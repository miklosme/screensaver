import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Path,
  Points,
  Quaternion,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Material,
} from "three";
import { TIMING, type SceneProps } from "./types";
import { createFrame, lookTowards, season, type Stretch } from "./rail";
import { createKoi, type Koi } from "./helix/koi";

/**
 * HELIX — the endless staircase, built round spring's stretch of the rail (rail.ts).
 *
 * Spring makes one full turn to the left, rising all the way, so the stair is that turn: a
 * carpeted sandstone flight winding round a great turning newel, inside a shaft whose wall is a
 * counter-wound arcade. The camera flies in from the void along a bridge (the approach every
 * season shares), climbs one turn, and leaves by a second bridge that bends away to a thin keyhole
 * stele standing in open air: the exit portal.
 *
 * The stair goes on above and below the turn the camera rides. The rail is level where it joins
 * and leaves the turn, so every turn of the stair has a landing on that side of the newel, and a
 * twin stair half a pitch higher makes it a double helix whose soffit is the camera's ceiling.
 *
 * The shaft holds a second great stair, the SISTER: the same double helix round its own newel, a
 * little way off to the right of the line the camera flies in on, so that the first frames (the
 * thumbnail the orbit's moon gate shows) hold a whole tower against the void. Level bridges, the
 * RUNGS, join the two towers every turn, and the lens is wide until the camera is on the stair.
 *
 * Everything is laid out in TOWER coordinates: the rail's local frame shifted so that the newel's
 * axis is x = z = 0 (y = 0 stays the eye's height at the joint). The stone shaders, the koi and
 * the motes all measure their angles from that axis.
 */

// ---------------------------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const TURNS_DOWN = 4; // turns of stair below the one the camera rides
const TURNS_UP = 4; // and above it
const DS = 0.1; // table resolution, in plan length
const NT = 38; // treads per turn
const TREAD_LEN = 1.63; // what the stone shader takes a tread's going to be: the turn's circumference / NT
const NOSE = 0.12; // how far a tread's nosing overhangs its riser
const THICK = 0.95;
const HALF_W = 2.6; // half width of the two bridges, and of the stair on the newel's side
const HALF_OUT = 2.2; // the stair's half width on the void's side: the lamp posts pass close
const LANDING_SPAN = 1.7; // radians over which the stair makes up the height its flat landing costs it
const NEWEL_BURY = 1.1; // on the turn the treads run this much further in, into the newel
const DOOR_FLARE = 0.9; // the landing widens by this much at the door
const COLUMN_R = 6.65;
const COLUMN_LOBES = 9;
const COLUMN_DEPTH = 0.4;
const COLUMN_TWIST = 0.544 / (COLUMN_R - 0.28); // radians per unit of height: the grooves lie about 29 degrees off the vertical
const COLUMN_BLOCKS = Math.round((TAU * COLUMN_R) / 1.05); // ashlar blocks round the newel
const COLUMN_Y0 = -80;
const COLUMN_Y1 = 100;
const WALL_R = 46;
const WALL_N = 32; // arcade modules per turn
const WALL_H = 13;
const WALL_PITCH = 13; // counter-wound: the stair climbs anticlockwise seen from above
const WALL_Y0 = -75;
const WALL_Y1 = 100;
const DECK_START = -9; // local distance at which the bridge in begins: behind the first frame
const END_GAP = 0.22; // the portal stands this far past the rail's exit, clear of the near plane
const EYE = 2.6;
const EYE_RISE = 2.55; // the last flight steps down, so the eye meets the keyhole's centre
const EYE_IN = 3.0; // and the bridge in starts this much lower, and climbs a first flight to the landing
const IN_FLIGHT = [4.5, 15.5]; // local distances between which it climbs
/**
 * Lamp standards that carry the bridge's left edge on across the open landing, as distances past
 * the joint: at the takeover they stand between the camera and the newel's wall.
 */
const LANDING_LAMPS = [1.3, 4.4, 7.4];
const LOOK_AHEAD = 5.5; // the camera looks at the rail this far on, into the turn
const LOOK_DROP = 0.85; // and this much below it, down onto the treads
const FOV = 72;
const FOV_IN = 80; // through the arrival: wide enough to hold the sister tower whole beside the stair the camera is on
const FOV_DOOR = 64;
/**
 * The sister tower's axis, in tower coordinates. Dead ahead at t = 0 (the camera looks 26 degrees
 * to the right of the joint's heading there) and as far off as the shaft allows; it is in the
 * right half of the frame at the takeover and behind the camera's shoulder on the way out.
 */
const SISTER_AT: [number, number] = [27, -19];
const SISTER_TURNS: [number, number] = [-3.2, 3.6]; // its stairs, in turns below and above the joint's level
const RUNG_W = 1.9; // half width of the bridges between the towers
/** which turns have one, counted from the one off the camera's ceiling; turn 1 would cross over the bridge out */
const RUNG_TURNS = [-3, -2, -1, 0, 2, 3];
const FOG_NEAR = 22;
const FOG_FAR = 150;

const DOOR_A = 2.45; // half width of the keyhole's shaft
const DOOR_CY = EYE + EYE_RISE; // centre of the keyhole's circle
const DOOR_R = 3.35;
const DOOR_FRAME = 0.8;

const IVORY: [number, number, number] = [0.95, 0.83, 0.64];
const SAND: [number, number, number] = [0.92, 0.72, 0.5];
const AMBER: [number, number, number] = [0.8, 0.47, 0.2];

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** like smooth, but its second derivative also vanishes at both ends */
const smoother = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * k * (k * (6 * k - 15) + 10);
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let k = Math.imul(s ^ (s >>> 15), 1 | s);
    k = (k + Math.imul(k ^ (k >>> 7), 61 | k)) ^ k;
    return ((k ^ (k >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// the layout: four flights of treads laid out from the rail
// ---------------------------------------------------------------------------------------------
/**
 * One flight: a centre line in plan (tables `DS` of plan length apart), the height of its floor,
 * and how far the treads reach to either side. Left is the newel's side, right the void's.
 */
interface Deck {
  n: number;
  /** plan length at which the flight ends */
  end: number;
  x: Float32Array;
  z: Float32Array;
  h: Float32Array;
  /** unit plan tangent */
  tx: Float32Array;
  tz: Float32Array;
  /** plan length of the first tread's riser; treads follow every `tread` from there */
  first: number;
  /** a count that runs on through the flights, so lamp posts keep their spacing */
  index0: number;
  wl(s: number): number;
  wr(s: number): number;
  /** where there is a balustrade on each side, and where the runner lies */
  railL(s: number): boolean;
  railR(s: number): boolean;
  runner(s: number): boolean;
  /** 1 where the left edge meets the newel (and is shaded by it), 0 on a bridge */
  newel(s: number): number;
  /** true for the flight that ends at the door: it gets the landing and its two lamps */
  door: boolean;
  /** plan lengths at which a lamp post ends the left balustrade */
  ends: number[];
  /** treads that carry a lamp post, if they are not simply every fourth */
  lamps?: number[];
  /** true for a flight the camera never comes within a few units of: its posts, globes and balusters are coarse */
  coarse?: boolean;
}

interface DeckPoint { x: number; z: number; h: number; tx: number; tz: number }
const _pt: DeckPoint = { x: 0, z: 0, h: 0, tx: 0, tz: -1 };

function deckAt(deck: Deck, s: number, out: DeckPoint = _pt): DeckPoint {
  const f = Math.min(deck.n - 1.001, Math.max(0, s / DS));
  const i = Math.floor(f);
  const u = f - i;
  out.x = deck.x[i]! + (deck.x[i + 1]! - deck.x[i]!) * u;
  out.z = deck.z[i]! + (deck.z[i + 1]! - deck.z[i]!) * u;
  out.h = deck.h[i]! + (deck.h[i + 1]! - deck.h[i]!) * u;
  out.tx = deck.tx[i]! + (deck.tx[i + 1]! - deck.tx[i]!) * u;
  out.tz = deck.tz[i]! + (deck.tz[i + 1]! - deck.tz[i]!) * u;
  const l = Math.hypot(out.tx, out.tz) || 1;
  out.tx /= l;
  out.tz /= l;
  return out;
}

interface Layout {
  stretch: Stretch;
  /** the newel's axis in the rail's local frame: tower = local - centre */
  centre: Vector3;
  /** plan radius of the stair's centre line, and what it rises in a turn */
  R: number;
  rise: number;
  /** plan length of a tread on the centre line */
  tread: number;
  /** the flight the camera rides (bridge, one turn, bridge), the stair below it, above it, and the twin */
  ride: Deck;
  lower: Deck;
  upper: Deck;
  twin: Deck;
  /** the sister tower's two stairs, the bridges to it, and how much higher its helix is than this one */
  sister: Deck[];
  rungs: Deck[];
  sisterY: number;
  /**
   * For the newel's shading: the angle of the first tread's riser, the top of each tread of a
   * turn above its landing, and how far the treads of the turn below the ride and of the turn
   * above it are from that (their landings are flat for longer).
   */
  phi0: number;
  treadTops: number[];
  lowOff: number[];
  highOff: number[];
  /** plan length along the ride at local distance d */
  rideS(d: number): number;
  /** where the lamp standards on the first landing stand */
  landingLamps: V3[];
  doorPos: Vector3;
  doorYaw: number;
}

/**
 * Angles are `phi`, measured about the newel from the side the camera arrives on and growing as
 * the stair climbs (anticlockwise seen from above): tower x = r cos(phi), z = -r sin(phi). The
 * turn the camera rides is phi = 0 .. TAU; the landings are at every multiple of TAU.
 */
function buildLayout(stretch: Stretch): Layout {
  const f = createFrame();
  // The axis: the centre of the circle spring's climb winds on. Spring's turn runs from 3 to 76
  // units past the joint (rail.ts), so 39.5 is its middle.
  stretch.frame(stretch.joint + 39.5, f);
  const R = Math.hypot(f.tangent.x, f.tangent.z) / f.curvature;
  const centre = new Vector3(f.position.x - f.right.x * R, 0, f.position.z - f.right.z * R);
  const rise = stretch.frame(stretch.exit, f).position.y - stretch.frame(stretch.joint, f).position.y;
  const R_OUT = R + HALF_OUT;
  const R_NEWEL = COLUMN_R + COLUMN_DEPTH + 0.15; // just clear of the newel's lobes
  const tread = (TAU * R) / NT;
  const dPhi = TAU / NT;

  // ---- the rail, densely: plan length, tower position, angle about the axis ----
  const D0 = DECK_START;
  const dd = 0.02;
  const m = Math.ceil((stretch.exit + END_GAP + 2 - D0) / dd) + 1;
  const qs = new Float64Array(m), qx = new Float64Array(m), qy = new Float64Array(m), qz = new Float64Array(m);
  const qtx = new Float64Array(m), qtz = new Float64Array(m), qphi = new Float64Array(m), qr = new Float64Array(m);
  /** the ride's left edge, as radius and angle */
  const qlr = new Float64Array(m), qlphi = new Float64Array(m);
  const unwrap = (raw: number, near: number) => near + Math.atan2(Math.sin(raw - near), Math.cos(raw - near));
  const dAt = (i: number) => D0 + i * dd;
  const leftOf = (d: number, r: number) =>
    HALF_W + NEWEL_BURY * smooth(R + 1.05, R + 0.2, r) + DOOR_FLARE * smooth(stretch.exit - 15, stretch.exit - 2, d);
  for (let i = 0; i < m; i++) {
    stretch.frame(dAt(i), f);
    const x = f.position.x - centre.x, z = f.position.z - centre.z;
    const tl = Math.hypot(f.tangent.x, f.tangent.z);
    qx[i] = x; qy[i] = f.position.y; qz[i] = z;
    qtx[i] = f.tangent.x / tl; qtz[i] = f.tangent.z / tl;
    qs[i] = i === 0 ? 0 : qs[i - 1]! + Math.hypot(x - qx[i - 1]!, z - qz[i - 1]!);
    qr[i] = Math.hypot(x, z);
    qphi[i] = unwrap(-Math.atan2(z, x), i === 0 ? -1.4 : qphi[i - 1]!);
    const w = leftOf(dAt(i), qr[i]!);
    const lx = x + qtz[i]! * w, lz = z - qtx[i]! * w;
    qlr[i] = Math.hypot(lx, lz);
    qlphi[i] = unwrap(-Math.atan2(lz, lx), qphi[i]!);
  }
  const iOf = (d: number) => Math.min(m - 1, Math.max(0, Math.round((d - D0) / dd)));
  const lerpQ = (q: Float64Array, fi: number) => {
    const i = Math.min(m - 2, Math.max(0, Math.floor(fi)));
    return q[i]! + (q[i + 1]! - q[i]!) * (fi - i);
  };
  /** fractional index at which the (rising) table q reaches v, searched between i0 and i1 */
  const find = (q: Float64Array, v: number, i0: number, i1: number) => {
    let lo = i0, hi = i1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (q[mid]! <= v) lo = mid;
      else hi = mid;
    }
    return lo + (v - q[lo]!) / Math.max(1e-9, q[hi]! - q[lo]!);
  };
  const iJoint = iOf(stretch.joint), iTop = iOf(stretch.exit - 10);

  // ---- the turn's height, as a function of angle: one period, repeated every `rise` ----
  const HN = 2048;
  const turnTable = new Float64Array(HN + 1);
  for (let k = 0; k <= HN; k++) turnTable[k] = lerpQ(qy, find(qphi, (k / HN) * TAU, iJoint, iTop)) - EYE;
  /** floor height of the stair at angle phi, on any turn */
  const turnH = (phi: number) => {
    const turns = Math.floor(phi / TAU);
    const u = ((phi - turns * TAU) / TAU) * HN;
    const k = Math.min(HN - 1, Math.floor(u));
    return turnTable[k]! + (turnTable[k + 1]! - turnTable[k]!) * (u - k) + turns * rise;
  };

  // ---- the ride: the rail itself, from behind the first frame to the door ----
  const sEnd = lerpQ(qs, (stretch.exit + END_GAP - D0) / dd);
  const n = Math.floor(qs[m - 1]! / DS);
  const ride: Deck = {
    n, end: sEnd,
    x: new Float32Array(n), z: new Float32Array(n), h: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n),
    first: 0, index0: 0, door: true, ends: [],
    wl: () => 0, wr: () => 0, railL: () => true, railR: () => true, runner: () => true, newel: () => 0,
  };
  const rideD = new Float32Array(n), rideR = new Float32Array(n), rideLR = new Float32Array(n);
  for (let k = 0, i = 0; k < n; k++) {
    const s = k * DS;
    while (i < m - 2 && qs[i + 1]! < s) i++;
    const fi = i + (s - qs[i]!) / Math.max(1e-9, qs[i + 1]! - qs[i]!);
    const d = D0 + fi * dd;
    ride.x[k] = lerpQ(qx, fi); ride.z[k] = lerpQ(qz, fi);
    ride.tx[k] = lerpQ(qtx, fi); ride.tz[k] = lerpQ(qtz, fi);
    // The rail is level through both approaches, and the floor is not: a first flight climbs to
    // the landing under the camera as it flies in, and the last one steps down to the door's.
    ride.h[k] =
      lerpQ(qy, fi) - EYE - EYE_IN * (1 - smoother(IN_FLIGHT[0]!, IN_FLIGHT[1]!, d)) - EYE_RISE * smoother(stretch.exit - 17, stretch.exit - 5.5, d);
    rideD[k] = d; rideR[k] = lerpQ(qr, fi); rideLR[k] = lerpQ(qlr, fi);
  }
  const tab = (q: Float32Array, s: number) => q[Math.min(n - 1, Math.max(0, Math.round(s / DS)))]!;
  const rideS = (d: number) => lerpQ(qs, (d - D0) / dd);
  // where the ride's left edge runs into the newel on the way in, comes back out of it on the way
  // out, and where it crosses the stair's outer edge at either end
  let iIn = iJoint, iOut = iTop, iCrossIn = iJoint, iCrossOut = iTop;
  while (iIn < m - 1 && qlr[iIn]! > R_NEWEL) iIn++;
  while (iOut < m - 1 && qlr[iOut]! < R_NEWEL) iOut++;
  while (iCrossIn > 0 && qlr[iCrossIn]! < R_OUT) iCrossIn--;
  while (iCrossOut < m - 1 && qlr[iCrossOut]! < R_OUT) iCrossOut++;
  const sCrossIn = qs[iCrossIn]!, sCrossOut = qs[iCrossOut]!;
  ride.wl = (s) => leftOf(tab(rideD, s), tab(rideR, s));
  // the void's side is narrower on the stair than on the bridges
  ride.wr = (s) =>
    HALF_W + (HALF_OUT - HALF_W) * smooth(R + 6, R + 1, tab(rideR, s)) + DOOR_FLARE * smooth(stretch.exit - 15, stretch.exit - 2, tab(rideD, s));
  // the left balustrade stops where the bridge reaches the stair: from there to the newel the landing is open
  ride.railL = (s) => s < sCrossIn - 0.2 || s > sCrossOut + 0.2;
  ride.ends = [sCrossIn, sCrossOut];
  ride.newel = (s) => smooth(R_NEWEL + 1.5, R_NEWEL, tab(rideLR, s));
  // treads are counted back from the door, as they always were
  ride.first = sEnd - Math.floor((sEnd - 0.5) / tread) * tread;
  // ... and the stair's own treads take their phase from the ride's, so the two agree on the turn
  const iMid = find(qs, ride.first + Math.round((rideS(stretch.joint + 39.5) - ride.first) / tread) * tread, iJoint, iTop);
  const phiMid = lerpQ(qphi, iMid);
  const phi0 = phiMid - Math.floor(phiMid / dPhi) * dPhi;

  // ---- the stair below and above, and the twin: true circles with the turn's height ----
  /** radius of the ride's left edge at angle phi, between two of its samples */
  const edgeR = (phi: number, i0: number, i1: number) => lerpQ(qlr, Math.min(i1, Math.max(i0, find(qlphi, phi, i0, i1))));
  const phiCrossIn = qlphi[iCrossIn]!, phiIn = qlphi[iIn]!, phiOut = qlphi[iOut]!, phiCrossOut = qlphi[iCrossOut]!;
  const circle = (jA: number, jB: number, height: (phi: number) => number, cx = 0, cz = 0): Deck => {
    const phiA = phi0 + jA * dPhi;
    const end = (jB - jA) * tread;
    const cn = Math.ceil(end / DS) + 2;
    const deck: Deck = {
      n: cn, end,
      x: new Float32Array(cn), z: new Float32Array(cn), h: new Float32Array(cn), tx: new Float32Array(cn), tz: new Float32Array(cn),
      first: 0, index0: jA, door: false, ends: [],
      wl: () => HALF_W + NEWEL_BURY, wr: () => HALF_OUT, railL: () => false, railR: () => true, runner: () => true, newel: () => 1,
    };
    for (let k = 0; k < cn; k++) {
      const phi = phiA + (k * DS) / R;
      deck.x[k] = cx + R * Math.cos(phi); deck.z[k] = cz - R * Math.sin(phi);
      deck.tx[k] = -Math.sin(phi); deck.tz[k] = -Math.cos(phi);
      deck.h[k] = height(phi);
    }
    return deck;
  };
  const jOf = (phi: number) => (phi - phi0) / dPhi;

  // Below: the stair comes up to the landing the bridge in arrives on. From where the bridge's
  // edge crosses its own the stair is level: an open floor of plain slabs between the bridge and
  // the newel, a hair lower and tucked under the bridge. It makes up the height before that.
  const floor0 = turnH(0), floor1 = turnH(TAU);
  const lowH = (phi: number) =>
    phi >= phiCrossIn
      ? floor0 - 0.04
      : turnH(phi) + (floor0 - 0.04 - turnH(phiCrossIn)) * smooth(phiCrossIn - LANDING_SPAN, phiCrossIn, phi);
  const jLowA = Math.round(jOf(-TURNS_DOWN * TAU)), jLowB = Math.floor(jOf(phiIn)) + 3; // on under the bridge, so no gap opens at the newel's foot
  const lower = circle(jLowA, jLowB, lowH);
  const lowPhi = (s: number) => phi0 + jLowA * dPhi + s / R;
  lower.wr = (s) => (lowPhi(s) < phiCrossIn ? HALF_OUT : Math.min(R_OUT, edgeR(lowPhi(s), iCrossIn, iIn) + 0.15) - R);
  lower.railR = (s) => lowPhi(s) < phiCrossIn - 0.02;
  lower.runner = lower.railR;

  // Above: the same, mirrored. The landing the bridge out leaves from is open to the newel, a
  // hair proud of the bridge, and the stair starts climbing where the bridge has left its edge.
  const highH = (phi: number) =>
    phi <= phiCrossOut
      ? floor1 + 0.03
      : turnH(phi) - (turnH(phiCrossOut) - floor1 - 0.03) * (1 - smooth(phiCrossOut, phiCrossOut + LANDING_SPAN, phi));
  const jUpA = Math.ceil(jOf(phiOut)) - 3, jUpB = Math.round(jOf((1 + TURNS_UP) * TAU));
  const upper = circle(jUpA, jUpB, highH);
  const upPhi = (s: number) => phi0 + jUpA * dPhi + s / R;
  upper.wr = (s) => (upPhi(s) > phiCrossOut ? HALF_OUT : Math.min(R_OUT, edgeR(upPhi(s), iOut, iCrossOut) + 0.06) - R);
  upper.railR = (s) => upPhi(s) > phiCrossOut + 0.02;
  upper.runner = upper.railR;

  // The twin: half a pitch higher, all the way up.
  const jTwinA = Math.round(jOf(-(TURNS_DOWN + 0.5) * TAU)), jTwinB = Math.round(jOf((1.5 + TURNS_UP) * TAU));
  const twin = circle(jTwinA, jTwinB, (phi) => turnH(phi) + rise / 2);

  // ---- the sister tower, and the rungs between the two ----
  // A rung leaves this tower's twin stair where it faces the sister (so the first one is a branch
  // of the camera's own ceiling) and lands on whichever of the sister's stairs is level with it:
  // the sister is the same helix, raised by `sisterY` so that one always is.
  const [sx, sz] = SISTER_AT;
  const sDist = Math.hypot(sx, sz);
  const phiS = -Math.atan2(sz, sx); // where this tower faces the sister
  const phiBack = phiS + Math.PI; // and the sister this one
  const rungH = (k: number) => turnH(phiS) + rise / 2 + k * rise;
  let sisterY = turnH(phiS) - turnH(phiBack);
  sisterY -= Math.round(sisterY / (rise / 2)) * (rise / 2);
  const gapHalf = Math.asin((RUNG_W + 0.25) / R_OUT);
  /** is the balustrade open for a rung at angle phi (from the facing direction `face`) and floor height h? */
  const rungGap = (phi: number, face: number, h: number) => {
    const turns = Math.round((phi - face) / TAU);
    if (Math.abs(phi - face - turns * TAU) > gapHalf) return false;
    const k = Math.round((h - rungH(0)) / rise);
    return RUNG_TURNS.includes(k) && Math.abs(h - rungH(k)) < 1.2;
  };
  const twinPhi = (s: number) => phi0 + jTwinA * dPhi + s / R;
  twin.railR = (s) => !rungGap(twinPhi(s), phiS, turnH(twinPhi(s)) + rise / 2);
  const jSisA = Math.round(jOf(SISTER_TURNS[0] * TAU)), jSisB = Math.round(jOf(SISTER_TURNS[1] * TAU));
  const sister = [0, rise / 2].map((lift) => {
    const height = (phi: number) => turnH(phi) + sisterY + lift;
    const deck = circle(jSisA, jSisB, height, sx, sz);
    const phiAt = (s: number) => phi0 + jSisA * dPhi + s / R;
    deck.railR = (s) => !rungGap(phiAt(s), phiBack, height(phiAt(s)));
    deck.coarse = true;
    return deck;
  });
  // a whole number of treads, their ends a little way into the two stairs
  const rungN = Math.ceil((sDist - 2 * R_OUT) / tread);
  const rungFrom = (sDist - rungN * tread) / 2;
  const rungs = RUNG_TURNS.map((k): Deck => {
    const cn = Math.ceil((rungN * tread) / DS) + 2;
    const deck: Deck = {
      n: cn, end: rungN * tread,
      x: new Float32Array(cn), z: new Float32Array(cn), h: new Float32Array(cn).fill(rungH(k)),
      tx: new Float32Array(cn).fill(sx / sDist), tz: new Float32Array(cn).fill(sz / sDist),
      first: 0, index0: 0, door: false, ends: [], lamps: [1, rungN - 2],
      wl: () => RUNG_W, wr: () => RUNG_W, railL: () => true, railR: () => true, runner: () => true, newel: () => 0,
      coarse: true,
    };
    for (let i = 0; i < cn; i++) {
      deck.x[i] = (sx / sDist) * (rungFrom + i * DS);
      deck.z[i] = (sz / sDist) * (rungFrom + i * DS);
    }
    return deck;
  });

  const treadTops: number[] = [], lowOff: number[] = [], highOff: number[] = [];
  for (let j = 0; j < NT; j++) {
    const a = phi0 + j * dPhi, b = a + dPhi;
    treadTops.push(turnH(b) + EYE);
    lowOff.push(Math.max(lowH(a - TAU), lowH(b - TAU)) - turnH(b - TAU));
    highOff.push(Math.max(highH(a + TAU), highH(b + TAU)) - turnH(b + TAU));
  }

  const landingLamps = LANDING_LAMPS.map((past): V3 => {
    const p = deckAt(ride, rideS(stretch.joint + past));
    const off = HALF_W - 0.22;
    return [p.x + p.tz * off, p.h, p.z - p.tx * off];
  });

  const end = deckAt(ride, sEnd);
  return {
    stretch, centre, R, rise, tread, ride, lower, upper, twin, sister, rungs, sisterY, phi0, treadTops, lowOff, highOff, rideS,
    landingLamps,
    doorPos: new Vector3(end.x, end.h, end.z),
    doorYaw: Math.atan2(-end.tx, -end.tz),
  };
}

// ---------------------------------------------------------------------------------------------
// tiny flat-shaded quad builder
// ---------------------------------------------------------------------------------------------
type V3 = [number, number, number];
class Quads {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  t: number[] = [];
  /**
   * quad a-b-c-d, wound so that it faces away from `inside`. `tile` gives each corner the pattern
   * coordinate the stair shader paints with: [distance from the stair's centre line, 0..1 across
   * the face, kind (1 tread, 2 riser)].
   */
  quad(a: V3, b: V3, c: V3, d: V3, inside: V3, col: V3, sa = 1, sb = 1, sc = 1, sd = 1, tile?: [V3, V3, V3, V3]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const mx = (a[0] + c[0]) / 2 - inside[0], my = (a[1] + c[1]) / 2 - inside[1], mz = (a[2] + c[2]) / 2 - inside[2];
    const flip = nx * mx + ny * my + nz * mz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const corner: [V3, number, V3][] = [
      [a, sa, tile?.[0] ?? NO_TILE],
      [b, sb, tile?.[1] ?? NO_TILE],
      [c, sc, tile?.[2] ?? NO_TILE],
      [d, sd, tile?.[3] ?? NO_TILE],
    ];
    for (const k of flip ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3]) {
      const [v, s, tl] = corner[k]!;
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col[0] * s, col[1] * s, col[2] * s);
      this.t.push(tl[0], tl[1], tl[2]);
    }
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.c), 3));
    if (this.t.some((v) => v !== 0)) g.setAttribute("aTile", new BufferAttribute(new Float32Array(this.t), 3));
    return g;
  }
}
const NO_TILE: V3 = [0, 0, 0];

function tint(g: BufferGeometry, fn: (x: number, y: number, z: number) => V3): BufferGeometry {
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/** marks each face of an extruded slab for the keyhole shader: 1 front, 2 back, 3 edge */
function faceKinds(g: BufferGeometry) {
  const nor = g.getAttribute("normal");
  const k = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const nz = nor.getZ(i);
    k[i * 3 + 2] = nz > 0.75 ? 1 : nz < -0.75 ? 2 : 3;
  }
  g.setAttribute("aTile", new BufferAttribute(k, 3));
}

/**
 * A solid of revolution from a profile of [radius, height, shade, brass] points, with smooth
 * normals along the profile. `shade` is baked occlusion; brass points are amber, the rest sandstone.
 */
type ProfilePt = [number, number, number, number];
function lathe(profile: ProfilePt[], seg: number): BufferGeometry {
  const n = profile.length;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) {
    const [r, y, sh, brass] = profile[j]!;
    const a = profile[Math.max(0, j - 1)]!, b = profile[Math.min(n - 1, j + 1)]!;
    // the profile's outward normal in the (r, y) plane
    let nr = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nr, ny) || 1;
    nr /= l; ny /= l;
    const base: V3 = brass ? AMBER : SAND;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(r * c, y, r * s);
      nor.push(nr * c, ny, nr * s);
      col.push(base[0] * sh, base[1] * sh, base[2] * sh);
      if (j < n - 1 && i < seg) {
        const p0 = j * (seg + 1) + i, p1 = p0 + seg + 1;
        idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  return g;
}
/** balusters, unit height (scaled to the rail): a brass vase turned on a slim stem */
const BALUSTER_PROFILE: ProfilePt[] = [
  [0.08, 0, 0.55, 1], [0.08, 0.035, 0.7, 1], [0.055, 0.06, 0.75, 1], [0.05, 0.1, 0.85, 1],
  [0.075, 0.2, 1, 1], [0.06, 0.3, 1, 1], [0.04, 0.38, 0.9, 1], [0.036, 0.8, 1, 1],
  [0.055, 0.86, 1, 1], [0.04, 0.92, 0.85, 1], [0.05, 1, 1, 1], [0, 1, 1, 1],
];
/** lamp posts, in metres: a sandstone shaft on a moulded plinth, banded in brass, with a cup for the globe */
const POST_H = 2.3;
const POST_PROFILE: ProfilePt[] = [
  [0.2, 0, 0.42, 0], [0.2, 0.12, 0.6, 0], [0.17, 0.14, 0.7, 0], [0.165, 0.18, 0.85, 0],
  [0.155, 0.22, 0.95, 0], [0.13, 0.26, 0.85, 0], [0.105, 0.3, 0.75, 0], [0.1, 0.36, 0.85, 0],
  [0.088, 0.95, 1, 0], [0.084, 0.98, 0.8, 0], [0.115, 1.0, 1, 1], [0.118, 1.04, 1.1, 1],
  [0.115, 1.08, 1, 1], [0.084, 1.1, 0.8, 0], [0.078, 1.86, 1, 0], [0.074, 1.9, 0.8, 0],
  [0.105, 1.92, 1, 1], [0.108, 1.96, 1.1, 1], [0.105, 2.0, 1, 1], [0.066, 2.03, 0.8, 1],
  [0.062, 2.12, 0.9, 1], [0.09, 2.17, 1, 1], [0.15, 2.25, 1.1, 1], [0.155, POST_H, 1.15, 1],
  [0.12, POST_H, 0.9, 1], [0, POST_H - 0.04, 0.8, 1],
];

/** the same two turnings in a few rings, for the sister tower: the camera never comes within six units of it */
const BALUSTER_COARSE: ProfilePt[] = [[0.08, 0, 0.6, 1], [0.05, 0.1, 0.85, 1], [0.075, 0.2, 1, 1], [0.038, 0.4, 0.95, 1], [0.045, 1, 1, 1]];
const POST_COARSE: ProfilePt[] = [
  [0.2, 0, 0.42, 0], [0.19, 0.13, 0.65, 0], [0.105, 0.3, 0.8, 0], [0.086, 1.0, 1, 0], [0.116, 1.04, 1.1, 1],
  [0.08, 1.1, 0.9, 0], [0.075, 1.9, 1, 0], [0.107, 1.96, 1.1, 1], [0.064, 2.08, 0.9, 1], [0.155, POST_H, 1.15, 1], [0, POST_H - 0.04, 0.8, 1],
];

// ---------------------------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------------------------
/** The void: deep teal below, amber haze pouring down the shaft from above. Fog fades into it. */
const SKY_GLSL = /* glsl */ `
  vec3 hxSky(vec3 d) {
    float y = d.y;
    vec3 col = mix(vec3(0.002, 0.016, 0.024), vec3(0.010, 0.080, 0.095), smoothstep(-0.95, 0.1, y));
    col += vec3(0.02, 0.10, 0.10) * pow(1.0 - abs(y), 6.0);
    float up = max(y, 0.0);
    col += vec3(1.0, 0.46, 0.12) * (0.55 * pow(up, 2.2) + 1.3 * pow(up, 9.0));
    return col;
  }
`;

type Detail = "plain" | "strata" | "wall" | "stair" | "column" | "post" | "globe" | "keyhole";
/** details that carve the surface: they write a height into `hxH` and the normal follows it */
const BUMPED: Detail[] = ["stair", "column", "post", "keyhole"];

const WALL_W = (TAU * WALL_R) / WALL_N; // width of one arcade module
const WALL_ARCH = WALL_W * 0.33; // radius of its arch
const WALL_SPRING = WALL_H - 1.7 - WALL_ARCH; // height the arch springs from
const WALL_C = WALL_PITCH / TAU; // rise of the arcade per radian
const glf = (x: number) => x.toFixed(4);

/** clock for the stone shaders' few moving parts; one Helix is mounted at a time */
const hxTime = { value: 0 };

/**
 * Where the stairs' treads meet the newel, so the newel can darken above and below each one:
 * the angle of the first riser, the top of each tread of one turn above the landing, the
 * landing's height and the rise of a turn. Filled in by getAssets, read when the column's program
 * is compiled on the first frame.
 */
const hxStairs = { phi0: 0, tops: [0] as number[], low: [0] as number[], high: [0] as number[], floor: 0, rise: 1 };
/**
 * Which tower a newel belongs to: where its axis is and how much higher its stairs are (xyz), with
 * w = 1 for a tower with no landings, and the heights its stairs run between.
 */
interface NewelFrame { axis: { value: Vector4 }; span: { value: Vector2 } }
const hxNewel: NewelFrame = { axis: { value: new Vector4() }, span: { value: new Vector2(-1, 1) } };
/** the two lamps that flank the door, in world space; filled in by getAssets, they light the arch */
const hxLamps = { value: [new Vector3(), new Vector3()] };

// The keyhole arch's carving, in the stele's own coordinates (x across, y up from the landing).
const KH_YJ = DOOR_CY - Math.sqrt(DOOR_R * DOOR_R - DOOR_A * DOOR_A); // where the jambs meet the circle
const KH_SPRING = Math.atan2(DOOR_A, KH_YJ - DOOR_CY); // the springer joint's angle from straight up
const KH_VOUSS = (2 * KH_SPRING) / 19; // nineteen voussoirs, the keystone in the middle
const KH_COURSE = KH_YJ / 4; // four courses up each jamb

function stairAoGlsl(): string {
  const { phi0, tops, low, high, floor, rise } = hxStairs;
  const n = tops.length;
  const list = (v: number[]) => `float[${n}](${v.map(glf).join(", ")})`;
  return /* glsl */ `
    const float HX_TOPS[${n}] = ${list(tops)};
    const float HX_LOW[${n}] = ${list(low)};
    const float HX_HIGH[${n}] = ${list(high)};
    /** occlusion from one tread whose top is a below (or -a above) this point */
    float hxSlabAO(float a) {
      float b = -a - ${glf(THICK)};
      return a > 0.0 ? mix(0.3, 1.0, smoothstep(0.0, 1.5, a)) : b > 0.0 ? mix(0.32, 1.0, smoothstep(0.0, 2.0, b)) : 0.3;
    }
    /** the two stairs wind round the newel half a pitch apart: shade over the one below and under the one above */
    float hxStairAO(vec3 w) {
      w -= uHxAxis.xyz;
      if (w.y < uHxSpan.x || w.y > uHxSpan.y) return 1.0;
      int j = int(min(mod(-atan(w.z, w.x) - ${glf(phi0)}, ${glf(TAU)}) * ${glf(n / TAU)}, ${glf(n - 1)}));
      float rel = w.y - HX_TOPS[j] - ${glf(floor)};
      float k = floor(rel / ${glf(rise / 2)});   // which stair is below: 0 is the turn the camera rides
      float a = rel - k * ${glf(rise / 2)};
      float b = a - ${glf(rise / 2)};
      // the turns below and above that one have their landings flat for longer
      if (uHxAxis.w < 0.5) {
        a -= k == -2.0 ? HX_LOW[j] : k == 2.0 ? HX_HIGH[j] : 0.0;
        b -= k == -3.0 ? HX_LOW[j] : k == 1.0 ? HX_HIGH[j] : 0.0;
      }
      return hxSlabAO(a) * hxSlabAO(b);
    }`;
}

/**
 * Carved detail, painted in the fragment shader so that the low-poly stone stays low-poly.
 * Both set `diffuseColor` and may add to `hxGlow`, which is light the fog still dims.
 */
const DETAIL_GLSL: Record<Detail, string> = {
  plain: "",
  strata: /* glsl */ `
    diffuseColor.rgb *= 0.93 + 0.07 * sin(vHxW.y * 2.6 + sin(vHxW.x * 0.7 + vHxW.z * 0.9) * 1.5);`,
  // The arcade: every module gets a striped ring of voussoirs with a keystone, imposts, quoined
  // jambs, running-bond masonry in the spandrels and a dentilled cornice set with glowing gems.
  // All of it is laid out in the module's own unbent coordinates (x across, y up).
  wall: /* glsl */ `
    {
      float phi = atan(vHxW.z, vHxW.x);
      float turn = phi * ${glf(WALL_N / TAU)};
      float y = mod(vHxW.y - ${glf(WALL_C)} * phi, ${glf(WALL_H)});
      float x = (fract(turn + 0.5) - 0.5) * ${glf(WALL_W)};
      float module = floor(turn + 0.5);
      float px = length(fwidth(vHxW)) * 0.8;          // size of a pixel on the stone
      float fade = 1.0 - smoothstep(0.03, 0.22, px);  // fine joints dissolve with distance
      float ax = abs(x);
      float up = max(y - ${glf(WALL_SPRING)}, 0.0);
      float dA = length(vec2(x, up));                 // distance from the arch's axis
      float ring = ${glf(WALL_ARCH + 1.05)};
      float joint = 0.0;
      vec3 m = vec3(0.93 + 0.07 * sin(vHxW.y * 2.6 + sin(vHxW.x * 0.7 + vHxW.z * 0.9) * 1.5));
      if (y > 11.72) {
        // cornice: bed mould, dentils, fascia
        float dent = step(0.5, fract(x * ${glf(30 / WALL_W)}));
        m *= y < 11.95 ? 0.8 : y < 12.38 ? mix(1.0, 0.7 + 0.42 * dent, fade) : 1.13;
        joint = hxLine(abs(y - 12.38), px) * 0.6;
        // a gem every sixth of a module; light runs round the arcade through them
        vec2 g = vec2((fract(x * ${glf(6 / WALL_W)}) - 0.5) * ${glf(WALL_W / 6)}, y - 12.7);
        float gem = 1.0 - smoothstep(1.0 - px * 6.0, 1.0 + px * 6.0, abs(g.x) / 0.21 + abs(g.y) / 0.15);
        float pulse = 0.5 + 0.5 * sin(turn * 0.9 + floor(vHxW.y / ${glf(WALL_H)} + 0.5) * 1.7 - uHxT * 1.1);
        m = mix(m, vec3(0.1, 0.45, 0.45), gem);
        hxGlow += vec3(0.05, 0.75, 0.62) * gem * (0.25 + 1.3 * pulse * pulse * pulse);
      } else if (y < 0.7) {
        m *= 0.8;
        joint = max(hxLine(abs(fract(x * ${glf(4 / WALL_W)}) - 0.5) * ${glf(WALL_W / 4)}, px), hxLine(abs(y - 0.7), px));
      } else if (dA < ring) {
        if (up > 0.0) {
          float seg = atan(up, x) * ${glf(13 / Math.PI)};
          float id = floor(seg);
          // alternating pale and terracotta voussoirs, a tall keystone in the middle
          m *= id == 6.0 ? vec3(1.2, 1.16, 1.05) : mod(id, 2.0) < 0.5 ? vec3(1.1, 1.08, 1.0) : vec3(0.95, 0.68, 0.55);
          joint = hxLine(min(fract(seg), 1.0 - fract(seg)) * dA * ${glf(Math.PI / 13)}, px);
        } else {
          float row = (y - 0.7) / 0.985;
          m *= mod(floor(row), 2.0) < 0.5 ? vec3(1.07, 1.05, 1.0) : vec3(0.97, 0.78, 0.68);
          joint = hxLine(min(fract(row), 1.0 - fract(row)) * 0.985, px);
        }
        joint = max(joint, hxLine(abs(dA - ${glf(WALL_ARCH + 0.16)}), px) * 0.7);
        // impost blocks where the arch springs
        float imp = step(abs(y - ${glf(WALL_SPRING)}), 0.24) * step(${glf(WALL_ARCH - 0.02)}, ax);
        m = mix(m, vec3(1.18, 1.12, 1.0), imp);
        joint *= 1.0 - imp;
      } else {
        float row = floor(y / 0.65);
        float bx = x * ${glf(6 / WALL_W)} + 0.5 * mod(row, 2.0);
        float fy = fract(y / 0.65);
        float fx = fract(bx);
        joint = max(hxLine(min(fy, 1.0 - fy) * 0.65, px), hxLine(min(fx, 1.0 - fx) * ${glf(WALL_W / 6)}, px));
        m *= 0.9 + 0.17 * hxHash(vec2(floor(bx) + module * 7.0, row + floor(vHxW.y / ${glf(WALL_H)}) * 3.0)) * fade;
        joint = max(joint, hxLine(abs(dA - ring), px));
      }
      diffuseColor.rgb *= m * (1.0 - 0.3 * joint * fade);
    }`,
  // The stair: worn sandstone slabs with a rounded nosing, a fluted riser panel and coffered
  // soffits, under a teal runner with a gold hem and a diamond on every tread, held down by brass
  // rods. vTile.z says which face: 1 tread (up to 1.3 where no riser follows it), 2 riser, 3 soffit,
  // 4 back, 5 end.
  stair: /* glsl */ `
    if (vTile.z > 0.5) {
      float kind = vTile.z;
      float lat = abs(vTile.x);
      float v = vTile.y;
      float px = fwidth(vTile.x) * 0.9 + 1e-4;
      float wpx = length(fwidth(vHxW)) * 0.8 + 1e-4;
      float fine = 1.0 - smoothstep(0.03, 0.15, wpx);
      float g = hxGrain(vHxW, wpx);
      float tread = step(kind, 1.5);
      float ao = 1.0;
      float shade = clamp(dot(diffuseColor.rgb, vec3(0.42)), 0.35, 1.25);
      vec3 stone = diffuseColor.rgb * hxTint(vHxW) * (1.0 + 0.1 * g);
      hxH += 0.0035 * g;
      if (kind < 1.5) {
        float vm = v * ${glf(TREAD_LEN + NOSE)};                 // metres back from the nose
        float nose = max(0.0, 1.0 - vm / 0.1);
        hxH -= 0.06 * nose * nose;                             // the bullnose rolls over
        stone *= 1.0 + 0.1 * hxBand(vm, 0.04, 0.12, wpx);       // worn bright lip
        ao *= mix(mix(0.55, 1.0, smoothstep(${glf(TREAD_LEN + NOSE)}, ${glf(TREAD_LEN - 0.2)}, vm)), 1.0, (kind - 1.0) / 0.3); // where the next riser rises
      } else if (kind < 2.5) {
        float vm = v * ${glf(THICK)};                          // metres down from the nose
        float nose = max(0.0, 1.0 - vm / 0.09);
        hxH -= 0.06 * nose * nose;
        float scotia = hxBand(vm, 0.1, 0.15, wpx);              // a shadowed groove under the nose
        hxH -= 0.02 * scotia;
        ao *= 1.0 - 0.4 * scotia;
        // a sunk panel of flutes on the stone either side of the runner
        float panel = hxBand(vm, 0.2, 0.44, wpx) * smoothstep(1.45, 1.5, lat);
        float flute = cos(lat * ${glf(TAU / 0.16)});
        hxH += panel * (0.006 * flute * fine - 0.012);
        stone *= 1.0 - panel * (0.1 - 0.06 * flute * fine);
        ao *= mix(0.45, 1.0, smoothstep(0.53, 0.3, vm));        // foot, against the tread below
      } else if (kind < 3.5) {
        float vm = v * 1.37;
        float cell = (fract(vTile.x / 1.05 + 0.5) - 0.5) * 1.05;
        vec2 q = abs(vec2(cell, vm - 0.74));
        float sd = max(q.x - 0.36, q.y - 0.42);                  // < 0 inside the coffer
        float rim = smoothstep(0.0, 0.07, -sd);
        hxH -= 0.06 * rim;
        stone *= mix(1.06, 0.8, rim);
        ao *= mix(1.0, 0.72, rim * (1.0 - smoothstep(0.07, 0.24, -sd)));
        float b = length(vec2(cell, vm - 0.74)) / 0.1;           // a rosette boss in each coffer
        hxH += 0.05 * sqrt(max(0.0, 1.0 - b * b));
        float petals = 0.85 + 0.15 * cos(atan(vm - 0.74, cell) * 8.0);
        stone = mix(stone, vec3(0.86, 0.52, 0.22) * petals, 1.0 - smoothstep(1.0 - wpx * 10.0, 1.0, b));
        ao *= mix(0.45, 1.0, smoothstep(0.1, 0.5, vm));          // corner with the slab below
      } else if (kind < 4.5) {
        float vm = v * ${glf(THICK)};
        ao *= mix(0.5, 1.0, smoothstep(0.52, 0.75, vm));         // corner with the soffit above
        float edge = max(0.0, (vm - 0.86) / 0.09);
        hxH -= 0.05 * edge * edge;
      } else {
        float vm = v * ${glf(THICK)};
        float top = max(0.0, 1.0 - vm / 0.09);
        float bot = max(0.0, (vm - 0.86) / 0.09);
        hxH -= 0.06 * (top * top + bot * bot);
        float bead = hxBand(vm, 0.15, 0.19, wpx);
        hxH -= 0.015 * bead;
        ao *= 1.0 - 0.35 * bead;
      }
      ao *= mix(0.45, 1.0, smoothstep(${glf(COLUMN_R)}, ${glf(COLUMN_R + 1.9)}, min(length(vHxW.xz), length(vHxW.xz - vec2(${glf(SISTER_AT[0])}, ${glf(SISTER_AT[1])})))));   // where it meets its newel
      if (kind < 2.5) {
        vec3 teal = vec3(0.03, 0.2, 0.34);
        vec3 gold = vec3(0.98, 0.66, 0.2);
        vec3 pile = teal * (0.92 + 0.16 * hxHash(floor(vec2(vTile.x * 34.0, v * 50.0))));
        // hem: two gold lines and a row of pearls between them
        pile = mix(pile, gold, hxBand(lat, 1.06, 1.2, px));
        pile = mix(pile, gold * 0.8, hxBand(lat, 0.86, 0.9, px));
        vec2 pearl = vec2(lat - 0.98, (fract(v * 4.0) - 0.5) * 0.34);
        pile = mix(pile, vec3(1.0, 0.9, 0.72), tread * (1.0 - smoothstep(0.04, 0.04 + px, length(pearl))));
        // the diamond, a smaller crimson one inside it
        float dm = lat / 0.52 + abs(v - 0.5) / 0.4;
        pile = mix(pile, gold, tread * (1.0 - smoothstep(1.0 - px * 2.5, 1.0 + px * 2.5, dm)));
        pile = mix(pile, vec3(0.62, 0.1, 0.12), tread * (1.0 - smoothstep(0.62 - px * 2.5, 0.62 + px * 2.5, dm)));
        pile = mix(pile, gold, tread * (1.0 - smoothstep(0.2 - px * 2.5, 0.2 + px * 2.5, dm)));
        // on the risers the runner is plain, with a brass rod pinning it at the foot
        float rod = (1.0 - tread) * hxBand(v, 0.43, 0.53, 0.01) * (1.0 - smoothstep(1.5, 1.5 + px, lat));
        float runner = 1.0 - smoothstep(1.28 - px, 1.28 + px, lat);
        stone = mix(stone, pile * shade * 1.5, runner);
        stone = mix(stone, vec3(1.25, 0.8, 0.28) * (0.7 + 0.6 * sin(v * 62.0)), rod);
      }
      diffuseColor.rgb = stone * ao;
    }`,
  // The newel: ashlar courses with pillowed, worn edges, and a carved band of beads running down
  // each of the barley-sugar grooves. Laid out in the column's own (turning) coordinates.
  column: /* glsl */ `
    {
      vec3 p = vHxL;
      float wpx = length(fwidth(vHxW)) * 0.8 + 1e-4;
      float fade = 1.0 - smoothstep(0.03, 0.2, wpx);
      float g = hxGrain(p, wpx);
      vec3 m = hxTint(p) * (1.0 + 0.1 * g);
      hxH += 0.0035 * g;
      float phi = atan(p.z, p.x);
      float ga = (fract((phi - p.y * ${glf(COLUMN_TWIST)}) * ${glf(COLUMN_LOBES / TAU)}) - 0.5) * ${glf(TAU)}; // 0 in a groove
      float dg = ga * ${glf((COLUMN_R - 0.28) / COLUMN_LOBES)};                      // metres across the groove
      if (abs(dg) < 0.21) {
        // sunk 4 cm, the same depth the ashlar's pillowed edges fall to, so the two meet cleanly
        float by = (fract(p.y / 0.3) - 0.5) * 0.3 * 1.13;
        float d = length(vec2(dg, by)) / 0.125;
        float bead = sqrt(max(0.0, 1.0 - d * d));
        hxH += 0.07 * bead - 0.04;
        m *= mix(0.62, 1.12, smoothstep(0.0, 0.5, bead));
        float fillet = hxBand(abs(dg), 0.165, 0.21, wpx);
        m *= 1.0 + 0.12 * fillet;
      } else {
        float row = floor(p.y / 0.52);
        float bx = phi * ${glf(COLUMN_BLOCKS / TAU)} + 0.5 * mod(row, 2.0);
        float fy = fract(p.y / 0.52), fx = fract(bx);
        float jd = min(min(fy, 1.0 - fy) * 0.52, min(fx, 1.0 - fx) * 1.05);   // metres to a joint
        jd = min(jd, abs(dg) - 0.21);                        // the band's edge is a joint too
        float pillow = max(0.0, 1.0 - jd / 0.08);
        hxH -= 0.04 * pillow * pillow;
        float jw = max(0.012, wpx * 0.7);
        float joint = 1.0 - smoothstep(jw * 0.5, jw + wpx, jd);
        m *= (0.88 + 0.18 * hxHash(vec2(floor(bx), row))) * (1.0 - 0.45 * joint * fade) * (1.0 - 0.12 * pillow * fade);
      }
      diffuseColor.rgb *= m * hxStairAO(vHxW);
    }`,
  // The keyhole arch: a thin carved slab. Radial voussoirs with a raised keystone round the
  // keyhole, coursed jambs below the springer joints, a bead moulding round the opening, and a
  // band of turquoise inlay set with studs that match the arcade's gems. Laid out from a distance
  // field of the opening in the stele's own coordinates. vTile.z: 1 face, 2 back, 3 edge or reveal.
  keyhole: /* glsl */ `
    {
      vec3 p = vHxL;
      float kind = vTile.z;
      float wpx = length(fwidth(vHxW)) * 0.8 + 1e-4;
      float fine = 1.0 - smoothstep(0.03, 0.15, wpx);
      float g = hxGrain(p + vec3(11.0, 0.0, 5.0), wpx);
      vec3 m = hxTint(p) * (1.0 + 0.16 * g);
      hxH += 0.004 * g;
      // distance from the opening: a circle on a shaft
      vec2 c = p.xy - vec2(0.0, ${glf(DOOR_CY)});
      vec2 bq = vec2(abs(p.x) - ${glf(DOOR_A)}, c.y);
      float dIn = min(length(c) - ${glf(DOOR_R)}, length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0));
      float w = max(dIn, 0.0);                          // metres out from the opening's edge
      float ang = atan(c.x, c.y);                       // 0 straight up, +-${glf(KH_SPRING)} at the springers
      float rad = length(c);
      // the springer joint, a radial line through the jamb's top corner
      float spring = abs(abs(c.x) * ${glf(Math.cos(KH_SPRING))} - c.y * ${glf(Math.sin(KH_SPRING))});
      bool arch = abs(ang) < ${glf(KH_SPRING)};
      float jd, along, id;
      if (arch) {
        float seg = ang / ${glf(KH_VOUSS)} + 0.5;
        id = floor(seg);
        float f = fract(seg);
        jd = min(f, 1.0 - f) * ${glf(KH_VOUSS)} * rad;
        along = (f - 0.5) * ${glf(KH_VOUSS)} * rad;
      } else {
        float cr = p.y / ${glf(KH_COURSE)};
        id = 20.0 + floor(cr) * 2.0 + step(0.0, p.x);
        float f = fract(cr);
        jd = min(f, 1.0 - f) * ${glf(KH_COURSE)};
        along = (f - 0.5) * ${glf(KH_COURSE)};
        // every other course is two stones, so the jamb is bonded like the arcade's quoins
        if (mod(floor(cr), 2.0) > 0.5) jd = min(jd, abs(w - 0.46));
      }
      jd = min(jd, spring);
      bool key = arch && id == 0.0;
      // each stone its own bed: alternating ivory and honey voussoirs, a pale keystone
      float sh = hxHash(vec2(id, 3.0));
      m *= key ? vec3(1.12, 1.08, 1.0) : mod(id, 2.0) < 0.5 ? vec3(1.04, 1.0, 0.94) : vec3(0.93, 0.76, 0.6);
      m *= 0.9 + 0.16 * sh;
      // joints: pillowed edges and a fine dark line, which fade once a pixel covers them
      float pillow = max(0.0, 1.0 - jd / 0.07);
      hxH -= 0.03 * pillow * pillow;
      float jw = max(0.014, wpx * 0.6);
      float joint = 1.0 - smoothstep(jw * 0.5, jw + wpx, jd);
      m *= (1.0 - mix(0.6, 0.3, smoothstep(0.01, 0.05, wpx)) * joint) * (1.0 - 0.2 * pillow * pillow);
      float ao = mix(0.42, 1.0, smoothstep(0.0, 1.1, p.y));   // where the jambs meet the landing
      if (kind < 1.5) {
        // worn arrises at the opening and the outer edge
        float inner = max(0.0, 1.0 - w / 0.05);
        float outer = max(0.0, (w - 0.72) / 0.08);
        hxH -= 0.035 * (inner * inner + outer * outer);
        m *= 1.0 + 0.08 * hxBand(w, 0.0, 0.03, wpx);
        if (key) {
          // the keystone stands proud of the face and runs over the bead
          hxH += 0.03 * smoothstep(0.02, 0.05, w);
        } else {
          // a round bead between two quirks, carved in every stone round the opening
          float b = (w - 0.13) / 0.055;
          float bead = sqrt(max(0.0, 1.0 - b * b));
          hxH += 0.04 * bead;
          float quirk = hxBand(w, 0.055, 0.075, wpx) + hxBand(w, 0.185, 0.205, wpx);
          hxH -= 0.012 * quirk;
          ao *= 1.0 - 0.55 * quirk;
          m *= mix(0.78, 1.1, bead);
        }
        // the inlay: a sunk turquoise band, studded at the middle of every stone
        float band = hxBand(w, 0.625, 0.695, wpx);
        float stud = (abs(along) / (key ? 0.15 : 0.11) + abs(w - 0.66) / (key ? 0.1 : 0.075));
        float st = 1.0 - smoothstep(1.0 - wpx * 12.0, 1.0 + wpx * 12.0, stud);
        float inlay = max(band, st);
        hxH -= 0.006 * band * (1.0 - st);
        float rim = hxBand(stud, 1.0, 1.25, wpx * 10.0) * (1.0 - band);
        m *= 1.0 - 0.25 * rim;
        float pulse = 0.5 + 0.5 * sin(id * 0.7 - uHxT * 1.3);
        m = mix(m, vec3(0.1, 0.45, 0.45) * (0.9 + 0.2 * g), inlay);
        hxGlow += vec3(0.05, 0.75, 0.62) * (band * (1.0 - st) * 0.12 + st * (0.3 + 0.9 * pulse * pulse));
      } else if (kind > 2.5 && dIn < 0.2) {
        // the inner reveal, shaded deeper toward the feet
        ao *= 0.72;
      }
      diffuseColor.rgb *= m * ao;
    }`,
  // turned lamp posts and balusters: grain only, their banding is in the geometry
  post: /* glsl */ `
    {
      float wpx = length(fwidth(vHxW)) * 0.8 + 1e-4;
      float g = hxGrain(vHxW, wpx);
      diffuseColor.rgb *= hxTint(vHxW) * (1.0 + 0.05 * g);
      hxH += 0.0008 * g;
    }`,
  // the lamp globes: a hot core that falls off to a warm amber limb, so they read as spheres
  globe: /* glsl */ `
    {
      float ndv = abs(dot(normalize(vHxN), normalize(cameraPosition - vHxW)));
      diffuseColor.rgb *= mix(vec3(0.72, 0.5, 0.42), vec3(1.25, 1.12, 1.02), pow(ndv, 0.8));
      diffuseColor.rgb += vec3(0.5, 0.35, 0.18) * pow(ndv, 6.0);
    }`,
};

/** the door lamps' warm wash on the arch, after the carved normal is known; fog still dims it */
const KEYHOLE_LAMPS_GLSL = /* glsl */ `
          {
            vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            for (int i = 0; i < 2; i++) {
              vec3 l = uHxLamp[i] - vHxW;
              float d2 = dot(l, l);
              float nl = max(dot(nw, l * inversesqrt(d2)), 0.0);
              hxGlow += diffuseColor.rgb * vec3(1.0, 0.55, 0.22) * 2.6 * nl / (1.0 + 0.8 * d2 * d2 * 0.25);
            }
          }`;

function withVoidFog<T extends Material>(mat: T, detail: Detail = "plain", newel: NewelFrame = hxNewel): T {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uHxT = hxTime;
    s.uniforms.uHxLamp = hxLamps;
    s.uniforms.uHxAxis = newel.axis;
    s.uniforms.uHxSpan = newel.span;
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHxW;\nvarying vec3 vHxL;\nvarying vec3 vHxN;\nattribute vec3 aTile;\nvarying vec3 vTile;",
      )
      .replace(
        "#include <fog_vertex>",
        /* glsl */ `#include <fog_vertex>
        vec4 hxp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          hxp = instanceMatrix * hxp;
        #endif
        vHxW = (modelMatrix * hxp).xyz;
        vHxL = transformed;
        vec3 hxn = normal;
        #ifdef USE_INSTANCING
          hxn = mat3(instanceMatrix) * hxn;
        #endif
        vHxN = mat3(modelMatrix) * hxn;
        vTile = aTile;`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec3 vHxW;
        varying vec3 vHxL;
        varying vec3 vHxN;
        varying vec3 vTile;
        uniform float uHxT;
        uniform vec3 uHxLamp[2];
        uniform vec4 uHxAxis;
        uniform vec2 uHxSpan;
        vec3 hxGlow = vec3(0.0);
        float hxH = 0.0; // carved height (metres) the bumped details write; the normal follows it
        float hxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        /** integer lattice hash: exact, so the two sides of a cell wall always agree */
        float hxH3(ivec3 c) {
          uvec3 u = uvec3(c);
          uint h = (u.x * 1597334677u) ^ (u.y * 3812015801u) ^ (u.z * 2798796415u);
          h ^= h >> 15;
          h *= 2246822519u;
          h ^= h >> 13;
          return float(h) * 2.3283064e-10;
        }
        float hxN3(vec3 p) {
          vec3 fl = floor(p);
          ivec3 i = ivec3(fl);
          vec3 f = p - fl;
          f = f * f * (3.0 - 2.0 * f);
          const ivec2 o = ivec2(1, 0);
          return mix(
            mix(mix(hxH3(i), hxH3(i + o.xyy), f.x), mix(hxH3(i + o.yxy), hxH3(i + o.xxy), f.x), f.y),
            mix(mix(hxH3(i + o.yyx), hxH3(i + o.xyx), f.x), mix(hxH3(i + o.yxx), hxH3(i + o.xxx), f.x), f.y),
            f.z);
        }
        /** the grain's base octave, kept for hxTint so the bedding costs no second noise */
        float hxBed = 0.5;
        /** sandstone grain, about -1..1; the finer octaves dissolve once a pixel covers them */
        float hxGrain(vec3 p, float px) {
          hxBed = hxN3(p * 0.6 + 7.0);
          float g = (hxBed - 0.5) * 0.6;
          if (px < 0.12) g += (hxN3(p * 7.0) - 0.5) * (1.0 - smoothstep(0.03, 0.12, px));
          if (px < 0.04) g += (hxN3(p * 31.0) - 0.5) * 0.6 * (1.0 - smoothstep(0.01, 0.04, px));
          return g * 1.6;
        }
        /** slow drift between paler and ruddier beds of stone (call hxGrain first) */
        vec3 hxTint(vec3 p) {
          return mix(vec3(1.05, 1.0, 0.94), vec3(0.97, 0.88, 0.8), hxBed);
        }
        ${detail === "column" ? stairAoGlsl() : ""}
        /** 1 on a line of half width 0.035 at distance d from it, antialiased over px */
        float hxLine(float d, float px) { return 1.0 - smoothstep(0.035, 0.035 + px, d); }
        float hxBand(float x, float a, float b, float px) { return smoothstep(a - px, a + px, x) * (1.0 - smoothstep(b - px, b + px, x)); }
        ${SKY_GLSL}`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + DETAIL_GLSL[detail])
      .replace(
        "#include <normal_fragment_maps>",
        BUMPED.includes(detail)
          ? /* glsl */ `#include <normal_fragment_maps>
          {
            // Mikkelsen's bump mapping from screen derivatives, in true units (sigmas unnormalised)
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            vec3 grad = sign(det) * (dFdx(hxH) * r1 + dFdy(hxH) * r2);
            normal = normalize(abs(det) * normal - grad);
          }` + (detail === "keyhole" ? KEYHOLE_LAMPS_GLSL : "")
          : "#include <normal_fragment_maps>",
      )
      .replace(
        "#include <tonemapping_fragment>",
        /* glsl */ `
        gl_FragColor.rgb += hxGlow;
        #ifdef USE_FOG
          float hxf = smoothstep(fogNear, fogFar, vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hxSky(normalize(vHxW - cameraPosition)), hxf * 0.97);
        #endif
        #include <tonemapping_fragment>`,
      )
      .replace("#include <fog_fragment>", "");
  };
  mat.customProgramCacheKey = () => "helix-void-" + detail;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// shared, cached assets (geometry + materials survive remounts; only light meshes are rebuilt)
// ---------------------------------------------------------------------------------------------
interface Satellite { pos: Vector3; tilt: Quaternion; scale: number; spin: number; phase: number }

interface Assets {
  index: number;
  layout: Layout;
  stairs: BufferGeometry;
  rails: BufferGeometry;
  column: BufferGeometry;
  sisterColumn: BufferGeometry;
  sisterColumnMat: MeshLambertMaterial;
  wall: BufferGeometry;
  satellite: BufferGeometry;
  baluster: BufferGeometry;
  lantern: BufferGeometry;
  sky: BufferGeometry;
  points: BufferGeometry;
  doorFrame: BufferGeometry;
  doorBack: BufferGeometry;
  doorPortal: BufferGeometry;
  stone: MeshLambertMaterial;
  keyholeMat: MeshLambertMaterial;
  columnMat: MeshLambertMaterial;
  /** writes depth and no colour, a hair behind the surface, so the pass that shades it still passes */
  depthOnly: MeshBasicMaterial;
  postMat: MeshLambertMaterial;
  post: BufferGeometry;
  postM: Float32Array;
  wallMat: MeshLambertMaterial;
  stairMat: MeshLambertMaterial;
  koi: Koi;
  glow: MeshBasicMaterial;
  veilMat: MeshBasicMaterial;
  skyMat: ShaderMaterial;
  pointsMat: ShaderMaterial;
  balusterM: Float32Array;
  lanternM: Float32Array;
  /** the coarse copies of the three, on flights seen only from afar */
  coarseBaluster: BufferGeometry;
  coarsePost: BufferGeometry;
  coarseLantern: BufferGeometry;
  coarseBalusterM: Float32Array;
  coarsePostM: Float32Array;
  coarseLanternM: Float32Array;
  wallM: Float32Array;
  satellites: Satellite[];
}

let cache: Assets | null = null;

function keyholeOutline(target: Path, grow: number, base: number) {
  const a = DOOR_A + grow;
  const r = DOOR_R + grow;
  const yj = DOOR_CY - Math.sqrt(r * r - a * a);
  const a0 = Math.atan2(yj - DOOR_CY, a);
  target.moveTo(-a, base);
  target.lineTo(a, base);
  target.lineTo(a, yj);
  target.absarc(0, DOOR_CY, r, a0, Math.PI - a0, false);
  target.lineTo(-a, base);
}

function getAssets(index: number): Assets {
  if (cache && cache.index === index) return cache;
  const layout = buildLayout(season(index));
  const TREAD = layout.tread;
  const rand = rng(1987);
  const dummy = new Object3D();
  const P: DeckPoint = { x: 0, z: 0, h: 0, tx: 0, tz: -1 };

  const sq = new Quads();
  // [fine, coarse] matrices of each turned piece
  const balusters: number[][] = [[], []];
  const posts: number[][] = [[], []];
  const lanterns: number[][] = [[], []];
  const lanternPos: number[] = [];
  const rp: number[] = [], rn: number[] = [], rc: number[] = [], ri: number[] = [];
  const RING = 6;
  const LAMP_EVERY = 4;

  const pushBaluster = (v: V3, height: number, coarse = false) => {
    dummy.position.set(v[0], v[1], v[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    balusters[+coarse]!.push(...dummy.matrix.elements);
  };
  /** a turned lamp post, POST_H tall, standing at v */
  const pushPost = (v: V3, size = 1, coarse = false) => {
    dummy.position.set(v[0], v[1], v[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(size, 1, size);
    dummy.updateMatrix();
    posts[+coarse]!.push(...dummy.matrix.elements);
  };
  const pushLantern = (x: number, y: number, z: number, size: number, coarse = false) => {
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    lanterns[+coarse]!.push(...dummy.matrix.elements);
    lanternPos.push(x, y, z);
  };

  /** `lampPhase` staggers one flight's lamp posts against another's */
  const addDeck = (deck: Deck, lampPhase: number) => {
    const END = deck.end;
    /** a point on the flight's edge: side +1 is the right (the void's), -1 the left (the newel's) */
    const edge = (s: number, side: number, y: number, inset = 0): V3 => {
      deckAt(deck, s, P);
      const w = side > 0 ? deck.wr(s) - inset : -(deck.wl(s) - inset);
      return [P.x - P.tz * w, y, P.z + P.tx * w];
    };
    const heightAt = (s: number) => deckAt(deck, s, P).h;

    // ---- stairs: one slab per tread ----
    const nSteps = Math.floor((END - deck.first) / TREAD + 1e-6);
    for (let i = 0; i <= nSteps; i++) {
      const landing = i === nSteps;
      if (landing && !deck.door) break;
      const s0 = landing ? END : deck.first + i * TREAD;
      const s1 = landing ? END + 1.1 : s0 + TREAD;
      const sm = (s0 + s1) / 2;
      // a tread is as high as its upper end, whichever way the flight runs
      const hA = heightAt(s0), hB = heightAt(Math.min(s1, END));
      const top = Math.max(hA, hB);
      const bot = top - THICK;
      // only a tread that rises has a nosing; on a landing it would lie in the slab before it
      const nose = landing || hB - hA < 0.04 ? 0 : NOSE;
      const i0 = edge(s0 - nose, -1, top), o0 = edge(s0 - nose, 1, top);
      const i1 = edge(s1, -1, top), o1 = edge(s1, 1, top);
      const lo = (v: V3): V3 => [v[0], bot, v[2]];
      const ctr: V3 = [(i0[0] + o1[0]) / 2, top - THICK / 2, (i0[2] + o1[2]) / 2];
      const warm = 0.9 + 0.1 * rand();
      const tone: V3 = [IVORY[0] * warm, IVORY[1] * warm, IVORY[2] * warm];
      // pattern coordinate across the tread; without a runner it is moved out onto bare stone
      const shift = deck.runner(sm) ? 0 : -9;
      const wi0 = -deck.wl(s0 - nose) + shift, wo0 = deck.wr(s0 - nose) + shift, wi1 = -deck.wl(s1) + shift, wo1 = deck.wr(s1) + shift;
      // the newel's side is in its shade; on a bridge both sides are lit alike
      const k = deck.newel(sm);
      const dim = (inner: number, outer: number) => outer + (inner - outer) * k;
      // a tread the next one does not rise from has no shaded corner at its back
      const kt = 1 + 0.3 * (1 - smooth(0.03, 0.2, Math.max(hB, heightAt(Math.min(s1 + TREAD, END))) - top));
      sq.quad(i0, o0, o1, i1, ctr, tone, dim(0.5, 1), 1, 1, dim(0.5, 1), [[wi0, 0, kt], [wo0, 0, kt], [wo1, 1, kt], [wi1, 1, kt]]); // tread
      // going down, what shows of this face is under the tread before: bare stone, not the runner
      const kr = hB < hA - 0.02 ? 4 : 2;
      sq.quad(i0, o0, lo(o0), lo(i0), ctr, SAND, dim(0.7, 1.1), 1.1, 0.95, dim(0.6, 0.95), [[wi0, 0, kr], [wo0, 0, kr], [wo0, 1, kr], [wi0, 1, kr]]); // riser
      sq.quad(i1, o1, lo(o1), lo(i1), ctr, SAND, dim(0.6, 1.1), 1.1, 0.8, dim(0.45, 0.8), [[wi1, 0, 4], [wo1, 0, 4], [wo1, 1, 4], [wi1, 1, 4]]); // back
      sq.quad(o0, o1, lo(o1), lo(o0), ctr, SAND, 1, 1, 0.8, 0.8, [[0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5]]); // outer end
      sq.quad(i0, i1, lo(i1), lo(i0), ctr, SAND, dim(0.6, 1), dim(0.6, 1), dim(0.5, 0.8), dim(0.5, 0.8), [[0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5]]); // inner end
      sq.quad(lo(i0), lo(o0), lo(o1), lo(i1), ctr, tone, dim(0.7, 1.15), 1.15, 1.05, dim(0.6, 1.05), [[wi0, 0, 3], [wo0, 0, 3], [wo1, 1, 3], [wi1, 1, 3]]); // soffit
      if (landing) continue;
      const lamp = deck.lamps
        ? deck.lamps.includes(i)
        : (((deck.index0 + i - lampPhase) % LAMP_EVERY) + LAMP_EVERY) % LAMP_EVERY === 0 && (!deck.door || sm < END - 6);
      const coarse = deck.coarse ?? false;
      for (const side of [1, -1]) {
        const has = side > 0 ? deck.railR : deck.railL;
        if (!has(sm)) continue;
        // no lamp right beside the post a balustrade ends at
        if (lamp && has(sm - 2 * TREAD) && has(sm + 2 * TREAD)) {
          pushPost(edge(sm, side, top, 0.22), 1, coarse);
          const e = edge(sm, side, top + 2.5, 0.22);
          pushLantern(e[0], e[1], e[2], 1, coarse);
        } else pushBaluster(edge(sm, side, top, 0.22), 1.45 + (heightAt(sm) - top), coarse);
      }
    }
    for (const s of deck.ends) {
      const h = heightAt(s);
      pushPost(edge(s, -1, h, 0.22));
      const e = edge(s, -1, h + 2.5, 0.22);
      pushLantern(e[0], e[1], e[2], 1);
    }
    // two lanterns flank the door
    if (deck.door) {
      for (const side of [-1, 1]) {
        const e = edge(END - 1.6, side, heightAt(END) + 2.5, 0.22);
        pushPost([e[0], heightAt(END), e[2]], 1.1);
        pushLantern(e[0], e[1], e[2], 1.15);
        hxLamps.value[side < 0 ? 0 : 1]!.set(e[0], e[1], e[2]);
      }
    }

    // ---- hand rails: swept tubes ----
    const sweep = (from: number, to: number, side: number) => {
      const base = rp.length / 3;
      const steps = Math.ceil((to - from) / 0.6);
      for (let k = 0; k <= steps; k++) {
        const s = from + ((to - from) * k) / steps;
        const c = edge(s, side, heightAt(s) + 1.45, 0.22);
        deckAt(deck, s, P);
        for (let q = 0; q < RING; q++) {
          const a = (q / RING) * TAU;
          const cx = Math.cos(a), cy = Math.sin(a);
          rp.push(c[0] - P.tz * cx * 0.11, c[1] + cy * 0.11, c[2] + P.tx * cx * 0.11);
          rn.push(-P.tz * cx, cy, P.tx * cx);
          rc.push(AMBER[0], AMBER[1], AMBER[2]);
        }
        if (k < steps) {
          for (let q = 0; q < RING; q++) {
            const a0 = base + k * RING + q, a1 = base + k * RING + ((q + 1) % RING);
            ri.push(a0, a0 + RING, a1, a1, a0 + RING, a1 + RING);
          }
        }
      }
    };
    // one rail over every unbroken run of balusters; it stops short of the door, and where a run
    // ends against the newel or another flight it carries on a little, into the stone
    for (const side of [1, -1]) {
      const has = (i: number) => i >= 0 && i < nSteps && (side > 0 ? deck.railR : deck.railL)(deck.first + (i + 0.5) * TREAD);
      for (let i = 0; i < nSteps; i++) {
        if (!has(i)) continue;
        let j = i;
        while (has(j + 1)) j++;
        const ext = deck.door ? 0.9 : 0;
        const from = deck.first + i * TREAD - (i > 0 ? ext : 0);
        const to = j === nSteps - 1 ? (deck.door ? END - 0.9 : END) : deck.first + (j + 1) * TREAD + ext;
        sweep(from, to, side);
        i = j;
      }
    }
  };
  // A lamp passes close on the right about every 1.2 s of the climb. The posts are set so that
  // one is just ahead of the camera, large in the frame, at t = 8.5 (and so at 12 and 15.5: the
  // camera covers twelve treads between them).
  const { ride } = layout;
  const lampAt = layout.rideS(layout.stretch.distance(8.5) + 2.9);
  const ridePhase = Math.round((lampAt - ride.first) / TREAD - 0.5) % LAMP_EVERY;
  addDeck(ride, ridePhase);
  for (const v of layout.landingLamps) {
    pushPost(v);
    pushLantern(v[0], v[1] + 2.5, v[2], 1);
  }
  addDeck(layout.lower, 1);
  addDeck(layout.upper, 1);
  addDeck(layout.twin, 3);
  layout.sister.forEach((deck, i) => addDeck(deck, 1 + 2 * i));
  for (const rung of layout.rungs) addDeck(rung, 0);
  hxStairs.phi0 = layout.phi0;
  hxStairs.tops = layout.treadTops;
  hxStairs.low = layout.lowOff;
  hxStairs.high = layout.highOff;
  hxStairs.floor = -EYE;
  hxStairs.rise = layout.rise;
  hxNewel.span.value.set(deckAt(layout.twin, 0).h - 3, deckAt(layout.twin, layout.twin.end).h + 3);
  const sisterNewel: NewelFrame = {
    axis: { value: new Vector4(SISTER_AT[0], layout.sisterY, SISTER_AT[1], 1) },
    span: { value: new Vector2(deckAt(layout.sister[0]!, 0).h - layout.sisterY - 3, deckAt(layout.sister[1]!, layout.sister[1]!.end).h - layout.sisterY + 3) },
  };
  const stairs = sq.build();
  const rails = new BufferGeometry();
  rails.setAttribute("position", new BufferAttribute(new Float32Array(rp), 3));
  rails.setAttribute("normal", new BufferAttribute(new Float32Array(rn), 3));
  rails.setAttribute("color", new BufferAttribute(new Float32Array(rc), 3));
  rails.setIndex(ri);

  // ---- central column: a solomonic (barley-sugar) shaft, wound against the stair ----
  const colY0 = COLUMN_Y0, colY1 = COLUMN_Y1;
  const LOBES = COLUMN_LOBES, TWIST = -COLUMN_TWIST, DEPTH = COLUMN_DEPTH;
  /** `around` facets to a lobe, a ring every `course` of height */
  const buildColumn = (around: number, course: number) => {
    const CS = COLUMN_LOBES * around, CR = Math.ceil((colY1 - colY0) / course);
    const cp = new Float32Array((CS + 1) * (CR + 1) * 3);
    const cn = new Float32Array(cp.length);
    const cc = new Float32Array(cp.length);
    const ci: number[] = [];
    for (let j = 0; j <= CR; j++) {
      const y = colY0 + ((colY1 - colY0) * j) / CR;
      for (let i = 0; i <= CS; i++) {
        const th = (i / CS) * TAU;
        const ph = LOBES * (th + y * TWIST);
        const r = COLUMN_R + DEPTH * Math.cos(ph);
        const drdph = -DEPTH * Math.sin(ph);
        const rTh = drdph * LOBES, rY = drdph * LOBES * TWIST;
        const k = (j * (CS + 1) + i) * 3;
        const c = Math.cos(th), s = Math.sin(th);
        cp[k] = r * c; cp[k + 1] = y; cp[k + 2] = r * s;
        const nx = r * c + rTh * s, ny = -r * rY, nz = r * s - rTh * c;
        const nl = Math.hypot(nx, ny, nz);
        cn[k] = nx / nl; cn[k + 1] = ny / nl; cn[k + 2] = nz / nl;
        const shade = 0.62 + 0.38 * smooth(-1, 0.6, Math.cos(ph));
        cc[k] = IVORY[0] * shade; cc[k + 1] = IVORY[1] * shade; cc[k + 2] = IVORY[2] * shade;
        if (i < CS && j < CR) {
          const a = j * (CS + 1) + i, b = a + CS + 1;
          ci.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(cp, 3));
    g.setAttribute("normal", new BufferAttribute(cn, 3));
    g.setAttribute("color", new BufferAttribute(cc, 3));
    g.setIndex(ci);
    return g;
  };
  const column = buildColumn(26, 1.2);
  const sisterColumn = buildColumn(12, 2.4); // the camera never comes within a dozen units of it

  // ---- shaft wall: one arcade module, bent onto the cylinder and sheared along the helix ----
  const W = WALL_W;
  const ARCH = WALL_ARCH;
  const SPRING = WALL_SPRING;
  const ws = new Shape();
  ws.moveTo(-W / 2, 0);
  ws.lineTo(-ARCH, 0);
  ws.lineTo(-ARCH, SPRING);
  ws.absarc(0, SPRING, ARCH, Math.PI, 0, true);
  ws.lineTo(ARCH, 0);
  ws.lineTo(W / 2, 0);
  ws.lineTo(W / 2, WALL_H);
  ws.lineTo(-W / 2, WALL_H);
  ws.closePath();
  const WALL_D = 2.6;
  const wallC = WALL_C;
  const wall = new ExtrudeGeometry(ws, { depth: WALL_D, bevelEnabled: false, curveSegments: 14, steps: 1 });
  {
    const pos = wall.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const th = -x / WALL_R;
      const r = WALL_R + z;
      pos.setXYZ(i, r * Math.cos(th), y + wallC * th, r * Math.sin(th));
      const sh = (0.62 + 0.38 * (y / WALL_H)) * (1 - 0.35 * (z / WALL_D));
      col[i * 3] = SAND[0] * sh; col[i * 3 + 1] = SAND[1] * sh; col[i * 3 + 2] = SAND[2] * sh;
    }
    wall.setAttribute("color", new BufferAttribute(col, 3));
    wall.deleteAttribute("uv");
    wall.computeVertexNormals();
    // faces that lie on the cylinder get true radial normals so the modules blend into one curved wall
    const nor = wall.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      const rl = Math.hypot(pos.getX(i), pos.getZ(i));
      const rx = pos.getX(i) / rl, rz = pos.getZ(i) / rl;
      const d = nor.getX(i) * rx + nor.getZ(i) * rz;
      if (Math.abs(d) > 0.9) nor.setXYZ(i, Math.sign(d) * rx, 0, Math.sign(d) * rz);
    }
  }
  const wallM: number[] = [];
  const wallLamps: number[] = [];
  {
    const k0 = Math.floor((WALL_Y0 / Math.abs(WALL_PITCH)) * WALL_N), k1 = Math.ceil((WALL_Y1 / Math.abs(WALL_PITCH)) * WALL_N);
    for (let k = k0; k <= k1; k++) {
      const psi = Math.sign(WALL_PITCH) * (k / WALL_N) * TAU; // height grows with k
      dummy.position.set(0, wallC * psi, 0);
      dummy.rotation.set(0, -psi, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      wallM.push(...dummy.matrix.elements);
      if ((((k % 2) + 2) % 2) === 0) {
        const r = WALL_R + WALL_D * 0.5;
        wallLamps.push(r * Math.cos(psi), wallC * psi + SPRING * 0.72, r * Math.sin(psi));
      }
    }
  }

  // ---- satellite staircase (low detail), instanced at wrong angles ----
  const tq = new Quads();
  {
    const N = 24, turns = 9, pitch = 13.5, rise = pitch / N;
    const half = (turns * pitch) / 2;
    const pt = (r: number, a: number, y: number): V3 => [r * Math.cos(a), y, r * Math.sin(a)];
    for (let i = 0; i < N * turns; i++) {
      const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
      const top = -half + (i + 1) * rise, bot = top - 0.9;
      const ctr = pt(5, (a0 + a1) / 2, top - 0.45);
      tq.quad(pt(2, a0, top), pt(8, a0, top), pt(8, a1, top), pt(2, a1, top), ctr, IVORY, 0.5, 1, 1, 0.5);
      tq.quad(pt(2, a0, bot), pt(8, a0, bot), pt(8, a1, bot), pt(2, a1, bot), ctr, IVORY, 0.5, 1, 1, 0.5);
      tq.quad(pt(2, a0, top), pt(8, a0, top), pt(8, a0, bot), pt(2, a0, bot), ctr, SAND, 0.5, 0.95, 0.7, 0.4);
      tq.quad(pt(2, a1, top), pt(8, a1, top), pt(8, a1, bot), pt(2, a1, bot), ctr, SAND, 0.5, 0.8, 0.8, 0.5);
      tq.quad(pt(8, a0, top), pt(8, a1, top), pt(8, a1, bot), pt(8, a0, bot), ctr, SAND);
    }
    const CN = 16;
    for (let i = 0; i < CN; i++) {
      const a0 = (i / CN) * TAU, a1 = ((i + 1) / CN) * TAU;
      const sh = i % 2 ? 0.7 : 0.95;
      tq.quad(pt(2.4, a0, -half - 14), pt(2.4, a1, -half - 14), pt(2.4, a1, half + 14), pt(2.4, a0, half + 14), [0, 0, 0], IVORY, sh, sh, sh, sh);
    }
  }
  const satellite = tq.build();
  const sat = (x: number, dy: number, z: number, rx: number, rz: number, scale: number, spin: number): Satellite => ({
    pos: new Vector3(x, dy, z),
    tilt: new Quaternion().setFromEuler(new Euler(rx, 0, rz)),
    scale,
    spin,
    phase: rand() * TAU,
  });
  const satellites = [
    sat(36, 9, 30, 1.3, 0.1, 0.5, 0.16), // hangs beside the fly-in, short of the sister tower
    sat(-12, -24, 34, 0.2, 1.2, 0.5, -0.14), // below the bridge in
    sat(-35, 10, 5, 0.25, 0.3, 0.5, 0.18), // out over the void, half way up the turn
    sat(-34, -14, -22, 0.9, 0.5, 0.4, -0.12), // low in the void on the far side of the turn
    sat(-18, 26, -38, 0.3, -1.1, 0.45, 0.14), // and to its left
    sat(84, 6, 50, 0.5, 0.45, 1.5, -0.07),
    sat(-92, 26, -54, 0.2, -0.95, 1.7, 0.06),
    sat(32, 44, 106, -1.0, 0.2, 1.4, 0.08),
    sat(-60, -34, 94, 0.45, 0.75, 1.3, -0.09),
    sat(106, -24, -64, 1.2, -0.2, 1.6, 0.07),
    sat(-20, 58, -108, 0.1, 1.4, 1.5, -0.06),
    sat(-80, -60, -12, -0.7, 0.5, 1.2, 0.08),
  ];

  // ---- the keyhole stele ----
  const outer = new Shape();
  keyholeOutline(outer, DOOR_FRAME, 0);
  const hole = new Path();
  keyholeOutline(hole, 0, 0);
  outer.holes.push(hole);
  // a thin slab: 20 cm of stone, its chamfer still wide enough to hide the portal's edge
  const doorFrame = new ExtrudeGeometry(outer, {
    depth: 0.12, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 72,
  });
  doorFrame.translate(0, 0, -0.06);
  doorFrame.deleteAttribute("uv");
  tint(doorFrame, (_x, y, z) => {
    const s = (0.86 + 0.1 * smooth(0, 9, y)) * (z > -0.05 ? 1 : 0.8);
    return [IVORY[0] * s, IVORY[1] * s, IVORY[2] * s];
  });
  faceKinds(doorFrame);
  const slab = new Shape();
  keyholeOutline(slab, DOOR_FRAME - 0.02, 0);
  const doorBack = new ExtrudeGeometry(slab, { depth: 0.05, bevelEnabled: false, curveSegments: 72 });
  doorBack.translate(0, 0, -0.15);
  doorBack.deleteAttribute("uv");
  tint(doorBack, (x, y) => {
    const d = Math.hypot(x, y - DOOR_CY);
    const s = 0.75 + 0.2 * Math.sin(d * 3.0) * smooth(4.2, 3.0, d);
    return [SAND[0] * s, SAND[1] * s, SAND[2] * s];
  });
  faceKinds(doorBack);
  const open = new Shape();
  keyholeOutline(open, 0.06, 0);
  const doorPortal = new ShapeGeometry(open, 72);

  // ---- points: wall lamps, lantern halos, drifting motes ----
  const pp: number[] = [], ps: number[] = [], pa: number[] = [];
  for (let i = 0; i < wallLamps.length; i += 3) {
    pp.push(wallLamps[i]!, wallLamps[i + 1]!, wallLamps[i + 2]!);
    ps.push(5.5);
    pa.push(0, 0, rand() * TAU, 0.75);
  }
  for (let i = 0; i < lanternPos.length; i += 3) {
    pp.push(lanternPos[i]!, lanternPos[i + 1]!, lanternPos[i + 2]!);
    ps.push(3.4);
    pa.push(0, 0, rand() * TAU, 0.55);
  }
  for (let i = 0; i < 520; i++) {
    const r = 8 + 36 * Math.sqrt(rand());
    const a = rand() * TAU;
    pp.push(r * Math.cos(a), -50 + rand() * 110, r * Math.sin(a));
    ps.push(0.18 + rand() * 0.3);
    pa.push(0.25 + rand() * 0.8, (rand() - 0.5) * 0.03, rand() * TAU, 1.2);
  }
  const points = new BufferGeometry();
  points.setAttribute("position", new BufferAttribute(new Float32Array(pp), 3));
  points.setAttribute("aSize", new BufferAttribute(new Float32Array(ps), 1));
  points.setAttribute("aAnim", new BufferAttribute(new Float32Array(pa), 4));

  // ---- materials ----
  const stone = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "strata");
  const wallMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "wall");
  const stairMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "stair");
  const columnMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "column");
  const sisterColumnMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "column", sisterNewel);
  const postMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "post");
  const keyholeMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "keyhole");
  // the two bridges and the arch stand in the koi's water: where, as angles about the newel
  const span = (d0: number, d1: number, y: number, halfY: number, clear: number) => {
    const a = deckAt(layout.ride, layout.rideS(d0), { ...P }), b = deckAt(layout.ride, layout.rideS(d1), { ...P });
    const a0 = Math.atan2(a.z, a.x), a1 = Math.atan2(b.z, b.x);
    const half = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))) / 2;
    return { angle: a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) / 2, halfAngle: half + 0.2, y, halfY, r: Math.max(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z)) + clear };
  };
  const { stretch } = layout;
  const bridgeIn = span(0, stretch.joint, -EYE - EYE_IN / 2 + 1, 5, 5);
  const bridgeOut = span(stretch.exit - 17, stretch.exit, layout.doorPos.y + 4.5, 6, 9); // the fish frame the arch, they do not touch it
  // between the stair and the arcade, from far below the camera's start to far above the door;
  // they swim round the two bridges and the arch
  const koi = createKoi({
    count: 84, rMin: layout.R + HALF_W + 5, rMax: WALL_R - 5, yMid: 6, yRange: 150, fogNear: FOG_NEAR, fogFar: FOG_FAR, skyGlsl: SKY_GLSL,
    keepOut: [bridgeIn, bridgeOut],
    // the sister tower fills the water from the rungs to the wall: no fish comes round to it
    wedge: { angle: Math.atan2(SISTER_AT[1], SISTER_AT[0]), halfAngle: 0.65, until: TIMING.total },
    door: { centre: new Vector3(layout.doorPos.x, layout.doorPos.y + DOOR_CY, layout.doorPos.z), radius: 6.2, from: 17.5, to: 20 },
  });
  const glow = withVoidFog(new MeshBasicMaterial({ color: new Color(1.35, 0.6, 0.16) }), "globe");
  // lamplight in the keyhole before the portal opens: the globes' glass, turned down
  const veilMat = withVoidFog(new MeshBasicMaterial({ color: new Color(0.95, 0.4, 0.1) }), "globe");
  const skyMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        gl_FragColor = vec4(hxSky(normalize(vDir)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pointsMat = new ShaderMaterial({
    uniforms: { uT: { value: 0 }, uScale: { value: 600 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec4 aAnim;
      uniform float uT;
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y += uT * aAnim.x;
        float a = uT * aAnim.y;
        float c = cos(a), s = sin(a);
        p.xz = mat2(c, s, -s, c) * p.xz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(aSize * uScale / max(d, 0.1), 220.0);
        vA = aAnim.w * (1.0 - smoothstep(${FOG_NEAR.toFixed(1)}, ${(FOG_FAR * 1.15).toFixed(1)}, d))
          * smoothstep(0.6, 3.0, d) * (0.85 + 0.15 * sin(uT * 1.7 + aAnim.z));
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float g = pow(max(1.0 - r, 0.0), 2.4);
        gl_FragColor = vec4(vec3(1.0, 0.42, 0.1) * g * vA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  cache = {
    index, layout, stairs, rails, column, sisterColumn, sisterColumnMat, wall, satellite,
    baluster: lathe(BALUSTER_PROFILE, 7),
    post: lathe(POST_PROFILE, 20),
    lantern: new SphereGeometry(0.22, 28, 16),
    sky: new SphereGeometry(1200, 24, 16),
    points, doorFrame, doorBack, doorPortal,
    stone, keyholeMat, columnMat, postMat,
    depthOnly: new MeshBasicMaterial({ colorWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }), wallMat, stairMat, koi, glow, veilMat, skyMat, pointsMat,
    balusterM: new Float32Array(balusters[0]!),
    postM: new Float32Array(posts[0]!),
    lanternM: new Float32Array(lanterns[0]!),
    coarseBaluster: lathe(BALUSTER_COARSE, 5),
    coarsePost: lathe(POST_COARSE, 10),
    coarseLantern: new SphereGeometry(0.22, 16, 9),
    coarseBalusterM: new Float32Array(balusters[1]!),
    coarsePostM: new Float32Array(posts[1]!),
    coarseLanternM: new Float32Array(lanterns[1]!),
    wallM: new Float32Array(wallM),
    satellites,
  };
  return cache;
}

function instanced(geo: BufferGeometry, mat: Material, matrices: Float32Array): InstancedMesh {
  const m = new InstancedMesh(geo, mat, matrices.length / 16);
  m.instanceMatrix.array.set(matrices);
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------------------------------------
// the scene
// ---------------------------------------------------------------------------------------------
const Y_AXIS = new Vector3(0, 1, 0);

export default function Helix({ index, clock, camera, portalMaterial }: SceneProps) {
  const rig = useMemo(() => {
    const A = getAssets(index);
    const root = new Group();
    const sky = new Mesh(A.sky, A.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    const column = new Mesh(A.column, A.columnMat);
    const stairs = new Mesh(A.stairs, A.stairMat);
    // Draw order, so that stone nothing sees is never shaded: the two newels lay down their depth
    // first, everything that stands in front of them follows, then the newels themselves, and
    // the arcade and the far stairs, which are behind it all, come last.
    const columnDepth = new Mesh(A.column, A.depthOnly);
    const sisterColumnDepth = new Mesh(A.sisterColumn, A.depthOnly);
    columnDepth.renderOrder = sisterColumnDepth.renderOrder = -5;
    column.renderOrder = 2;
    const rails = new Mesh(A.rails, A.stone);
    const balusters = instanced(A.baluster, A.postMat, A.balusterM);
    const postMesh = instanced(A.post, A.postMat, A.postM);
    const lanterns = instanced(A.lantern, A.glow, A.lanternM);
    const coarse = [
      instanced(A.coarseBaluster, A.postMat, A.coarseBalusterM),
      instanced(A.coarsePost, A.postMat, A.coarsePostM),
      instanced(A.coarseLantern, A.glow, A.coarseLanternM),
    ];
    const sisterColumn = new Mesh(A.sisterColumn, A.sisterColumnMat);
    sisterColumn.position.set(SISTER_AT[0], A.layout.sisterY, SISTER_AT[1]);
    sisterColumnDepth.position.copy(sisterColumn.position);
    sisterColumn.renderOrder = 2;
    const wall = instanced(A.wall, A.wallMat, A.wallM);
    wall.renderOrder = 3;
    const sats = new InstancedMesh(A.satellite, A.stone, A.satellites.length);
    sats.frustumCulled = false;
    sats.renderOrder = 3;
    const points = new Points(A.points, A.pointsMat);
    points.frustumCulled = false;
    const door = new Group();
    door.position.copy(A.layout.doorPos);
    door.rotation.y = A.layout.doorYaw;
    const portal = new Mesh(A.doorPortal, portalMaterial);
    const doorBack = new Mesh(A.doorBack, A.keyholeMat);
    doorBack.renderOrder = 1; // after the portal, so the depth test spares the carving behind it
    // Until the portal shows the next scene (t = TIMING.portalLive) it is black, and the arch is
    // in sight from the bridge in and from under the bridge out: till then the keyhole is lit.
    const veil = new Mesh(A.doorPortal, A.veilMat);
    veil.position.z = 0.012;
    door.add(new Mesh(A.doorFrame, A.keyholeMat), doorBack, portal, veil);
    root.add(sky, columnDepth, sisterColumnDepth, column, sisterColumn, stairs, rails, balusters, postMesh, lanterns, ...coarse, wall, sats, A.koi.mesh, points, door);
    return {
      A, root, sky, sats, veil,
      columns: [column, columnDepth], sisterColumns: [sisterColumn, sisterColumnDepth],
      instancedMeshes: [balusters, postMesh, lanterns, ...coarse, wall, sats],
    };
  }, [index, portalMaterial]);

  useEffect(() => () => rig.instancedMeshes.forEach((m) => m.dispose()), [rig]);

  const tmp = useMemo(
    () => ({ pose: createFrame(), ahead: createFrame(), look: new Vector3(), q: new Quaternion(), o: new Object3D(), fwd: new Vector3() }),
    [],
  );

  useFrame((state) => {
    const { A, sky, columns, sisterColumns, sats, veil } = rig;
    const { stretch, centre } = A.layout;
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    const { pose, ahead, look, q, o, fwd } = tmp;

    // --- camera: the rail's, with a look into the turn and down onto the treads while it is free ---
    const d = stretch.distance(t);
    stretch.frame(d, pose);
    const free = stretch.free(t);
    if (free > 0) {
      look.copy(stretch.frame(d + LOOK_AHEAD, ahead).position);
      look.y -= LOOK_DROP;
      lookTowards(pose, look, free);
    }
    camera.position.copy(pose.position).sub(centre);
    camera.quaternion.copy(pose.quaternion);
    // The lens is wide while the scene is a picture in the orbit's gate (and steady: the two
    // cameras share the track), closes to the ride's as the camera turns onto the stair, tightens
    // again on the last landing and has settled before the cameras share the track once more.
    const fov =
      FOV_IN + (FOV - FOV_IN) * smooth(stretch.joint + 2.2, stretch.joint + 12, d) + (FOV_DOOR - FOV) * smooth(stretch.exit - 31, stretch.exit - 20, d);
    if (camera.fov !== fov) camera.fov = fov;

    // --- the world turns ---
    sky.position.copy(camera.position);
    for (const m of columns) m.rotation.y = -t * 0.035;
    for (const m of sisterColumns) m.rotation.y = t * 0.035; // the sister's newel turns the other way
    for (let i = 0; i < A.satellites.length; i++) {
      const s = A.satellites[i]!;
      q.setFromAxisAngle(Y_AXIS, s.phase + t * s.spin);
      o.position.copy(s.pos);
      o.quaternion.copy(s.tilt).multiply(q);
      o.scale.setScalar(s.scale);
      o.updateMatrix();
      sats.setMatrixAt(i, o.matrix);
    }
    sats.instanceMatrix.needsUpdate = true;
    hxTime.value = t;
    veil.visible = t < TIMING.portalLive;
    A.koi.update(t, camera.position, fwd.set(0, 0, -1).applyQuaternion(camera.quaternion));
    A.pointsMat.uniforms.uT!.value = t;
    A.pointsMat.uniforms.uScale!.value =
      state.gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  });

  return (
    <>
      <color attach="background" args={["#02181d"]} />
      <fog attach="fog" args={["#02181d", FOG_NEAR, FOG_FAR]} />
      <hemisphereLight args={["#ffe6bd", "#1f5f66", 1.3]} />
      <directionalLight color="#ffb060" intensity={2.1} position={[-0.35, 1, -0.6]} />
      <directionalLight color="#ff9548" intensity={0.55} position={[0.3, -1, 0.35]} />
      <primitive object={rig.root} />
    </>
  );
}
