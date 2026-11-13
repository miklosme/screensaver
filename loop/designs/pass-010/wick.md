# wick

**Premise.** A ballroom at white noon where every candle is out and every reflection is lit: the candles are danced across the floor by their own reflections, which have legs.

## Ten premises, five struck

1. ~~A procession of snails carrying candles on their shells.~~ Struck: "carried" + "candle" = the first picture anyone gets.
2. ~~A birthday cake the size of a county, its candles as lighthouses.~~ Struck: the first wax object everyone knows, and it is candy land.
3. ~~A great hall of candles floating in the air.~~ Struck: a famous film already owns it, and the air is full of lights in helix and orbit.
4. ~~A wax museum whose figures melt and re-form.~~ Struck: the obvious reading of "wax", and grim.
5. ~~A wax mountain under one giant candle, drips as terraces.~~ Struck: a tower with a spiral round it; the helix again.
6. Candle stubs as boats on a slow river, each flame a passenger.
7. A hive: halls of honeycomb wax, bees ferrying wicks.
8. A bath at noon: candle ends adrift, the bathwater holding the real sky.
9. A candle farm in the back of a parlour: wicks sown in furrows, light harvested.
10. **A ballroom where the candles are carried by their reflections.**

**Chosen: 10** (it swallows 9 as its far fields). It is the only one where the broken law is what moves the inhabitants, so the strangeness is in every frame and is funny (a reflection with shoes) instead of being set dressing. The other four are pretty wax places that could exist, and two of them lean on taken ground (6 repeats the orbit's lanterns, 7 is a tunnel of cells).

## Column for "The worlds"

| | wick |
|---|---|
| Premise | A ballroom at white noon, hours across, where the candles are all out and their reflections are all lit, and do the dancing. |
| Palette | **Milk white** (room, haze, wax), **soot black** (wicks, shoes, the deep floor), **sealing-wax vermilion** (candles; washed to **blush** above the floor), **primrose** flame, **dove grey** smoke. |
| Who lives there | Waltzing candles, each carried by its legged reflection; wallflower tapers; smoke threads leaning in the draught. |
| Exit | The one lit flame in the room, on a taper thinner than a wrist. |
| The gimmick | The reflection is the real one. |

Against the others: helix is tan stone on teal (no white, no black, no red here except inside the exit); burrow is wall-to-wall coral and plum, dark and enclosed (here red is a small accent on a white field); dollhouse is multi-hue pastel under a blue sky with shadows (here two hues, no sky, no shadows); orbit is indigo with gold (here the dark is neutral black, and it is only ever the lower half of the frame).

## How the law is drawn

The floor is a flat sheet at `y = -2.2` under the rail (eye height 2.2). Every object exists twice: above the floor and mirrored below it. Which one is "the reflection" is swapped, and four differences say so:

- **Above** (where the camera is): candles are unlit, with a black wick and a rising smoke thread; colours are washed 65% towards milk white; shapes sway with the horizontal ripple of a reflection in water (`x += 0.05 * h * sin(3.1*y - 1.7*t + phase)`, `h` = height above floor); nothing has legs, things glide.
- **Below**: the same objects crisp, fully saturated, in a dark candle-lit room, every wick burning (primrose, linear 5 to 8), and each standing on the underside of the floor on two thin black legs with round shoes.
- The floor passes the lower world almost unchanged when looked at steeply and turns to white sheen at grazing angles, so the horizon dissolves into the white wall.
- There are no shadows anywhere. Things touch the floor through a pool of warm light around their feet, which is the lower twin's flame-light coming up through the sheet, and are shaded from below by it.

## Opening silhouette (t = 0 to 5)

The camera is at floor level, 2.2 above the sheet, sweeping left onto the −Z axis. The thumbnail is a white disc cut by a level horizon: milk white above, black strewn with primrose points below. One tall red-and-white striped line stands on the horizon left of centre with a single spark at its tip (the exit taper, about 48 units off, its flame 16° above the horizon), and a pale tiered chandelier hangs at the left edge above its blazing twin in the floor. It reads small because it is three shapes in three values (white field, black half, one vertical stroke with a hot dot), and inside the orbit's gold moon gate against indigo it looks like the full moon.

## Beat sheet

Distances `s` are along spring from the joint; headings are degrees turned left from −Z; heights are above the joint. Between t = 6 and 19 the camera looks into the turn: up to 13° left and 9° down, weighted by `stretch.free(t)`. FOV fixed.

| t | Camera | Near the lens | Far | Unfolds |
|---|---|---|---|---|
| 0 | approach, level, heading 26° right of −Z | outer wheel of couples parting round the flight cone, 2 to 3 units off; shoes trotting in the floor | window wall blazing; the taper as a stroke | the silhouette above |
| 5 | joint, heading 0°, h 0 | a couple gliding past at eye height, its lit twin under it | taper ahead-left, flame at the top edge of frame | first clear look at legs under a legless candle |
| 8 | s≈13, heading 30°, h 0.4, banking in | the inner wheel, turning the same way a little slower than the camera, so one couple lingers alongside for 3 s | west: the backfields, furrows of candles to the skirting board, a gust running through their smoke | the camera has joined the line of dance |
| 12 | s≈35, heading 155°, h 6, bank 16° | lowest chandelier tier: dead candles, hanging wax drops, smoke, 3.5 units left | south wall: an ordinary panelled door, 200 units tall, keyhole glowing in its floor twin | scale reveal; wheels start opening into a five-petal figure; behind the camera the exit goes live |
| 16 | s≈57, heading 280°, h 11.5 | top tier and chain; tips of wallflower tapers come level on the right | east wall; below-left the dance is now a turning flower drawn in flames, the chandelier's twin burning deep in its centre | the crowd has become a pattern |
| 20 | s=77, heading 0°, h 14, level | nothing between lens and the avenue's first tapers | the one lit flame, 16° left, against the white windows | the only fire on this side of the floor |
| 23 | straight, 5.6 units out | wallflowers either side bow towards the flame as the camera passes; melt crown, drips, curled wick | inside the flame: sandstone and teal | the flame's edge flickers, the world in it holds still |
| 25 | exit | the flame's skin crosses the lens | the helix | takeover |

The turn reveals the four walls in order (windows, fields, door, wallflowers, windows again with the flame lit); the climb turns a crowd into a figure and the floor into depth.

## The inhabitants

**Couples** (about 70, so 140 candles, drawn above and below). Five wheels round the spiral's axis `C` (centroid of `stretch.frame` positions over the turn), radii 5.2, 7.2, 13, 16.5, 21, leaving 8.4 to 11.8 empty for the camera. For couple `i` on wheel `k`: `theta = theta0_i + w_k*t` (w about 0.42 rad/s inside, down to 0.18 outside, one wheel reversed); `R = R_k + P(t)*1.2*sin(5*theta)`, `P = smoothstep(9, 14, t)`; partners at `±0.9*(cos psi, sin psi)`, `psi = psi0_i + 2.1*t`; three steps per turn: bob `0.12*abs(sin(1.5*psi))`, lean 6° inwards. The lower twin gets the same position mirrored, plus legs: foot phase from `1.5*psi`, the swing foot lifted 0.15 and thrown along the velocity (position at `t` and `t + 0.02`, both analytic). The upper twin only bobs: it is visibly a passenger. Couple centres are pushed sideways out of a cone ahead of the eye (`uEye`, `uFwd`, as in `helix/koi.ts`), both twins alike, so the dancers part for the camera.

**Wallflowers** (about 24): tapers 9 to 17 tall that do not dance, along the east wall and flanking the last 9 units of the approach at `frame(d) ± right*3.2`. Static; lean towards the flame grows with `1/distance to uEye`.

**Smoke threads**: one ribbon per upper wick, curling by a sine that travels up it, all bent by one gust `g(dot(xz, dir) - 9*t)` crossing the room. **Backfields**: about 3000 low candles in 40 wavy furrows from 45 to 250 units out on the west side, their lower flames the landing lights that give the floor its depth.

## The exit

A single taper, 0.7 in radius and 15 tall, standing alone on the floor under `frame(stretch.exit)`: milk white with a vermilion barber-pole twist, the only saturated, unrippled object above the floor. In the floor its twin is the pale, wobbling, unlit one: the law, inverted once.

- **Flame = portal.** A lathed teardrop, radius 1.5, height 4.6, wearing `portalMaterial` (already double-sided, screen-space). Its fattest section is at eye height with its near skin 0.3 short of the exit point, so the lens is inside the closed body, and every pixel is portal, just before t = 25. Flicker is on the mesh matrix (a shear and a y-stretch from two sines of `clock.t`), so the outline dances and the picture inside does not.
- **Before t = 12** the portal is black, so an opaque emissive cover (primrose core 6, amber skin, same lathe scaled 1.02) hides it and fades out over t = 11.5 to 13, while the camera faces the door. An amber flame and a flame-shaped window on amber stone are the same thumbnail.
- **Craft:** an additive fresnel aureole shell that blooms the outline; a small teal cup at the flame's root (the helix's own void colour); a curled wick with an ember at 4; a flared, scalloped melt crown holding a glossy pool; frozen runs of wax down the twist with a dozen drops sliding (`fract(phase + 0.03*t)`); a warm point-light term in the candle shader so the wallflowers' tips catch its light from above, the one place light does.
- **Too thin:** the room is hours wide and the way out is a candle flame.
- **Reaching it:** the turn ends at t≈19.7 already at flame height; the flame is first seen 16° left, swings to centre by t = 23, and the last 4.76 units are straight and level.

## How it is built

| What | How | Calls | Triangles |
|---|---|---|---|
| Room shell | one oval lathe (wall, cove, ceiling rose); wainscot, three arched windows (north), panelled door (south) as SDFs in the fragment shader; drawn above (white) and mirrored (dark) | 2 | 6k |
| Floor | one disc, blended, `depthWrite` off: fresnel white sheen, hairline inlay of the dance rings and furrows (`fwidth`), drawn after the lower world | 1 | 0.2k |
| Dancers + wallflowers | one lathed candle (16×12), four surface styles in the shader (plain, barley twist, rolled honeycomb sheet, banded pillar), drips from the rim; one instanced mesh per side sharing a program, `uSide` choosing wash + ripple or crisp + lit | 2 | 140k |
| Legs and shoes | instanced bent capsule + ellipsoid, lower side only | 1 | 20k |
| Flames, light pools | instanced teardrops (HDR) and additive floor discs, lower side only | 2 | 25k |
| Smoke | instanced 2×20 ribbons, alpha, upper side only | 1 | 15k |
| Chandelier | merged at mount: baluster lathe, 20 S-curve tube arms in three tiers, cups; instanced wax drops and chain links; turns at −0.05 rad/s; drawn above and mirrored | 4 | 90k |
| Backfields | 6-sided candles, both sides, + flame quads | 3 | 190k |
| Exit | taper, crown, drops, wick, portal flame, cover, aureole, cup, pale twin | 9 | 25k |

About 25 calls and 0.5 M triangles (the others run 75 to 100 calls, 0.75 to 1.4 M). Cost is fill: the lower world plus the floor blend is roughly 2× overdraw on half the frame, with no shadow map and no render target, so 1.5 to 1.9 ms should hold. `looks`: bloom 0.7, threshold 1.6 (white wax sits near 1.0), vignette 0.18.

Techniques that carry the look: **(1)** mirrored duplicates styled as swapped (wash and ripple above, crisp and lit below) instead of a real reflection pass; **(2)** light from below: wrap shading whose key is the floor, a contact glow instead of a contact shadow, edge translucency on wax; **(3)** the fresnel floor that fades the dark half into the white wall. Note: mirrored instances flip winding (use `BackSide` on the lower meshes), and render order is lower world, then floor, then smoke and aureole.

## The kit in the result

- **backfields**: the candle farm in furrows at the back of the room, and the wheels' formations.
- **cavorts**: the waltz, three steps to the turn, turning the way the camera turns.
- **blend**: the floor's sheen blends the dark half into the white; washed and saturated wax of one candle meet at its foot.
- **A thing and its reflection have swapped places**: lit, crisp, legged twins in the floor; pale rippling passengers above; inverted once at the exit.
- **Wax and wick**: everything is candle; the black wick is the scene's only line-work.
- **A single room that takes hours to cross**: skirting board, door and windows on the horizon; candles at candle size, the camera at a moth's.
- **Noon with no shadows**: white windows on all sides, no shadow anywhere, contact by glow.
- **Carried by something else**: candles by their reflections' legs, smoke by the draught, the one flame by its taper.
- **Start from the inhabitant**: a candle cannot walk, so something had to carry it; a floor polished enough to hold that something is a ballroom.

## Risks, and what to cut first

1. **The swap may not read**, and just look like a mirror floor. The legs, the unlit wicks and the dark lower half must be visible at t = 5 to 8 from 2.2 above the floor; if they are not, lower the eye or enlarge the shoes before adding anything else.
2. **White on white goes flat** without shadows. Depth has to come from haze, the black half, wick line-work and the uplight gradient; judge t = 16 and t = 20 hardest, where the frame is mostly upper room.
3. **The 3D flame portal**: every pixel must be portal at t = 24.99 (seam gate), and the cover's hand-off at t = 12 must stay off-screen. Fallback: a flat teardrop square to the tangent inside the lathe.

Cut first, in order: the ripple on the upper world, the wall furniture other than the door, backfield density, the petal figure (keep plain wheels).
