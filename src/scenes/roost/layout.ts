import { Vector3 } from "three";
import { createFrame, type Stretch } from "../rail";

/**
 * Where everything in the roost is, in the scene's local frame (rail.ts: the takeover joint at the
 * origin, north is -Z, +Y up). Measured against spring, the stretch the fifth scene rides:
 *
 *   t = 0 .. 5    level under the floor, y = 0, sweeping 26 degrees left onto north
 *   t = 7.8 .. 18 one full turn to the left about (-10, -7.6), radius 10, climbing to y = 13.73;
 *                 the eye crosses the floor plane (y = 12.5) at t = 16.7, near (-5.2, 0.9)
 *   t = 20 .. 25  level, 1.23 above the glaze, onto the nest's lip at (-5.2, 13.73, -31.4)
 *
 *                          N (-Z)
 *               hen H (-10,-41)  <- nest lip r 11; the exit E is on it
 *                     \   E
 *                       \ |   approach t 20..25
 *            . - - - .   \|
 *          /  climb    \  |  <- over the hole t 17..19.6
 *         |  (-10,-7.6) | [hole]   the eye crosses the slab at t 16.7
 *          \  r 10     /  |
 *            ' - - - '    | t 5 origin, inside the light column
 *                         |
 *                         \ t 0 (-3, 0, 18)
 */

export const TAU = Math.PI * 2;

/** top face of the slab (glazed) */
export const FLOOR_Y = 12.5;
export const SLAB = 0.25;
/** under face of the slab (matt biscuit): the ceiling of the place below */
export const UNDER_Y = FLOOR_Y - SLAB;
/** the floor disc and the curtain round it are centred here */
export const CENTRE = new Vector3(-5, FLOOR_Y, -15);
export const FLOOR_R = 160;
export const CURTAIN_R = 172;

/** radius of the nest's lip, and of the portal wall standing just inside it */
export const LIP_R = 11;
export const WALL_R = 10.9;
/** how far the nest's bowl, the lamp, hangs below the ceiling */
export const BOWL_DEPTH = 9;
/** height of the hen's hem above the floor while she sits */
export const HEM = 0.32;

/** the light column under the hole */
export const COLUMN = { x: -3, z: -2.5, r: 10.5, bottom: -30, top: FLOOR_Y + 45 } as const;

/**
 * The missing shard: a five-sided hole, broken edges. Every point of the track whose eye is within
 * 1.5 of the slab (t = 15.4 .. 17.4) is more than 2 inside it, and the eye flies over it until z = -12.
 */
const HOLE_CORNERS: [number, number][] = [
  [-17.5, 2.5],
  [-8.5, 8.5],
  [7.5, 6.5],
  [9, -9.5],
  [-4.5, -13.5],
  [-15, -6],
];

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let k = Math.imul(s ^ (s >>> 15), 1 | s);
    k = (k + Math.imul(k ^ (k >>> 7), 61 | k)) ^ k;
    return ((k ^ (k >>> 14)) >>> 0) / 4294967296;
  };
}

/** the hole's broken outline: each side split into short jagged steps (x, z) */
export const HOLE: [number, number][] = (() => {
  const rand = rng(77);
  const out: [number, number][] = [];
  for (let i = 0; i < HOLE_CORNERS.length; i++) {
    const [ax, az] = HOLE_CORNERS[i]!;
    const [bx, bz] = HOLE_CORNERS[(i + 1) % HOLE_CORNERS.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(3, Math.round(len / 1.4));
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const j = k === 0 ? 0 : (rand() - 0.5) * 0.9;
      out.push([ax + (bx - ax) * u + nx * j, az + (bz - az) * u + nz * j]);
    }
  }
  return out;
})();

export function inHole(x: number, z: number, margin = 0): boolean {
  let inside = false;
  for (let i = 0, j = HOLE.length - 1; i < HOLE.length; j = i++) {
    const [xi, zi] = HOLE[i]!;
    const [xj, zj] = HOLE[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (margin === 0) return inside;
  // distance to the outline
  let d = Infinity;
  for (let i = 0, j = HOLE.length - 1; i < HOLE.length; j = i++) {
    const [ax, az] = HOLE[j]!;
    const [bx, bz] = HOLE[i]!;
    const ex = bx - ax;
    const ez = bz - az;
    const k = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    d = Math.min(d, Math.hypot(x - ax - ex * k, z - az - ez * k));
  }
  return margin > 0 ? inside || d < margin : inside && d > -margin;
}

/** One sample of the track: where the eye is, and when. */
export interface TrackPoint {
  t: number;
  p: Vector3;
  fwd: Vector3;
}

export interface Layout {
  /** the hen's centre, on the floor plane: the exit's lip point plus LIP_R along its heading */
  hen: Vector3;
  /** the exit point and its heading */
  exit: Vector3;
  exitDir: Vector3;
  track: TrackPoint[];
  /** distance in plan from (x, z) to the track, counting only samples whose eye is within [y0, y1] */
  clear(x: number, z: number, y0: number, y1: number): number;
}

export function createLayout(stretch: Stretch): Layout {
  const f = createFrame();
  const e = stretch.frame(stretch.exit, f);
  const exit = e.position.clone();
  const exitDir = e.tangent.clone().setY(0).normalize();
  const hen = exit.clone().addScaledVector(exitDir, LIP_R).setY(FLOOR_Y);
  const track: TrackPoint[] = [];
  for (let t = -1; t <= 25.5; t += 0.1) {
    const p = stretch.pose(t, f);
    track.push({ t, p: p.position.clone(), fwd: p.tangent.clone() });
  }
  return {
    hen,
    exit,
    exitDir,
    track,
    clear(x, z, y0, y1) {
      let d = Infinity;
      for (const s of track) {
        if (s.p.y < y0 || s.p.y > y1) continue;
        d = Math.min(d, Math.hypot(s.p.x - x, s.p.z - z));
      }
      return d;
    },
  };
}
