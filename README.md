# screensaver

An endless camera journey through four impossible, curvy worlds. Each scene ends by flying
through a doorway that is a live window into the next one. No UI, just WebGL
(Vite + React + react-three-fiber).

```bash
bun install
bun run dev      # http://localhost:5173
bun run build    # static build in dist/
```

## How it works

- `src/director/Director.tsx` draws two scenes: the current one and the next one. The next scene
  is rendered into a render target, and the current scene's exit portal samples that target in
  screen space (`portalMaterial.ts`). When the portal fills the screen the scenes swap, which is
  invisible because both images are pixel-identical at that moment.
- Every scene is mounted once at start-up and stays mounted, and the first frame draws each of
  them once so that all shaders are compiled and all buffers uploaded before the show begins.
  Start-up takes a moment longer for it; in exchange no portal ever costs a dropped frame.
- Until a scene starts moving (its takeover is 5 s away) the portal onto it shows its first frame,
  which is rendered once and kept.
- Every scene runs on the same 25 s local timeline, documented in `src/scenes/types.ts`. A new
  scene takes over the screen every 20 s.
- The cut only hides if the *motion* matches too, so the cameras share one rail
  (`src/scenes/rail.ts`): a single closed, curvature-continuous track of climbs, dives and banked
  sweeps, 80 s round, cut into four seasons (spring, summer, fall, winter). A scene's place in the
  playing order picks its season (`index % 4`), and its 25 s are the last 5 s of the season before
  followed by its own 20, so the scene that is leaving and the one arriving ride the same piece
  of track with the same bank and speed, and the portal between them is a true window. The rail
  owns position, heading, bank and speed; a scene builds its world around its stretch. The burrow
  rides summer this way and the dollhouse fall. Helix and orbit still have their own tracks and
  meet the rail in the legacy seam state the same file describes: dead straight along the view
  axis, without rotating, at one common speed.
- Scenes are listed in `src/scenes/index.ts` and loop in that order. To add one, write a component
  that takes `SceneProps`, ask the rail for its stretch with `season(index)`, build the world
  along `stretch.frame(distance)`, put `portalMaterial` on an exit standing at
  `stretch.frame(stretch.exit)`, set the camera from `stretch.pose(clock.t)` every frame, and
  register it. The header of `rail.ts` is the full contract; `burrow.tsx` is the worked example.
- `src/main.tsx` registers only the three.js classes the scenes write as JSX (`<mesh>`,
  `<group>`, ...) instead of using r3f's `<Canvas>`, which would keep all of three.js in the
  bundle. A new kind of JSX element has to be added to that list.

## Who lives where

- `helix`: carved masonry and a stair runner painted in the stone shaders (`helix.tsx`), and a
  school of lantern koi (`helix/koi.ts`).
- `burrow`: eyes in the walls that wake as the camera nears, and glowing mushrooms
  (`burrow/creatures.ts`).
- `dollhouse`: flowers, pinwheels and paper birds (`dollhouse/garden.ts`), patterned trees,
  domes and hoops (`PATTERNS` in `dollhouse.tsx`).
- `orbit`: a star-freckled whale with her calf and rising paper lanterns (`orbit/sky.ts`).

Everything that moves is animated in a vertex shader from the scene clock, one instanced draw per
kind of creature.

## The improvement loop

The scenes are improved by an agent loop: a director (Claude Fable 5.2) hands slices of
`BACKLOG.md` to workers (Claude Opus 5.5) in parallel worktrees, gates the result on measured
budgets, and has three reviewers on different models rank what is still wrong. `DESIGN.md` is
the taste it works towards, `loop/LOOP.md` is the director's procedure, `loop/JOURNAL.md` is
what happened, and `loop/DIRECTION.md` is where the owner steers it.

## Debugging

There is no UI, only query params:

- `?scene=<id>` start at that scene (`helix`, `burrow`, `dollhouse`, `orbit`)
- `?t=<seconds>` freeze the scene clock at a local time
- `?speed=<n>` time multiplier

`bun scripts/look.ts` captures frozen frames and contact sheets in headless Chrome on the GPU,
and measures frame cost, hitches and seams; run it with no arguments for usage.
`scripts/shot.sh <scene> <t> <out.png>` is the software-rendered fallback.

In dev builds `window.__screensaver` exposes `freeze(t)` (freeze the scene clock, `null` to
release it), `advance(ms)` (render one frame now), the renderer as `gl` and the director's `live`
state, for sampling a scene over time or profiling it from a console or a headless browser.
