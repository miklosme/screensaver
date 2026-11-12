# screensaver

A WebGL screensaver: four scenes joined by portals into one endless camera ride. `README.md` explains the architecture.

## Scenes are pure functions of `clock.t`

Everything a scene shows, camera included, is computed from `clock.t` inside `useFrame`. This is what lets `?t=<seconds>` freeze any frame and lets the next scene render inside the current one's portal. Derive motion from `clock.t`; wall-clock time and frame deltas break both.

The director also relies on it: while a scene waits at `t` = 0 its portal image is rendered once and reused, so anything not derived from `clock.t` would freeze there and jump at the takeover.

Moving things added to a scene (creatures, particles) are placed in a vertex shader from `clock.t`, and those that share the air with the camera are pushed out of a cone ahead of it (`uEye` / `uFwd` in `helix/koi.ts`, `orbit/sky.ts`), which is what keeps the line of flight clear.

## Scenes are mounted once

All scenes mount at start-up and never unmount, and the first frame renders each one to compile and upload everything it owns. Build geometry, materials and textures at mount; anything created later costs a dropped frame mid-flight.

`src/main.tsx` registers the three.js classes usable as JSX. Writing a JSX element that is not in its `extend` list fails at runtime, not at typecheck.

## Before touching a camera, a track, or scene timing

Read `src/scenes/rail.ts` (the seam state every scene holds at both ends of its timeline) and the timeline in `src/scenes/types.ts`.

- A track's own parameter is often not true distance (helix indexes by plan length, orbit by unrolled cylinder coordinates). `createRide` works in real world units, so convert before using it.
- Lengthening or slowing an arrival pushes every later beat of that scene back. Re-time the beats that are keyed to `t` (door swings, look targets, FOV ramps) against where the camera now is.
- Props are often placed relative to the camera track, so moving a track can put one on the line of flight.

A camera change is done when both seams hold the seam state and frames at `t` = 0, 5, 12, 20 and 24.5 show a clear line of flight and the portal filling the screen at the end.

## Looking at a frame

`scripts/shot.sh <scene> <t> <out.png>` screenshots one frozen frame and needs `bun run dev` running; set `PORT` if vite landed somewhere other than 5173.

- Run at most three shots at once and retry any PNG under ~9 KB: overloaded headless Chrome returns a blank frame with no error.
- Headless Chrome advances only a few animation frames under `--virtual-time-budget`. To sample a scene over time, call `__screensaver.freeze(t)` then `__screensaver.advance(ms)` in a loop (dev builds only) instead of waiting on frames.
- A real GPU works headless with `--use-angle=vulkan --enable-features=Vulkan` in place of the swiftshader flags, and is fast enough to shoot whole contact sheets.

## Checks

`bun run typecheck` and `bun run build`. There are no tests, so a frame is the only evidence that a visual change works.

For performance, the evidence is a full loop with no long frame: run `?speed=2` for 90 s recording `requestAnimationFrame` deltas, and expect none above ~20 ms after the first frame. A hitch at a scene's `t` = 5 or 12 means something was built or compiled in flight.
