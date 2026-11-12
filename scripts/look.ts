#!/usr/bin/env bun
// Eyes and a stopwatch for agents: one headless Chrome on the real GPU, driven over CDP.
//
//   bun scripts/look.ts shots <outDir> <scene:t> [<scene:t> ...]   frozen frames, 1920x1080
//   bun scripts/look.ts sheet <outDir> [scene ...]                 3x3 contact sheet per scene
//   bun scripts/look.ts perf  <out.json> [--frames|--loop] [scene ...]  frame cost at 4K, and a 92 s hitch run
//   bun scripts/look.ts seams <out.json>                           picture difference across each takeover
//   bun scripts/look.ts gate  <outDir> [--since <git-ref>]         all of the above + typecheck, build, diff
//
// It starts its own vite dev server on a free port, so it works unchanged inside a git worktree.
// Set BASE=http://localhost:5173 to reuse a running one, GPU=0 to fall back to swiftshader.
// `gate` exits 1 when anything is over loop/budget.json; `perf` and `seams` do so too.
import { $, spawn, type Subprocess } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCENES = ["helix", "burrow", "dollhouse", "orbit"];
/** local times a contact sheet shows: arrival, release, solo, portal opening, exit, portal full */
const SHEET_T = [0, 2.5, 5, 8.5, 12, 15.5, 19, 22, 24.5];
const PERF_T = [0, 2.5, 5, 8, 10, 12, 14, 16, 18, 20, 22, 24, 24.8];
const GPU = process.env.GPU !== "0";

const children: Subprocess[] = [];
const tempDirs: string[] = [];
async function cleanup() {
  for (const c of children) c.kill();
  for (const d of tempDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port!;
  await server.stop(true);
  return port;
}

let base = process.env.BASE ?? "";
async function serve(): Promise<string> {
  if (base) return base;
  const port = await freePort();
  children.push(
    spawn(["bun", "x", "vite", "--port", String(port), "--strictPort"], { cwd: ROOT, stdout: "ignore", stderr: "ignore" }),
  );
  base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base)).ok) return base;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("vite did not start");
}

interface Browser {
  evaluate(expression: string): Promise<any>;
  open(path: string): Promise<void>;
  screenshot(file: string): Promise<void>;
  logs: string[];
  close(): void;
}

/** One page of the given CSS size. `dpr` 2 at 1920x1080 is a 4K drawing buffer. */
async function browser(width: number, height: number, dpr = 1): Promise<Browser> {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "look-"));
  tempDirs.push(profile);
  const chrome = spawn(
    [
      "google-chrome",
      "--headless=new",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--ignore-gpu-blocklist",
      `--window-size=${width},${height}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...(GPU
        ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--enable-gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  children.push(chrome);

  let wsUrl = "";
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = ((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as any).webSocketDebuggerUrl;
    } catch {
      await Bun.sleep(100);
    }
  }
  if (!wsUrl) throw new Error("chrome did not start");
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const logs: string[] = [];
  const born = performance.now();
  const stamp = () => `[+${((performance.now() - born) / 1000).toFixed(1)}s]`;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") {
      logs.push(stamp() + "[exception] " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      logs.push(stamp() + `[${m.params.type}] ` + m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
    }
  };
  const send = (method: string, params: object = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (method: string, params: object = {}) => send(method, params, sessionId);
  await S("Page.enable");
  await S("Runtime.enable");
  await S("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await S("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__lost = 0; addEventListener('webglcontextlost', () => window.__lost++, true);",
  });

  const evaluate = async (expression: string) => {
    const r = await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    evaluate,
    logs,
    async open(path) {
      // Headless Chrome on ANGLE/Vulkan sometimes drops a fresh GL context as the page is first
      // presented. three restores it, but the director's warm-up is gone, so every program then
      // compiles in flight. Such a load is reloaded: it would measure the harness, not the show.
      for (let attempt = 0; ; attempt++) {
        logs.length = 0;
        await S("Page.navigate", { url: (await serve()) + path });
        // the dev handle appears once the director has mounted, i.e. once every scene is built
        for (let i = 0; i < 600; i++) {
          await Bun.sleep(100);
          if (await evaluate("!!window.__screensaver && !!document.querySelector('canvas')").catch(() => false)) break;
          if (i === 599) throw new Error(`page never mounted: ${path}\n${logs.join("\n")}`);
        }
        await evaluate(FRAMES(8));
        if (!(await evaluate("window.__lost"))) return;
        if (attempt === 4) throw new Error(`the WebGL context was lost on five loads in a row: ${path}`);
      }
    },
    async screenshot(file) {
      const { data } = await S("Page.captureScreenshot", { format: "png" });
      await mkdir(dirname(file), { recursive: true });
      await Bun.write(file, Buffer.from(data, "base64"));
    },
    close() {
      ws.close();
      chrome.kill();
    },
  };
}

const FRAMES = (n: number) =>
  `new Promise(r => { let k = 0; const f = () => (++k >= ${n} ? r(k) : requestAnimationFrame(f)); requestAnimationFrame(f); })`;
const FREEZE = (t: number) => `(window.__screensaver.freeze(${t}), ${FRAMES(4)})`;

function reportLogs(b: Browser) {
  // an exception in a scene is a finding in itself: it must reach whoever is looking
  if (b.logs.length) console.error("page errors:\n" + [...new Set(b.logs)].slice(0, 20).join("\n"));
}

// ---------------------------------------------------------------------------------------------

async function shots(outDir: string, list: string[]) {
  const b = await browser(1920, 1080);
  let scene = "";
  for (const item of list) {
    const [s, t] = item.split(":");
    if (!SCENES.includes(s!) || t === undefined) throw new Error(`expected <scene>:<t>, got ${item}`);
    if (s !== scene) await b.open(`/?scene=${(scene = s!)}&t=${t}`);
    await b.evaluate(FREEZE(Number(t)));
    const file = join(outDir, `${s}-${t}.png`);
    await b.screenshot(file);
    console.log(file);
  }
  reportLogs(b);
  b.close();
}

async function sheet(outDir: string, scenes: string[]) {
  const b = await browser(1280, 720);
  for (const scene of scenes) {
    await b.open(`/?scene=${scene}&t=0`);
    const frames: string[] = [];
    for (const t of SHEET_T) {
      await b.evaluate(FREEZE(t));
      const file = join(outDir, "frames", `${scene}-${t}.png`);
      await b.screenshot(file);
      frames.push(file);
    }
    const out = join(outDir, `${scene}.jpg`);
    const labelled = frames.flatMap((f, i) => ["-label", `${scene}  t=${SHEET_T[i]}`, f]);
    await $`montage -background black -fill white -font DejaVu-Sans -pointsize 22 ${labelled} -tile 3x3 -geometry 800x450+3+3 -quality 90 ${out}`.quiet();
    console.log(out);
  }
  reportLogs(b);
  b.close();
}

/** Runs inside the page: average cost of a frame at each sampled time, forced through the GPU. */
const PROFILE = `(async () => {
  const S = window.__screensaver, gl = S.gl, ctx = gl.getContext();
  const px = new Uint8Array(4);
  const sync = () => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  gl.info.autoReset = false;
  let now = performance.now();
  const frame = (t) => { S.freeze(t); now += 16; S.advance(now); sync(); };
  const samples = [];
  for (const t of ${JSON.stringify(PERF_T)}) {
    for (let i = 0; i < 4; i++) frame(t);
    gl.info.reset();
    frame(t);
    const calls = gl.info.render.calls, triangles = gl.info.render.triangles;
    const N = 40, t0 = performance.now();
    for (let i = 0; i < N; i++) frame(t);
    samples.push({ t, ms: +((performance.now() - t0) / N).toFixed(3), calls, triangles });
  }
  return { size: [ctx.drawingBufferWidth, ctx.drawingBufferHeight], samples,
    programs: gl.info.programs.length, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures };
})()`;

/** Runs inside the page: every requestAnimationFrame gap over `ms` of the show at ?speed=2. */
const HITCHES = (ms: number, limit: number) => `(async () => {
  // lap 0 is the first visit to each scene: a hitch only there means something was built late
  const S = window.__screensaver, names = ${JSON.stringify(SCENES)};
  const hitches = [], deltas = [];
  let last = performance.now();
  const start = last;
  await new Promise((done) => {
    const tick = () => {
      const now = performance.now(), d = now - last;
      last = now;
      if (now - start > 1000) {
        deltas.push(d);
        const seq = S.live.seq, t = S.live.time - seq * 20 + 5;
        if (d > ${limit}) hitches.push({ ms: Math.round(d), scene: names[seq % names.length], t: +t.toFixed(2), lap: Math.floor(seq / names.length) });
      }
      if (now - start > ${ms}) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  deltas.sort((a, b) => a - b);
  const n = deltas.length;
  return { frames: n, medianMs: +deltas[n >> 1].toFixed(2), p99Ms: +deltas[Math.floor(n * 0.99)].toFixed(2),
    worstMs: Math.round(deltas[n - 1]), hitches, contextLost: window.__lost };
})()`;

interface Budget {
  frameMs4k: number;
  hitchMs: number;
  seamRmse: number;
  bundleGzipKb: number;
}
const budget = (): Promise<Budget> => Bun.file(join(ROOT, "loop/budget.json")).json();

async function perf(out: string, scenes: string[], part: "all" | "frames" | "loop") {
  if (!GPU) throw new Error("perf needs the real GPU: frame costs under swiftshader mean nothing");
  const limits = await budget();
  const result: any = { budget: limits, scenes: {}, breaches: [] as string[] };
  const b = part === "loop" ? null : await browser(1920, 1080, 2);
  for (const scene of b ? scenes : []) {
    if (!b) break;
    await b.open(`/?scene=${scene}&t=0`);
    const p = await b.evaluate(PROFILE);
    const worst = p.samples.reduce((a: any, s: any) => (s.ms > a.ms ? s : a));
    result.scenes[scene] = {
      avgMs: +(p.samples.reduce((a: number, s: any) => a + s.ms, 0) / p.samples.length).toFixed(3),
      worstMs: worst.ms,
      worstAt: worst.t,
      maxCalls: Math.max(...p.samples.map((s: any) => s.calls)),
      maxTriangles: Math.max(...p.samples.map((s: any) => s.triangles)),
      programs: p.programs,
      geometries: p.geometries,
      textures: p.textures,
      samples: p.samples,
    };
    result.drawingBuffer = p.size;
    if (worst.ms > limits.frameMs4k)
      result.breaches.push(`${scene}: frame costs ${worst.ms} ms at t=${worst.t} (budget ${limits.frameMs4k} ms at 4K)`);
  }
  if (b) reportLogs(b);
  b?.close();
  if (part !== "frames") {
    // 92 s at double speed is a little over two full loops: the second one proves nothing is built late
    const h = await browser(1920, 1080);
    await h.open("/?speed=2");
    result.loop = await h.evaluate(HITCHES(92_000, limits.hitchMs));
    if (result.loop.contextLost) result.breaches.push("the WebGL context was lost during the loop run: the measurement is void");
    for (const x of result.loop.hitches)
      result.breaches.push(`hitch: ${x.ms} ms frame in ${x.scene} at t=${x.t}, lap ${x.lap} (budget ${limits.hitchMs} ms)`);
    reportLogs(h);
    h.close();
  }
  await mkdir(dirname(out), { recursive: true });
  await Bun.write(out, JSON.stringify(result, null, 1));
  for (const [scene, s] of Object.entries<any>(result.scenes))
    console.log(`${scene.padEnd(10)} avg ${s.avgMs} ms  worst ${s.worstMs} ms @ t=${s.worstAt}  calls ${s.maxCalls}  tris ${Math.round(s.maxTriangles / 1000)}k  programs ${s.programs}`);
  if (result.loop) {
    console.log(`loop       median ${result.loop.medianMs} ms  p99 ${result.loop.p99Ms} ms  worst ${result.loop.worstMs} ms`);
    for (const x of result.loop.hitches) console.log(`  ${x.ms} ms  ${x.scene} t=${x.t} lap ${x.lap}`);
  }
  return result.breaches as string[];
}

async function seams(out: string) {
  const limits = await budget();
  const dir = await mkdtemp(join(tmpdir(), "seams-"));
  tempDirs.push(dir);
  const b = await browser(1280, 720);
  const result: any = { budget: limits.seamRmse, seams: {}, breaches: [] as string[] };
  for (let i = 0; i < SCENES.length; i++) {
    const from = SCENES[i]!, to = SCENES[(i + 1) % SCENES.length]!;
    await b.open(`/?scene=${from}&t=24.99`);
    await b.screenshot(join(dir, "a.png"));
    await b.open(`/?scene=${to}&t=5`);
    await b.screenshot(join(dir, "b.png"));
    const cmp = await $`compare -metric RMSE ${join(dir, "a.png")} ${join(dir, "b.png")} null:`.nothrow().quiet();
    const rmse = Number(/\(([\d.e-]+)\)/.exec(cmp.stderr.toString())?.[1] ?? NaN);
    result.seams[`${from}->${to}`] = +rmse.toFixed(4);
    if (!(rmse <= limits.seamRmse))
      result.breaches.push(`seam ${from}->${to}: pictures differ by ${(rmse * 100).toFixed(1)}% RMSE (budget ${limits.seamRmse * 100}%)`);
    console.log(`seam ${from}->${to}  ${(rmse * 100).toFixed(2)}% RMSE`);
  }
  reportLogs(b);
  b.close();
  await mkdir(dirname(out), { recursive: true });
  await Bun.write(out, JSON.stringify(result, null, 1));
  return result.breaches as string[];
}

async function gate(outDir: string, since: string | null) {
  const limits = await budget();
  await mkdir(outDir, { recursive: true });
  const breaches: string[] = [];
  const checks: Record<string, unknown> = {};

  const tc = await $`bun run typecheck`.cwd(ROOT).nothrow().quiet();
  checks.typecheck = tc.exitCode === 0;
  if (tc.exitCode !== 0) breaches.push("typecheck fails:\n" + tc.stdout.toString().slice(-1500));

  const build = await $`bun run build`.cwd(ROOT).nothrow().quiet();
  checks.build = build.exitCode === 0;
  if (build.exitCode !== 0) breaches.push("build fails:\n" + build.stderr.toString().slice(-1500));
  else {
    let gzip = 0;
    for await (const f of new Bun.Glob("dist/assets/*.js").scan(ROOT)) gzip += Bun.gzipSync(await Bun.file(join(ROOT, f)).bytes()).length;
    checks.bundleGzipKb = Math.round(gzip / 1024);
    if (gzip / 1024 > limits.bundleGzipKb) breaches.push(`bundle is ${checks.bundleGzipKb} kB gzip (budget ${limits.bundleGzipKb} kB)`);
  }

  if (since) {
    await Bun.write(join(outDir, "diff.patch"), (await $`git diff ${since} -- src index.html package.json`.cwd(ROOT).quiet()).stdout);
    checks.diffStat = (await $`git diff --stat ${since} -- src index.html package.json`.cwd(ROOT).quiet()).stdout.toString().trim().split("\n").pop();
  }

  // a broken type or build is reported with everything else, but there is nothing to look at
  if (checks.typecheck && checks.build) {
    await sheet(outDir, SCENES);
    breaches.push(...(await seams(join(outDir, "seams.json"))));
    breaches.push(...(await perf(join(outDir, "perf.json"), SCENES, "all")));
  }
  const result = { pass: breaches.length === 0, breaches, checks };
  await Bun.write(join(outDir, "gate.json"), JSON.stringify(result, null, 1));
  console.log(result.pass ? "GATE PASS" : "GATE FAIL\n- " + breaches.join("\n- "));
  return breaches;
}

// ---------------------------------------------------------------------------------------------

const [mode, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args.splice(i, 2)[1]!;
};
const has = (name: string) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const sceneArgs = (list: string[]) => {
  for (const s of list) if (!SCENES.includes(s)) throw new Error(`unknown scene ${s} (have ${SCENES.join(", ")})`);
  return list.length ? list : SCENES;
};

let breaches: string[] = [];
try {
  if (mode === "shots" && args.length >= 2) await shots(args[0]!, args.slice(1));
  else if (mode === "sheet" && args.length >= 1) await sheet(args[0]!, sceneArgs(args.slice(1)));
  else if (mode === "perf" && args.length >= 1) {
    const part = has("--frames") ? "frames" : has("--loop") ? "loop" : "all";
    breaches = await perf(args[0]!, sceneArgs(args.slice(1)), args.length > 1 && part === "all" ? "frames" : part);
    if (breaches.length) console.log("OVER BUDGET\n- " + breaches.join("\n- "));
  } else if (mode === "seams" && args.length === 1) breaches = await seams(args[0]!);
  else if (mode === "gate" && args.length >= 1) {
    const since = flag("--since");
    breaches = await gate(args[0]!, since);
  } else {
    console.error((await Bun.file(import.meta.path).text()).split("\n").slice(1, 12).join("\n").replace(/^\/\/ ?/gm, ""));
    process.exitCode = 2;
  }
} finally {
  await cleanup();
}
if (breaches.length) process.exitCode = 1;
