# Backlog

What the improvement loop works on next. The director owns this file and rewrites it at the end
of every pass; workers and reviewers read it.

An item states an **outcome on screen**, so that a frame can prove it done:

```
- **<id> <scene> · <title>** — what a viewer sees when it is done.
  Technique: <how> · Files: <scope> · Worker: opus | fable · Frames: <scene>:<t> ...
  Source: <who raised it, which pass>
```

Ids: `K` keystone (touches the director, shared code, the rail or a camera track; one per pass,
built by Fable 5.2), `H` helix, `B` burrow, `D` dollhouse, `O` orbit.

## Queue

Ranked. A pass takes from the top, skipping items whose `Needs` is not done yet. "Panel 3/3"
means all three reviewers of that pass raised it independently. The first three items are the
owner's (`loop/DIRECTION.md`, handled in pass 001) and outrank the panel.

- **B5 burrow · Rebuilt around summer (second try)** — the burrow rides the rail's summer
  stretch (`season(1)` in `src/scenes/rail.ts`) and is at least as good a picture as the legacy
  burrow in every frame of the sheet: the glowing knot hangs at the vanishing point through
  t=0 to 5 (it is the scene's thumbnail), each junction shows two distinct mouths as the camera
  nears it (the fork at t=15.5), no two frames of the sheet are the same composition (t=19 looks
  down a curl, not a straight bore), two or three readable eyes are in frame through the first
  eight seconds, and every doorway trim meets floor and wall with no wedge, sliver or blunt end.
  Reverted in pass 002 (commit `6e45aa4`, the burrow half of K4): "The glowing pink knot at the
  vanishing point of the tunnel is gone ... nothing to fly towards" (fable); "The new route crowds
  the camera against doorway rims and conceals the branching chamber composition" (sol); "A
  conspicuous dark wedge and thin exposed edge separate the trim from the floor" (astra). The
  motion itself was sound: seams 0.00 to 0.32%, no hitch, cost unchanged.
  Technique: start from `6e45aa4` (`git checkout 6e45aa4 -- src/scenes/burrow.tsx
  src/scenes/burrow`). Keep the rail; move the world. Place chamber centres, fork headings, the
  knot and the eyes from the camera's sampled frusta along the stretch (a plan drawing and a
  per-second "what is in frame" table before any shader work), put a lit thing at the end of
  every sightline, use `lookTowards` within `stretch.free(t)`, and build each trim and its
  chamber opening from the same boundary. Judge against `loop/out/pass-002/burrow.jpg` (the
  legacy burrow) frame by frame · Files: `src/scenes/burrow.tsx`, `src/scenes/burrow/*` ·
  Worker: fable · Frames: burrow:0 burrow:2.5 burrow:5 burrow:8.5 burrow:15.5 burrow:19
  burrow:22 helix:22 · Source: owner, pass 001; pass 002 panel 3/3 (regression)
- **H5 helix · Rebuilt around spring** / **D3 dollhouse · Rebuilt around fall** / **O4 orbit ·
  Rebuilt around winter** — each scene rides its season's stretch of the rail (`season(index)`;
  the header of `src/scenes/rail.ts` is the contract, `loop/out/pass-002/workers/K4/after/` holds
  the plots) and keeps the premise and palette `DESIGN.md` gives it: the stair climbs spring's
  full circle, the garden's doorways stand along fall's meander, the town's street follows
  winter's banked descent and up keeps rotating. Each is at least as good a picture as its
  legacy sheet in every frame. Three slices with disjoint files.
  What the burrow pilot taught (pass 002): riding the rail is the easy half; the picture is lost
  when the world is rebuilt along the new curve without placing its sights against where the
  camera now looks. A brief names, frame by frame, what must still be on screen (the exit small
  in the distance at t=12, the hero object at t=8.5, the opening silhouette), and the worker
  compares sheets the way the panel does. The first and last 5 s of every stretch are the same
  shape for all scenes (a level 26° left sweep, then straight), so openings and exits are
  designed for that. When the last scene lands, the legacy seam state can go and the joints may
  bend (a follow-up keystone).
  Files: each scene's own files · Worker: fable (camera tracks) · Frames: every `t` of the sheet
  against `loop/out/pass-002/<scene>.jpg` · Source: owner, pass 001
- **S1 new · A fifth world, designed by Fable and built by Opus** — Needs: B5, H5, D3, O4. A new
  scene (index 4, riding spring) as unmistakably different from the first four as they are from
  one another. The director adds its column to `DESIGN.md` before it is built.
  How the designers get entropy (the owner asked): the randomness comes from outside the model.
  (a) A script, not the model, draws each designer's kit: `shuf -n 3 /usr/share/dict/words` plus
  one dice-rolled row from each of five small tables (a law of space to break, a material, a
  scale, a kind of light, a way the inhabitants move). (b) Three to five designers run in
  parallel and never see each other; each gets a different kit and a different way in (start
  from the rail segment's motion; from the inhabitant; from the exit; by inverting one existing
  scene's premise; by taking two seed words literally). (c) Each must write ten one-line
  premises, discard the five it thought of first, and develop the strangest of the rest. (d) A
  forbidden list: the four existing worlds and the first ideas a model reaches for (floating
  islands, neon city, coral reef, crystal cave, clockwork, library, forest, space station,
  candy land). (e) The review panel's three models rank the proposals blind against
  "mesmerizing, strange, whimsical", palette distance from the existing four, fit to spring's
  motion and what fits the budget; the director builds the winner and keeps the runners-up here.
  Each proposal is a `DESIGN.md` column, a beat sheet on the 25 s timeline and a technique list.
  Worker: fable designs, opus builds · Source: owner, pass 001
- **B1 burrow · Wet, living walls (second try)** — the walls are soft packed scales whose pattern
  sits under the ribs' light instead of over it: near the lens a bright coral wall with scales
  you can count, between ribs dark plum, and the dome keeps its radial rhythm. No hard outlines,
  no tiled rows, no smeared texels.
  Reverted in pass 001: "Uniformly prominent cell seams make the living tunnel look paved and
  visually noisy" (astra), "dark cell outlines overpower the ribs ... reads as tiled masonry"
  (sol), "the tunnel lost value depth ... one flat pink wall around a small hole" (fable, who
  also called the relief "far better as a surface").
  Technique: start from commit `c91e1ed` (crisp to the lens, true arc length, fwidth filtering,
  all worth keeping). Cut the cell-edge albedo contrast and bump amplitude by more than half,
  suppress cells on rib crests, fade them earlier with distance, put the broad coral-to-plum rib
  shading back on top, soften the floor pores. Consider overlapping scales with a direction
  along the flow instead of voronoi pads · Files: `src/scenes/burrow/materials.ts`,
  `src/scenes/burrow/build.ts` (attributes only; after B5, which rebuilds the route and touches
  the same files) · Worker: opus · Frames: burrow:8.5 burrow:12 burrow:19 burrow:22 ·
  Source: pass 000 panel 3/3; pass 001 panel 3/3 (regression); pass 002 fable (ranked first:
  "stretched into long radial smears ... the surface that fills half the screen in most frames")
- **O2 orbit · The moon-gate hut is the best thing in town** — the two leaves have thickness, a
  bevelled edge and a carved crescent-and-star lattice that lets gold light through; the hut has
  a shingled roof with a finial; the steps are masonry with shaded junctions; the gold ring
  spills warm light onto leaves and steps, and the moon rims the hut. Rider from O1: the cool
  rim on the overhead towers is quieter, so it separates silhouettes without outlining them
  ("an outlined ceiling instead of atmospheric depth", astra, reported as a regression).
  Technique: reuse the tower roof shader; signed-distance lattice with emissive gold above the
  bloom threshold; fresnel rim keyed to the moon direction; radial falloff in the base shader;
  for the rider, lower `RIM_GLSL`'s strength, gate it harder by moon-facing normals and fade it
  with the extinction · Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:19 orbit:22
  orbit:15.5 · Source: pass 000 panel 3/3; pass 001 astra, sol; pass 002 panel 3/3
- **D5 dollhouse · Every door is bigger inside** — the ordinary doorways passed at t=0 to 15.5
  each show a different vast interior (nested arches, a far floating thing, its own sky) with
  its own vanishing point, moving with the camera and legible even in the portal thumbnail; the
  cream arches the camera flies through are patterned paper with a darker cut edge, not bare
  tubes. "The paper-thin doorways that the camera passes closest to are plain untextured cream
  tubes ... no inside-is-vast reveal at the moment of passing" (fable).
  Technique: interior mapping (a ray-marched room in the door's fragment shader), animated from
  `clock.t`; arch-space stripes or scallops and fibre noise on the fly-through arches · Files:
  `src/scenes/dollhouse.tsx` · Worker: opus · Frames: dollhouse:0 dollhouse:5 dollhouse:8.5
  dollhouse:15.5 · Source: pass 001 sol, fable; pass 002 panel 3/3 (opportunity), fable
- **D6 dollhouse · Flowers with body** — near flowers have curved, folded petals with a darker
  underside, leaves and a shaded foot; drifts are distinct clumps separated by quiet sand, and
  far drifts read as patches, not specks. Rider: the last dashed shadow streaks near the
  horizon at t=8.5 dissolve (long thin shadows fade with distance from their caster).
  "Thin stems and flat petals form a noisy scatter over the pale sand ... loose coloured
  cutouts" (sol). Technique: instanced curved petal meshes with folded normals and a
  transmission term, stem-base occlusion baked into the terrain mask, clustering with
  distance-dependent detail · Files: `src/scenes/dollhouse/garden.ts`, `src/scenes/dollhouse.tsx` ·
  Worker: opus · Frames: dollhouse:0 dollhouse:8.5 dollhouse:19 · Source: pass 002 astra, sol, fable
- **H3 helix · Light from the koi and the lamps** — the amber is back and it lands on things:
  lamps pool orange on the steps, the newel and the brickwork beside them, arcade orbs glow as
  warmly as at pass 000, passing koi spill light on nearby stone, and slow teal-and-gold caustics
  drift across the newel and the coffered soffit.
  "The arcade's amber glow is weaker than in pass 000 ... the stair lamps no longer throw a
  visible orange wash on the brickwork" (fable, regression: additive sprites now add in linear
  light). Technique: raise the emitters well above 1 (orbs and koi are near 0.6, lamps 1.35) and
  then the helix threshold in `src/director/looks.ts`; analytic point falloff from lamp positions
  along the helix; caustic pattern from `clock.t` · Files: `src/scenes/helix.tsx`,
  `src/scenes/helix/koi.ts`, the `helix` entry in `src/director/looks.ts` · Worker: opus ·
  Frames: helix:0 helix:8.5 helix:12 helix:15.5 · Source: pass 000 astra, sol, fable; pass 001
  astra (opportunity), fable (regression); pass 002 astra, sol (opportunity)
- **B3 burrow · The tunnel leads you** — a slow pulse travels along the tunnel towards the exit:
  it brightens the floor thread and the wall around it as it passes, mushrooms light in a wave
  with it and throw mint light through their caps onto their stems and the floor, and eyes open
  as it reaches them.
  Technique: a wave over the tunnel's arc-length coordinate from `clock.t`, a slight wall
  displacement in the vertex shader, falloff terms in the wall and floor shaders, cap
  transmission; emitters above 1 so they bloom, then raise the burrow's threshold in
  `src/director/looks.ts` · Files: `src/scenes/burrow/*` (after B5) · Worker: opus ·
  Frames: burrow:5 burrow:8.5 burrow:15.5 burrow:22 · Source: pass 000 astra, fable; pass 001
  panel 3/3 (opportunity)
- **B4 burrow · The hoop is a crafted thing** — a fleshy pearlescent torus with mint nodes that
  bloom and two counter-rotating gimbal rings, feet that grow out of the floor, a pool of mint
  and daylight on the floor under it, and a rim of its light on the nearest mushrooms. Mushroom
  caps are round. "The exit is a pair of hairline pale rings round an oval that reads as a
  washed-out sticker" (fable).
  Files: `src/scenes/burrow.tsx`, `src/scenes/burrow/creatures.ts` (after B5) · Worker: opus ·
  Frames: burrow:19 burrow:22 · Source: pass 000 astra; pass 001 sol, fable
- **H6 helix · Round and crisp at the lens** — at t=8.5 the newel's joints are antialiased lines
  instead of stair-stepped texels, its silhouette and the handrail are round, satellite stairs
  carry the main stair's carving, and the foreground globe is a glass shell with a hot core that
  does not clip. Files: `src/scenes/helix.tsx` · Worker: opus · Frames: helix:8.5 helix:15.5 ·
  Source: pass 001 fable; H1's worker
- **H4 helix · A void with depth** — far arcade tiers lose contrast and dissolve towards teal,
  far orbs are smaller and dimmer, and behind the arcade the teal is a lit volume: shafts of
  light, far stairs fading in layers, motes drifting. "The improved foreground carving exposes
  how little atmospheric separation the shaft has" (sol).
  Technique: distance-dependent contrast reduction in the arcade shader, additive light-shaft
  cones with soft edges, GPU motes from `clock.t` · Files: `src/scenes/helix.tsx` · Worker: opus ·
  Frames: helix:0 helix:5 helix:12 · Source: prep baseline; pass 001 sol
- **O5 orbit · The street is a surface** — the road nearest the lens is worn setts with a raised
  crown and wet streaks that reflect the lamp colour; lamp heads are round with a hot core;
  bushes are smooth and leafy with a moon rim; the arches over the road carry voussoir banding.
  "The road is a featureless lilac band with two white stripes, and it is the surface nearest
  the lens for most of the ride" (fable). Files: `src/scenes/orbit.tsx` · Worker: opus ·
  Frames: orbit:8.5 orbit:15.5 · Source: pass 000 fable; pass 001 fable
- **O3 orbit · The whale is the event** — at t=19 to 24 the whale and her calf carry glowing
  constellation markings and a silver-blue rim, swim with a slow tail beat, pass as a large near
  silhouette across the moon, and the moon throws a shaft behind the hut; lamps have fog halos.
  Technique: emissive star pattern, fresnel rim, vertex-shader swim, closed-form inscattering for
  the moon shaft and lamp halos · Files: `src/scenes/orbit/sky.ts` · Worker: opus · Frames:
  orbit:15.5 orbit:19 orbit:22 · Source: pass 000 panel 3/3; pass 001 sol, fable (opportunity)
- **B2 burrow · The walls are watching** — many more eyes, set in fleshy sockets, clustered at the
  fork arches and in the dome; each opens as the camera nears, follows it and blinks, with a wet
  highlight and a mint glow on the wall around it.
  Technique: iris offset towards `uEye` in the fragment shader, eyelid as a signed distance opened
  by distance along the track, blink hashed per instance · Files: `src/scenes/burrow/creatures.ts`
  (after B5) · Worker: opus · Frames: burrow:2.5 burrow:8.5 burrow:22 · Source: pass 000 sol,
  fable (opportunity)
- **K5 all · A portal keeps its own light** — a bright scene seen through the portal of a dark
  one is not veiled by the host's bloom before t=20 (the dollhouse in the burrow's hoop is washed
  towards white today), and the canvas stops paying for multisampling it no longer uses.
  Technique: weigh the portal's pixels by the next scene's threshold in the bloom prefilter (a
  mask in the target's alpha, or the portal drawn into the prefilter separately);
  `antialias: false` in `src/main.tsx` (0.1 to 0.3 ms at 4K); bring `README.md`'s pipeline
  paragraph up to date · Files: `src/director/*`, `src/main.tsx`, `README.md` · Worker: fable ·
  Frames: burrow:19 burrow:22 dollhouse:19 · Source: K1's and D1b's workers, pass 001
- **K6 all · The gate checks the rail** — the gate fails when a camera breaks the seam state or
  two cameras sharing track move differently, and a worker can measure against another commit
  in one command.
  Technique: move the K4 worker's rail plots and seam-motion table
  (`loop/out/pass-002/workers/K4/after/*.ts.txt`) into `scripts/look.ts` as a `rail` mode the
  gate runs; `perf --ref <git-ref>` that alternates the two builds · Files: `scripts/*` ·
  Worker: fable · Source: K4's and O1's workers, pass 002
- **K3 all · Depth for the final pass** — the scene target carries a depth texture, so the final
  pass can do height fog, soft particle edges, depth of field focused on the exit, and camera
  motion blur computed from `clock.t`.
  Files: `src/director/*` · Worker: fable · Source: prep baseline

## Technique catalogue

Seed material for new items. The "seen as" column is from the reference that started this loop:
a browser FPS built by an agent loop, analysed frame by frame. What made it look expensive was
mostly five things, none of which the screensaver did at baseline:

1. Every emitter blooms and visibly lights what is next to it.
2. There is always something in the air between the camera and the background: snow, mist, haze.
3. Hero objects are dense with trim, panel lines and small lights.
4. The sky is an event (a ringed planet, an eclipse), not a gradient.
5. The world changes colour when the story does (red arena lights turn amber when the boss dies).

| Technique | Seen as | Route under our rules | Needs |
|---|---|---|---|
| HDR and bloom | neon trim, muzzle flashes, eclipse corona | emissive values above 1 into a HalfFloat target, mip-chain bloom | none (K1 done): raise the emitter in the scene, then that scene's threshold in `src/director/looks.ts` |
| Grade, vignette, dither | cold blue exterior, amber interior | lift/gamma/gain and split toning per scene in the final pass; static interleaved-gradient dither against banding | none (K1 done): numbers in `src/director/looks.ts` |
| Anamorphic streaks, lens flare | glare round the eclipse | extra horizontal blur tap in bloom; flare sprites placed from a light's screen position | keystone (`src/director/post.ts`) |
| Chromatic aberration, radial streaks | the dash effect | final pass, strength keyed to camera speed, strongest in the dive through a portal at t=23 to 25 | keystone (`src/director/post.ts`) |
| Light shafts | warm cones under a canopy | additive cone meshes with fresnel edge fade and scrolling noise; or a radial blur from the light's screen position | none |
| Air: snow, motes, spores, mist | blowing snow, arena ground mist | instanced quads placed in the vertex shader from `clock.t` (house style); streak along velocity; mist cards | none; soft edges need K3 |
| Height fog | haze pooling low | replace the fog chunk through `onBeforeCompile`: density by world height, tinted towards the light | none |
| Emitters light their surroundings | lamps, panels, energy weapons | analytic point-light falloff in ground and wall shaders from a small uniform array of emitter positions | none |
| Contact shadows, ambient occlusion | objects sit on the snow | instanced blob shadows; AO baked into vertex colours at mount; analytic AO near the ground | none |
| One static shadow map | (not in the reference) | a directional shadow rendered once at mount with `shadowMap.autoUpdate = false`; movers get blobs | budget |
| Fresnel shells | energy shields with ripple rings | additive fresnel with a scrolling pattern; intersection glow | none; intersection needs K3 |
| Trail ribbons | blue energy trails, the striped tentacle | ribbon mesh along a curve with emissive stripes scrolled from `clock.t` | none |
| Ground rings and decals | boss telegraph rings | signed-distance rings drawn in the ground shader in world space | none |
| Glossy floors | the archive's wet floor | fake reflection: mirror the analytic emitters in the floor shader; environment map prefiltered once at mount from the scene's own sky | none |
| Holographic panels | wall displays, contour maps | emissive signed-distance patterns with scanlines | none |
| A sky that is an event | ringed planet, eclipse, layered cloud | sky-dome shader: gradient, fbm cloud layers, analytic bodies with rings and coronas | none |
| Layered silhouettes | huge ring gate and pylons behind the action | large simple shapes at three fog depths | none |
| Rim light | figures against the sky | fresnel rim tinted by the sky | none |
| World reacts to a beat | red turns amber | uniforms keyed to `clock.t`: the scene answers when its portal goes live at t=12 | none |
| Interior mapping | (not in the reference) | ray-box rooms in the fragment shader, behind windows and thin doorways | none |
| Triplanar detail, detail normals | wind-rippled snow | world-space procedural normal perturbation at two scales | none |
| Wrap and back lighting | (not in the reference) | wrapped diffuse and a transmission term for flesh, petals, mushroom caps, paper | none |
| Iridescence, thin film | (not in the reference) | view-angle hue shift on koi scales, eyes, lantern paper | none |
| Depth of field | soft foreground weapon | circle of confusion from depth in the final pass, focused on the exit | K3 |
| Camera motion blur | fast turns | reproject with the camera at `clock.t` minus a shutter time; no frame history | K3 |

## Done

- **K1 all · One colour pipeline, with bloom** (pass 001) — both scenes are drawn into linear HDR
  targets and one final pass does bloom, grade, vignette, tone curve and dither; per-scene numbers
  in `src/director/looks.ts`, cross-faded over the exit. Seams 0.00 to 0.31% RMSE at matching
  instants (`loop/out/pass-001/seams.json`); bloom in `loop/out/pass-001/frames/orbit-22.png`
  and `helix-8.5.png`. `seamRmse` tightened from 0.07 to 0.01.
- **K2 all · Warm up again after a restored GL context** (pass 001, rider on K1) — one forced
  context loss each way: a 38 ms frame in flight without the fix, none with it
  (`loop/out/pass-001/workers/K1/after/seams-explained.txt`).
- **H1 helix · Stone that holds up close** (pass 001) — coffered soffit, ashlar newel with a
  beaded spiral band, nosed treads, turned posts, round globes:
  `loop/out/pass-001/frames/helix-8.5.png`, `loop/out/pass-001/helix.jpg`. Leftovers are H6.
- **D1 dollhouse · Things stand on the ground, in sunlight** (pass 001, in two slices) — one sun,
  cast shadows and contact pools under every prop, rippled sand, lavender shade, and the palette
  solved back through the tone curve (`onScreen` in `garden.ts`):
  `loop/out/pass-001/dollhouse.jpg`, `loop/out/pass-001/frames/dollhouse-8.5.png`. Leftover: D4.
- **K4 all · The seasonal rail** (pass 002; its burrow pilot was reverted, see B5) — one closed,
  curvature-continuous lap of 396 units in 80 s, cut into spring (a climbing full circle),
  summer (an S with a dive and a 205° curl), fall (a meander over a rise) and winter (a banked
  teardrop descent); `season(index)` hands a scene its stretch. No scene rides it yet. Proofs:
  `loop/out/pass-002/workers/K4/after/rail-views.png`, `rail-timeline.png`, `rail-numbers.txt`.
- **O1 orbit · A town with depth** (pass 002, second try) — masonry fades into indigo air while
  windows stay lit, lamps pool on cobbles and walls, tower bases sit in contact rings:
  `loop/out/pass-002/frames/orbit-8.5.png`, `loop/out/pass-002/orbit.jpg`. Leftover (the rim is
  too strong overhead) rides on O2.
- **H2 helix · The keyhole arch is the best thing on the stair** (pass 002) — voussoirs,
  keystone, bead moulding, turquoise inlay, a thin slab lit by its landing lamps:
  `loop/out/pass-002/frames/helix-22.png`.
- **D2 dollhouse · The exit door is the best thing in the garden** and **D4 · Shadows lie on the
  dunes** (pass 002) — panelled leaves with a sunburst fanlight, brass hinges and knobs, a
  moulded surround, an inlaid plinth; shadows baked into one terrain mask:
  `loop/out/pass-002/frames/dollhouse-22.png`, `dollhouse-8.5.png`. Leftover streaks ride on D6.

## Rejected

Items tried and dropped, with the reason, so they are not tried the same way twice.

- **B1 as voronoi pads with outlined edges** (pass 001, commit `c91e1ed`, reverted) — crisp and
  untiled, but the pale cell borders and the bevel on every cell read as paving, and the detail
  layer replaced the ribs' value falloff. Back in the queue with the contrast cut and the rib
  shading on top.
- **O1 with window occupancy cut per building and extinction on everything** (pass 001, commit
  `a8b85ee`, reverted) — the layers separated, but the overhead town went dark and the wrapped
  city stopped reading. Back in the queue with the lights kept through the fog.
- **The burrow swept along summer with its sights left where the build put them** (pass 002,
  commit `6e45aa4`, burrow files reverted) — the camera rode the rail without a jolt, but the
  knot left the vanishing point, the fork showed one mouth, t=19 repeated the opening and a
  doorway foot showed a wedge. Back in the queue as B5, composed frame by frame.
