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
means all three reviewers of that pass raised it independently.

- **K1 all · One colour pipeline, with bloom** — a scene looks the same through a portal as it
  does full-screen, so takeovers stop popping, and everything emissive glows.
  Today the picture through a portal is visibly washed out against the same scene drawn direct
  (`loop/out/pass-000/seam-burrow-dollhouse.jpg`; every seam differs by 4 to 5.5% RMSE). Find the
  cause first (materials with tone mapping off and raw shaders are tone-mapped on one path only).
  Then render every scene into the HDR target on both paths and tone-map once, in one final pass
  in the director, which also carries a mip-chain bloom, a per-scene grade (each scene exports
  its numbers), a vignette and a static dither. Done when every seam is under 1% RMSE and the
  gate passes; then tighten `seamRmse` to 0.02.
  Technique: HalfFloat scene target, downsample/upsample bloom, ACES or AgX in the final pass ·
  Files: `src/director/*`, one `look` export per scene file · Worker: fable ·
  Frames: all four at t=22 and t=24.5 · Source: prep baseline; pass 000 fable (opportunity)
- **D1 dollhouse · Things stand on the ground, in sunlight** — every tree, door, dome, pinwheel
  and flower drift has a soft shadow falling one way, the dunes have a lit and a shaded side, and
  the picture has a full value range instead of an even pale haze. The opening frame reads at
  thumbnail size.
  Technique: one sun direction; blob shadows or one static shadow map; fog pulled back from the
  foreground; wrap lighting with a warm key and a cool lavender fill; wind-ripple detail in the
  sand · Files: `src/scenes/dollhouse.tsx`, `src/scenes/dollhouse/garden.ts` · Worker: opus ·
  Frames: dollhouse:0 dollhouse:8.5 dollhouse:12 · Source: pass 000 panel 3/3 (ranked first by all)
- **B1 burrow · Wet, living walls** — the walls are packed scales that vary in size and spacing,
  with a wet sheen that moves with the view and light bleeding through thin edges, crisp right up
  to the lens. Today identical half-moons sit in straight tiled rows and smear at the frame edges.
  Technique: procedural scales in tunnel coordinates scaled by true arc length (voronoi or hex
  packing with per-cell jitter), derivative-based filtering, bump normal, fresnel sheen, wrap and
  back lighting · Files: `src/scenes/burrow/materials.ts` · Worker: opus ·
  Frames: burrow:8.5 burrow:12 burrow:19 · Source: pass 000 panel 3/3
- **H1 helix · Stone that holds up close** — at t=8 to 19 the treads, risers, stair underside,
  newel and lamp posts nearest the camera are carved, worn masonry with rounded edges and
  occluded corners; the newel and the lamp globes are round.
  Technique: the arcade's ashlar shader in cylindrical coordinates on the newel, nosing on the
  treads, coffering underneath, baked vertex AO, more segments on globes and posts ·
  Files: `src/scenes/helix.tsx` · Worker: opus · Frames: helix:8.5 helix:12 helix:15.5 ·
  Source: pass 000 panel 3/3
- **O1 orbit · A town with depth** — the near street, the middle towers and the town overhead
  separate into layers: far towers fade towards indigo and lose their brick contrast, far windows
  dim, and lamps throw soft pools on the cobbles and the nearest wall instead of lighting nothing.
  Technique: distance extinction in the tower shader, window occupancy seeded per building,
  analytic light pools in the ground shader from lamp positions, contact shading at tower bases ·
  Files: `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:0 orbit:8.5 orbit:15.5 ·
  Source: pass 000 panel 3/3
- **D2 dollhouse · The exit door is the best thing in the garden** — at t=19 to 24 the leaves
  have panels, hinges and a handle, the arch a moulded profile, the plinth an inlaid pattern and
  a round rim, and door and leaves cast contact shadows that follow the swing.
  Technique: relief painted in the shader with a faked bevel normal, small instanced fittings,
  blob shadows keyed to the leaf angle from `clock.t` · Files: `src/scenes/dollhouse.tsx` ·
  Worker: opus · Frames: dollhouse:19 dollhouse:22 · Source: pass 000 panel 3/3
- **O2 orbit · The moon-gate hut is the best thing in town** — shingled roof with a finial, gold
  filigree on the leaves, masonry on the steps, a rim of moonlight, and the gold ring spilling
  warm light onto the steps. Lamp heads are round and glow.
  Technique: reuse the tower roof shader; signed-distance filigree with emissive gold; fresnel
  rim keyed to the moon direction; radial falloff in the base shader · Files:
  `src/scenes/orbit.tsx` · Worker: opus · Frames: orbit:19 orbit:22 · Source: pass 000 panel 3/3
- **H2 helix · The keyhole arch is the best thing on the stair** — carved concentric mouldings,
  stone joints and grain on the surround, occlusion where it meets the landing.
  Files: `src/scenes/helix.tsx` · Worker: opus · Frames: helix:19 helix:22 · Source: pass 000 astra, sol
- **B2 burrow · The walls are watching** — many more eyes, set in fleshy sockets, clustered at the
  fork arches and in the dome; each opens as the camera nears, follows it and blinks, with a wet
  highlight and a mint glow on the wall around it.
  Technique: iris offset towards `uEye` in the fragment shader, eyelid as a signed distance opened
  by distance along the track, blink hashed per instance · Files: `src/scenes/burrow/creatures.ts` ·
  Worker: opus · Frames: burrow:2.5 burrow:8.5 burrow:22 · Source: pass 000 sol, fable (opportunity)
- **K2 all · Warm up again after a restored GL context** — a context lost at start-up costs
  nothing later. Today three restores the context but the director's warm-up is not repeated, so
  every program compiles in flight: 20 to 60 ms hitches at each scene's `t` = 5 and 12 for the
  whole first lap (seen in headless Chrome; `scripts/look.ts` reloads to avoid measuring it).
  Technique: reset `warmed` on `webglcontextrestored` · Files: `src/director/Director.tsx` ·
  Worker: fable · Source: prep baseline
- **H3 helix · Light from the koi and the lamps** — lamps pool amber on the steps and the column
  beside them, passing koi spill light on nearby stone, and slow teal caustics move across the
  column and the stair undersides.
  Technique: analytic point falloff from lamp positions along the helix; caustic pattern from
  `clock.t` · Files: `src/scenes/helix.tsx`, `src/scenes/helix/koi.ts` · Worker: opus ·
  Frames: helix:8.5 helix:15.5 · Source: pass 000 astra, sol (opportunity), fable
- **B3 burrow · The thread and the mushrooms are alive** — pulses of light run along the floor
  thread towards the exit and brighten the walls as they pass; mushrooms pulse in a wave and
  light the floor under them; the floor has a pore or moss pattern; the hoop is pearlescent and
  its feet grow out of the floor.
  Technique: travelling pulse from `clock.t`, falloff in wall and floor shaders · Files:
  `src/scenes/burrow/*` · Worker: opus · Frames: burrow:5 burrow:15.5 burrow:22 ·
  Source: prep baseline; pass 000 astra (opportunity), fable
- **H4 helix · A void with depth** — behind the arcade the teal is a lit volume: shafts of light
  falling through it, far stairs fading in layers, motes drifting.
  Technique: additive light-shaft cones with soft edges, layered fog, GPU motes from `clock.t` ·
  Files: `src/scenes/helix.tsx` · Worker: opus · Frames: helix:0 helix:5 helix:12 · Source: prep baseline
- **O3 orbit · The whale is the event** — at t=19 to 24 the whale and her calf carry glowing
  constellation markings and a cyan rim, swim with a slow tail beat, and the moon throws a fan
  of rays behind the hut.
  Technique: emissive star pattern, fresnel rim, vertex-shader swim, additive ray quads ·
  Files: `src/scenes/orbit/sky.ts` · Worker: opus · Frames: orbit:19 orbit:22 ·
  Source: pass 000 panel 3/3 (opportunity)
- **K3 all · Depth for the final pass** — Needs: K1. The scene target carries a depth texture, so
  the final pass can do height fog, soft particle edges, depth of field focused on the exit, and
  camera motion blur computed from `clock.t`.
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
| HDR and bloom | neon trim, muzzle flashes, eclipse corona | emissive values above 1 into a HalfFloat target, mip-chain bloom | K1 |
| Grade, vignette, dither | cold blue exterior, amber interior | lift/gamma/gain and split toning per scene in the final pass; static interleaved-gradient dither against banding | K1 |
| Anamorphic streaks, lens flare | glare round the eclipse | extra horizontal blur tap in bloom; flare sprites placed from a light's screen position | K1 |
| Chromatic aberration, radial streaks | the dash effect | final pass, strength keyed to camera speed, strongest in the dive through a portal at t=23 to 25 | K1 |
| Light shafts | warm cones under a canopy | additive cone meshes with fresnel edge fade and scrolling noise; or a radial blur from the light's screen position | none, or K1 |
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

Nothing yet.

## Rejected

Items tried and dropped, with the reason, so they are not tried the same way twice.

Nothing yet.
