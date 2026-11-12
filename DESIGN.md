# Design

What the screensaver is meant to be, what may not change, and how a frame is judged. `AGENTS.md`
covers how the code works; this file covers taste.

## The brief

The owner's own words, collected from the sessions that built this. They outrank everything below.

- "something similar like the Win95/98 labyrinth screensaver, just much less straight lines"
- "that 3D game gimmick when the camera enters a door, and the inner room is larger than when the
  outside suggested", and "when the camera goes up in an infinite staircase"
- "there must be no ui, just the webgl animation"
- scenes linked "with some sort of transformation, ideally integrated [into] the exit and enter
  visuals", changing about every 20 seconds
- "make the camera feel like it's on a single railway"
- "the graphics could be more detailed"
- the result should be "mesmerizing, strange, and whimsical"

**Mesmerizing, strange, whimsical** is the test for every change. Mesmerizing: you keep watching,
because something is always unfolding. Strange: the space could not exist. Whimsical: it is
friendly and a little funny, never grim, never a tech demo.

## Fixed

The loop improves how the four worlds look. It keeps these as they are:

- **Four scenes, in this order:** helix, burrow, dollhouse, orbit. Each keeps its premise and its
  palette (below), so the four stay unmistakably different from one another.
- **The ride:** the 25 s timeline (`src/scenes/types.ts`), the rail (`src/scenes/rail.ts`), and
  the exit portal that is a live window into the next scene. Camera tracks and beat timing change
  only when a backlog item says so by name.
- **No UI**, no text, no logos.
- **Procedural only:** `three` and `@react-three/fiber`, nothing loaded at runtime. Every texture,
  mesh and sky is built in code at mount.
- **A frame is a pure function of `clock.t`.** Anything that reads a previous frame (temporal
  anti-aliasing, accumulation, feedback trails) is out, because `?t=` must reproduce any frame
  exactly. Motion blur and trails are still possible when computed analytically from `clock.t`.

## The four worlds

| | helix | burrow | dollhouse | orbit |
|---|---|---|---|---|
| Premise | An endless double-helix stair climbing a round arcade shaft. | The Win95 maze with no straight wall: a ribbed living tunnel that forks and curls. | A daylight dune garden of paper-thin doorways whose insides are vast. | A night town wrapped round the inside of a cylinder, so streets hang overhead. |
| Palette | Sandstone, ivory and amber light against a deep teal void. | Coral, magenta and plum with mint bioluminescence. | Soft pastels: peach, mint, cream, powder blue. The one daylight scene. | Indigo and midnight blue, warm gold lamps, a few cyan accents. |
| Who lives there | Lantern koi swimming up the shaft. | Eyes in the walls that wake as you pass; glowing mushrooms. | Flowers, pinwheels, paper birds. | A star-freckled whale and her calf; rising paper lanterns. |
| Exit | A free-standing keyhole arch on a landing. | A spinning hoop in a dead-end dome. | A door on a bare plinth, seen to be empty from behind. | A moon gate on a tiny hut. |
| The gimmick | The stair never ends. | You are being led, and the walls are watching. | Bigger on the inside. | Up keeps rotating. |

## What a good frame has

Reviewers judge frames against this list, and workers build towards it.

- **It looks designed.** Strong palette, clear focal point, curves everywhere. A viewer could not
  mistake it for a three.js example.
- **Depth reads.** Foreground, middle and far layers separate through fog, value contrast and
  overlap. Something is always near the lens and something is always far away.
- **Light comes from somewhere.** Things that glow bloom, and light the surfaces next to them.
  Things that stand on the ground touch it: a contact shadow, a pool of light, an occluded base.
- **Detail holds at every distance.** The surface nearest the camera survives a 4K screen: no
  stretched texels, no visible facets on something meant to be round, no flat untextured slab.
- **The exit is the most crafted object in its scene.** The camera stares at it for the last five
  seconds, and it must look too small or too thin to hold another world.
- **It reads small.** For its first five seconds a scene is a thumbnail inside the previous
  scene's portal, so the opening composition needs a silhouette that works at postage-stamp size.
- **Something is alive every second.** Slow, hypnotic, continuous motion; nothing pops, nothing
  jitters, nothing crosses the line of flight.

## What the loop may now use

The scenes were first built under a tight rule set (no post-processing, no render targets, no
shadows, three lights). Those were budget guesses, and the measured budget below replaces them.
Post-processing, extra render targets and shadow maps are all allowed when:

- screen-space effects run in the director, so both sides of a takeover get the identical
  treatment and the seam stays invisible;
- everything is built at mount and warmed on the first frame;
- the gate still passes.

## Budgets

The numbers live in `loop/budget.json`; `bun scripts/look.ts gate <dir>` measures against them on
this machine (RTX 4070 Ti, headless Chrome on Vulkan) and fails on any breach.

- `frameMs4k`: the most one frame may cost at 3840x2160, at any sampled time in any scene. The
  baseline is about 1 ms; the budget leaves a 60 Hz frame reachable on a GPU four times slower.
- `hitchMs`: the longest gap between two frames across two full loops at `?speed=2`. A hitch at a
  scene's `t` = 5 or 12 means something was built or compiled in flight.
- `seamRmse`: how much the picture may differ across a takeover (outgoing scene at `t` = 24.99
  against the incoming one at `t` = 5).
- `bundleGzipKb`: gzipped JavaScript in `dist/`.

Raising a budget is the owner's call. A change that needs more room goes to `loop/DIRECTION.md`
as a question; it does not edit `loop/budget.json`.
