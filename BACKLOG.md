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

- **K7 helix · Spring has a run-up, and the helix rides it** — the helix rides the rail and its
  opening is as strong as the legacy one: through t=0 to 5 (and in the orbit's moon gate) the
  whole spiral stair stands in the shaft ahead with teal void behind several complete turns,
  both limbs in frame, legible at postage-stamp size; then the camera flies to it and climbs.
  The climb has air in it: the newel is no more than a quarter of the frame, the soffit is well
  overhead, and the shaft and arcade stay in view; lantern koi are near the lens or mid-air in
  most frames. The exit is the carved keyhole arch on its landing, as now.
  Reverted in pass 003 (commits `fbeaac2`, `2fbd0d9`): "Pass 002 showed a complete spiral
  against teal space; the replacement sister tower is partly obscured. The opening loses its
  immediately readable endless-stair silhouette" (astra); "by t=5 the left 40% of the frame is a
  blank curved brick wall" (fable); "The ride spends much of its time hemmed between masonry and
  ceiling" (sol); "The lantern koi are much less present" (fable).
  Why it could not be fixed from the scene's side: spring turns left straight after the joint,
  so on the approach the camera is 26.8 units from the turn's axis looking 40° past it, and a
  scene may not aim the camera before t=5.6. So this item reshapes the season with its scene:
  spring's body begins with a run-up of several seconds from which the stair is seen whole and
  ahead, then winds onto it (a turn of smaller radius, or fewer degrees, is fine). Frozen: the
  shared approach, the joint state, and the whole of summer (the burrow rides it; its sheet
  must not change by a pixel). Fall and winter may move to close the lap; nothing rides them.
  Technique: change spring's data in `design()` in `src/scenes/rail.ts` and re-plot; then start
  the helix from `2fbd0d9` for its rail plumbing, stair-on-the-bed geometry and draw-order
  saving, and from the legacy `helix.tsx` for its proportions (stair radius 5.5 round a column
  of 3). Judge against `loop/out/pass-003/helix.jpg` (the legacy helix) frame by frame · Files:
  `src/scenes/rail.ts`, `src/scenes/helix.tsx`, `src/scenes/helix/koi.ts`, `README.md` (one
  sentence) · Worker: fable · Frames: the whole helix sheet, orbit:22 orbit:24.5, the whole
  burrow sheet unchanged, rail plots · Source: owner, pass 001; pass 003 panel 3/3 (regression)
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
- **B1 burrow · Wet, living walls (second try)** — the wall nearest the lens is the most
  detailed surface in the frame instead of the least: soft packed scales with relief and a dark
  crevice between them, crisp to the lens and never smeared along the tunnel, varying slowly in
  size and strength, sitting under the ribs' light. Near walls keep their red value (no flat
  pale-pink wash at t=19 or t=0), between ribs it falls to plum, the dome keeps its radial
  rhythm, and mushrooms and doorway feet sit in soft occlusion with mint light pooled round
  the groves.
  Pass 003: "Uniform scallop rows and broad luminous ribs make the tunnel resemble padded
  plastic" (astra); "Identical rows of bright scallops cover nearly every surface ... patterned
  upholstery" (sol); "The tunnel wall nearest the lens blows out to flat pale pink and its scale
  pattern stretches into long radial smears" (fable). The first try (pass 001, commit `c91e1ed`)
  was reverted for the opposite fault: pale outlines round every cell read as paving and the
  ribs' value falloff was lost. Aim between the two.
  Technique: procedural scales in tunnel coordinates with true arc length and fwidth filtering
  (take that from `c91e1ed`), a bump normal from the scale height, crevice darkening instead of
  bright borders, the rim term clamped, low-frequency variation, the rib shading multiplied on
  top; occlusion and mint irradiance baked into the existing vertex-light attributes · Files:
  `src/scenes/burrow/materials.ts`, `src/scenes/burrow/build.ts` (attributes only) · Worker:
  fable (short from opus once) · Frames: burrow:0 burrow:8.5 burrow:12 burrow:19 burrow:22 ·
  Source: pass 000, 001, 003 panel 3/3; pass 002 fable
- **D7 dollhouse · The insides are vast** — a doorway's interior reads as a huge space at the
  size it has on screen, thumbnail included: three distinct depth layers, a dark first reveal,
  more floor than wall, rooms several door-widths deep fading into their own air, and one small
  bright thing far inside. Edge-on the door stays paper-thin while the inside shows parallax.
  D5 (pass 003) built the interiors; the panel finds them shallow: "The doorway interiors are a
  shallow box: flat vertical stripes on a back wall a metre behind a checker floor" (fable, who
  scored the scene 5); "broad colored bands ... floors and distant destinations are too weak"
  (sol); "read as striped inserts ... recesses need stronger lighting and scale cues" (astra).
  Technique: tune the interior-mapping shader in `dollhouse.tsx` (narrower near piers, darker
  reveals, contact occlusion where partitions meet the floor, per-room fog, a lit window or
  turning object several rooms in); widen the first chamber well past the opening · Files:
  `src/scenes/dollhouse.tsx` · Worker: fable (short from opus once) · Frames: dollhouse:0
  dollhouse:5 dollhouse:8.5 dollhouse:12 burrow:24.5 · Source: pass 003 panel 3/3
- **B4 burrow · The hoop is a crafted thing, in a dome with a foreground** — the exit is a thick
  organic ring with a pearlescent band, a recessed mint channel and beads that bloom, gimbal
  rings of a second material, a pool of mint light and a contact shadow on the floor under it;
  two or three large mushrooms stand near the lens to frame it (the dome lost its near layer
  when the burrow moved onto the rail), and the eyes on the dome wall are round eyes that turn
  to the hoop, not dark dashes.
  "The exit remains a nearly featureless white oval with thin white loops" (astra); "plain white
  tubing while the other scenes' exits have recognizable material and craftsmanship" (sol);
  "the least crafted object in its dome" (fable) · Files: `src/scenes/burrow.tsx`,
  `src/scenes/burrow/creatures.ts`, `src/scenes/burrow/build.ts` (mushroom placement in the
  dome only) · Worker: opus · Frames: burrow:19 burrow:22 burrow:24 · Source: pass 000 astra;
  pass 001 sol, fable; pass 003 panel 3/3, fable (regression at t=22)
- **O2 orbit · The moon-gate hut is the best thing in town (again, without its rider)** — the
  crafted gate of pass 003 comes back as built: gilt-framed leaves pierced with a crescent,
  stars and a ring of lights, a shingled roof with a crescent finial, masonry steps, the ring's
  warm wash. The overhead towers keep pass 002's separation, tuned once: a restrained
  moon-facing rim on middle-distance towers only, and successive layers separated by value.
  Reverted in pass 003 for its rider alone: "The overhead buildings merge into darker, less
  distinct silhouettes" (sol), "The previous outlines were excessive, but made the cylindrical
  town easier to decipher" (astra). The panel has now called the rim too strong (pass 002) and
  too weak (pass 003): land in between and leave it.
  Technique: `git revert c255ad5` restores the hut; then set `RIM_GLSL` between the two passes'
  values, as two commits (hut, rim) so one can be reverted without the other · Files:
  `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:19 orbit:22 orbit:12 orbit:15.5 ·
  Source: pass 000 to 003 panel 3/3; pass 003 astra, sol (regression)
- **D8 dollhouse · Wind and paper light** — the garden moves and is made of paper: a slow wind
  wave bends the flower stems and ruffles petals, soft cloud shadows drift across the dunes,
  and pinwheel blades, birds and petals glow at the edges where the sun shines through them.
  Technique: one travelling wave from `clock.t` shared by the flower vertex shader and a
  low-frequency shadow mask in the sand shader; a transmission term and fold shading on paper
  things · Files: `src/scenes/dollhouse/garden.ts`, `src/scenes/dollhouse.tsx` · Worker: opus ·
  Frames: dollhouse:0 dollhouse:8.5 dollhouse:19 (and two frames a second apart) ·
  Source: pass 003 panel 3/3 (opportunity)
- **H4 helix · A void with depth** — far arcade tiers lose contrast and dissolve towards teal,
  far orbs are smaller and dimmer, and behind the arcade the teal is a lit volume: shafts of
  light, far stairs fading in layers, motes drifting. "The improved foreground carving exposes
  how little atmospheric separation the shaft has" (sol).
  Technique: distance-dependent contrast reduction in the arcade shader, additive light-shaft
  cones with soft edges, GPU motes from `clock.t` · Files: `src/scenes/helix.tsx` · Worker: opus ·
  Frames: helix:0 helix:5 helix:12 · Needs: K7 (it rebuilds the scene). Source: prep baseline; pass 001 sol; pass 003 astra, fable
  (opportunity: amber light shafts across the void with koi brightening as they cross)
- **H3 helix · Light from the koi and the lamps** — Needs: K7. the amber is back and it lands on things:
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
- **O5 orbit · The street is a surface** — the road nearest the lens is worn setts with a raised
  crown and wet streaks that reflect the lamp colour; lamp heads are round with a hot core;
  bushes are smooth and leafy with a moon rim; the arches over the road carry voussoir banding.
  "The road is a featureless lilac band with two white stripes, and it is the surface nearest
  the lens for most of the ride" (fable). Files: `src/scenes/orbit.tsx` · Worker: opus ·
  Frames: orbit:8.5 orbit:15.5 · Source: pass 000 fable; pass 001 fable
  Pass 003, fable again: the bushes are "large faceted flat-shaded teal blobs", the arches "plain
  untextured tubes with a visible collar seam"; and as an opportunity, wet-street reflections:
  stretched specular streaks under each lamp and window in the cobble and road shader.
- **O3 orbit · The whale is the event** — at t=19 to 24 the whale and her calf carry glowing
  constellation markings and a silver-blue rim, swim with a slow tail beat, pass as a large near
  silhouette across the moon, and the moon throws a shaft behind the hut; lamps have fog halos.
  Technique: emissive star pattern, fresnel rim, vertex-shader swim, closed-form inscattering for
  the moon shaft and lamp halos · Files: `src/scenes/orbit/sky.ts` · Worker: opus · Frames:
  orbit:15.5 orbit:19 orbit:22 · Source: pass 000 panel 3/3; pass 001 sol, fable (opportunity)
  Pass 003: the moon "becomes a large white glare patch ... swallows the crescent finial"
  (astra): lower its emission, give the disc a gradient, thin the beam near it. Opportunities:
  the whale staged across the open sky at t=12 to 19 (astra); rising lanterns that throw moving
  warm pools on the tower walls (sol).
- **D6 dollhouse · Flowers with body** — near flowers have curved, folded petals with a darker
  underside, leaves and a shaded foot; drifts are distinct clumps separated by quiet sand, and
  far drifts read as patches, not specks. Rider: the last dashed shadow streaks near the
  horizon at t=8.5 dissolve (long thin shadows fade with distance from their caster).
  "Thin stems and flat petals form a noisy scatter over the pale sand ... loose coloured
  cutouts" (sol). Technique: instanced curved petal meshes with folded normals and a
  transmission term, stem-base occlusion baked into the terrain mask, clustering with
  distance-dependent detail · Files: `src/scenes/dollhouse/garden.ts`, `src/scenes/dollhouse.tsx` ·
  Worker: opus · Frames: dollhouse:0 dollhouse:8.5 dollhouse:19 · Source: pass 002 astra, sol, fable
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
- **H6 helix · Round and crisp at the lens** — Needs: K7. at t=8.5 the newel's joints are antialiased lines
  instead of stair-stepped texels, its silhouette and the handrail are round, satellite stairs
  carry the main stair's carving, and the foreground globe is a glass shell with a hot core that
  does not clip. Files: `src/scenes/helix.tsx` · Worker: opus · Frames: helix:8.5 helix:15.5 ·
  Source: pass 001 fable; H1's worker
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
- **B5 burrow · Rebuilt around summer** (pass 003, second try) — the first scene on the rail: the
  knot at the vanishing point from the first frame, a junction with watching eyes, a banked
  dive, two mouths at the fork, the dome: `loop/out/pass-003/burrow.jpg`,
  `loop/out/pass-003/frames/burrow-8.5.png`; plan and frame table in
  `loop/out/pass-003/workers/B5/after/`. Leftovers ride on B4 (the dome's near layer) and B1
  (the pale near wall at t=19).
- **D5 dollhouse · Every door is bigger inside** (pass 003) — four kinds of interior drawn through
  each doorway, and patterned paper arches: `loop/out/pass-003/frames/dollhouse-8.5.png`,
  `loop/out/pass-003/dollhouse.jpg`. The panel wants them deeper: D7.

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
