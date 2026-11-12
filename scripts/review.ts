#!/usr/bin/env bun
// The review panel for one pass of the loop: independent reviewers on different models, each
// answering loop/review.schema.json about the frames and numbers in a gate directory.
//
//   bun scripts/review.ts <passDir> [--prev <prevPassDir>] [--only astra,sol,fable,opus] [--dry]
//
// --dry prints the prompt, the schema and the image list, and calls nobody.
//
// Default panel: GPT-6 Astra and GPT-6.1 Sol through the Codex CLI, Claude Fable 5.2 through the
// Claude CLI. When a Codex reviewer fails (the ChatGPT plan's usage window is spent, or anything
// else), Claude Opus 5.5 reviews in its place, so the panel never drops below two.
//
// Writes review-<name>.json per reviewer, panel.json (who ran, who failed and why) and
// reviews.md (all answers side by side). Exits 1 with fewer than two reviews.
import { spawn } from "bun";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT, at, sceneIds } from "./show";

const SCENES = await sceneIds();
/** frames of each scene shown at full size: mid-ride, and the approach to the exit */
const CLOSE_T = [8.5, 22].map(at);
const TIMEOUT_MS = 20 * 60_000;

type Reviewer = { cli: "codex" | "claude"; model: string };
const REVIEWERS: Record<string, Reviewer> = {
  astra: { cli: "codex", model: "gpt-6-astra" },
  sol: { cli: "codex", model: "gpt-6.1-sol" },
  fable: { cli: "claude", model: "claude-fable-5-2" },
  opus: { cli: "claude", model: "claude-opus-5-5" },
};
const PANEL = ["astra", "sol", "fable"];
const STAND_IN = "opus";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args.splice(i, 2)[1]!;
};
const prevArg = flag("--prev");
const only = flag("--only")?.split(",");
const dry = args.includes("--dry") && args.splice(args.indexOf("--dry"), 1).length > 0;
if (args.length !== 1) {
  console.error("usage: bun scripts/review.ts <passDir> [--prev <prevPassDir>] [--only astra,sol,fable,opus] [--dry]");
  process.exit(2);
}
const passDir = resolve(args[0]!);
const prevDir = prevArg ? resolve(prevArg) : null;
const rel = (p: string) => relative(ROOT, p);

const sheets = SCENES.map((s) => join(passDir, `${s}.jpg`));
const closeFrames = SCENES.flatMap((s) => CLOSE_T.map((t) => join(passDir, "frames", `${s}-${t}.png`)));
// a scene added in this pass has no sheet in the previous one
const prevSheets = prevDir ? SCENES.map((s) => join(prevDir, `${s}.jpg`)).filter(existsSync) : [];
const newScenes = prevDir ? SCENES.filter((s) => !existsSync(join(prevDir, `${s}.jpg`))) : [];
for (const f of [...sheets, ...closeFrames, join(passDir, "gate.json")])
  if (!existsSync(f)) throw new Error(`missing ${rel(f)}: run \`bun scripts/look.ts gate ${rel(passDir)}\` first`);
const images = [...sheets, ...closeFrames, ...prevSheets];
const hasDiff = existsSync(join(passDir, "diff.patch"));

// loop/review.schema.json is written for the first four scenes; the scene names in it are
// replaced with the ones the show has now
const schema = await Bun.file(join(ROOT, "loop/review.schema.json")).json();
schema.properties.scores.required = SCENES;
schema.properties.scores.properties = Object.fromEntries(SCENES.map((s) => [s, { type: "integer", minimum: 1, maximum: 10 }]));
for (const list of ["regressions", "problems", "opportunities"]) schema.properties[list].items.properties.scene.enum = [...SCENES, "all"];
const schemaText = JSON.stringify(schema);
const schemaFile = join(passDir, "review.schema.json");
const prompt = [
  await Bun.file(join(ROOT, "loop/REVIEWER.md")).text(),
  "## This pass",
  "",
  `Paths are relative to the repository root, which is your working directory.`,
  "",
  `- Design: DESIGN.md`,
  `- Contact sheets: ${sheets.map(rel).join(", ")}`,
  `- Close frames: ${closeFrames.map(rel).join(", ")}`,
  `- Numbers: ${rel(join(passDir, "gate.json"))}, ${rel(join(passDir, "perf.json"))}, ${rel(join(passDir, "seams.json"))}`,
  hasDiff ? `- Diff: ${rel(join(passDir, "diff.patch"))}` : `- Diff: none, this is the baseline pass`,
  prevDir ? `- Previous pass's sheets: ${prevSheets.map(rel).join(", ")}` : `- Previous pass: none, so \`regressions\` is empty`,
  ...(newScenes.length ? [`- New in this pass, so with nothing to compare against: ${newScenes.join(", ")}`] : []),
  "",
  "The images are attached when your harness supports attachments; otherwise open each path above with your file reading tool.",
  "",
].join("\n");

async function run(name: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const { cli, model } = REVIEWERS[name]!;
  const out = join(passDir, `review-${name}.json`);
  const started = Date.now();
  const cmd =
    cli === "codex"
      ? // medium effort stretches a ChatGPT plan's usage window; reviewers only read
        ["codex", "exec", "-m", model, "-s", "read-only", "--ephemeral", "-C", ROOT, "-c", 'model_reasoning_effort="medium"',
          "--output-schema", schemaFile, "-o", out, ...images.flatMap((f) => ["-i", f]), "-"]
      : ["claude", "-p", "--model", model, "--output-format", "json", "--json-schema", schemaText,
          "--allowedTools", "Read,Glob,Grep", "--no-session-persistence"];
  const tail = (s: string) => s.trim().split("\n").slice(-6).join("\n").slice(-600);
  try {
    // a CLI that is missing or cannot start is a failed reviewer like any other
    const proc = spawn(cmd, { cwd: ROOT, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error(`exit ${code}: ${tail(stderr) || tail(stdout)}`);
    let review: any;
    if (cli === "codex") review = JSON.parse(await Bun.file(out).text());
    else {
      const envelope = JSON.parse(stdout);
      if (envelope.is_error || !envelope.structured_output) throw new Error(`no structured output: ${tail(String(envelope.result ?? stdout))}`);
      review = envelope.structured_output;
    }
    if (!Array.isArray(review.problems) || !review.scores) throw new Error("answer does not follow the schema");
    await Bun.write(out, JSON.stringify(review, null, 1));
    console.log(`${name}: reviewed in ${Math.round((Date.now() - started) / 1000)} s`);
    return { ok: true };
  } catch (e) {
    console.log(`${name}: FAILED, ${(e as Error).message.split("\n")[0]}`);
    return { ok: false, why: (e as Error).message };
  }
}

const wanted = only ?? PANEL;
for (const n of wanted) if (!REVIEWERS[n]) throw new Error(`unknown reviewer ${n} (have ${Object.keys(REVIEWERS).join(", ")})`);
if (dry) {
  console.log(prompt + "\n## Schema\n\n" + JSON.stringify(schema, null, 1) + "\n\n## Images\n\n" + images.map(rel).join("\n"));
  process.exit(0);
}
await Bun.write(schemaFile, schemaText);
const results = Object.fromEntries(await Promise.all(wanted.map(async (n) => [n, await run(n)] as const)));
const codexFailed = wanted.some((n) => REVIEWERS[n]!.cli === "codex" && !results[n]!.ok);
if (!only && codexFailed) {
  console.log(`a Codex reviewer failed: ${STAND_IN} stands in`);
  results[STAND_IN] = await run(STAND_IN);
}

const ran = Object.keys(results).filter((n) => results[n]!.ok);
const failed = Object.fromEntries(Object.entries(results).filter(([, r]) => !r.ok).map(([n, r]) => [n, (r as { why: string }).why]));
await Bun.write(join(passDir, "panel.json"), JSON.stringify({ ran, failed, standIn: !only && codexFailed }, null, 1));

const md: string[] = [`# Reviews: ${rel(passDir)}`, "", `Panel: ${ran.join(", ") || "nobody"}` + (Object.keys(failed).length ? `. Failed: ${Object.keys(failed).join(", ")}.` : "."), ""];
const reviews = Object.fromEntries(await Promise.all(ran.map(async (n) => [n, await Bun.file(join(passDir, `review-${n}.json`)).json()] as const)));
md.push("## Scores", "", `| reviewer | ${SCENES.join(" | ")} |`, `|---|${SCENES.map(() => "---").join("|")}|`);
for (const n of ran) md.push(`| ${n} | ${SCENES.map((s) => reviews[n].scores[s]).join(" | ")} |`);
for (const n of ran) {
  const r = reviews[n];
  md.push("", `## ${n}`, "");
  if (r.regressions.length) md.push("Regressions:", ...r.regressions.map((x: any) => `- **${x.scene} t=${x.t}**: ${x.what}`), "");
  md.push("Problems, worst first:", ...r.problems.map((x: any, i: number) => `${i + 1}. **${x.scene} t=${x.t}, ${x.where}**: ${x.what} Fix: ${x.fix}`), "");
  if (r.opportunities.length) md.push("Opportunities:", ...r.opportunities.map((x: any) => `- **${x.scene}, ${x.where}**: ${x.technique}. ${x.payoff}`));
}
await Bun.write(join(passDir, "reviews.md"), md.join("\n") + "\n");
console.log(rel(join(passDir, "reviews.md")));
if (ran.length < 2) process.exitCode = 1;
