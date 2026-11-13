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
  Vector3,
  Vector4,
  type Material,
} from "three";
import { TIMING, type SceneProps } from "./types";
import { RAIL, RAIL_LEAD_OUT, createRide, type Ride } from "./rail";
import { createKoi, type Koi } from "./helix/koi";

/**
 * HELIX — the endless staircase.
 *
 * A cantilevered sandstone stair winds around a slowly turning fluted column inside a vast shaft
 * whose wall is itself a counter-wound helical arcade. Other staircases hang in the teal void at
 * wrong angles, each rotating about its own axis so it seems to climb forever. Near the top the
 * stair peels away from the column into open air and ends at a thin keyhole stele: the exit portal.
 */

// ---------------------------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const R0 = 5.5; // centre-line radius of the stair around the column
const R1 = 13.5; // centre-line radius where the stair ends
const TURNS = 10; // helix turns below the flare
const FLARE = 0.56 * TAU; // angle over which the stair peels away
const DS = 0.1; // path table resolution
const TWIN_TURNS = 8; // the twin stair keeps climbing this many turns past the door's angle
const EXT = 40; // straight continuation behind the door (look-ahead only)
const TREAD = 1.25;
const SLOPE = 0.5 / TREAD;
const THICK = 0.95;
const COLUMN_R = 3.0;
const WALL_R = 38;
const WALL_N = 26; // arcade modules per turn
const WALL_H = 13;
const WALL_PITCH = -13; // counter-wound
const CRUISE = 3.6; // camera speed on the stair; RAIL.speed at both seams
const LEAD_EASE = 20; // track over which the fly-in bends from dead straight onto the helix
const LAND_EASE = 12; // track over which the flare straightens out into the landing
const END_GAP = 0.22; // camera stops this far in front of the portal plane
const EYE = 2.6;
const EYE_RISE = 2.5; // the camera floats up to the keyhole's centre at the end
const FOG_NEAR = 22;
const FOG_FAR = 150;

const DOOR_A = 2.45; // half width of the keyhole's shaft
const DOOR_CY = 5.15; // centre of the keyhole's circle
const DOOR_R = 3.35;
const DOOR_FRAME = 0.8;

const IVORY: [number, number, number] = [0.95, 0.83, 0.64];
const SAND: [number, number, number] = [0.92, 0.72, 0.5];
const AMBER: [number, number, number] = [0.8, 0.47, 0.2];
/** the void's colour at eye level, which far stone hazes into (linear) */
const VOID_TEAL = "vec3(0.022, 0.13, 0.145)";

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
// the path: a helix that peels off into a spiral and ends in a straight line
// ---------------------------------------------------------------------------------------------
interface PathTable {
  x: Float32Array;
  z: Float32Array;
  h: Float32Array;
  flare: Float32Array;
  end: number; // arc length at the door
  n: number;
}

function buildPath(main: boolean): PathTable {
  const thetaF = -FLARE;
  const theta0 = thetaF - TURNS * TAU;
  const thetaEnd = main ? 0 : TWIN_TURNS * TAU;
  const dTheta = 0.002;
  const count = Math.ceil((thetaEnd - theta0) / dTheta) + 1;
  const fx = new Float32Array(count);
  const fz = new Float32Array(count);
  const fs = new Float32Array(count);
  const ff = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const th = Math.min(thetaEnd, theta0 + i * dTheta);
    const k = main ? Math.max(0, (th - thetaF) / FLARE) : 0;
    const r = R0 + (R1 - R0) * k * k * k;
    fx[i] = r * Math.cos(th);
    fz[i] = r * Math.sin(th);
    ff[i] = k;
    fs[i] = i === 0 ? 0 : fs[i - 1]! + Math.hypot(fx[i]! - fx[i - 1]!, fz[i]! - fz[i - 1]!);
  }
  if (main) {
    // The flare would arrive at the door still turning. Fade its curvature out instead, so that
    // the landing (and the camera on it) runs dead straight into the keyhole.
    const straight = RAIL_LEAD_OUT + END_GAP + 0.8;
    const total = fs[count - 1]!;
    const ox = fx.slice();
    const oz = fz.slice();
    const heading = (i: number) => Math.atan2(oz[i]! - oz[i - 1]!, ox[i]! - ox[i - 1]!);
    let i = count - 1;
    while (i > 2 && total - fs[i]! < straight + LAND_EASE) i--;
    let psi = heading(i);
    for (i++; i < count; i++) {
      const bend = heading(i) - heading(i - 1);
      const keep = 1 - smoother(straight + LAND_EASE, straight, total - fs[i]!);
      psi += Math.atan2(Math.sin(bend), Math.cos(bend)) * keep;
      const step = fs[i]! - fs[i - 1]!;
      fx[i] = fx[i - 1]! + Math.cos(psi) * step;
      fz[i] = fz[i - 1]! + Math.sin(psi) * step;
    }
  }
  const tx = fx[count - 1]! - fx[count - 6]!;
  const tz = fz[count - 1]! - fz[count - 6]!;
  const tl = Math.hypot(tx, tz);
  const end = fs[count - 1]!;
  const n = Math.ceil((end + EXT) / DS) + 1;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const h = new Float32Array(n);
  const flare = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = k * DS;
    if (s <= end) {
      while (j < count - 2 && fs[j + 1]! < s) j++;
      const u = (s - fs[j]!) / Math.max(1e-6, fs[j + 1]! - fs[j]!);
      x[k] = fx[j]! + (fx[j + 1]! - fx[j]!) * u;
      z[k] = fz[j]! + (fz[j + 1]! - fz[j]!) * u;
      flare[k] = ff[j]! + (ff[j + 1]! - ff[j]!) * u;
    } else {
      x[k] = fx[count - 1]! + (tx / tl) * (s - end);
      z[k] = fz[count - 1]! + (tz / tl) * (s - end);
      flare[k] = 1;
    }
    // the stair levels out into a landing just before the door
    h[k] = k === 0 ? 0 : h[k - 1]! + SLOPE * DS * (main ? smooth(3, 16, end - (s - DS / 2)) : 1);
  }
  return { x, z, h, flare, end, n };
}

function pathAt(p: PathTable, s: number, out: Vector3): Vector3 {
  const f = Math.min(p.n - 1.001, Math.max(0, s / DS));
  const i = Math.floor(f);
  const u = f - i;
  return out.set(
    p.x[i]! + (p.x[i + 1]! - p.x[i]!) * u,
    p.h[i]! + (p.h[i + 1]! - p.h[i]!) * u,
    p.z[i]! + (p.z[i + 1]! - p.z[i]!) * u,
  );
}
function pathFlare(p: PathTable, s: number): number {
  return p.flare[Math.min(p.n - 1, Math.max(0, Math.round(s / DS)))]!;
}
const _a = new Vector3();
const _b = new Vector3();
/** horizontal unit tangent */
function pathTangent(p: PathTable, s: number, out: Vector3): Vector3 {
  pathAt(p, s - 0.5, _a);
  pathAt(p, s + 0.5, _b);
  out.set(_b.x - _a.x, 0, _b.z - _a.z);
  return out.normalize();
}

/**
 * The camera's own track. It is the stair's centre line, except that the camera cannot start out
 * on a spiral (see rail.ts): it flies in from the void along a straight line that climbs at the
 * stair's slope, and a transition curve then winds that line onto the helix.
 */
interface CameraTrack {
  path: PathTable;
  /** true (sloped) distance travelled at each table entry; the path itself is indexed by plan length */
  dist: Float32Array;
  ride: Ride;
  /** value of `dist` where the camera stops, END_GAP short of the door */
  stop: number;
}

function buildCameraTrack(path: PathTable): CameraTrack {
  const cam: PathTable = { ...path, x: path.x.slice(), z: path.z.slice(), h: path.h.slice() };
  const dist = new Float32Array(path.n);
  for (let k = 1; k < path.n; k++) dist[k] = dist[k - 1]! + Math.hypot(DS, path.h[k]! - path.h[k - 1]!);
  const track: CameraTrack = { path: cam, dist, ride: createRide({ cruise: CRUISE }), stop: 0 };
  const kStop = (path.end - END_GAP) / DS;
  track.stop = dist[Math.floor(kStop)]! + (kStop % 1) * (dist[Math.floor(kStop) + 1]! - dist[Math.floor(kStop)]!);

  // the straight outlasts the seam by the look-ahead
  const bend0 = trackS(track, RAIL.release) + 2.2;
  const join = Math.round((bend0 + LEAD_EASE) / DS);
  const heading = (k: number) => Math.atan2(path.z[k + 1]! - path.z[k]!, path.x[k + 1]! - path.x[k]!);
  let psi = heading(join);
  let turn = heading(join + 5) - heading(join - 5);
  turn = Math.atan2(Math.sin(turn), Math.cos(turn)) / 10; // the helix's heading change per table step
  for (let k = join - 1; k >= 0; k--) {
    psi -= turn * smooth(bend0, bend0 + LEAD_EASE, (k + 0.5) * DS);
    cam.x[k] = cam.x[k + 1]! - Math.cos(psi) * DS;
    cam.z[k] = cam.z[k + 1]! - Math.sin(psi) * DS;
    cam.h[k] = cam.h[k + 1]! - SLOPE * DS; // same slope as the stair, so `dist` still holds
  }
  return track;
}

/** plan length along the track at local time t */
function trackS({ dist, ride, stop }: CameraTrack, t: number): number {
  const d = stop - ride.length + ride.at(t);
  let lo = 0;
  let hi = dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return (lo + (d - dist[lo]!) / (dist[hi]! - dist[lo]!)) * DS;
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

/**
 * The stair lamps' turned post, built from pieces: each piece is a smooth curve with exact normals,
 * and the joints between pieces are crisp arrises. It stands on a bell-shaped console that juts
 * from the slab's outer end, so the lamp sits beyond the hand rail, out of the climb's way.
 * Each piece: [r(u), y(u)] for u in 0..1, samples, brass, shade at u = 0 and u = 1.
 */
type Piece = [(u: number) => [number, number], number, number, number, number];
const torus = (cr: number, cy: number, rad: number, a0: number, a1: number) => (u: number): [number, number] => {
  const a = a0 + (a1 - a0) * u;
  return [cr + rad * Math.cos(a), cy + rad * Math.sin(a)];
};
const seg = (r0: number, y0: number, r1: number, y1: number) => (u: number): [number, number] => [r0 + (r1 - r0) * u, y0 + (y1 - y0) * u];
const HALF_PI = Math.PI / 2;
/** height of the globe's centre above the tread the post stands on, and the globe's radius */
const LAMP_Y = 2.33;
const GLOBE_R = 0.165;
/** how far beyond the slab's outer end the post stands */
const LAMP_OUT = 0.07;
const LAMP_PIECES: Piece[] = [
  // the console: an onion drop under the slab, ending in a bead at the tread
  [(u) => [0.18 * Math.pow(Math.sin(u * HALF_PI), 0.65) + 0.004, -0.62 + 0.56 * u], 14, 0, 0.45, 0.7],
  [torus(0.17, -0.035, 0.03, -HALF_PI, HALF_PI), 8, 0, 0.7, 0.9],
  // the plinth, a torus and a cove
  [seg(0.17, -0.005, 0.17, 0.08), 2, 0, 0.55, 0.75],
  [seg(0.17, 0.08, 0.152, 0.08), 1, 0, 0.9, 0.9],
  [torus(0.152, 0.114, 0.034, -HALF_PI, HALF_PI), 10, 0, 0.8, 1.05],
  [seg(0.152, 0.148, 0.128, 0.148), 1, 0, 1.0, 0.95],
  [(u) => [0.092 + 0.036 * (1 - u) * (1 - u), 0.148 + 0.075 * Math.sqrt(u)], 8, 0, 0.75, 0.9],
  // a brass astragal, the lower shaft with a little entasis, a brass collar, the upper shaft
  [torus(0.092, 0.243, 0.02, -HALF_PI, HALF_PI), 8, 1, 0.8, 1.0],
  [(u) => [0.09 - 0.008 * u + 0.004 * Math.sin(Math.PI * u), 0.263 + 0.72 * u], 8, 0, 0.9, 1.0],
  [(u) => [0.082 + 0.012 * Math.sin(u * HALF_PI), 0.983 + 0.012 * (1 - Math.cos(u * HALF_PI))], 4, 1, 0.75, 0.9],
  [torus(0.094, 1.025, 0.03, -HALF_PI, HALF_PI), 12, 1, 0.9, 1.1],
  [(u) => [0.094 - 0.012 * (1 - Math.cos(u * HALF_PI)), 1.055 + 0.012 * Math.sin(u * HALF_PI)], 4, 1, 0.95, 0.8],
  [(u) => [0.082 - 0.01 * u + 0.003 * Math.sin(Math.PI * u), 1.067 + 0.79 * u], 8, 0, 0.85, 1.0],
  // the capital collar, a waisted neck and a tulip cup with a rolled lip
  [seg(0.072, 1.857, 0.088, 1.857), 1, 1, 0.85, 0.9],
  [torus(0.088, 1.885, 0.028, -HALF_PI, HALF_PI), 10, 1, 0.9, 1.1],
  [(u) => [0.058 + 0.03 * (1 - u) * (1 - u), 1.913 + 0.08 * u], 6, 1, 0.8, 0.9],
  [(u) => [0.058 + 0.076 * Math.pow(Math.sin(u * HALF_PI), 1.6), 1.993 + 0.2 * u], 12, 1, 0.9, 1.15],
  [torus(0.122, 2.193, 0.012, 0, Math.PI), 8, 1, 1.15, 1.2],
  [seg(0.11, 2.193, 0.0, 2.13), 3, 1, 1.0, 0.8],
];
/** `fine` scales every piece's samples down for the distant lamps */
function turned(pieces: Piece[], seg: number, fine = 1): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let rows = 0;
  for (const [fn, n0, brass, sh0, sh1] of pieces) {
    const n = Math.max(1, Math.round(n0 * fine));
    const base: V3 = brass ? AMBER : SAND;
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      const [r, y] = fn(u);
      const e = 1e-3;
      const a = fn(Math.max(0, u - e)), b = fn(Math.min(1, u + e));
      let nr = b[1] - a[1], ny = -(b[0] - a[0]);
      const l = Math.hypot(nr, ny) || 1;
      nr /= l; ny /= l;
      const sh = sh0 + (sh1 - sh0) * u;
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * TAU;
        const c = Math.cos(th), s = Math.sin(th);
        pos.push(r * c, y, r * s);
        nor.push(nr * c, ny, nr * s);
        col.push(base[0] * sh, base[1] * sh, base[2] * sh);
        if (j < n && i < seg) {
          const p0 = (rows + j) * (seg + 1) + i, p1 = p0 + seg + 1;
          idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
        }
      }
    }
    rows += n + 1;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  return g;
}
/** the lamps' warm light: the nearest few, in world space, w their strength; set each frame */
const POOL_N = 10;
/** stair lamps drawn with the fine post and globe; the rest use coarse ones */
const LAMP_NEAR = 6;
/** the hand rail: a slim dark-bronze tube, carried low so it stays under the line of sight */
const RAIL_R = 0.048;
const RAIL_Y = 1.24;
const BRONZE: V3 = [0.27, 0.16, 0.075];
const hxPool = { value: Array.from({ length: POOL_N }, () => new Vector4()) };

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

type Detail = "plain" | "strata" | "wall" | "stair" | "column" | "post" | "globe" | "lamp" | "keyhole" | "satellite";
/** details lit by the stair lamps' warm pools */
const POOLED: Detail[] = ["stair", "column", "post", "strata"];
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
 * Where the two stairs' treads cross the newel, so the newel can darken above and below each one.
 * Filled in by getAssets, read when the column's program is compiled on the first frame.
 */
const hxStairs = { offMain: 0, offTwin: 0, endMain: 0, endTwin: 0 };
/** the two lamps that flank the door, in world space; filled in by getAssets, they light the arch */
const hxLamps = { value: [new Vector3(), new Vector3()] };

// The keyhole arch's carving, in the stele's own coordinates (x across, y up from the landing).
const KH_YJ = DOOR_CY - Math.sqrt(DOOR_R * DOOR_R - DOOR_A * DOOR_A); // where the jambs meet the circle
const KH_SPRING = Math.atan2(DOOR_A, KH_YJ - DOOR_CY); // the springer joint's angle from straight up
const KH_VOUSS = (2 * KH_SPRING) / 19; // nineteen voussoirs, the keystone in the middle
const KH_COURSE = KH_YJ / 4; // four courses up each jamb

const THETA0 = -FLARE - TURNS * TAU;
const PITCH = SLOPE * TAU * R0;
function stairAoGlsl(): string {
  return /* glsl */ `
    /** occlusion from one turn of one stair at height y; s is plan length along it */
    float hxSlabAO(float y, float s, float off, float yOff, float sEnd) {
      if (s < 0.0 || s > sEnd) return 1.0;
      float top = ${glf(SLOPE)} * (off + (floor((s - off) / ${glf(TREAD)}) + 1.0) * ${glf(TREAD)}) + yOff;
      float a = y - top;
      float b = top - ${glf(THICK)} - y;
      return a > 0.0 ? mix(0.3, 1.0, smoothstep(0.0, 1.5, a)) : b > 0.0 ? mix(0.32, 1.0, smoothstep(0.0, 2.0, b)) : 0.3;
    }
    float hxStairAO(vec3 w) {
      float phi = atan(w.z, w.x);
      float lin = ${glf(SLOPE * R0)} * (phi - ${glf(THETA0)});
      float ao = 1.0;
      for (int k = 0; k < 2; k++) {
        float yOff = k == 0 ? 0.0 : ${glf(PITCH / 2)};
        float off = k == 0 ? ${glf(hxStairs.offMain)} : ${glf(hxStairs.offTwin)};
        float sEnd = k == 0 ? ${glf(R0 * TURNS * TAU)} : ${glf(hxStairs.endTwin)};
        float n = floor((w.y - yOff - lin) / ${glf(PITCH)});
        for (int j = 0; j < 2; j++) {
          float th = phi + (n + float(j)) * ${glf(TAU)};
          ao *= hxSlabAO(w.y, ${glf(R0)} * (th - ${glf(THETA0)}), off, yOff, sEnd);
        }
      }
      return ao;
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
  // rods. vTile.z says which face: 1 tread, 2 riser, 3 soffit, 4 back, 5 end.
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
        float vm = v * 1.37;                                   // metres back from the nose
        float nose = max(0.0, 1.0 - vm / 0.1);
        hxH -= 0.06 * nose * nose;                             // the bullnose rolls over
        stone *= 1.0 + 0.1 * hxBand(vm, 0.04, 0.12, wpx);       // worn bright lip
        ao *= mix(0.55, 1.0, smoothstep(1.37, 1.05, vm));       // where the next riser rises
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
      ao *= mix(0.45, 1.0, smoothstep(3.0, 4.9, length(vHxW.xz)));   // where it meets the newel
      for (int i = 0; i < ${POOL_N}; i++) {                     // a soft shadow round each lamp's foot
        vec4 L = uHxPool[i];
        if (L.w <= 0.0) break;
        vec3 f = vHxW - L.xyz + vec3(0.0, ${glf(LAMP_Y)}, 0.0);
        float blob = 1.0 - smoothstep(0.12, 0.62, length(f.xz));
        ao *= 1.0 - 0.6 * blob * blob * step(abs(f.y), 0.02 + 0.98 * step(4.5, kind)) * step(f.y, 0.03);
      }
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
      float ga = (fract((phi + p.y * 0.2) * ${glf(4 / TAU)}) - 0.5) * ${glf(TAU)}; // 0 in a groove
      float dg = ga * 0.68;                               // metres across the groove
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
        float bx = phi * ${glf(18 / TAU)} + 0.5 * mod(row, 2.0);
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
  // the stair lamps' glass: a white-hot core seen through warm amber glass that darkens toward the
  // limb, with a thin bright rim where the glass turns away, so bloom keeps a round silhouette
  lamp: /* glsl */ `
    {
      float ndv = clamp(abs(dot(normalize(vHxN), normalize(cameraPosition - vHxW))), 0.0, 1.0);
      float core = pow(ndv, 14.0);
      vec3 glass = mix(vec3(0.22, 0.06, 0.01), vec3(0.72, 0.3, 0.07), smoothstep(0.0, 0.9, ndv));
      diffuseColor.rgb = glass + vec3(2.4, 1.5, 0.75) * core + vec3(0.5, 0.22, 0.06) * pow(1.0 - ndv, 8.0);
    }`,
  // the hanging stairs: the same sandstone, cooler and bluer the further off they hang
  satellite: /* glsl */ `
    diffuseColor.rgb *= vec3(1.04, 0.93, 0.8) * (0.93 + 0.07 * sin(vHxW.y * 2.6 + sin(vHxW.x * 0.7 + vHxW.z * 0.9) * 1.5));
    {
      // the treads survive only as faint joints across the smooth ramp
      float st = atan(vHxL.z, vHxL.x) * ${glf(24 / TAU)};
      float sw = fwidth(st) + 1e-4;
      float jd = abs(fract(st) - 0.5);
      diffuseColor.rgb *= 1.0 - 0.38 * smoothstep(0.5 - 0.06 - sw, 0.5 - 0.06 + sw, jd) * smoothstep(1.0, 0.25, sw * 8.0);
    }`,
};

/** the stair lamps' warm pools: inverse-square with a soft wrap, after the carved normal is known */
const poolGlsl = (detail: Detail) => /* glsl */ `
          {
            vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float acc = 0.0;
            for (int i = 0; i < ${POOL_N}; i++) {
              vec4 L = uHxPool[i];
              if (L.w <= 0.0) break;
              vec3 l = L.xyz - vHxW;
              ${detail === "post" ? "if (dot(l.xz, l.xz) < 0.06) continue; // a lamp's own post stays in its glass's shade" : ""}
              float d2 = dot(l, l);
              float wrap = clamp((dot(nw, l * inversesqrt(d2)) + 0.35) / 1.35, 0.0, 1.0);
              float win = clamp(1.0 - d2 / 18.0, 0.0, 1.0);   // gone within a couple of treads
              acc += L.w * wrap * win * win / (1.0 + d2);
            }
            hxGlow += diffuseColor.rgb * vec3(1.0, 0.56, 0.24) * 9.0 * acc;
          }`;

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

/**
 * The arcade's haze: tiers further off, and further above or below the eye, sink into the void's
 * teal, so the near arches stay warm and crisp while the middle and far shaft fall away by value.
 */
const WALL_HAZE_GLSL = /* glsl */ `
        {
          vec3 hv = vHxW - cameraPosition;
          float hk = smoothstep(32.0, 85.0, length(hv)) * 0.55 + smoothstep(4.0, 40.0, abs(hv.y)) * 0.5;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, ${VOID_TEAL}, clamp(hk, 0.0, 0.9));
        }`;

/**
 * The hanging stairs are veiled in mist: cooler with distance, and wherever the surface turns away
 * from the eye it thins into the void, so they read as soft spirals rather than solid shapes.
 */
const SATELLITE_VEIL_GLSL = /* glsl */ `
        {
          vec3 sv = vHxW - cameraPosition;
          float sd = length(sv);
          vec3 sdir = sv / sd;
          float far = smoothstep(12.0, 110.0, sd);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.3, 0.78, 0.86) + vec3(0.0, 0.035, 0.045), far * 0.75);
          float edge = 1.0 - abs(dot(normalize(vHxN), sdir));
          float veil = clamp(0.5 + 0.35 * far + 0.6 * edge * edge, 0.0, 0.93);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(hxSky(sdir), ${VOID_TEAL} * 1.6, 0.7), veil);
        }`;

function withVoidFog<T extends Material>(mat: T, detail: Detail = "plain"): T {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uHxT = hxTime;
    s.uniforms.uHxLamp = hxLamps;
    s.uniforms.uHxPool = hxPool;
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
        uniform vec4 uHxPool[${POOL_N}];
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
          }` + (detail === "keyhole" ? KEYHOLE_LAMPS_GLSL : "") + (POOLED.includes(detail) ? poolGlsl(detail) : "")
          : "#include <normal_fragment_maps>" + (POOLED.includes(detail) ? poolGlsl(detail) : ""),
      )
      .replace(
        "#include <tonemapping_fragment>",
        /* glsl */ `
        gl_FragColor.rgb += hxGlow;
        ${detail === "satellite" ? SATELLITE_VEIL_GLSL : ""}
        ${detail === "wall" ? WALL_HAZE_GLSL : ""}
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
  path: PathTable;
  track: CameraTrack;
  stairs: BufferGeometry;
  rails: BufferGeometry;
  column: BufferGeometry;
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
  postMat: MeshLambertMaterial;
  post: BufferGeometry;
  postM: Float32Array;
  lampNear: BufferGeometry;
  lampFar: BufferGeometry;
  globeNear: BufferGeometry;
  globeFar: BufferGeometry;
  /** feet of the stair lamps' posts, xyz */
  lamps: Float32Array;
  satMat: MeshLambertMaterial;
  lampMat: MeshBasicMaterial;
  wallMat: MeshLambertMaterial;
  stairMat: MeshLambertMaterial;
  koi: Koi;
  shafts: BufferGeometry;
  shaftMat: ShaderMaterial;
  glow: MeshBasicMaterial;
  skyMat: ShaderMaterial;
  pointsMat: ShaderMaterial;
  balusterM: Float32Array;
  lanternM: Float32Array;
  wallM: Float32Array;
  satellites: Satellite[];
  doorPos: Vector3;
  doorYaw: number;
}

/**
 * Broad shafts of amber light slanting down across the shaft from high arcade openings. Each runs
 * along a chord of the shaft that stays SHAFT_OFF from the axis, well outside the stair and the
 * landing, so the camera never flies through one; the koi swim through them.
 * [azimuth of the chord's nearest point, height where it leaves the wall above HEND, slope]
 */
const SHAFTS: [number, number, number][] = [
  [0.35, 38, 0.62],
  [2.35, 14, 0.55],
  [4.1, 30, 0.66],
  [5.35, -6, 0.58],
];
const SHAFT_OFF = 22;
const SHAFT_R0 = 1.5; // radius where it enters
const SHAFT_R1 = 3.6; // radius where it dies out across the shaft
interface Shaft { a: Vector3; dir: Vector3; len: number }
function shaftLines(hend: number): Shaft[] {
  const half = Math.sqrt(36 * 36 - SHAFT_OFF * SHAFT_OFF);
  return SHAFTS.map(([phi, top, slope]) => {
    const cx = SHAFT_OFF * Math.cos(phi), cz = SHAFT_OFF * Math.sin(phi);
    const ux = -Math.sin(phi), uz = Math.cos(phi);
    const drop = 2 * half * slope;
    const a = new Vector3(cx - ux * half, hend + top, cz - uz * half);
    const b = new Vector3(cx + ux * half, hend + top - drop, cz + uz * half);
    const dir = b.clone().sub(a);
    const len = dir.length();
    return { a, dir: dir.normalize(), len };
  });
}
function shaftGeometry(shafts: Shaft[]): BufferGeometry {
  // a flared open tube per shaft; aShaft = (fraction along, radius), position in world space
  const SEG = 28, ROWS = 6;
  const pos: number[] = [], nor: number[] = [], sh: number[] = [], idx: number[] = [];
  const side = new Vector3(), up = new Vector3();
  for (const { a, dir, len } of shafts) {
    side.set(0, 1, 0).cross(dir).normalize();
    up.copy(dir).cross(side).normalize();
    const base = pos.length / 3;
    for (let j = 0; j <= ROWS; j++) {
      const u = j / ROWS;
      const r = SHAFT_R0 + (SHAFT_R1 - SHAFT_R0) * u;
      for (let i = 0; i <= SEG; i++) {
        const th = (i / SEG) * TAU;
        const c = Math.cos(th), s = Math.sin(th);
        const nx = side.x * c + up.x * s, ny = side.y * c + up.y * s, nz = side.z * c + up.z * s;
        pos.push(a.x + dir.x * len * u + nx * r, a.y + dir.y * len * u + ny * r, a.z + dir.z * len * u + nz * r);
        nor.push(nx, ny, nz);
        sh.push(u, r);
        if (j < ROWS && i < SEG) {
          const p0 = base + j * (SEG + 1) + i, p1 = p0 + SEG + 1;
          idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("aShaft", new BufferAttribute(new Float32Array(sh), 2));
  g.setIndex(idx);
  return g;
}
function shaftMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uT: hxTime },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec2 aShaft;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vS;
      void main() {
        vW = position;
        vN = normal;
        vS = aShaft;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vS;
      float sHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float sNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y),
          f.z);
      }
      void main() {
        vec3 v = cameraPosition - vW;
        float d = length(v);
        // the tube's silhouette is its edge: light thickest through the middle, gone at the rim
        float through = abs(dot(normalize(vN), v / d));
        float body = through * through * (3.0 - 2.0 * through);
        float ends = smoothstep(0.0, 0.18, vS.x) * (1.0 - smoothstep(0.55, 1.0, vS.x));
        float fog = 1.0 - 0.85 * smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, d);
        float k = body * ends * fog * (1.6 / vS.y);
        // slow dust, drifting down the beam and sinking
        vec3 q = vW * 2.4 + vec3(0.0, uT * 0.45, 0.0);
        float n = sNoise(q) * 0.8 + sNoise(q * 1.9 + 17.0) * 0.2;
        float mote = smoothstep(0.66, 0.9, n) * (1.0 - smoothstep(30.0, 70.0, d));
        float haze = 0.7 + 0.6 * sNoise(vW * 0.16 + vec3(0.0, uT * 0.07, 0.0));
        vec3 col = vec3(1.0, 0.6, 0.26) * k * (0.17 * haze + 0.09 * mote) * 2.2;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
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

function getAssets(): Assets {
  if (cache) return cache;
  const mainPath = buildPath(true);
  const twinPath = buildPath(false);
  const rand = rng(1987);
  const P = new Vector3();
  const T = new Vector3();
  const dummy = new Object3D();

  const sq = new Quads();
  const balusters: number[] = [];
  const posts: number[] = [];
  const lanterns: number[] = [];
  const lanternPos: number[] = [];
  const haloSize: number[] = [];
  const lamps: number[] = [];
  const rp: number[] = [], rn: number[] = [], rc: number[] = [], ri: number[] = [];
  const RING = 16;
  let HEND = 0;

  const addStair = (path: PathTable, yOff: number, main: boolean) => {
  const END = path.end;
  const halfW = (s: number) => 2.5 + 1.0 * smooth(END - 15, END - 2, s);
  const innerW = (s: number) => halfW(s) + 0.7 * (1 - smooth(0.05, 0.4, pathFlare(path, s)));
  const edge = (s: number, side: number, y: number, inset = 0): V3 => {
    pathAt(path, s, P);
    pathTangent(path, s, T);
    const w = side > 0 ? halfW(s) - inset : -(innerW(s) - inset);
    return [P.x + T.z * w, y, P.z - T.x * w];
  };
  const heightAt = (s: number) => pathAt(path, s, P).y + yOff;

  // ---- stairs: one slab per tread ----
  const nSteps = Math.floor(END / TREAD);
  const stepStart = (i: number) => END - (nSteps - i) * TREAD;
  const pushBaluster = (v: V3, height: number) => {
    dummy.position.set(v[0], v[1], v[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    balusters.push(...dummy.matrix.elements);
  };
  /** a turned lamp post, POST_H tall, standing at v */
  const pushPost = (v: V3, size = 1) => {
    dummy.position.set(v[0], v[1], v[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(size, 1, size);
    dummy.updateMatrix();
    posts.push(...dummy.matrix.elements);
  };
  const pushLantern = (x: number, y: number, z: number, size: number) => {
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    lanterns.push(...dummy.matrix.elements);
    lanternPos.push(x, y, z);
    haloSize.push(3.4);
  };
  for (let i = 0; i <= nSteps; i++) {
    const s0 = i === nSteps ? END : stepStart(i);
    const s1 = i === nSteps ? END + 1.1 : s0 + TREAD;
    const top = heightAt(Math.min(s1, END));
    const bot = top - THICK;
    const nose = i === nSteps ? 0 : 0.12;
    const i0 = edge(s0 - nose, -1, top), o0 = edge(s0 - nose, 1, top);
    const i1 = edge(s1, -1, top), o1 = edge(s1, 1, top);
    const lo = (v: V3): V3 => [v[0], bot, v[2]];
    const ctr: V3 = [(i0[0] + o1[0]) / 2, top - THICK / 2, (i0[2] + o1[2]) / 2];
    const warm = 0.9 + 0.1 * rand();
    const tone: V3 = [IVORY[0] * warm, IVORY[1] * warm, IVORY[2] * warm];
    const wi0 = -innerW(s0 - nose), wo0 = halfW(s0 - nose), wi1 = -innerW(s1), wo1 = halfW(s1);
    sq.quad(i0, o0, o1, i1, ctr, tone, 0.5, 1, 1, 0.5, [[wi0, 0, 1], [wo0, 0, 1], [wo1, 1, 1], [wi1, 1, 1]]); // tread
    sq.quad(i0, o0, lo(o0), lo(i0), ctr, SAND, 0.7, 1.1, 0.95, 0.6, [[wi0, 0, 2], [wo0, 0, 2], [wo0, 1, 2], [wi0, 1, 2]]); // riser
    sq.quad(i1, o1, lo(o1), lo(i1), ctr, SAND, 0.6, 1.1, 0.8, 0.45, [[wi1, 0, 4], [wo1, 0, 4], [wo1, 1, 4], [wi1, 1, 4]]); // back
    sq.quad(o0, o1, lo(o1), lo(o0), ctr, SAND, 1, 1, 0.8, 0.8, [[0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5]]); // outer end
    sq.quad(i0, i1, lo(i1), lo(i0), ctr, SAND, 0.6, 0.6, 0.5, 0.5, [[0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5]]); // inner end
    sq.quad(lo(i0), lo(o0), lo(o1), lo(i1), ctr, tone, 0.7, 1.15, 1.05, 0.6, [[wi0, 0, 3], [wo0, 0, 3], [wo1, 1, 3], [wi1, 1, 3]]); // soffit
    if (i === nSteps) continue;
    const sm = s0 + TREAD / 2;
    const post = i % 6 === (main ? 3 : 0) && sm < END - 6;
    pushBaluster(edge(sm, 1, top, 0.22), RAIL_Y - 0.05 + (heightAt(sm) - top));
    if (post) {
      // the lamp stands on a console beyond the slab's end, outside the rail
      const e = edge(sm, 1, top, -LAMP_OUT);
      lamps.push(e[0], e[1], e[2]);
      lanternPos.push(e[0], e[1] + LAMP_Y, e[2]);
      haloSize.push(1.5);
    }
    if (pathFlare(path, sm) > 0.3) pushBaluster(edge(sm, -1, top, 0.22), RAIL_Y - 0.05 + (heightAt(sm) - top));
  }
  // two lanterns flank the door
  if (main) {
    for (const side of [-1, 1]) {
      const e = edge(END - 1.6, side, heightAt(END) + 2.5, 0.22);
      pushPost([e[0], heightAt(END), e[2]], 1.1);
      pushLantern(e[0], e[1], e[2], 1.15);
      hxLamps.value[side < 0 ? 0 : 1]!.set(e[0], e[1], e[2]);
    }
    HEND = heightAt(END);
    hxStairs.endMain = END;
    hxStairs.offMain = END - nSteps * TREAD;
  } else {
    hxStairs.endTwin = END;
    hxStairs.offTwin = END - nSteps * TREAD;
  }

  // ---- hand rails: swept tubes ----
  const sweep = (from: number, to: number, side: number) => {
    const base = rp.length / 3;
    const steps = Math.ceil((to - from) / 0.3);
    for (let k = 0; k <= steps; k++) {
      const s = from + ((to - from) * k) / steps;
      const c = edge(s, side, heightAt(s) + RAIL_Y, 0.22);
      pathTangent(path, s, T);
      for (let q = 0; q < RING; q++) {
        const a = (q / RING) * TAU;
        const cx = Math.cos(a), cy = Math.sin(a);
        rp.push(c[0] + T.z * cx * RAIL_R, c[1] + cy * RAIL_R, c[2] - T.x * cx * RAIL_R);
        rn.push(T.z * cx, cy, -T.x * cx);
        rc.push(BRONZE[0], BRONZE[1], BRONZE[2]);
      }
      if (k < steps) {
        for (let q = 0; q < RING; q++) {
          const a0 = base + k * RING + q, a1 = base + k * RING + ((q + 1) % RING);
          ri.push(a0, a1, a0 + RING, a1, a1 + RING, a0 + RING); // wound outward, so the near side is the one drawn
        }
      }
    }
  };
  sweep(0, END - 0.9, 1);
  if (main) {
    let flareStart = 0;
    while (pathFlare(path, flareStart) < 0.3) flareStart += TREAD;
    sweep(flareStart, END - 0.9, -1);
  }
  };
  addStair(mainPath, 0, true);
  addStair(twinPath, SLOPE * Math.PI * R0, false); // half a pitch higher: a double helix
  const path = mainPath;
  const END = path.end;
  const stairs = sq.build();
  const rails = new BufferGeometry();
  rails.setAttribute("position", new BufferAttribute(new Float32Array(rp), 3));
  rails.setAttribute("normal", new BufferAttribute(new Float32Array(rn), 3));
  rails.setAttribute("color", new BufferAttribute(new Float32Array(rc), 3));
  rails.setIndex(ri);

  // ---- central column: a solomonic (barley-sugar) shaft, wound against the stair ----
  const colY0 = HEND - 160, colY1 = HEND + 150;
  const CS = 112, CR = Math.ceil((colY1 - colY0) / 0.75);
  const LOBES = 4, TWIST = 0.2, DEPTH = 0.4;
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
  const column = new BufferGeometry();
  column.setAttribute("position", new BufferAttribute(cp, 3));
  column.setAttribute("normal", new BufferAttribute(cn, 3));
  column.setAttribute("color", new BufferAttribute(cc, 3));
  column.setIndex(ci);

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
    const y0 = HEND - 150, y1 = HEND + 120;
    const k0 = Math.floor((y0 / Math.abs(WALL_PITCH)) * WALL_N), k1 = Math.ceil((y1 / Math.abs(WALL_PITCH)) * WALL_N);
    for (let k = k0; k <= k1; k++) {
      const psi = -(k / WALL_N) * TAU; // wallC < 0, so height grows with k
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

  // ---- satellite staircase: a smooth spiral ramp round a round core, instanced at wrong angles ----
  // No treads: at their distance the steps only made a saw-tooth edge. The ramp's section is a
  // rounded slab swept along the helix with smooth normals, so the mist can thin it at its rims.
  const satellite = (() => {
    const N = 48, turns = 9, pitch = 13.5;
    const half = (turns * pitch) / 2;
    // the slab's section: [radius, height below the walking surface, shade]
    const sect: [number, number, number][] = [];
    const RIN = 2.3, ROUT = 7.6, TH = 0.7, RND = 0.33;
    for (let k = 0; k <= 4; k++) {
      const a = (k / 4) * (Math.PI / 2);
      sect.push([ROUT - RND + RND * Math.sin(a), -RND + RND * Math.cos(a), 1]);
    }
    for (let k = 0; k <= 4; k++) {
      const a = Math.PI / 2 + (k / 4) * (Math.PI / 2);
      sect.push([ROUT - RND + RND * Math.sin(a), -(TH - RND) + RND * Math.cos(a), 0.62]);
    }
    sect.push([RIN, -TH, 0.5]);
    sect.push([RIN, 0, 0.75]);
    const M = sect.length;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const rows = N * turns;
    for (let i = 0; i <= rows; i++) {
      const th = (i / N) * TAU;
      const y0 = -half + (i / N) * pitch;
      const c = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k <= M; k++) {
        const [r, dy, sh] = sect[k % M]!;
        pos.push(r * c, y0 + dy, r * sn);
        const tone = k === 0 || k === M || k === M - 1 ? IVORY : SAND;
        col.push(tone[0] * sh, tone[1] * sh, tone[2] * sh);
        if (i < rows && k < M) {
          const p0 = i * (M + 1) + k, p1 = p0 + M + 1;
          idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
        }
      }
    }
    // the core: a plain round shaft through the middle
    const base = pos.length / 3;
    const CN = 32;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= CN; i++) {
        const th = (i / CN) * TAU;
        pos.push(2.4 * Math.cos(th), (j ? 1 : -1) * (half + 14), 2.4 * Math.sin(th));
        col.push(IVORY[0] * 0.85, IVORY[1] * 0.85, IVORY[2] * 0.85);
        if (j === 0 && i < CN) idx.push(base + i, base + CN + 1 + i, base + i + 1, base + i + 1, base + CN + 1 + i, base + CN + 2 + i);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const sat = (x: number, dy: number, z: number, rx: number, rz: number, scale: number, spin: number): Satellite => ({
    pos: new Vector3(x, HEND + dy, z),
    tilt: new Quaternion().setFromEuler(new Euler(rx, 0, rz)),
    scale,
    spin,
    phase: rand() * TAU,
  });
  const satellites = [
    sat(-17, -11, -20, 1.3, 0.1, 0.55, 0.16), // hangs beside the fly-in
    sat(8, -52, -25, 0.2, 1.2, 0.5, -0.14),
    sat(14, 27, 27, 0.15, Math.PI / 2 - 0.12, 0.5, 0.18),
    sat(74, 6, 44, 0.5, 0.45, 1.5, -0.07),
    sat(-82, 26, -48, 0.2, -0.95, 1.7, 0.06),
    sat(28, 44, 96, -1.0, 0.2, 1.4, 0.08),
    sat(-54, -34, 84, 0.45, 0.75, 1.3, -0.09),
    sat(96, -24, -58, 1.2, -0.2, 1.6, 0.07),
    sat(-18, 58, -98, 0.1, 1.4, 1.5, -0.06),
    sat(-70, -60, -10, -0.7, 0.5, 1.2, 0.08),
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
  pathAt(path, END, P);
  pathTangent(path, END, T);
  const doorPos = P.clone();
  const doorYaw = Math.atan2(-T.x, -T.z);

  // ---- points: wall lamps, lantern halos, drifting motes ----
  // aPulse: rate and depth of a slow breath, and how much the arcade's haze takes the light
  const pp: number[] = [], ps: number[] = [], pa: number[] = [], pu: number[] = [];
  const orbRand = rng(311);
  for (let i = 0; i < wallLamps.length; i += 3) {
    const phase = rand() * TAU; // drawn even for dropped orbs, so the motes below keep their places
    // about a third of the openings stay dark; the rest differ in size and strength
    if (orbRand() < 0.34) continue;
    const big = orbRand();
    pp.push(wallLamps[i]!, wallLamps[i + 1]!, wallLamps[i + 2]!);
    ps.push(3.2 + 4.2 * big * big);
    pa.push(0, 0, phase, 0.3 + 0.75 * orbRand());
    pu.push(0.18 + 0.32 * orbRand(), 0.55, 1);
  }
  for (let i = 0; i < lanternPos.length; i += 3) {
    pp.push(lanternPos[i]!, lanternPos[i + 1]!, lanternPos[i + 2]!);
    ps.push(haloSize[i / 3]!);
    pa.push(0, 0, rand() * TAU, 0.55);
    pu.push(1.7, 0.3, 0);
  }
  for (let i = 0; i < 520; i++) {
    const r = 4 + 32 * Math.sqrt(rand());
    const a = rand() * TAU;
    pp.push(r * Math.cos(a), HEND - 70 + rand() * 110, r * Math.sin(a));
    ps.push(0.18 + rand() * 0.3);
    pa.push(0.25 + rand() * 0.8, (rand() - 0.5) * 0.03, rand() * TAU, 1.2);
    pu.push(1.7, 0.3, 0);
  }
  const points = new BufferGeometry();
  points.setAttribute("position", new BufferAttribute(new Float32Array(pp), 3));
  points.setAttribute("aSize", new BufferAttribute(new Float32Array(ps), 1));
  points.setAttribute("aAnim", new BufferAttribute(new Float32Array(pa), 4));
  points.setAttribute("aPulse", new BufferAttribute(new Float32Array(pu), 3));

  // ---- materials ----
  const stone = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "strata");
  const wallMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "wall");
  const stairMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "stair");
  const columnMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "column");
  const satMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "satellite");
  const lampMat = withVoidFog(new MeshBasicMaterial({ color: new Color(1, 1, 1) }), "lamp");
  const postMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "post");
  const keyholeMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "keyhole");
  // between the stair's flare and the arcade, from far below the camera's start to above the door
  const shafts = shaftLines(HEND);
  const koi = createKoi({
    count: 84, rMin: 18.5, rMax: 33, yMid: HEND - 22, yRange: 150, fogNear: FOG_NEAR, fogFar: FOG_FAR, skyGlsl: SKY_GLSL,
    shafts: shafts.map(({ a, dir, len }) => ({ a, dir, len, r0: SHAFT_R0, r1: SHAFT_R1 })),
  });
  const glow = withVoidFog(new MeshBasicMaterial({ color: new Color(1.35, 0.6, 0.16) }), "globe");
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
      attribute vec3 aPulse;
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
          * smoothstep(0.6, 3.0, d) * (1.0 - aPulse.y + aPulse.y * (0.5 + 0.5 * sin(uT * aPulse.x + aAnim.z)));
        // the arcade's orbs sink into the same haze as the stone around them
        vec3 hv = p - cameraPosition;
        vA *= 1.0 - aPulse.z * clamp(smoothstep(32.0, 85.0, length(hv)) * 0.55 + smoothstep(4.0, 40.0, abs(hv.y)) * 0.5, 0.0, 0.9);
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
    path, track: buildCameraTrack(path), stairs, rails, column, wall, satellite,
    baluster: lathe(BALUSTER_PROFILE, 7),
    post: lathe(POST_PROFILE, 20),
    lampNear: turned(LAMP_PIECES, 48),
    lampFar: turned(LAMP_PIECES, 12, 0.3),
    globeNear: new SphereGeometry(GLOBE_R, 48, 28),
    globeFar: new SphereGeometry(GLOBE_R, 18, 10),
    lamps: new Float32Array(lamps),
    satMat, lampMat,
    lantern: new SphereGeometry(0.22, 28, 16),
    sky: new SphereGeometry(1200, 24, 16),
    points, doorFrame, doorBack, doorPortal,
    stone, keyholeMat, columnMat, postMat, wallMat, stairMat, koi, glow, skyMat, pointsMat,
    shafts: shaftGeometry(shafts), shaftMat: shaftMaterial(),
    balusterM: new Float32Array(balusters),
    postM: new Float32Array(posts),
    lanternM: new Float32Array(lanterns),
    wallM: new Float32Array(wallM),
    satellites, doorPos, doorYaw,
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

export default function Helix({ clock, camera, portalMaterial }: SceneProps) {
  const rig = useMemo(() => {
    const A = getAssets();
    const root = new Group();
    const sky = new Mesh(A.sky, A.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    const column = new Mesh(A.column, A.columnMat);
    const stairs = new Mesh(A.stairs, A.stairMat);
    const rails = new Mesh(A.rails, A.stone);
    const balusters = instanced(A.baluster, A.postMat, A.balusterM);
    const postMesh = instanced(A.post, A.postMat, A.postM);
    const lanterns = instanced(A.lantern, A.glow, A.lanternM);
    const wall = instanced(A.wall, A.wallMat, A.wallM);
    const sats = new InstancedMesh(A.satellite, A.satMat, A.satellites.length);
    const nLamps = A.lamps.length / 3;
    const lampMesh = (geo: BufferGeometry, mat: Material, n: number) => {
      const m = new InstancedMesh(geo, mat, n);
      m.frustumCulled = false;
      return m;
    };
    const postNear = lampMesh(A.lampNear, A.postMat, LAMP_NEAR);
    const postFar = lampMesh(A.lampFar, A.postMat, nLamps);
    const globeNear = lampMesh(A.globeNear, A.lampMat, LAMP_NEAR);
    const globeFar = lampMesh(A.globeFar, A.lampMat, nLamps);
    sats.frustumCulled = false;
    const points = new Points(A.points, A.pointsMat);
    points.frustumCulled = false;
    const door = new Group();
    door.position.copy(A.doorPos);
    door.rotation.y = A.doorYaw;
    const portal = new Mesh(A.doorPortal, portalMaterial);
    const doorBack = new Mesh(A.doorBack, A.keyholeMat);
    doorBack.renderOrder = 1; // after the portal, so the depth test spares the carving behind it
    door.add(new Mesh(A.doorFrame, A.keyholeMat), doorBack, portal);
    root.add(sky, column, stairs, rails, balusters, postMesh, lanterns, wall, sats, A.koi.mesh, points, door);
    root.add(postNear, postFar, globeNear, globeFar);
    const shafts = new Mesh(A.shafts, A.shaftMat);
    shafts.frustumCulled = false;
    shafts.renderOrder = 5; // after the koi and the stone, which it lies over
    root.add(shafts);
    const lampOrder = Array.from({ length: nLamps }, (_, i) => i);
    const lampD2 = new Float32Array(nLamps);
    return {
      A, root, sky, column, sats, postNear, postFar, globeNear, globeFar, lampOrder, lampD2,
      instancedMeshes: [balusters, postMesh, lanterns, wall, sats, postNear, postFar, globeNear, globeFar],
    };
  }, [portalMaterial]);

  useEffect(() => () => rig.instancedMeshes.forEach((m) => m.dispose()), [rig]);

  const tmp = useMemo(
    () => ({ pos: new Vector3(), tan: new Vector3(), look: new Vector3(), q: new Quaternion(), o: new Object3D(), fwd: new Vector3() }),
    [],
  );

  useFrame((state) => {
    const { A, sky, column, sats, lampOrder, lampD2 } = rig;
    const { path } = A.track;
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    const { pos, tan, look, q, o, fwd } = tmp;

    // --- camera: in from the void, a glide up the stair, then straight into the keyhole ---
    const s = trackS(A.track, t);
    const settle = smooth(path.end - 28, path.end - 6.5, s); // 0 on the helix, 1 on the final approach
    pathAt(path, s, pos);
    pos.y += EYE + EYE_RISE * smooth(path.end - 25, path.end - 6.5, s);
    pathTangent(path, s, tan);
    const side = 0.7 * (1 - settle);
    pos.x += tan.z * side;
    pos.z -= tan.x * side;
    pathTangent(path, s + 1.6, tan);
    const out = 0.0 * (1 - settle);
    // on the fly-in the eye points exactly where the camera is going, i.e. up the stair's slope
    const freed = smooth(RAIL.release, RAIL.release + 4, t);
    const sway = freed * (1 - settle); // the idle drift stops for both seams
    const up = (SLOPE + (0.24 - SLOPE) * freed) * (1 - settle) + 0.02 * Math.sin(t * 0.45) * sway;
    look.set(pos.x + (tan.x + tan.z * out) * 10, pos.y + up * 10, pos.z + (tan.z - tan.x * out) * 10);
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.rotateZ(-0.055 * (1 - settle) + 0.012 * Math.sin(t * 0.37 + 1) * sway);
    camera.fov = 72 - 8 * settle;

    // --- the world turns ---
    sky.position.copy(pos);
    column.rotation.y = -t * 0.035;
    for (let i = 0; i < A.satellites.length; i++) {
      const d = A.satellites[i]!;
      q.setFromAxisAngle(Y_AXIS, d.phase + t * d.spin);
      o.position.copy(d.pos);
      o.quaternion.copy(d.tilt).multiply(q);
      o.scale.setScalar(d.scale);
      o.updateMatrix();
      sats.setMatrixAt(i, o.matrix);
    }
    sats.instanceMatrix.needsUpdate = true;

    // --- the stair lamps: the nearest light the stone and are drawn finely ---
    const L = A.lamps;
    for (let i = 0; i < lampD2.length; i++) {
      const dx = L[i * 3]! - pos.x, dy = L[i * 3 + 1]! + LAMP_Y - pos.y, dz = L[i * 3 + 2]! - pos.z;
      lampD2[i] = dx * dx + dy * dy + dz * dz;
    }
    lampOrder.sort((a, b) => lampD2[a]! - lampD2[b]!);
    for (let k = 0; k < POOL_N; k++) {
      const i = lampOrder[k];
      const v = hxPool.value[k]!;
      if (i === undefined) v.set(0, 0, 0, 0);
      else v.set(L[i * 3]!, L[i * 3 + 1]! + LAMP_Y, L[i * 3 + 2]!, 1 - smooth(11, 16, Math.sqrt(lampD2[i]!)));
    }
    const put = (m: InstancedMesh, slot: number, i: number, lift: number, show: boolean) => {
      const a = m.instanceMatrix.array as Float32Array;
      const o = slot * 16;
      const k = show ? 1 : 0;
      a.fill(0, o, o + 16);
      a[o] = a[o + 5] = a[o + 10] = k;
      a[o + 12] = L[i * 3]! * k;
      a[o + 13] = (L[i * 3 + 1]! + lift) * k;
      a[o + 14] = L[i * 3 + 2]! * k;
      a[o + 15] = 1;
    };
    for (let k = 0; k < lampOrder.length; k++) {
      const i = lampOrder[k]!;
      const near = k < LAMP_NEAR;
      if (near) {
        put(rig.postNear, k, i, 0, true);
        put(rig.globeNear, k, i, LAMP_Y, true);
      }
      put(rig.postFar, i, i, 0, !near);
      put(rig.globeFar, i, i, LAMP_Y, !near);
    }
    for (const m of [rig.postNear, rig.postFar, rig.globeNear, rig.globeFar]) m.instanceMatrix.needsUpdate = true;
    hxTime.value = t;
    A.koi.update(t, pos, fwd.subVectors(look, pos).normalize());
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
