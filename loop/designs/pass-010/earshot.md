# earshot

**Premise.** A pocket sewn from two pressed leaves, where distance is loudness: whatever sings is hurled up close, and whatever falls quiet sinks away to the hushed rim.

## Method

Ten premises, in the order they came:

1. ~~A bell garden: chimes everywhere, the ringing ones nearest.~~ Sound means bells; the first picture anyone has.
2. ~~A sonar void where pings draw rings and things appear in them.~~ An audio visualiser: a tech demo, and dark.
3. ~~The inside of a guitar or music box, strings overhead.~~ Sound means instrument; also a cave, and clockwork.
4. ~~The inside of a trouser pocket: giant keys, coins, lint.~~ "Pocket" taken literally; a cloth cave full of props.
5. ~~A herbarium album whose pages of pressed leaves turn as you fly.~~ Pressed leaves mean a book; that is the library.
6. A flower press being unscrewed: the camera climbs the thread of its bolt while the layers lift apart.
7. A nursery mobile of pressed leaves, seen from a gnat's height, turning on its thread.
8. **A pocket sewn from two leaves where loud is near: leaf party-horns unroll to toot and arrive, curl up and recede.**
9. A tin-can telephone exchange: taut threads between leaf cups, and whoever is speaking is pulled beside you.
10. A great moth whose wingbeats shush whatever it passes, sending it over the horizon.

**Picked: 8.** It is the only one where the broken law is the thing you watch: every inhabitant demonstrates it every few seconds (curled = quiet = far), and the exit is the same law taken to its limit. The press and the mobile fit the rail but are ordinary rooms with a sound theme painted on; the exchange is a web of straight lines; the moth makes one slightly menacing actor do all the work.

## Column for "The worlds"

| | earshot |
|---|---|
| Premise | A pocket sewn from two pressed leaves, where distance is loudness: what sings is near, what is quiet is far. |
| Palette | Lid gold (sunlit yellow-green, the light), moss (dense near things), hush white (straw-pale: the far and the silent), russet (tongues, the crook), heliotrope (sound, and only sound), sepia thread (veins, stitches). The one high-key green world, lit through its own walls. |
| Who lives there | Tooters: leaf party-horns that unroll to toot. One colossal tooter on the horizon. Phosphenes drifting in the sky. |
| Exit | A plumb line hung from a twig crook at the tip of a leaf; the window is the blur of the humming thread. |
| The gimmick | Loud is near. |

Against the others: helix is stone and teal (here no stone, no teal, warmth only as russet accents); burrow is red flesh with mint (here green is the body and red the accent, the inverse); dollhouse is pastel under a blue sky with a sun (here one saturated hue family, no sky blue, no cast shadows); orbit is indigo with point lamps (here its complement, bright, with no lamps at all).

## The space

All coordinates are scene-local, from `season(4)`. The camera: t=5 at (0, 0, 0) flying −Z; the climb circles an axis at about (−9.5, ·, −7.7), radius 10; t=20 at (0, 13.7, −13.6); exit at (−5.2, 13.7, −31.4), heading 26° left of −Z.

- **The pocket.** Floor: a shallow dish, a patchwork of pressed leaves joined by running stitches, eye height 1.5 below the entry. Sky: one vast leaf seen from underneath, a dome 70 high, glowing, its veins dark. They meet at a rim where a slit of hush-white light shows between them, crossed by sepia stitches each as long as a house. The rim is 150 away ahead (−Z) and only 70 away behind (+Z).
- **Gradations.** The floor is toned in seven concentric steps around the axis, moss at the centre to hush white at the rim. Everything standing in a band takes that band's tone, so tone, distance and quiet are one scale.
- **The great leaf.** A coiled stalk (a spring, radius 4.5, 2.5 turns) rises on the helix axis; the camera winds up around it. At the top it carries one leaf blade, 12.2 above the floor's entry level, 28 long and 16 wide, whose midrib is laid exactly under the last 21 units of track. The camera enters *under* this leaf at t=5 and leaves along its top.
- **The conductor.** One tooter 40 tall with a rolled tongue 24 across, stationed far at (26, ·, −92) and near at (20, ·, −58).

## Opening silhouette (t=0 to 5)

Three dark shapes on a gold field: a spring on the left, a leaf roof across the top, and on the horizon, slightly right of centre, one big spiral (the conductor, asleep, its edge stitched in sepia so it stays a line drawing even when pale). A spiral is the most legible shape there is at stamp size, and lid gold is the complement of the orbit's indigo, so the moon gate holds a lit yellow-green disc with a snail drawn on it. The conductor moves from 11° left of centre at t=0 to 15° right at t=5.

## Beat sheet

| t | Camera | Near the lens | Far | What unfolds |
|---|---|---|---|---|
| 0 | 18.8 before the joint, level, sweeping left | nothing nearer than 15 | conductor curled on the rim; sky veins | Hush. Phosphenes drift; here and there a far dot swells and sinks. |
| 5 | origin, straight | glowing underside of the great leaf 12 above; coil stalk 5 to the left | conductor begins to unroll, first heliotrope rings | The first tooters arrive trackside at the right edge. |
| 8 | banked 16°, 25° into the turn, starting to climb | tooters hurled in at the left edge, tongues shooting out | a tide of pale dots on the −X plain, darkening as it comes | Crescendo. The conductor leaves frame right, half unrolled. |
| 12 | height 5.7, looking back (+Z) | chorus at its loudest, rings overlapping | **the rim, close: the horizon is a row of stitches** | The turn's first reveal: the world is sewn. The exit goes live, unseen. |
| 16 | height 11.5, looking +X | tongue tips at eye level 4 away, puffing rings | the widest plain; the seven tone bands seen from above | Loud on the left, already paling on the right: one frame holds the whole scale. |
| 20 | level on top of the great leaf, facing −Z again | stitched midrib 1.5 below; margin curls | conductor rolling itself up and sliding away right; the chorus going out like a tide | The turn's second reveal: the same view as t=5, emptied. One thing still hums, 16° left: a thread. |
| 23 | 6.8 from the exit, straight | the crook; the thread's blur, 3 wide | hush white | Sandstone and teal inside the blur. Margin curls lean in to listen. |
| 25 | through it | the blur fills the screen | | |

Look offset (only while `free(t)` > 0): 6° into the turn through the climb, 5° down from t=16, back to zero by t=19.5. FOV steady.

## Inhabitants

**Tooters** (about 400, one instanced draw for cones, one for tongues). A cone rolled from one leaf, seam stitched, and a tongue: a tapering leaf ribbon. Each has a far station on the rim and a near station 15 to 30 from the axis on the same radial line, so from the camera it mostly grows in place rather than crossing the frame. Loudness is a pure function: `L = clamp(chorus(t − t*ᵢ) + solo(fract(t/Pᵢ + φᵢ)))`. `t*ᵢ` is computed at mount: the time the camera's turning gaze reaches that bearing, so attack happens at the left edge of frame (0.9 s, with a small overshoot: the hurl) and release as it slides right (4 s). `solo` is a small private toot, period 5 to 9 s, so the hush is never still. Everything follows from `L` in the vertex shader: radius `mix(far, near, L)`; tone from the band it stands in; tongue shape a logarithmic spiral whose tightness is `(1−L)^1.5` (closed form, straight at L=1); tongue lifts from flat to 50°. Nothing new attacks after t=18.5. Near stations within 4.5 of any rail sample are rejected at mount; the usual `uEye`/`uFwd` cone push does the rest.

**The conductor** is the same shader with a finer strip: unrolls 5.5 to 9, rolls up and recedes 18.5 to 22.5. **Rings**: three thread hoops per tooter leave the tongue tip, radius `0.4 + 2.2·fract(0.8t + j/3)`, brightness `L·(1−phase)`. **Phosphenes**: soft heliotrope blobs in the sky shader plus about 40 air motes.

## The exit

A twig crook, russet, planted beside the midrib near the leaf's tip, arching over and ending in a fiddlehead curl. From it hangs one hair, 11 long, passing just beyond the leaf tip and held taut by an acorn bob below, which slowly twists one way and back. The hair crosses the rail at `frame(stretch.exit)`, its midpoint at eye height.

At rest it is a line. As it hums it blurs into a vesica, the shape of a leaf and of an opening eyelid, and the portal is that blur: half-width `A(t)·sin(π·s)`, with A = 0.04 from t=12 (a hairline of sandstone), ramping from t=19 to 2.3 by t=24. Its edge is eleven ghost strands, crowded and brightest at the extremes as a real string looks, heliotrope-white at 4×. Craft: wound whipping at the crook's tip, a peg, bark grain, the acorn's cross-hatched cap, tick stitches along the midrib closing up like a tape measure. It is too thin twice over: a hair, and a window that exists only while the hair is moving. It also obeys the law: it swells faster than the camera closes, because it is getting louder. The rim leaves the screen at about t=24.4.

## Build

| Draw | Count | Triangles |
|---|---|---|
| Sky dome (baked 2048² vein texture, phosphenes in shader) | 1 | 6k |
| Floor dish (baked patchwork + stitch tile, band tone, detail tile near) | 1 | 40k |
| Rim stitches (instanced tubes, 140) | 1 | 28k |
| Great leaf blade, coil stalk | 2 | 64k |
| Tooter cones, tongues, rings, contact blobs | 4 | 165k |
| Conductor cone, tongue | 2 | 12k |
| Margin curls (tongue shader), air motes | 2 | 8k |
| Exit: crook and fittings, bob, ghost strands, portal vesica | 4 | 30k |

About 17 draws and 350k triangles (the others run 30 to 75 draws and 700k and up).

Techniques that carry the look:

1. **Transmission instead of lighting.** No lights, no shadow maps. Every leaf is `albedo × glow`, brighter when the sky is behind it from the camera, veins dark. The great blade is drawn multiply-blended (order-independent, no sort) so the sky's veins show through it from below. Contact is a multiply blob under each foot.
2. **Framework first.** One vein generator at mount (midrib, pinnate laterals, a net) bakes the textures for sky, floor patches, blade and tongues.
3. **One loudness function** drives position, tone, curl and rings, so the law cannot drift out of sync.

Glow: sky 1.2 to 1.6 (under the bloom threshold); rim slit 3; rings and ghost strands 3 to 5.

## The kit, item by item

- **Framework**: the vein skeleton every membrane is stretched on, the sky included; the exit is the barest one, a crook and a hair.
- **Hurling**: the 0.9 s attack that throws a tooter from the rim to the trackside, tongue shot out.
- **Gradations**: seven tone bands that are at once the scale of distance and of quiet; the tape-measure stitches.
- **Distance is sound**: curled, pale and far are one state; unrolled, saturated and near are the other; heliotrope appears only where there is sound.
- **Pressed leaves**: floor, sky, blade, cones and tongues, flat, veined and translucent.
- **Pocket**: two leaves sewn at the rim; the stitches, thread and acorn set the scale.
- **Closed eyelid**: sourceless light through a veined membrane, no shadows, drifting phosphenes. Its red is moved to leaf gold because red is the burrow's; a rose edge survives on the rim slit.
- **Wind and unwind**: tongues roll and unroll, the conductor most of all; the bob twists; the stalk is a coil the camera winds up.

## Risks

1. **The law reads as "creatures rush up to greet me".** Guards: far solo toots, the conductor rolling up as it recedes at t=18 to 22, heliotrope reserved for sound. If frames still say "greeting", stop the tooters travelling and let them only grow in place.
2. **It reads as a fern forest, or as a green cave.** Keep uprights few and stitched, no foliage masses, the sky high-key and far, and the seam reveal at t=12 close enough to see the thread.
3. **Thin things at 4K with no temporal anti-aliasing.** Hair, rings, stitches and veins must be ribbons with analytic soft edges at least 1.5 px wide. Related: the vesica schedule has to clear the seam budget at t=24.99.

**Cut first**: air motes, margin curls, then solo toots. Never cut the conductor's roll-up or the seam reveal.
