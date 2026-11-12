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

- `src/director/Director.tsx` keeps two scenes mounted: the current one and the next one. The
  next scene is rendered into a render target, and the current scene's exit portal samples that
  target in screen space (`portalMaterial.ts`). When the portal fills the screen the scenes swap,
  which is invisible because both images are pixel-identical at that moment.
- Every scene runs on the same 25 s local timeline, documented in `src/scenes/types.ts`. A new
  scene takes over the screen every 20 s.
- The cut only hides if the *motion* matches too, so all cameras share one rail
  (`src/scenes/rail.ts`): around both ends of its timeline every scene travels dead straight along
  its view axis, without rotating, at one common speed, and eases in and out of that state like a
  railway transition curve.
- Scenes are listed in `src/scenes/index.ts` and loop in that order. To add one, write a component
  that takes `SceneProps`, put `portalMaterial` on its exit opening, drive its camera with
  `createRide` from a track that starts and ends straight, and register it.

## Debugging

There is no UI, only query params:

- `?scene=<id>` start at that scene (`helix`, `burrow`, `dollhouse`, `orbit`)
- `?t=<seconds>` freeze the scene clock at a local time
- `?speed=<n>` time multiplier

`scripts/shot.sh <scene> <t> <out.png>` takes a headless Chrome screenshot of a frozen frame.
