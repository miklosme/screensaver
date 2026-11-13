import { Matrix4, Quaternion, Vector3 } from "three";
import { TIMING } from "./types";

/**
 * THE RAIL — one closed track that carries the camera of every scene.
 *
 * The rail is a single closed, curvature-continuous curve, designed below (`design`) and cut into
 * four seasons. It owns the camera's position, heading, bank and speed, all as pure functions of
 * time. One lap is 396 units and takes 4 x TIMING.cycle = 80 s.
 *
 *   spring   the climb       one full turn to the left, rising 14 units all the way: a helix
 *   summer   the serpentine  a sweep right, a long 205 degree curl left that dives 3.3 units
 *                            and climbs most of the way back, a flick right: the busiest season
 *   fall     the dunes       two camel-backs (up 13, down 15, up 12, down 8 degrees) over a slow S
 *   winter   the vortex      a spiral dive to the right, 330 degrees round and 11 units down,
 *                            that tightens and banks harder (to 28 degrees) as it falls
 *
 * Plots of all of it: `loop/out/after/rail-views.png` and `rail-timeline.png` of the pass that
 * built it (pass 002), or `rail.frame` / `rail.pose` below.
 *
 * WHO RIDES WHAT. The scene at (zero-based) position `index` in the playing order rides season
 * `index % 4`, so a fifth scene rides spring again. A scene's 25 s timeline is the last 5 s of the
 * season before its own, followed by its own 20 s:
 *
 *   local t    0 ........ 5 ........................ 20 ........ 25
 *              | APPROACH |    its own season's body   | APPROACH |
 *              (of the season before)                  (its own; the next scene rides it too)
 *              seen through the previous portal        its portal grows to fill the screen
 *                         ^ t = 5: a JOINT, the takeover          ^ t = 25: the next joint: the exit
 *
 * While one scene is at t = 20..25 the next one is at t = 0..5 on a stretch of exactly the same
 * shape, bank and speed, so the two cameras move identically and the portal is a parallax-correct
 * window into the next world, bends included. That works for ANY pair of scenes, because the
 * APPROACH, the last 5 s of every season, is the same piece of track four times over: level,
 * 18.8 units long, a sweep of APPROACH_TURN degrees to the left that straightens out for the last
 * 4.76 units, slowing from 4.4 to RAIL.speed. It is flown without bank: the exit is in sight all
 * the way down it, and a camera that leaned into the sweep showed every exit tilted (by up to 9
 * degrees) until 1.4 s before the takeover. A season's own bends end before the approach begins,
 * so whatever bank its body carries has eased out by then. It is also what lets the loop wrap
 * from the last scene to the first when the scene count is not a multiple of four.
 *
 * A JOINT is still in the legacy seam state (see "Legacy" below) from 1.4 s before it to 0.6 s
 * after it: level, straight, not rotating, at RAIL.speed. So a scene on the rail can meet a scene
 * that is still on its own legacy track without a jolt. In scene time that is t = 3.6..5.6 and
 * t = 23.6..25.
 *
 * HOW A SCENE USES IT.
 *
 *   const stretch = useMemo(() => season(index), [index]);   // `index` comes in SceneProps
 *   // at mount: build the world along the curve
 *   for (let d = -6; d <= stretch.exit; d += 0.2) { const f = stretch.frame(d); ... }
 *   // in useFrame: the camera is the rail's
 *   const pose = stretch.pose(clock.t, tmpFrame);
 *   camera.position.copy(pose.position);
 *   camera.quaternion.copy(pose.quaternion);
 *
 * - LOCAL FRAME. Everything a Stretch returns is in the scene's own coordinates: the joint it
 *   takes over at (t = 5) is the origin, the camera there flies along -Z, and +Y is up. The local
 *   frame is the rail's frame turned about the vertical and shifted, so up is the rail's up for
 *   every scene and gravity in your world may point down -Y.
 * - DISTANCE. `frame(d)` takes local distance along the track: d = 0 is where the camera is at
 *   t = 0, `stretch.joint` (18.8) where it is at t = 5, and `stretch.exit` where it is at t = 25.
 *   The rail is closed, so d may run below 0 (the world behind the first frame) and past `exit`.
 * - THE EXIT stands at `frame(stretch.exit)`: the camera reaches that point at t = 25 flying
 *   along its `tangent`, level and straight for the last 4.76 units, so a portal centred there
 *   and square to the tangent fills the screen at the takeover. Because the approach bends, the
 *   exit is first seen about 16 degrees left of centre (t = 20..21) and swings to the middle by
 *   t = 23; the scene cannot aim the camera at it any earlier (see LOOKING).
 * - FRAMES. A frame's `position` is the camera's EYE. `tangent`, `up`, `right` are the track
 *   bed, NOT banked: `up` is where a floor laid on the rail faces (the floor under the camera is
 *   at position - up * eyeHeight) and `right` is horizontal. `bank` is the camera's roll on top
 *   of that and `quaternion` the camera's orientation with the bank in it. A world built from the
 *   bed stays upright while the camera leans, which is what makes a bank visible; build from
 *   `quaternion` and the world leans with the camera. Use the frame's own axes instead of
 *   assuming up = +Y: today the bed never tilts sideways and the bank stays under BANK_LIMIT, but
 *   that is the rail's data (`Bend`, `roll`), and a rail that rolls right over keeps this
 *   interface.
 * - LOOKING. The camera looks down the tangent. A scene may turn it (look into a bend, glance at
 *   a sight) only as an OFFSET weighted by `stretch.free(t)`, which is 0 until RAIL.release and
 *   from t = TIMING.cycle on, i.e. whenever two cameras share a stretch; any difference there
 *   makes the next world swim inside the portal. `lookTowards` applies such an offset. Field of
 *   view is the scene's own; hold it steady while `free(t)` is 0.
 * - SPEED is the rail's too: `stretch.distance(t)` is where the camera is, `stretch.speed(t)` how
 *   fast. Each season cruises at its own speed (spring 5.6, summer 5.9, fall 5.5, winter 6.5);
 *   the approach and the joints are the same for all. Beats that used to be keyed to t (doors,
 *   FOV ramps) are better keyed to where the camera is: `stretch.timeAt(d)`.
 * - ROOM. No two points of a stretch that are more than 3 x CLEARANCE apart along the track are
 *   closer than CLEARANCE in space (checked below, at start-up), so a tube of half that radius
 *   swept along a stretch never meets itself. Spring and winter do pass over their own plan,
 *   12 and 9 units higher or lower: that is the loop. The rail says nothing about what else a
 *   scene builds; whatever stands near the track has to keep off the line of flight.
 * - LEVEL GROUND. The track is level (and the bed's `up` is +Y) through the whole approach and
 *   for 2 units after a joint, so an exit can stand on a flat floor.
 *
 * `rail` is the whole lap in its own coordinates, for plots and for anything that needs more
 * than one stretch. `src/scenes/burrow.tsx` and `burrow/build.ts` are the worked example: a
 * tunnel swept along summer, chambers placed on it by distance, the camera with a look-ahead.
 *
 * ---------------------------------------------------------------------------------------------
 * Legacy: the seam state. A scene that still has its own camera track (helix, dollhouse, orbit
 * until they migrate) keeps the "seam state" around both of its seams:
 *
 *   - it travels in a straight line, along its own view axis,
 *   - it does not rotate (no yaw, pitch or roll rate),
 *   - at exactly RAIL.speed, without accelerating.
 *
 * It holds that state from t = 0 until RAIL.release and again from RAIL.settle until the end, and
 * leaves and re-enters it gradually. `createRide` takes care of the speed half of that; the
 * track's shape is up to the scene. `RAIL_LEAD_IN`, `RAIL_LEAD_OUT` and `createRide` go when the
 * last scene is on the rail; after that the joints themselves may bend (shorten the straights in
 * `shapeOf` and the seam window in the speed profile, for all four seasons alike).
 */
export const RAIL = {
  /** world units per second through every seam */
  speed: 3.4,
  /** local time until which an arriving scene holds the seam state */
  release: TIMING.arrival + 0.6,
  /** local time from which a leaving scene is back in the seam state */
  settle: TIMING.total - 1.4,
} as const;

/** length of straight track a scene needs at its start / before its portal */
export const RAIL_LEAD_IN = RAIL.speed * RAIL.release;
export const RAIL_LEAD_OUT = RAIL.speed * (TIMING.total - RAIL.settle);

const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export interface RideOptions {
  /**
   * Speed the scene would like mid-ride: a constant, or a function of local time for a ride that
   * e.g. starts brisk and winds down. Defaults to RAIL.speed (a perfectly even ride).
   */
  cruise?: number | ((t: number) => number);
  /** If given, the mid-ride speed is scaled so that exactly this much track is covered. */
  length?: number;
  /** seconds taken to get from RAIL.speed up to cruise after RAIL.release */
  rampIn?: number;
  /** seconds taken to get back down to RAIL.speed before RAIL.settle */
  rampOut?: number;
}

export interface Ride {
  /** track covered over the whole timeline */
  length: number;
  /** track covered at local time t; a pure function of t */
  at(t: number): number;
}

const STEP = 0.01;

/** Legacy. A speed profile that obeys the seam state at both ends. Position along the track = start + at(t). */
export function createRide({ cruise = RAIL.speed, length, rampIn = 3, rampOut = 3 }: RideOptions = {}): Ride {
  const n = Math.round(TIMING.total / STEP);
  const want = typeof cruise === "number" ? () => cruise : cruise;
  // speed = RAIL.speed + k * extra(t), where extra vanishes around both seams
  const extra = (t: number) =>
    (want(t) - RAIL.speed) *
    smoothstep(RAIL.release, RAIL.release + rampIn, t) *
    (1 - smoothstep(RAIL.settle - rampOut, RAIL.settle, t));
  const bonus = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) bonus[i] = bonus[i - 1]! + extra((i - 0.5) * STEP) * STEP;
  const base = RAIL.speed * TIMING.total;
  const k = length === undefined || bonus[n] === 0 ? 1 : (length - base) / bonus[n]!;
  return {
    length: base + k * bonus[n]!,
    at(t) {
      const f = Math.min(n, Math.max(0, t / STEP));
      const i = Math.min(n - 1, Math.floor(f));
      return RAIL.speed * (f * STEP) + k * (bonus[i]! + (bonus[i + 1]! - bonus[i]!) * (f - i));
    },
  };
}

// =============================================================================================
// The seasonal rail
// =============================================================================================

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type Season = (typeof SEASONS)[number];

const DEG = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** quintic ease: its first and second derivatives vanish at both ends, so curvature built from it ramps like a transition curve */
const ease = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * k * (k * (k * 6 - 15) + 10);
};
/** integral of the quintic ease from 0 to k, continued linearly past 1 */
const easeArea = (k: number) => (k <= 0 ? 0 : k >= 1 ? k - 0.5 : k * k * k * k * (k * (k - 3) + 2.5));

// --- time ------------------------------------------------------------------------------------
// Season time runs 0..TIMING.cycle from joint to joint. Speed is RAIL.speed around the joints,
// plus a fixed part every season shares (it shapes the approach), plus the season's own cruise.

/** season time until which the seam state is held after a joint */
const T_RELEASE = RAIL.release - TIMING.arrival;
/** season time at which the approach to the next joint begins: the last TIMING.arrival seconds */
const T_APPROACH = TIMING.cycle - TIMING.arrival;
/** season time from which the seam state is held before the next joint */
const T_SETTLE = TIMING.cycle - (TIMING.total - RAIL.settle);
/** speed above RAIL.speed with which every season enters its approach */
const APPROACH_EXTRA = 1.0;
const DT = 0.01;
const TICKS = Math.round(TIMING.cycle / DT);

const sharedExtra = (tau: number) => APPROACH_EXTRA * (ease(T_RELEASE, T_RELEASE + 3, tau) - ease(T_APPROACH, T_SETTLE, tau));
const cruiseShape = (tau: number) => ease(T_RELEASE, T_RELEASE + 3.5, tau) * (1 - ease(T_APPROACH - 3.5, T_APPROACH, tau));

/** distance covered by the shared part of the speed, and by one unit of cruise, at each tick of season time */
const SHARED_DIST = new Float64Array(TICKS + 1);
const CRUISE_DIST = new Float64Array(TICKS + 1);
for (let i = 1; i <= TICKS; i++) {
  const mid = (i - 0.5) * DT;
  SHARED_DIST[i] = SHARED_DIST[i - 1]! + (RAIL.speed + sharedExtra(mid)) * DT;
  CRUISE_DIST[i] = CRUISE_DIST[i - 1]! + cruiseShape(mid) * DT;
}
const tableAt = (table: Float64Array, tau: number) => {
  const f = Math.min(TICKS, Math.max(0, tau / DT));
  const i = Math.min(TICKS - 1, Math.floor(f));
  return table[i]! + (table[i + 1]! - table[i]!) * (f - i);
};

/** track covered by the approach: the same for every season */
const APPROACH_LENGTH = SHARED_DIST[TICKS]! - tableAt(SHARED_DIST, T_APPROACH);
/** straight track after and before a joint */
const STRAIGHT_AFTER = RAIL.speed * T_RELEASE;
const STRAIGHT_BEFORE = RAIL.speed * (TIMING.cycle - T_SETTLE);

// --- shape -----------------------------------------------------------------------------------

/**
 * One element of the track, in a season's own distance (0 at its first joint).
 * As a `turn`: the heading swings by `deg` in all over [at, at + len], positive to the left.
 * As a `slope`: the track pitches up to `deg` over the same span and back, positive climbing.
 * As a `roll`: the camera rolls by up to `deg` on top of the automatic bank, positive leaning
 * left; 360 is a barrel roll (not used: the owner has not yet allowed the horizon to go over).
 * Either way the element eases in and out over `ease` units, like a railway transition curve.
 */
export interface Bend {
  at: number;
  len: number;
  deg: number;
  ease: number;
}

interface SeasonDesign {
  /** distance from this season's first joint to its last */
  length: number;
  turn: Bend[];
  slope: Bend[];
  roll: Bend[];
  /** radians of bank per unit of curvature in this season's body (the approach has none) */
  bank: number;
}

/** degrees the shared approach swings to the left before it straightens out into a joint */
export const APPROACH_TURN = 26;
/** no bank beyond this: the horizon stays comfortable */
const BANK_LIMIT = 34 * DEG;
/** a stretch (25 s of track) keeps at least this far from itself */
export const CLEARANCE = 8;

/**
 * THE DESIGN. Three numbers are left to `close()`, which nudges them until the lap meets itself:
 * p[0] stretches fall, p[1] moves a few degrees of turn from fall's first sweep to its second,
 * p[2] scales winter's dive.
 */
function design(p: readonly number[]): SeasonDesign[] {
  const [weave = 0, hinge = 0, dive = 0] = p;
  return [
    // spring: the climb. One full turn to the left, rising all the way: a helix.
    {
      length: 96,
      turn: [{ at: 3, len: 73, deg: 360, ease: 9 }],
      slope: [{ at: 7, len: 64, deg: 15, ease: 11 }],
      roll: [],
      bank: 3.2,
    },
    // summer: the serpentine. A sweep to the right, then a long curl to the left that dives and
    // comes back up, and a flick to the right before the approach.
    {
      length: 99,
      turn: [
        { at: 3, len: 17, deg: -50, ease: 7 },
        { at: 20, len: 44, deg: 205, ease: 11 },
        { at: 64, len: 16, deg: -36, ease: 7.5 },
      ],
      slope: [
        { at: 21, len: 20, deg: -16, ease: 8 },
        { at: 59, len: 16, deg: 12, ease: 6.5 },
      ],
      roll: [],
      bank: 3.6,
    },
    // fall: the dunes. Four camel-backs over a slow S.
    {
      length: 95,
      turn: [
        { at: 3, len: 26, deg: -70 + 20 * weave, ease: 8 },
        { at: 29, len: 46, deg: 147 - 20 * weave - 20 * hinge, ease: 12 },
      ],
      slope: [
        { at: 3, len: 16, deg: 13, ease: 6 },
        { at: 19, len: 20, deg: -15, ease: 7 },
        { at: 39, len: 16, deg: 12, ease: 6 },
        { at: 55, len: 20, deg: -8, ease: 7 },
      ],
      roll: [],
      bank: 4.5,
    },
    // winter: the vortex. A spiral dive to the right that tightens as it falls.
    {
      length: 106,
      turn: [
        { at: 3, len: 84, deg: -190 + 20 * hinge, ease: 10 },
        { at: 40, len: 46, deg: -110, ease: 14 },
      ],
      slope: [{ at: 6, len: 76, deg: -10 * (1 + dive), ease: 12 }],
      roll: [],
      bank: 6,
    },
  ];
}

const windowOf = (b: Bend, s: number) => ease(b.at, b.at + b.ease, s) - ease(b.at + b.len - b.ease, b.at + b.len, s);
const windowArea = (b: Bend, s: number) => b.ease * (easeArea((s - b.at) / b.ease) - easeArea((s - (b.at + b.len - b.ease)) / b.ease));

/** yaw, pitch, bank and plan curvature of one season at its own distance s */
function shapeOf(d: SeasonDesign, strict: boolean) {
  const approach: Bend = {
    at: d.length - APPROACH_LENGTH,
    len: APPROACH_LENGTH - STRAIGHT_BEFORE,
    deg: APPROACH_TURN,
    ease: 6.5,
  };
  const rate = (b: Bend) => (b.deg * DEG) / (b.len - b.ease);
  for (const b of strict ? [...d.turn, ...d.slope, ...d.roll] : [])
    if (b.at < STRAIGHT_AFTER - 1e-9 || b.at + b.len > approach.at + 1e-9 || b.len < 2 * b.ease)
      throw new Error("rail: a bend reaches into a joint, into the approach, or is shorter than its easing");
  const soft = (x: number) => BANK_LIMIT * Math.tanh(x / BANK_LIMIT);
  return {
    yaw(s: number) {
      let a = rate(approach) * windowArea(approach, s);
      for (const b of d.turn) a += rate(b) * windowArea(b, s);
      return a;
    },
    pitch(s: number) {
      let a = 0;
      for (const b of d.slope) a += b.deg * DEG * windowOf(b, s);
      return a;
    },
    curvature(s: number) {
      let a = rate(approach) * windowOf(approach, s);
      for (const b of d.turn) a += rate(b) * windowOf(b, s);
      return a;
    },
    bank(s: number) {
      let body = 0;
      for (const b of d.turn) body += rate(b) * windowOf(b, s);
      // the approach is flown level: only the season's own bends bank
      let a = soft(d.bank * body);
      for (const b of d.roll) a += b.deg * DEG * windowOf(b, s);
      return a;
    },
  };
}

/** spacing of the rail's table, in distance */
const DS = 0.02;

interface Built {
  /** samples per lap; sample i is at distance i * step */
  n: number;
  step: number;
  length: number;
  /** distance of each season's first joint, and the lap's length as a fifth entry */
  joints: number[];
  /** cruise speed of each season above the shared profile */
  cruise: number[];
  pos: Float64Array;
  /** the track bed's orientation (no bank), as quaternions */
  bed: Float64Array;
  bank: Float64Array;
  curvature: Float64Array;
  /** how far the lap is from meeting itself: position (3) and heading */
  gap: [number, number, number, number];
}

/** direction of travel for a yaw (0 = -Z, positive to the left) and a pitch */
const forward = (yaw: number, pitch: number, out: [number, number, number]) => {
  const c = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * c;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * c;
  return out;
};

function build(p: readonly number[], withTable: boolean, ds = DS): Built {
  const seasons = design(p);
  const joints = [0];
  for (const d of seasons) joints.push(joints[joints.length - 1]! + d.length);
  const length = joints[seasons.length]!;
  const n = Math.round(length / ds);
  const step = length / n;
  const pos = new Float64Array(withTable ? (n + 1) * 3 : 0);
  const bed = new Float64Array(withTable ? (n + 1) * 4 : 0);
  const bank = new Float64Array(withTable ? n + 1 : 0);
  const curvature = new Float64Array(withTable ? n + 1 : 0);
  const cruise = seasons.map((d) => (d.length - SHARED_DIST[TICKS]!) / CRUISE_DIST[TICKS]!);

  const shapes = seasons.map((d) => shapeOf(d, withTable));
  const yawAtJoint = [0];
  for (let k = 0; k < seasons.length; k++) yawAtJoint.push(yawAtJoint[k]! + shapes[k]!.yaw(seasons[k]!.length));

  let k = 0;
  const heading = (s: number, out: [number, number, number]) => {
    while (k < seasons.length - 1 && s >= joints[k + 1]!) k++;
    const local = s - joints[k]!;
    return forward(yawAtJoint[k]! + shapes[k]!.yaw(local), shapes[k]!.pitch(local), out);
  };
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  const c: [number, number, number] = [0, 0, 0];
  const q = new Quaternion();
  const qPitch = new Quaternion();
  const Y = new Vector3(0, 1, 0);
  const X = new Vector3(1, 0, 0);
  let x = 0;
  let y = 0;
  let z = 0;
  heading(0, a);
  for (let i = 0; i <= n; i++) {
    const s = i * step;
    if (withTable) {
      while (k < seasons.length - 1 && s >= joints[k + 1]!) k++;
      const local = s - joints[k]!;
      const shape = shapes[k]!;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      q.setFromAxisAngle(Y, yawAtJoint[k]! + shape.yaw(local)).multiply(qPitch.setFromAxisAngle(X, shape.pitch(local)));
      // neighbours stay in the same hemisphere, so they can be blended component by component
      if (i > 0 && q.x * bed[i * 4 - 4]! + q.y * bed[i * 4 - 3]! + q.z * bed[i * 4 - 2]! + q.w * bed[i * 4 - 1]! < 0)
        q.set(-q.x, -q.y, -q.z, -q.w);
      bed[i * 4] = q.x;
      bed[i * 4 + 1] = q.y;
      bed[i * 4 + 2] = q.z;
      bed[i * 4 + 3] = q.w;
      bank[i] = shape.bank(local);
      curvature[i] = shape.curvature(local);
    }
    if (i === n) break;
    // Simpson's rule over one step
    heading(s + step / 2, b);
    heading(s + step, c);
    x += ((a[0] + 4 * b[0] + c[0]) * step) / 6;
    y += ((a[1] + 4 * b[1] + c[1]) * step) / 6;
    z += ((a[2] + 4 * b[2] + c[2]) * step) / 6;
    a[0] = c[0];
    a[1] = c[1];
    a[2] = c[2];
  }
  const turns = yawAtJoint[seasons.length]! / (2 * Math.PI);
  return { n, step, length, joints, cruise, pos, bed, bank, curvature, gap: [x, y, z, turns - Math.round(turns)] };
}

/** Newton's method on the three free numbers of the design until the lap meets itself. */
function close(): Built {
  const p = [0, 0, 0];
  // Simpson's rule is good to a few parts in 10^9 at ten times the table's spacing, which is all
  // the search needs; the table itself is then built once at full resolution.
  const coarse = DS * 10;
  for (let iteration = 0; iteration < 30; iteration++) {
    const g = build(p, false, coarse).gap;
    if (Math.hypot(g[0], g[1], g[2]) < 1e-9) break;
    const h = 1e-5;
    // jacobian by differences, then a 3x3 solve by Cramer's rule
    const J: number[][] = [];
    for (let j = 0; j < 3; j++) {
      const pj = p.slice();
      pj[j]! += h;
      const gj = build(pj, false, coarse).gap;
      J.push([(gj[0] - g[0]) / h, (gj[1] - g[1]) / h, (gj[2] - g[2]) / h]);
    }
    const det3 = (m: number[][]) =>
      m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
      m[1]![0]! * (m[0]![1]! * m[2]![2]! - m[0]![2]! * m[2]![1]!) +
      m[2]![0]! * (m[0]![1]! * m[1]![2]! - m[0]![2]! * m[1]![1]!);
    const D = det3(J);
    if (Math.abs(D) < 1e-12) break;
    for (let j = 0; j < 3; j++) {
      const m = J.map((row) => row.slice());
      m[j] = [-g[0], -g[1], -g[2]];
      p[j]! += Math.max(-0.25, Math.min(0.25, det3(m) / D));
    }
  }
  const built = build(p, true);
  if (Math.hypot(built.gap[0], built.gap[1], built.gap[2]) > 1e-6 || Math.abs(built.gap[3]) > 1e-9)
    throw new Error(`rail: the lap does not close (gap ${built.gap.map((g) => g.toFixed(4)).join(", ")})`);
  return built;
}

const BUILT = close();

// --- access ----------------------------------------------------------------------------------

export interface RailFrame {
  /** where the camera's eye is */
  position: Vector3;
  /** unit direction of travel */
  tangent: Vector3;
  /** unit normal of the track bed, without bank: where a floor laid on the rail faces */
  up: Vector3;
  /** tangent x up: to the right of travel */
  right: Vector3;
  /** the camera's roll about the tangent on top of the bed, in radians; positive leans left */
  bank: number;
  /** the camera's orientation: looking down the tangent, banked */
  quaternion: Quaternion;
  /** plan curvature here (1 / radius of the turn, positive to the left) */
  curvature: number;
}

export const createFrame = (): RailFrame => ({
  position: new Vector3(),
  tangent: new Vector3(),
  up: new Vector3(),
  right: new Vector3(),
  bank: 0,
  quaternion: new Quaternion(),
  curvature: 0,
});

const LAP = TIMING.cycle * SEASONS.length;
const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);
const scratchQ = new Quaternion();
const wrap = (x: number, period: number) => x - Math.floor(x / period) * period;

/** the rail's frame at lap distance s (any real number: the lap repeats) */
function frameAt(s: number, out: RailFrame): RailFrame {
  const { n, step, pos, bed, bank, curvature } = BUILT;
  const f = wrap(s, BUILT.length) / step;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  const j = i + 1;
  out.position.set(
    pos[i * 3]! + (pos[j * 3]! - pos[i * 3]!) * u,
    pos[i * 3 + 1]! + (pos[j * 3 + 1]! - pos[i * 3 + 1]!) * u,
    pos[i * 3 + 2]! + (pos[j * 3 + 2]! - pos[i * 3 + 2]!) * u,
  );
  const q = out.quaternion;
  q.set(
    bed[i * 4]! + (bed[j * 4]! - bed[i * 4]!) * u,
    bed[i * 4 + 1]! + (bed[j * 4 + 1]! - bed[i * 4 + 1]!) * u,
    bed[i * 4 + 2]! + (bed[j * 4 + 2]! - bed[i * 4 + 2]!) * u,
    bed[i * 4 + 3]! + (bed[j * 4 + 3]! - bed[i * 4 + 3]!) * u,
  ).normalize();
  out.tangent.set(0, 0, -1).applyQuaternion(q);
  out.up.set(0, 1, 0).applyQuaternion(q);
  out.right.set(1, 0, 0).applyQuaternion(q);
  out.bank = bank[i]! + (bank[j]! - bank[i]!) * u;
  out.curvature = curvature[i]! + (curvature[j]! - curvature[i]!) * u;
  q.multiply(scratchQ.setFromAxisAngle(Z_AXIS, out.bank));
  return out;
}

/** lap distance at lap time T (any real number) */
function lapDistance(T: number): number {
  const laps = Math.floor(T / LAP);
  const inLap = T - laps * LAP;
  const k = Math.min(SEASONS.length - 1, Math.floor(inLap / TIMING.cycle));
  const tau = inLap - k * TIMING.cycle;
  return laps * BUILT.length + BUILT.joints[k]! + tableAt(SHARED_DIST, tau) + BUILT.cruise[k]! * tableAt(CRUISE_DIST, tau);
}

function lapSpeed(T: number): number {
  const inLap = wrap(T, LAP);
  const k = Math.min(SEASONS.length - 1, Math.floor(inLap / TIMING.cycle));
  const tau = inLap - k * TIMING.cycle;
  return RAIL.speed + sharedExtra(tau) + BUILT.cruise[k]! * cruiseShape(tau);
}

/** lap time at which the camera is at lap distance s; the inverse of `lapDistance` */
function lapTime(s: number): number {
  const laps = Math.floor(s / BUILT.length);
  const target = s - laps * BUILT.length;
  let lo = 0;
  let hi = LAP;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (lapDistance(mid) < target) lo = mid;
    else hi = mid;
  }
  return laps * LAP + (lo + hi) / 2;
}

/** The whole lap, in the rail's own coordinates: spring starts at the origin, flying along -Z. */
export const rail = {
  /** distance round the lap */
  length: BUILT.length,
  /** seconds round the lap */
  duration: LAP,
  /** lap distance of each season's first joint (spring's is 0) */
  joints: BUILT.joints.slice(0, SEASONS.length) as readonly number[],
  /** frame at lap distance s */
  frame: (s: number, out: RailFrame = createFrame()) => frameAt(s, out),
  /** lap distance at lap time T; T = 0 is spring's first joint */
  distance: lapDistance,
  /** speed at lap time T */
  speed: lapSpeed,
  /** lap time at lap distance s */
  timeAt: lapTime,
  /** frame at lap time T */
  pose: (T: number, out: RailFrame = createFrame()) => frameAt(lapDistance(T), out),
} as const;

export interface Stretch {
  /** which season this scene's own 20 s are */
  season: Season;
  /** local distance of the joint this scene takes over at (t = TIMING.arrival): the local origin */
  joint: number;
  /** local distance of the joint this scene ends at (t = TIMING.total): where its portal stands */
  exit: number;
  /** local distance covered at local time t; 0 at t = 0 */
  distance(t: number): number;
  /** local time at which the camera is at local distance d */
  timeAt(d: number): number;
  /** speed at local time t */
  speed(t: number): number;
  /** the rail at local distance d, in the scene's local frame */
  frame(d: number, out?: RailFrame): RailFrame;
  /** the camera at local time t: `frame(distance(t))` */
  pose(t: number, out?: RailFrame): RailFrame;
  /** how much of a scene's own look offset may show at local time t: 0 wherever two cameras share the track */
  free(t: number): number;
}

const stretches: (Stretch | undefined)[] = [];

/** The stretch of rail the scene at position `index` in the playing order rides: season `index % 4`. */
export function season(index: number): Stretch {
  const k = wrap(Math.round(index), SEASONS.length);
  return (stretches[k] ??= createStretch(k));
}

function createStretch(k: number): Stretch {
  /** lap time and lap distance at local t = 0 */
  const T0 = k * TIMING.cycle - TIMING.arrival;
  const S0 = lapDistance(T0);
  const joint = BUILT.joints[k]! - S0;
  const exit = lapDistance(T0 + TIMING.total) - S0;
  // the local frame: the joint at the origin, the camera there flying along -Z
  const at = frameAt(BUILT.joints[k]!, createFrame());
  const origin = at.position.clone();
  const turn = new Quaternion().setFromAxisAngle(Y_AXIS, -Math.atan2(-at.tangent.x, -at.tangent.z));
  const frame = (d: number, out: RailFrame = createFrame()) => {
    frameAt(S0 + d, out);
    out.position.sub(origin).applyQuaternion(turn);
    out.tangent.applyQuaternion(turn);
    out.up.applyQuaternion(turn);
    out.right.applyQuaternion(turn);
    out.quaternion.premultiply(turn);
    return out;
  };
  const distance = (t: number) => lapDistance(T0 + t) - S0;
  return {
    season: SEASONS[k]!,
    joint,
    exit,
    distance,
    timeAt: (d) => lapTime(S0 + d) - T0,
    speed: (t) => lapSpeed(T0 + t),
    frame,
    pose: (t, out) => frame(distance(t), out),
    free: (t) => ease(RAIL.release, RAIL.release + 2.5, t) * (1 - ease(TIMING.cycle - 2.5, TIMING.cycle, t)),
  };
}

// A stretch that came closer to itself than CLEARANCE would put one part of a scene's world inside
// another, so a design that does is refused here, at start-up, rather than found in a frame.
for (let k = 0; k < SEASONS.length; k++) {
  const stretch = season(k);
  const f = createFrame();
  const pts: Vector3[] = [];
  const STEP_D = 0.5;
  for (let d = 0; d <= stretch.exit; d += STEP_D) pts.push(stretch.frame(d, f).position.clone());
  // points less than 3 x CLEARANCE apart along the track are neighbours, not a crossing
  const skip = Math.ceil((3 * CLEARANCE) / STEP_D);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + skip; j < pts.length; j++)
      if (pts[i]!.distanceToSquared(pts[j]!) < CLEARANCE * CLEARANCE)
        throw new Error(`rail: ${SEASONS[k]}'s stretch comes within ${pts[i]!.distanceTo(pts[j]!).toFixed(1)} of itself`);
}

const lookM = { up: new Vector3(), q: new Quaternion(), x: new Vector3(), y: new Vector3(), z: new Vector3(), m: new Matrix4() };

/**
 * A scene's look offset: turns `pose.quaternion` towards `target` (a point in the scene's local
 * frame) by `weight`, keeping the rail's bank. Pass `stretch.free(t)` times whatever the scene
 * wants as the weight, so the offset is gone wherever two cameras share the track.
 */
export function lookTowards(pose: RailFrame, target: Vector3, weight: number): Quaternion {
  if (weight <= 0) return pose.quaternion;
  const m = lookM;
  // the banked up, and a camera basis that looks at the target with it
  m.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
  m.z.copy(pose.position).sub(target).normalize();
  m.x.crossVectors(m.up, m.z).normalize();
  m.y.crossVectors(m.z, m.x);
  m.q.setFromRotationMatrix(m.m.makeBasis(m.x, m.y, m.z));
  return pose.quaternion.slerp(m.q, Math.min(1, weight));
}
