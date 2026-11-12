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
