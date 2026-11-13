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
- **D3 dollhouse · Rebuilt around fall** — the dollhouse rides the rail's fall stretch
  (`season(2)`; the header of `src/scenes/rail.ts` is the contract) and is at least as good a
  picture as its legacy sheet in every frame: the garden's doorways, flower beds and hoops
  stand along the track, the opening shows the garden with the navy doorway as its focal
  point, the exit door on its plinth fills the screen at the end.
  Taken in pass 010 without waiting for question 12: the owner's note asks for all four scenes
  on the rail, the joints allow a rail scene between two legacy ones, and the helix's trouble
  (a view from below that the level approach cannot give) does not apply to a garden seen
  from eye height. The worker may reshape fall's body with the scene (frozen: the shared
  approach, the joint state, summer, and fall's last 7 units if the orbit ever builds on
  them). What made the burrow land: a per-frame list of what must be on screen, a plan
  drawing and a per-second "what is in frame" table before building
  (`loop/out/pass-003/workers/B5/after/`), judged against the legacy sheet.
  Files: `src/scenes/rail.ts` (fall's data only), `src/scenes/dollhouse.tsx`,
  `src/scenes/dollhouse/garden.ts` · Worker: fable · Frames: the whole dollhouse sheet against
  `loop/out/pass-009/dollhouse.jpg`, burrow:22 burrow:24.5, the burrow sheet unchanged ·
  Source: owner, pass 001
- **O4 orbit · Rebuilt around winter** — after D3, the same way. Source: owner, pass 001
- **S1 new · A fifth world, designed by Fable and built by Opus** — a new scene (index 4, riding
  spring) as unmistakably different from the first four as they are from one another.
  Stage 1, the designs (pass 010; needs nothing): three to five Fable designers, each with a
  kit drawn by a script and not by a model (`shuf` words from `/usr/share/dict/words` plus
  dice-rolled rows from five small tables: a law of space to break, a material, a scale, a
  kind of light, a way the inhabitants move), each with a different way in, none seeing the
  others; each writes ten one-line premises, discards the five it thought of first, and
  develops the strangest of the rest into a `DESIGN.md` column, a beat sheet on the 25 s
  timeline and a technique list within the budgets. A forbidden list rules out the four
  existing worlds and a model's first ideas (floating islands, neon city, coral reef, crystal
  cave, clockwork, library, forest, space station, candy land). The proposals go to
  `loop/out/pass-010/designs/` and a summary to `loop/DIRECTION.md` for the owner to choose
  from or veto; without an answer by the next pass the director takes the one a blind ranking
  by a second set of readers puts first.
  Stage 2, the build (needs the owner's answer to question 12 or K7: the fifth scene rides
  spring, which the helix does not ride yet, so the scene would take spring as it is).
  Worker: fable designs, opus builds · Source: owner, pass 001
- **B10 burrow · Doorways grown (second try: round first)** — two commits that apply alone.
  (1) The doorway rims are round: the trim tube has 24 or more sides with smooth normals,
  and nothing else changes (today it has ten, `sweepTube(..., 10, ...)` in `buildDoorFrame`).
  (2) On the round rim: the wall's scales run onto the outer shoulder and thin out, the lip
  has fine ridges and a sheen, kept away from the silhouette, with veins on the inner lip and
  a dark crease at wall and floor (commit `ec0953b` has the shader).
  Reverted in pass 009: "The newly detailed membrane rims look angular and laminated rather
  than softly grown" (astra); "polygonal bands and broken highlights. Fine shader grooves
  cannot hide the coarse rounded form. Increase sweepTube's radial segments from 10 to 24–32"
  (sol) · Files: `src/scenes/burrow/build.ts`, `src/scenes/burrow/materials.ts` · Worker:
  fable (short from opus once) · Frames: burrow:8.5 burrow:15.5 · Source: pass 008, 009
- **O11 orbit · The window rooms, corrected and further out** — (1) a fault in the diff: the
  room shader gets an unnormalised view ray and finds the lamp's closest point with
  `dot(L-P, d)`, so the lamp's glow depends wrongly on camera distance: normalise the ray
  (sol, pass 009). (2) Rooms register on more than the nearest one or two panes: a cheap
  one-plane parallax for windows between about 12 and 30 px, and the walking figure's head
  clear of the transom so it reads (fable; the worker's own note). The overhead town stays
  flat gold · Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:5 orbit:8.5
  orbit:12 · Source: pass 009 sol, fable
- **H13 helix · Ripples you can see** — the caustics of pass 009 sit between its two versions:
  the first (`0467beb`: bright thread lines over the coffers) was sent back as hiding the
  carving, the second (`facfb24`, on `loop`) is invisible to one reviewer ("cannot be seen:
  the pass-009 sheet is indistinguishable from pass-008"). Wanted: at helix:8.5 a viewer
  comparing with and without sees the ripples at once on the soffit and newel, as soft-edged
  bright cells (not hairlines), and the coffers still read. Prove it with an A/B of
  helix:8.5 and a soffit crop. Astra and sol also ask that the ripples follow or brighten
  near passing koi · Files: `src/scenes/helix.tsx` · Worker: opus · Frames: helix:8.5
  helix:12 helix:15.5 · Source: pass 009 fable; astra, sol (opportunity)
- **H11 helix · Stone and lamp at the lens** — the nearest risers and tread edges beside the
  runner have crisp stone grain and a narrow bevel instead of smeared vertical bands and dark
  seams; the newel's joints are antialiased; the lamp post beside the lens has fluting and
  turned collars and the bronze has a directional sheen. Files: `src/scenes/helix.tsx` ·
  Worker: opus · Frames: helix:8.5 helix:12 · Source: pass 007 fable, sol; pass 008 astra,
  sol, fable
  Pass 009: the hanging stairs "read as blunt, disconnected construction pieces" (sol): bevels
  and soffit detail on them, NOT smoothing or veiling (reverted in pass 007); the arcade's
  orbs want visible lantern fixtures (astra, twice).
- **O10 orbit · Road and kerbs at a distance** — the luminous kerb line is a little broader in
  the opening frames (t=0 to 2.5) so the road's sweep reads at thumbnail size (fable,
  regression on pass 008's kerbs: "thin hairlines"), and the carriageway keeps course-level
  texture into the middle distance instead of dissolving to a glossy purple strip (astra).
  Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:0 orbit:2.5 orbit:8.5 ·
  Source: pass 008 astra, fable
- **B11 burrow · The floor keeps its plum** — the chamber floor at t=8.5 has its deep glossy plum
  back under the new wrinkles: no grey-teal patches where mushroom pools fall (they should
  tint towards mint on plum, not grey), and the broad soft sheen of pass 007 at t=15.5
  returns. "The new membrane floor reads as a desaturated grey-teal patch ... outside the
  coral/plum palette" (fable, regression on B8) · Files: `src/scenes/burrow/materials.ts`
  (the floor) · Worker: opus · Frames: burrow:8.5 burrow:15.5 · Source: pass 008 fable
- **B9 burrow · Something to look at in the middle** — at t=12 the frame has a subject: a
  cluster of large eyes round the chosen branch's mouth that open in sequence as the camera
  turns in, and a mushroom stand with its pool at the near edge for foreground. "At t=12 the
  frame is almost all one orange scale wall with a small off-centre opening: no focal point,
  no near object, no far layer" (fable); also sol on scale monotony. Mind pass 005: a busier
  dome was reverted; this is the fork chamber only · Files: `src/scenes/burrow/creatures.ts`,
  `src/scenes/burrow/build.ts` (placement) · Worker: opus · Frames: burrow:12 burrow:15.5 ·
  Source: pass 006 and 007 fable
  Pass 008, fable again: mid-ride frames are "70% uniform red scale wall"; vary scale size and
  hue along the tunnel, eye clusters at the t=12 and t=19 stretches, something overlapping the
  lens edge.
- **D16 dollhouse · Depth in the garden** (ranked first by astra and sol in pass 009) — WAIT for
  D3: the garden is being rebuilt along the rail. Then: near, middle and far separate by more
  than size, with a soft dark pool under every flower clump, tree and doorway foot and a
  coloured pool of light on the sand in front of each doorway. Mind pass 005: haze that
  washes out the horizon's colour and dunes that hide the skyline were reverted.
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
  Pass 008: petal translucency (astra), paper birds with crease shading (sol), and from fable:
  "no light event": a low sun disc with a halo, cloud shadows drifting over the sand.
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
  Pass 008, sol: closed eyes in the dome "look like detached purple balls with black cuts":
  raised lid rims, recessed sockets, an occlusion halo.
  Pass 009, fable: eight to twelve full-size eyes in the dome wall that open towards the hoop
  as the camera arrives; the dome's ribs catching the hoop's light.
- **H12 helix · Beats on the climb** — KEYSTONE (camera): t=8.5, 12 and 15.5 are nearly the same
  composition; the look target swings out over the void at about t=10 and something crosses
  near the lens at about t=13 (fable, pass 008). Waits on the owner's rail decision, since the
  helix's camera track is what question 12 is about.
- **O9 orbit · Bushes** — PARKED: pushed both ways. Smooth ellipsoids with a tiled leaf texture
  drew one reviewer's complaint for three passes ("flat silhouette, no leaf relief"); lumpy
  displaced bushes (pass 008, commit `2726367`, reverted) drew all three ("craggy blue rocks").
  Only as: the pass-007 clipped silhouette kept exactly, with fine overlapping leaf relief in
  place of the tile texture and a contact patch on the cobbles.
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
- **H4 helix · A shaft with depth** (pass 008, second try) — the far arcade falls back, orbs
  vary, the rail catches light; three amber shafts of light with no edges that light the
  sills they cross; hanging stairs untouched. Astra and sol raised helix to 8:
  `loop/out/pass-008/helix.jpg`, `loop/out/pass-008/workers/H4/accept-both.jpg`.
- **D14 dollhouse · The flowers hold in motion and on any screen** (pass 008) — frustum culling
  from the real camera, a dithered hand-over between near and far flowers, smooth near petals:
  `loop/out/pass-008/workers/D14/d14/`.
- **B8 burrow · A floor that is alive** (pass 008) — folds, pores, scales carried in from the
  walls, a glow beside the thread: `loop/out/pass-008/frames/burrow-22.png`. Leftover: B11.
- **O6 orbit · Kerbstones** (pass 008; its topiary half was reverted) — stone kerbs near the lens
  that turn into luminous lines with distance: `loop/out/pass-008/frames/orbit-8.5.png`.
  Leftover: O10.
- **D15 dollhouse · The exit door has relief** (pass 009) — fielded panels with lit and shaded
  bevels under the kept cream outlines, crowned brass, a contact line on the plinth:
  `loop/out/pass-009/frames/dollhouse-22.png`, `loop/out/pass-009/workers/D15/compare/`.
- **O7 orbit · Rooms behind the windows** (pass 009) — lit rooms with shelves, lamps and a cat on
  a sill behind the near windows: `loop/out/pass-009/workers/O7/after/crop-8.5-window-b.png`.
  Faults: O11.
- **H10 helix · Caustics** (pass 009) — soft ripples of light on soffit and newel, too faint for
  one reviewer: `loop/out/pass-009/workers/H10/compare.jpg`. Leftover: H13.

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
- **Topiary as noise-displaced lumps** (pass 008, commit `2726367`, reverted) — all three saw
  rocks. Parked as O9.
- **Relief on the ten-sided doorway rims** (pass 009, commit `ec0953b`, reverted) — shading
  detail on coarse geometry shows the facets. Round the tube first: B10's second try.
