# screensaver

A WebGL screensaver: four scenes joined by portals into one endless camera ride. `README.md` explains the architecture.

## Scenes are pure functions of `clock.t`

Everything a scene shows, camera included, is computed from `clock.t` inside `useFrame`. This is what lets `?t=<seconds>` freeze any frame and lets the next scene render inside the current one's portal. Derive motion from `clock.t`; wall-clock time and frame deltas break both.

## Before touching a camera, a track, or scene timing

Read `src/scenes/rail.ts` (the seam state every scene holds at both ends of its timeline) and the timeline in `src/scenes/types.ts`.

- A track's own parameter is often not true distance (helix indexes by plan length, orbit by unrolled cylinder coordinates). `createRide` works in real world units, so convert before using it.
- Lengthening or slowing an arrival pushes every later beat of that scene back. Re-time the beats that are keyed to `t` (door swings, look targets, FOV ramps) against where the camera now is.
- Props are often placed relative to the camera track, so moving a track can put one on the line of flight.

A camera change is done when both seams hold the seam state and frames at `t` = 0, 5, 12, 20 and 24.5 show a clear line of flight and the portal filling the screen at the end.

## Looking at a frame

`scripts/shot.sh <scene> <t> <out.png>` screenshots one frozen frame and needs `bun run dev` running; set `PORT` if vite landed somewhere other than 5173.

- Run at most three shots at once and retry any PNG under ~9 KB: overloaded headless Chrome returns a blank frame with no error.
- Headless Chrome advances only a few animation frames under `--virtual-time-budget`. To sample a scene over time, set `clock.t` and call r3f's `advance()` in a loop instead of waiting on frames.

## Checks

`bun run typecheck` and `bun run build`. There are no tests, so a frame is the only evidence that a visual change works.
