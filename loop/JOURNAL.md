# Journal

One entry per pass, newest last. The director appends; nobody edits old entries.

```
## Pass NNN (date)
Slices: <id> <worker model> kept | reverted | dropped, one line each with the reason
Gate: frame cost worst <ms> (<scene>), loop worst <ms>, seams <min>–<max>% RMSE, bundle <kB>
Panel: <who reviewed>
Scores (mean of the panel): helix <n>, burrow <n>, dollhouse <n>, orbit <n>
Learned: what the next director should know that the backlog does not say
```

## Pass 000 (2026-11-12)

The baseline, measured on `master` at `a5ac302` while the loop was being set up. No code changed.

Slices: none
Gate: frame cost worst 2.35 ms (orbit), loop worst 13 ms, seams 3.9–5.5% RMSE, bundle 241 kB
Panel: astra, sol, fable
Scores (mean of the panel): helix 6.0, burrow 5.7, dollhouse 4.7, orbit 6.7
Learned:
- All three reviewers ranked the dollhouse's flat, washed-out values first, and all three named
  the exit set pieces, the burrow's tiled walls and the helix's bare near surfaces.
- The seam numbers are not noise: a scene seen through a portal is visibly paler than the same
  scene drawn direct (`loop/out/pass-000/seam-burrow-dollhouse.jpg`). K1 is about that.
- Headless Chrome sometimes drops the GL context as a page first appears. `scripts/look.ts`
  reloads when it sees that; without the reload the run shows 20 to 60 ms hitches that are the
  harness's doing (K2 is the real-world half of the same gap).
- About 1.7 ms of the 4 ms frame budget at 4K is unused in the costliest scene.

## Pass 001 (2026-11-12)

Slices:
- K1 all · One colour pipeline, with bloom (fable) kept: both sides of every takeover are now the
  same picture, emitters bloom. K2 (re-warm after a restored GL context) rode along, kept.
- H1 helix · Stone that holds up close (opus) kept: all three reviewers raised helix by a point.
- D1 dollhouse · Things stand on the ground, in sunlight (opus) kept, came back short on colour;
  D1b (fable) finished it after K1 landed. Dollhouse went from 4.7 to 6.0.
- B1 burrow · Wet, living walls (opus) reverted: all three reviewers called the outlined cells a
  regression (paved, noisy, the ribs' value depth gone).
- O1 orbit · A town with depth (opus) reverted: astra and sol said the overhead town went dark
  and stopped reading as a wrapped city.
Gate: frame cost worst 3.21 ms (orbit), loop worst 12 ms, seams 0.00–0.28% RMSE, bundle 251 kB
Panel: astra, sol, fable
Scores (mean of the panel): helix 7.0, burrow 6.3, dollhouse 6.0, orbit 6.7. The burrow and orbit
scores were given to B1 and O1 before they were reverted (`loop/out/pass-001/reviewed/`); what
`loop` holds for those two scenes is pass 000 plus K1's bloom, which nobody scored.
Learned:
- The seam number the gate used to print was 0.01 s of camera travel. `look.ts seams` now
  compares the same instant on both sides, and `seamRmse` is 0.01. A seam over 0.3% is now real.
- K1's final pass costs about 0.7 ms at 4K (mostly drawing the current scene into a float
  multisampled target). About 0.8 ms of the 4 ms budget is left in the costliest scene.
- The scenes were lit for an 8-bit canvas: lights are 1.3 to 1.6 against surfaces up to 0.8, so
  bloom thresholds sit just above the surfaces. A slice that wants a glow raises the emitter
  well above 1 in the scene and then that scene's threshold in `src/director/looks.ts`.
- Colours are tone-mapped (ACES) after everything. A pastel picked by eye comes out grey; the
  dollhouse's `onScreen` helper in `garden.ts` inverts the curve so a colour can be written as
  it should look. Additive sprites now add in linear light and come out dimmer than at pass 000.
- A scene slice built in parallel with a keystone that changes the picture cannot be tuned: D1
  had to wait for K1 and be finished afterwards. Next time the keystone lands first, or the
  scene slices are ones the keystone cannot move.
- Both reverted slices over-applied one idea across the whole frame (an outline on every cell,
  fog on every window). Briefs for surface work should name what must survive: the ribs' value
  falloff, the lit windows overhead.
- I read the one-reviewer revert rule as a judgment on the whole slice and kept D1 and K1
  despite a confirmed regression each; the question is with the owner in `loop/DIRECTION.md`.
- In T3 Code the workers are started with `delegate_task` (`isolation: "worktree"`), not the
  Agent tool; their branches are `t3/<slug>` and their worktrees live under `~/.t3/worktrees/`.
  A "completed" notice can be a worker pausing on a background job: check for its commit. Worker
  frames are untracked, so copy them into `loop/out/pass-NNN/workers/` before removing a worktree.
- Five parallel workers make frame-cost numbers useless (plus or minus 0.5 ms); workers that
  measured against their own "before" in alternation got usable deltas. The owner commits to
  `loop` while a pass runs: check `git log` before each merge.
