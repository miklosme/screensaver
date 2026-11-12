// What the tooling knows about the show, read from the source so that adding a scene or
// re-timing the timeline needs no change here.
import { resolve } from "node:path";
import { TIMING } from "../src/scenes/types";

export const ROOT = resolve(import.meta.dir, "..");
export { TIMING };

/**
 * Scene ids in playing order. Read from the text of src/scenes/index.ts, not imported: the scene
 * modules pull in three.js and the browser. `SCENES=a,b` overrides, for a list this cannot parse.
 */
export async function sceneIds(): Promise<string[]> {
  const override = process.env.SCENES?.split(",").filter(Boolean);
  if (override?.length) return override;
  const text = await Bun.file(resolve(ROOT, "src/scenes/index.ts")).text();
  const ids = [...text.matchAll(/\bid:\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1]!);
  if (!ids.length)
    throw new Error('no `id: "<name>"` entries found in src/scenes/index.ts: set SCENES=a,b,c or teach scripts/show.ts the new shape');
  return ids;
}

/** A time written for the original 25 s timeline, moved to wherever that moment now falls. */
export const at = (t: number) => +((t * TIMING.total) / 25).toFixed(2);
