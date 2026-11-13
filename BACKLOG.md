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
- **H7 helix · The lamp by the lens** (panel 3/3 in pass 005; fable ranked it first) — at t=8.5
  and 15.5 the lamp beside the stair is a finished object that lights its surroundings: a
  smooth turned post (no facets or shading break), a glass globe with a hot core and a warm
  limb that keeps a readable round silhouette under bloom, a warm pool on the tread, the carpet,
  the handrail and the newel beside it that falls off with distance, and a soft contact shadow
  at its foot. It stands a little further out from the runner so the stair stays the dominant
  path, and the handrail beside it is a smooth round rail. The grey sawtooth satellite stairs
  in the void take the sandstone material, tinted teal with distance.
  "The scene nearest the lens for the longest is the least finished ... the lamp post is a
  crumpled low-poly column with visible facets and a hard shading break, the globe is a flat
  cream disc that lights nothing around it" (fable); "The close lamp dominates the climb with a
  featureless bright globe and a visibly angular shaft" (astra); "move the nearest posts farther
  outside the stair rail. Reduce their head size and retain a smaller warm glow" (sol).
  Technique: lathe with 32+ segments; fresnel-rimmed emissive globe, its core well above 1 and
  the helix's bloom threshold raised to match in `src/director/looks.ts`; an analytic
  point-light term in the stair, carpet, rail and newel shaders from the nearest lamps (their
  positions are a function of the helix parameter); more segments and smooth normals on the
  rail · Files: `src/scenes/helix.tsx`, the `helix` entry in `src/director/looks.ts` · Worker:
  opus · Frames: helix:8.5 helix:12 helix:15.5 helix:19 · Source: pass 000 fable; pass 001
  fable; pass 004 astra, sol; pass 005 panel 3/3. Absorbs H3's lamp half and H6.
- **D11 dollhouse · The exit is the richest thing in the garden** (panel 3/3 in passes 004 and
  005) — at t=19 to 24 the plinth is a turned piece with a stepped, bull-nosed edge and an
  inlaid rosette (tile or marquetry with fine joints) instead of a cream disc with printed
  rings; the coral surround is built of voussoirs with bevelled joints and a raised moulding;
  the two leaves throw soft shadows onto the plinth that follow their swing, and the surround
  sits in an occlusion gradient where it meets the plinth. The side doorways, with their
  dotted and striped frames, no longer look richer than the exit. Nothing else in the garden
  changes.
  "The exit is not the most crafted object in its scene. The plinth is a flat cream disc with a
  few painted rings and no rim profile, the surround is a smooth untextured coral band with one
  plain keystone, and the open leaves cast no shadow onto the plinth" (fable); "the panel
  outlines still read mainly as paint and the large plinth remains visually smooth" (astra).
  D9 (pass 005, reverted for its dunes) had a rounded plinth with grain and leaf contact
  shadows in commit `1294f26`; take those parts from it.
  Files: `src/scenes/dollhouse.tsx` · Worker: opus · Frames: dollhouse:19 dollhouse:22
  dollhouse:24 · Source: pass 001 to 005
- **B4 burrow · The hoop glows (second try, the hoop alone)** — at t=19 to 24.5 the hoop is the
  brightest, most finished thing in the dome: it keeps the glossy bubble and bright rim it has
  now and gains what makes it an object: a rim that glows above the bloom threshold with a
  fresnel term, a row of mint beads, gimbal rings with real thickness, and a pool of light on
  the rippled floor beneath it. It fills at least as much of the frame as now. The dome wall,
  the eyes and the mushrooms are NOT changed by this item.
  Reverted in pass 005 (commit `d10cb57`), which also brightened the dome wall, opened every
  eye and added foreground mushrooms: "The dome's brighter, larger wall scales and many fully
  open white eyes compete with the central hoop" (astra); "it is now a flat disc with thin
  matte pink gimbal rings and a small beaded rim that does not glow, and it covers less of the
  frame. It is more detailed up close but weaker as the thing the camera stares at" (fable).
  That commit's floor pool and bead geometry are reusable; note its bug: a wall material given
  `new Vector4()` for "no pool" switches the pool on (w defaults to 1).
  Files: `src/scenes/burrow.tsx`, `src/scenes/burrow/materials.ts` (the floor pool only) ·
  Worker: fable (short from opus once) · Frames: burrow:19 burrow:22 burrow:24 burrow:24.5 ·
  Source: pass 000 to 005
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
  Pass 004: the overhead city still "compresses into a dense field of similarly blue towers and
  yellow window specks" (astra): dim distant windows with their towers; lantern light shafts
  between the overhead towers (sol).
  Pass 005: astra and sol both ask, as their opportunity, for a whale-and-calf reveal staged
  against a quiet gap of sky at t=12 to 19; fable and sol want the moon's disc clamped ("a
  clipped white blob") with its glow moved to a wide, dim halo.
- **D12 dollhouse · Something near the lens, and dunes with a lit side** — the garden reads in
  layers from its first frame: a few tall flowers and grass blades stand just beside the
  camera's path and sweep past with parallax, swaying from `clock.t`; one or two low dune
  ridges cross the middle distance with a sunlit face and a lavender lee, flower drifts
  following their slopes; far props lose a little contrast. The skyline of hoops and domes
  stays fully visible above the dunes (it is the scene's silhouette), and the horizon's candy
  colour stays as it is.
  Reverted as D9 in pass 005 (commits `1294f26`, `36a4313`): ridges all round the garden hid
  the hoops ("partially buried, weakening the garden skyline", sol) and the change otherwise
  read as "almost imperceptible" (fable); the first version's haze washed the horizon out.
  Still ranked first by astra and sol: "the opening still reads as scattered objects across a
  pale plane"; fable: "flowers are tiny flat rosettes scattered at one scale with nothing near
  the camera".
  Technique: instanced blades and tall flowers placed along the camera track outside the
  line of flight, bent in the vertex shader; ridges composed for the opening view only, lower
  than the hoops' feet; a small contrast falloff with distance, not a haze · Files:
  `src/scenes/dollhouse.tsx`, `src/scenes/dollhouse/garden.ts` · Worker: fable (short from opus
  once) · Frames: dollhouse:0 dollhouse:5 dollhouse:8.5 dollhouse:12 dollhouse:19 · Source:
  pass 004 fable; pass 005 panel 3/3
- **B7 burrow · Mushrooms that hold up close** — the mushrooms nearest the lens (t=8.5, and two
  or three large ones framing the hoop at t=22, which astra welcomed as "foreground depth")
  have round caps with no polygon silhouette, radial gills underneath, a slight undulation,
  soft-edged spots, fibrous stems and a dark foot on the floor; cap colours are chosen (mint,
  lilac, gold), not drawn from the shared random stream.
  "The largest caps reveal angular silhouettes and abrupt changes in surface shading ... white
  spots look painted onto hard shells" (sol); "Their surface craft falls below the surrounding
  wall scales" (astra) · Files: `src/scenes/burrow/creatures.ts`, `src/scenes/burrow/build.ts`
  (mushroom placement in the dome) · Worker: opus · Frames: burrow:8.5 burrow:22 · Source:
  pass 005 panel 3/3 (on the reverted B4, and on t=8.5 as it is now)
- **O6 orbit · The street, finished** — leftovers of O5: the topiary's leaf pattern is irregular
  and fades with distance so a bush is a soft dark mass, not "a tiled sphere" (fable,
  regression at t=15.5); the lamp cones have no visible edges (they read as "hard-edged
  translucent trapezoids"); the two kerb strips are kerbstones with joints at a lower
  brightness; ordinary bulbs and kerbs sit a step below the moon gate so "several light
  sources" no longer "become nearly white simultaneously" (sol).
  Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:8.5 orbit:15.5 orbit:22 ·
  Source: pass 005 sol, fable
- **H4 helix · A void with depth** — far arcade tiers lose contrast and dissolve towards teal,
  far orbs are smaller and dimmer, and behind the arcade the teal is a lit volume: shafts of
  light, far stairs fading in layers, motes drifting. "The improved foreground carving exposes
  how little atmospheric separation the shaft has" (sol).
  Technique: distance-dependent contrast reduction in the arcade shader, additive light-shaft
  cones with soft edges, GPU motes from `clock.t` · Files: `src/scenes/helix.tsx` · Worker: opus ·
  Frames: helix:0 helix:5 helix:12 · Source: prep baseline; pass 001 sol; pass 003 astra, fable
  (opportunity: amber light shafts across the void with koi brightening as they cross)
  Not blocked by the rail any longer: it changes the shaft, not the stair, and whoever lands
  the helix on the rail carries it over. Pass 004: astra and sol ask again for amber shafts
  and caustics; fable wants the arcade darker and cooler with distance so the stair stands out.
  Pass 005: fable again (light shafts from the arcade arches, dust motes); astra and sol ask for
  caustics on the soffits and newel (the other half of the old H3).
- **D10 dollhouse · No two rooms alike, and something moves in each** — the doorways hold
  visibly different impossible rooms again (a twisting room of rotating arch layers comes back
  beside the hall, the rotunda and the avenue), and each has one thing in motion from
  `clock.t` (a swinging lamp, a rolling ball, the arches turning), so the insides are live
  rooms and not pictures.
  "The right background doorway now contains another column hall instead of the previous
  twisting interior ... the collection of impossible rooms loses some variety" (sol,
  regression); "they are static pictures" (fable) · Files: `src/scenes/dollhouse.tsx` · Worker:
  opus · Frames: dollhouse:5 dollhouse:12 dollhouse:19 dollhouse:22 · Source: pass 004 sol, fable
- **D8 dollhouse · Wind and paper light** — the garden moves and is made of paper: a slow wind
  wave bends the flower stems and ruffles petals, soft cloud shadows drift across the dunes,
  and pinwheel blades, birds and petals glow at the edges where the sun shines through them.
  Technique: one travelling wave from `clock.t` shared by the flower vertex shader and a
  low-frequency shadow mask in the sand shader; a transmission term and fold shading on paper
  things · Files: `src/scenes/dollhouse/garden.ts`, `src/scenes/dollhouse.tsx` · Worker: opus ·
  Frames: dollhouse:0 dollhouse:8.5 dollhouse:19 (and two frames a second apart) ·
  Source: pass 003 panel 3/3 (opportunity)
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
- **O7 orbit · Rooms behind the windows** — the tower windows the camera passes at t=5 to 12 show
  lit rooms with depth (interior mapping), and now and then a silhouette crosses one, keyed to
  `clock.t`. Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:5 orbit:8.5 orbit:12 ·
  Source: pass 005 fable (opportunity)
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
