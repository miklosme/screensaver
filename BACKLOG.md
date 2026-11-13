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

- **K7 helix · The helix rides spring** — WAITING ON THE OWNER (question 12 in
  `loop/DIRECTION.md`); not to be taken until answered. Three tries (passes 003, 004, 005) could
  not match the legacy helix's opening and exit approach from the rail's level, fixed approach.
  The third try is kept unmerged on branch `t3/helix-spring-keystone` (commits `2cc708b`,
  `40fa788`, `32b6aa1`): whole tower nearer with large koi, no lamp on the lens, arch upright at
  t=22, gate green, burrow pixel-identical; short at helix:0, 2.5 (not seen from below) and 19
  (a wider, flatter approach). Frames: `loop/out/pass-005/workers/K7/after/helix-three-columns.jpg`.
  D3, O4 and S1 below wait on the same answer.
- **D3 dollhouse · Rebuilt around fall** / **O4 orbit · Rebuilt around winter** — each scene
  rides its season's stretch (`season(index)`; the header of `src/scenes/rail.ts` is the
  contract) and is at least as good a picture as its legacy sheet in every frame: the garden's
  doorways stand along fall's rises and its exit door on its plinth ends it; the town's street
  follows winter's banked spiral down and up keeps rotating.
  What three tries taught (passes 002 and 003): the burrow landed when its brief listed, frame
  by frame, what had to be on screen and its worker drew a plan and a per-second "what is in
  frame" table before building (`loop/out/pass-003/workers/B5/after/`). The helix failed where
  the season's shape itself hid the scene's best view, and no placement could bring it back. So
  each of these is a keystone that may reshape its own season's body with the scene (frozen:
  the shared approach, the joint state, and any season a scene already rides), one per pass,
  judged against the legacy sheet. The first and last 5 s are the same for every scene (a level
  26° left sweep, then straight): design the opening and the exit for that.
  Files: `src/scenes/rail.ts` and the scene's own files · Worker: fable · Frames: every `t` of
  the sheet against `loop/out/pass-003/<scene>.jpg` · Source: owner, pass 001
- **S1 new · A fifth world, designed by Fable and built by Opus** — Needs: K7, D3, O4. A new
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
- **D14 dollhouse · The flowers hold in motion and on any screen** (a fault in the diff, ranked
  first by astra and sol in pass 007) — flowers never vanish while still inside the picture,
  whatever the screen's aspect ratio (today `garden.update` culls against a fixed horizontal
  angle, so an ultrawide screen shows them being dropped at its edges), and the change from the
  near flower to the far one is invisible in motion (today both meshes draw across a one-metre
  overlap and then one disappears). Second commit: the nearest flowers (within about 8 m) have
  smooth petals, not five flat facets per bloom, with a little seeded variety in petal length
  and head tilt.
  "The new visibility cone assumes a fixed horizontal angle and ignores camera aspect ratio.
  Wider screens can show flowers being culled while still inside the image" (astra); "abrupt
  flower LOD changes: step thresholds add and remove whole meshes ... Replace the hard switches
  with complementary, stable object-space dither coverage ... Use the same per-instance seed
  for both LODs, and fade the outer draw-distance boundary" (sol); "Nearest flowers are visibly
  faceted" (fable, sol).
  Technique: cull prebuilt clusters against the camera's real frustum planes, with bounds
  grown for flower height and sway; a dithered cross-fade keyed to a per-instance seed; more
  petal subdivisions on the near mesh only. Prove it with frames at 21:9 and 32:9 (`look.ts`
  shots take the page's size from the browser: see how `sheet` sets it) and with frames a
  tenth of a second apart across a transition · Files: `src/scenes/dollhouse/garden.ts`,
  `src/scenes/dollhouse.tsx` (only if the camera's matrices have to be passed) · Worker: opus ·
  Frames: dollhouse:2.5 dollhouse:8.5 dollhouse:12 at 16:9 and at 32:9 · Source: pass 007
  astra, sol, fable
- **H4 helix · A shaft with depth (second try: the hanging stairs are not touched)** — two
  commits, merged separately. (1) The arcade falls back in value with distance and height (at
  the strength of commit `5a3abbb`), the orbs vary and pulse with a third gone, and the slim
  rail catches a warm line at a distance: `619e230`'s arcade and orb code and `8c0d5e9`,
  WITHOUT any change to the satellite staircases, which stay exactly as at pass 006 (stepped
  treads, sandstone, no veil, no ramp). (2) Light shafts that read as light: no silhouette
  edge (alpha by the facing term), both ends faded so no mouth shows, a fade near the camera,
  streaks along the beam from `clock.t`, and the beam lights what it crosses: stone and koi
  inside it brighten, and a warm ellipse lands where it meets the far wall.
  Reverted in pass 007 (commits `619e230`, `8c0d5e9`, `5a3abbb`): "The satellite staircases
  behind the arcade have lost their distinct tread silhouettes and much of their contrast ...
  translucent ribbons, weakening the impossible-space premise" (sol, astra); "The light shafts
  are flared open tubes and look like it: a visible circular mouth at top right,
  constant-opacity sides with a readable edge, and a milky wash where one is seen near end-on
  ... they do not light anything they cross" (fable). Nobody objected to the haze, the orbs or
  the rail · Files: `src/scenes/helix.tsx`, `src/scenes/helix/koi.ts` (the brightening term) ·
  Worker: fable (short from opus once) · Frames: helix:0 helix:5 helix:8.5 helix:12 helix:22 ·
  Source: pass 001 to 007
- **B8 burrow · A floor that is alive** — the chamber floors under the lens (t=8.5, the fork at
  t=15.5, the dome at t=22) are a living surface instead of a smooth plum gradient: low
  membrane wrinkles and fine pores that catch a wet highlight, the wall's scale pattern
  carried across darker, wet streaks running towards the glowing thread, and a soft glow
  either side of the thread. The hoop's pool and the mushrooms' pools stay as they are and
  stay the brightest things on the floor.
  "The improved mushroom caps and stalks now stand over a broad, nearly featureless glossy
  floor. The blurred plum bands read as painted gradients rather than a living surface"
  (astra); "At t=15.5 the fork's floor is a smooth dark plum band with no scales, ribs or
  pools, the flattest surface in the scene, right under the lens" (fable).
  Files: `src/scenes/burrow/materials.ts` (the floor only) · Worker: opus · Frames: burrow:8.5
  burrow:15.5 burrow:22 · Source: pass 004 fable; pass 007 astra, fable
- **O6 orbit · Bushes and kerbs** — the topiary nearest the lens (t=0, 2.5, 15.5) is a lumpy,
  leafy mass: an irregular outline, leaf clumps in relief, a warm rim from the lamp beside it
  and a dark contact patch on the cobbles; no tiled scale texture, no flat ellipsoid, and the
  tall one at the right edge of t=15.5 does not cut the frame. The road's two edge stripes are
  kerbstones: a raised, bevelled strip with stone joints, lavender and lit by the lamp pools,
  no longer the brightest, plainest thing on the street.
  "The bushes nearest the lens are smooth ellipsoids with a small tiled scale texture: flat
  silhouette, no leaf relief ... They are the largest near objects in three of nine frames. The
  road's edge stripes are featureless white ribbons brighter than the lamps" (fable, three
  passes running). NOT in this item: distance haze on the towers and windows (sol, astra): the
  overhead town's brightness was pushed both ways in passes 001 to 004 and is settled.
  Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:0 orbit:2.5 orbit:8.5
  orbit:15.5 · Source: pass 005 to 007 fable; pass 006 astra, sol
- **B9 burrow · Something to look at in the middle** — at t=12 the frame has a subject: a
  cluster of large eyes round the chosen branch's mouth that open in sequence as the camera
  turns in, and a mushroom stand with its pool at the near edge for foreground. "At t=12 the
  frame is almost all one orange scale wall with a small off-centre opening: no focal point,
  no near object, no far layer" (fable); also sol on scale monotony. Mind pass 005: a busier
  dome was reverted; this is the fork chamber only · Files: `src/scenes/burrow/creatures.ts`,
  `src/scenes/burrow/build.ts` (placement) · Worker: opus · Frames: burrow:12 burrow:15.5 ·
  Source: pass 006 and 007 fable
- **H9 helix · The keyhole takes the burrow's light** — at t=19 to 24 pink and magenta light
  spills from the keyhole onto the inner jambs, the landing and the carpet in front of it, the
  arch's inlay channel glows and pulses slowly, the two landing lamps are a little larger with
  pools on the landing, and the arch's edge reads as a thin slab free of the wall behind.
  "nothing from the magenta burrow light spills onto the jambs, carpet or landing. It is also
  as thick as the wall around it" (fable). Caustics on the soffits and newel (astra, sol,
  every pass) can ride as their own commit · Files: `src/scenes/helix.tsx` · Worker: opus ·
  Frames: helix:19 helix:22 helix:24 · Source: pass 006 fable; astra, sol (opportunity)
  Pass 007: the newel's block joints stair-step at the lens (fable; antialias the joint mask
  with fwidth); the rail and lamp support read matte ochre (sol: a directional specular).
- **D10 dollhouse · No two rooms alike, and something moves in each** — the doorways hold
  visibly different impossible rooms again (a twisting room of rotating arch layers comes back
  beside the hall, the rotunda and the avenue), and each has one thing in motion from
  `clock.t` (a swinging lamp, a rolling ball, the arches turning), so the insides are live
  rooms and not pictures.
  "The right background doorway now contains another column hall instead of the previous
  twisting interior ... the collection of impossible rooms loses some variety" (sol,
  regression); "they are static pictures" (fable) · Files: `src/scenes/dollhouse.tsx` · Worker:
  opus · Frames: dollhouse:5 dollhouse:12 dollhouse:19 dollhouse:22 · Source: pass 004 sol, fable
  Pass 006: a tiny table or hanging mobile deep inside for scale (sol); a moving light shaft
  inside (fable).
- **D8 dollhouse · Wind and paper light** — the garden moves and is made of paper: a slow wind
  wave bends the flower stems and ruffles petals, soft cloud shadows drift across the dunes,
  and pinwheel blades, birds and petals glow at the edges where the sun shines through them.
  Technique: one travelling wave from `clock.t` shared by the flower vertex shader and a
  low-frequency shadow mask in the sand shader; a transmission term and fold shading on paper
  things · Files: `src/scenes/dollhouse/garden.ts`, `src/scenes/dollhouse.tsx` · Worker: opus ·
  Frames: dollhouse:0 dollhouse:8.5 dollhouse:19 (and two frames a second apart) ·
  Source: pass 003 panel 3/3 (opportunity)
- **B3 burrow · The tunnel leads you** — a slow pulse travels along the tunnel towards the exit:
  it brightens the floor thread and the wall around it as it passes, mushrooms light in a wave
  with it and throw mint light through their caps onto their stems and the floor, and eyes open
  as it reaches them.
  Technique: a wave over the tunnel's arc-length coordinate from `clock.t`, a slight wall
  displacement in the vertex shader, falloff terms in the wall and floor shaders, cap
  transmission; emitters above 1 so they bloom, then raise the burrow's threshold in
  `src/director/looks.ts` · Files: `src/scenes/burrow/*` (B5 is done) · Worker: opus ·
  Frames: burrow:5 burrow:8.5 burrow:15.5 burrow:22 · Source: pass 000 astra, fable; pass 001
  panel 3/3 (opportunity)
- **B2 burrow · The walls are watching** — many more eyes, set in fleshy sockets, clustered at the
  fork arches and in the dome; each opens as the camera nears, follows it and blinks, with a wet
  highlight and a mint glow on the wall around it.
  Technique: iris offset towards `uEye` in the fragment shader, eyelid as a signed distance opened
  by distance along the track, blink hashed per instance · Files: `src/scenes/burrow/creatures.ts`
  (B5 is done) · Worker: opus · Frames: burrow:2.5 burrow:8.5 burrow:22 · Source: pass 000 sol,
  fable (opportunity)
  Pass 003: sleeping eyes read as dark maroon balls or dashes at 15 to 25 units (B5's worker,
  fable): a lid that takes the wall's colour, or a slit of glow.
  Pass 006: the dome's eyes are "closed-slit eyes too small to read": scale them up and open
  them in a wave over t=20 to 23 (fable); staggered slow blinks and gaze (sol, opportunity).
  One reviewer notes t=0, 2.5, 5 and 19 are nearly the same composition: a ring of eyes
  opening in sequence between t=10 and 19 would vary the middle.
- **O7 orbit · Rooms behind the windows** — the tower windows the camera passes at t=5 to 12 show
  lit rooms with depth (interior mapping), and now and then a silhouette crosses one, keyed to
  `clock.t`. Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:5 orbit:8.5 orbit:12 ·
  Source: pass 005 fable (opportunity)
- **O8 orbit · The whale and the finial** — PARKED: the panel has pushed this both ways. On the
  moon at t=22 the whale tangled with the hut's finial (pass 006: fable's regression, astra's
  problem); moved beside the moon she was lost against the overhead towers (pass 007: astra's
  and sol's regression, reverted). She is on the moon now. Take it again only with a placement
  that is on the disc AND clear of the finial (above it, or a smaller whale), or with a gap
  opened in the overhead towers beside the moon (sol's suggestion; that is `orbit.tsx`).
  Commits of the reverted try: `ca7f5c8`, `a784d3d`.
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
  Pass 005, fable (opportunity): depth of field with a per-scene focus distance from `clock.t`
  (a near prop early, the exit from t=19), "makes the exit the sharpest thing in the last five
  seconds".

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
- **B5 burrow · Rebuilt around summer** (pass 003, second try) — the first scene on the rail: the
  knot at the vanishing point from the first frame, a junction with watching eyes, a banked
  dive, two mouths at the fork, the dome: `loop/out/pass-003/burrow.jpg`,
  `loop/out/pass-003/frames/burrow-8.5.png`; plan and frame table in
  `loop/out/pass-003/workers/B5/after/`. Leftovers ride on B4 (the dome's near layer) and B1
  (the pale near wall at t=19).
- **D5 dollhouse · Every door is bigger inside** (pass 003) — four kinds of interior drawn through
  each doorway, and patterned paper arches: `loop/out/pass-003/frames/dollhouse-8.5.png`,
  `loop/out/pass-003/dollhouse.jpg`. The panel wants them deeper: D7.
- **B1 burrow · Wet, living walls** (pass 004, second try) — overlapping scales with relief,
  crisp at the lens, teal pools round the mushroom groves; all three reviewers raised the
  burrow to 7: `loop/out/pass-004/frames/burrow-8.5.png`, `loop/out/pass-004/burrow.jpg`,
  crops in `loop/out/pass-004/workers/B1/after/compare/`. Kept with a regression open: B6.
- **D7 dollhouse · The insides are vast** (pass 004) — a colonnaded hall, a rotunda and a dusk
  avenue behind the doorways, dark reveals, deep floors, a far light:
  `loop/out/pass-004/frames/dollhouse-8.5.png`, `loop/out/pass-004/workers/D7/crops/`.
  Leftover: D10.
- **O2 orbit · The moon-gate hut is the best thing in town** (pass 004) — gilt leaves pierced
  with a crescent and stars, shingled roof and finial, masonry steps; tower rims set between
  the two earlier strengths, in a commit of their own: `loop/out/pass-004/frames/orbit-22.png`.
- **O5 orbit · The street is a surface** (pass 005) — a sett road with lamp reflections, stone
  arches with capitals and festoon bulbs, round lamps with cones, topiary, windows set into
  the walls; astra and sol raised orbit to 8: `loop/out/pass-005/frames/orbit-8.5.png`,
  `loop/out/pass-005/orbit.jpg`. Leftovers: O6.
- **B4 burrow · The hoop glows** (pass 006, second try) — a ring of mint light set with bulbs in
  two gold gimbals over a pool of light, the first exit of the burrow no reviewer called
  unfinished: `loop/out/pass-006/frames/burrow-22.png`,
  `loop/out/pass-006/workers/B4/accept/b4-hoop-crop-22.png`.
- **H7 helix · The lamp by the lens** (pass 006) — a turned post, a smaller amber glass globe,
  warm pools on the treads, a slim bronze rail (its triangles had been wound inside out):
  `loop/out/pass-006/frames/helix-8.5.png`. Leftover (the rail's outline at a distance) rides
  on H4.
- **O3 orbit · The whale is the event** (pass 006) — a star-freckled whale and calf that swim,
  crossing the sky at t=15.5 and the moon from t=19; a moon that glows without clipping at
  t=22: `loop/out/pass-006/orbit.jpg`. Leftover: O8.
- **D11 dollhouse · The exit's plinth and surround** (pass 007, second try) — a turned plinth
  with a tiled rosette, a voussoir surround with a panelled keystone, the leaves left as they
  were: `loop/out/pass-007/frames/dollhouse-22.png`.
- **D13 dollhouse · Flowers that belong to the ground** (pass 007) — dense beds of cupped
  poppies, cosmos and daisies on bent stems with grass tufts; all three reviewers score the
  dollhouse 7: `loop/out/pass-007/frames/dollhouse-8.5.png`, `loop/out/pass-007/dollhouse.jpg`.
  Faults found in its diff are D14.
- **B7 burrow · Mushrooms that hold up close, and light the floor** (pass 007) — domed caps with
  glowing rims and gills, bent stems, a pool of each one's colour on the floor:
  `loop/out/pass-007/frames/burrow-8.5.png`.

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
- **The helix on spring as designed in pass 002** (pass 003, commits `fbeaac2` and `2fbd0d9`,
  reverted) — the climb worked, but the season turns left straight after the joint, so the
  opening could not show the stair whole; a "sister" tower added on the sightline read as
  clutter, a 6.65-radius newel drum filled the left of the frame, and the 16° bank under a low
  soffit felt cramped. Back in the queue as K7, which reshapes spring with the scene.
- **O2 with a rim reduction riding on it** (pass 003, commit `869994d`, reverted) — the hut was
  liked; the rider dimmed the overhead town and took the hut down with it. Riders that change a
  different part of the picture get their own commit.
- **The helix on a spring with a run-up, seen from afar and level** (pass 004, commit
  `56cfd25`, reverted) — whole stair in frame and an airy climb, but the tower read small and
  pale against the arcade, a lamp sat on the lens, the last flight was a flat bridge and the
  arch was seen rolled. Back in the queue as K7's third try with those four things named.
- **Restoring a pale sheen on the burrow's rib crests** (pass 005, commit `3452fea`, reverted) —
  two reviewers said it flattens the scales; the pass before, the same two said the scales had
  cost the ribs their highlight. The panel pushes this dial both ways. Leave the rib and scale
  balance where pass 004 put it unless a technique gives both at once.
- **The hoop, the dome wall, the eyes and the foreground mushrooms in one slice** (pass 005,
  commit `d10cb57`, reverted) — the hoop traded its glossy presence for detail, and the busier
  dome competed with it. Back as B4 (the hoop alone) and B7 (the mushrooms).
- **Dunes all round the garden, haze, and the plinth in one slice** (pass 005, commits `1294f26`
  and `36a4313`, reverted) — ridges hid the skyline's hoops; the rest read as no change. Back
  as D11 (the exit) and D12 (a near layer and two composed ridges).
- **Replacing the door leaves' cream pinstripes with blue relief beads** (pass 006, part of
  commit `f88c2db`, reverted) — truer as relief, weaker as a picture: the panels stopped
  reading on the approach. The plinth and surround of the same commit are back as D11.
- **Smoothing and veiling the satellite staircases; light shafts as plain additive tubes** (pass
  007, commits `619e230` and `5a3abbb`, reverted) — the hanging stairs are part of the premise
  and must keep their treads at every distance the eye can resolve; a shaft with a visible
  mouth and edges reads as a pipe. Back as H4's second try.
