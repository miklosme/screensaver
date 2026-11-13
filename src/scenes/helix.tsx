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
  type Material,
} from "three";
import { TIMING, type SceneProps } from "./types";
import { createFrame, lookTowards, season, type Stretch } from "./rail";
import { createKoi, type Koi } from "./helix/koi";

/**
 * HELIX — the endless staircase, on spring's stretch of the rail (rail.ts).
 *
 * A cantilevered sandstone stair winds around a slowly turning fluted column inside a vast shaft
 * whose wall is itself a counter-wound helical arcade. Other staircases hang in the teal void at
 * wrong angles, each rotating about its own axis so it seems to climb forever.
 *
 * Spring is a run-up, a turn and an eighth to the right on a helix, and an S out of it. The helix
 * IS the stair's: the camera flies in through open air with the whole tower ahead of it, comes
 * down onto the treads from outside the balustrade and climbs. Where the rail leaves the helix
 * the stair leaves the column with it, still climbing, as a bridge that sweeps back to the left,
 * crests where the rail levels out and steps down to a thin keyhole stele: the exit portal. The
 * twin stair, half a turn round, goes on up the column, so the stair never ends.
 *
 * Everything is laid out in TOWER coordinates: the rail's local frame shifted so that the column's
 * axis is x = z = 0. The stone shaders, the koi and the motes measure their angles from that axis.
 */

// ---------------------------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const R0 = 5.5; // centre-line radius of the stair around the column
const SIDE = 0.7; // on the helix the camera rides this far outside the centre line
const TURNS = 10; // helix turns below the point where the stair leaves the column
const DS = 0.1; // path table resolution
const TWIN_TURNS = 8.5; // the twin stair keeps climbing this many turns past that point
const EXT = 3; // the path tables run on this far past their end
const TREAD = 1.25;
const SLOPE = 0.5 / TREAD;
const THICK = 0.95;
const COLUMN_R = 3.0;
const WALL_R = 46;
const WALL_N = 32; // arcade modules per turn
const WALL_H = 13;
const WALL_PITCH = -13; // counter-wound
const END_GAP = 0.22; // the portal stands this far past the rail's exit, clear of the near plane
const EYE = 2.6;
const FOV = 72;
const FOV_IN = 66; // through the arrival: a longer lens holds the tower larger in the orbit's gate
const FOV_DOOR = 66; // on the way out; the burrow's, so the keyhole is a true window
const FOG_NEAR = 22;
const FOG_FAR = 150;

const DEG = Math.PI / 180;
/** piecewise-linear with eased joints: [x, y] keys in rising x */
const keyed = (keys: [number, number][]) => (x: number) => {
  let i = 0;
  while (i < keys.length - 2 && x > keys[i + 1]![0]) i++;
  const [x0, y0] = keys[i]!, [x1, y1] = keys[i + 1]!;
  return y0 + (y1 - y0) * smooth(x0, x1, x);
};
/**
 * Where the camera looks, as degrees off the rail's heading by distance past the joint: to the
 * left (the column is on the right), and upwards. Only as far as `stretch.free(t)` allows, which
 * is not at all until t = 5.6 or from t = 20.
 */
const GLANCE_YAW = keyed([[0, 0], [7, 5], [10, 5], [18, -10], [45, -10], [56, 5], [67, 0]]);
const GLANCE_PITCH = keyed([[0, 0], [8, 3], [18, -6], [50, -6], [60, -9], [70, -4]]);

const DOOR_A = 2.45; // half width of the keyhole's shaft
const DOOR_CY = 5.15; // centre of the keyhole's circle
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
// the layout: a helix round the column, and the bed of the rail from where the two part
// ---------------------------------------------------------------------------------------------
/** A stair's centre line in plan, tabulated every DS of plan length, and the height of its floor. */
interface PathTable {
  x: Float32Array;
  z: Float32Array;
  h: Float32Array;
  flare: Float32Array;
  end: number; // plan length at which the stair ends
  n: number;
}

/**
 * A stair that winds round the column from angle theta0 to thetaEnd: at angle th it is at
 * (R0 cos th, R0 sin th), which climbs to the right, and its floor rises SLOPE per unit of plan.
 */
function helixPath(theta0: number, thetaEnd: number): PathTable {
  const end = R0 * (thetaEnd - theta0);
  const n = Math.ceil((end + EXT) / DS) + 1;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const h = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const th = theta0 + (k * DS) / R0;
    x[k] = R0 * Math.cos(th);
    z[k] = R0 * Math.sin(th);
    h[k] = SLOPE * k * DS;
  }
  return { x, z, h, flare: new Float32Array(n), end, n };
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

interface Layout {
  stretch: Stretch;
  /** the column's axis, and the height the stair's tables count from, in the rail's local frame: tower = local - origin */
  origin: Vector3;
  /** angle about the axis at which both stairs begin, far below */
  theta0: number;
  /** the stair the camera climbs: a helix up to plan length `leave`, then laid on the rail's bed out to the door */
  main: PathTable;
  leave: number;
  /** its twin, half a turn round and so half a pitch higher: a helix all the way up */
  twin: PathTable;
  /** rail distances between which the camera is on the helix, EYE above the main stair */
  on: number;
  off: number;
  /** the camera's path through the air and down onto the stair, in tower coordinates: lamps keep clear of it */
  flight: Vector3[];
  /** true where a lamp's globe would stand between the camera and the keyhole on the way out */
  hidesDoor(globe: Vector3): boolean;
}

/**
 * Finds the stair in the rail. Spring holds its hardest turn and its steepest climb together for
 * most of a turn (rail.ts): that piece is a helix, and it has to be the stair's, SIDE outside its
 * centre line. Before it the camera is in the air; after it the stair is laid on the rail's bed.
 */
function buildLayout(stretch: Stretch): Layout {
  const f = createFrame();
  const dd = 0.02;
  const body1 = stretch.exit - stretch.joint; // the approach is as long as the one the scene arrives on
  let turn = 0;
  let climb = 0;
  for (let d = stretch.joint; d <= body1; d += dd) {
    stretch.frame(d, f);
    turn = Math.max(turn, -f.curvature);
    climb = Math.max(climb, f.tangent.y);
  }
  let on = NaN;
  let off = NaN;
  for (let d = stretch.joint; d <= body1; d += dd) {
    stretch.frame(d, f);
    if (-f.curvature < turn - 1e-6 || f.tangent.y < climb - 1e-6) continue;
    if (Number.isNaN(on)) on = d;
    off = d;
  }
  stretch.frame((on + off) / 2, f);
  const plan = Math.hypot(f.tangent.x, f.tangent.z);
  const radius = plan / turn;
  if (!(off - on > 10) || Math.abs(radius - (R0 + SIDE)) > 2e-3 || Math.abs(f.tangent.y / plan - (SLOPE * R0) / radius) > 2e-4)
    throw new Error(
      `helix: spring's turn (radius ${radius.toFixed(3)}, slope ${(f.tangent.y / plan).toFixed(4)}) is not the stair's helix ` +
        `(radius ${R0 + SIDE}, slope ${((SLOPE * R0) / (R0 + SIDE)).toFixed(4)}): see STAIR in rail.ts`,
    );
  const ax = f.position.x + f.right.x * radius;
  const az = f.position.z + f.right.z * radius;
  stretch.frame(off, f);
  const theta1 = Math.atan2(f.position.z - az, f.position.x - ax);
  const theta0 = theta1 - TURNS * TAU;
  const leave = R0 * TURNS * TAU;
  const origin = new Vector3(ax, f.position.y - EYE - SLOPE * leave, az);

  // ---- the bed: from where the stair leaves the helix to past the door ----
  // The stair goes on climbing under the camera until the rail is level, and from there the rail
  // stays level while the last flight steps down to the door: the eye meets the keyhole's middle.
  const dEnd = stretch.exit + END_GAP;
  const m = Math.ceil((dEnd + EXT + 0.5 - off) / dd) + 1;
  const bs = new Float64Array(m), bx = new Float64Array(m), bz = new Float64Array(m), bh = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const d = off + i * dd;
    stretch.frame(d, f);
    // the camera moves to the middle of the bridge as it leaves the column
    const side = SIDE * (1 - smooth(off + 2, off + 18, d));
    bx[i] = f.position.x - ax + f.right.x * side;
    bz[i] = f.position.z - az + f.right.z * side;
    bh[i] = f.position.y - origin.y - EYE - (DOOR_CY - EYE) * smoother(stretch.exit - 17, stretch.exit - 5.5, d);
    bs[i] = i === 0 ? 0 : bs[i - 1]! + Math.hypot(bx[i]! - bx[i - 1]!, bz[i]! - bz[i - 1]!);
  }
  const iEnd = (dEnd - off) / dd;
  const end = leave + bs[Math.floor(iEnd)]! + (bs[Math.floor(iEnd) + 1]! - bs[Math.floor(iEnd)]!) * (iEnd % 1);
  const main = helixPath(theta0, theta1);
  const n = Math.ceil((end + EXT) / DS) + 1;
  const grow = (a: Float32Array) => {
    const b = new Float32Array(n);
    b.set(a.subarray(0, Math.min(n, a.length)));
    return b;
  };
  main.x = grow(main.x); main.z = grow(main.z); main.h = grow(main.h); main.flare = new Float32Array(n);
  main.n = n;
  main.end = end;
  for (let k = Math.ceil(leave / DS), i = 0; k < n; k++) {
    const s = k * DS - leave;
    while (i < m - 2 && bs[i + 1]! < s) i++;
    const u = (s - bs[i]!) / Math.max(1e-9, bs[i + 1]! - bs[i]!);
    main.x[k] = bx[i]! + (bx[i + 1]! - bx[i]!) * u;
    main.z[k] = bz[i]! + (bz[i + 1]! - bz[i]!) * u;
    main.h[k] = bh[i]! + (bh[i + 1]! - bh[i]!) * u;
    // 0 against the column, 1 once the stair stands free of it
    main.flare[k] = Math.min(1, Math.max(0, (Math.hypot(main.x[k]!, main.z[k]!) - R0) / 1.5));
  }

  const flight: Vector3[] = [];
  for (let d = 0; d <= on + 1; d += 0.2) flight.push(stretch.frame(d, f).position.clone().sub(origin));
  // From where the arch comes into sight the eye is on its way to the keyhole's middle, which is
  // where the camera is at the exit: no globe may come within a unit of that line of sight.
  const keyhole = stretch.frame(stretch.exit, f).position.clone().sub(origin);
  const sight: Vector3[] = [];
  for (let d = off + 4; d <= stretch.exit - 4; d += 0.25) sight.push(stretch.frame(d, f).position.clone().sub(origin));
  const ray = new Vector3();
  const to = new Vector3();
  const hidesDoor = (globe: Vector3) =>
    sight.some((eye) => {
      ray.subVectors(keyhole, eye);
      const k = to.subVectors(globe, eye).dot(ray) / ray.lengthSq();
      return k > 0.12 && k < 1 && to.addScaledVector(ray, -k).lengthSq() < 1;
    });
  return { stretch, origin, theta0, main, leave, twin: helixPath(theta0, theta1 + TWIN_TURNS * TAU), on, off, flight, hidesDoor };
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
 * Where the two stairs' treads cross the newel, so the newel can darken above and below each one.
 * Filled in by getAssets, read when the column's program is compiled on the first frame.
 */
const hxStairs = { theta0: 0, offMain: 0, offTwin: 0, endMain: 0, endTwin: 0 };
/** the two lamps that flank the door, in world space; filled in by getAssets, they light the arch */
const hxLamps = { value: [new Vector3(), new Vector3()] };

// The keyhole arch's carving, in the stele's own coordinates (x across, y up from the landing).
const KH_YJ = DOOR_CY - Math.sqrt(DOOR_R * DOOR_R - DOOR_A * DOOR_A); // where the jambs meet the circle
const KH_SPRING = Math.atan2(DOOR_A, KH_YJ - DOOR_CY); // the springer joint's angle from straight up
const KH_VOUSS = (2 * KH_SPRING) / 19; // nineteen voussoirs, the keystone in the middle
const KH_COURSE = KH_YJ / 4; // four courses up each jamb

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
      float lin = ${glf(SLOPE * R0)} * (phi - ${glf(hxStairs.theta0)});
      float ao = 1.0;
      for (int k = 0; k < 2; k++) {
        float yOff = k == 0 ? 0.0 : ${glf(PITCH / 2)};
        float off = k == 0 ? ${glf(hxStairs.offMain)} : ${glf(hxStairs.offTwin)};
        float sEnd = k == 0 ? ${glf(hxStairs.endMain)} : ${glf(hxStairs.endTwin)};
        float n = floor((w.y - yOff - lin) / ${glf(PITCH)});
        for (int j = 0; j < 2; j++) {
          float th = phi + (n + float(j)) * ${glf(TAU)};
          ao *= hxSlabAO(w.y, ${glf(R0)} * (th - ${glf(hxStairs.theta0)}), off, yOff, sEnd);
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

function withVoidFog<T extends Material>(mat: T, detail: Detail = "plain"): T {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uHxT = hxTime;
    s.uniforms.uHxLamp = hxLamps;
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
  depthOnly: MeshBasicMaterial;
  keyholeMat: MeshLambertMaterial;
  columnMat: MeshLambertMaterial;
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
  wallM: Float32Array;
  satellites: Satellite[];
  doorPos: Vector3;
  doorYaw: number;
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
  if (cache?.index === index) return cache;
  const layout = buildLayout(season(index));
  const mainPath = layout.main;
  const twinPath = layout.twin;
  hxStairs.theta0 = layout.theta0;
  const rand = rng(1987);
  const P = new Vector3();
  const T = new Vector3();
  const dummy = new Object3D();

  const sq = new Quads();
  const balusters: number[] = [];
  const posts: number[] = [];
  const lanterns: number[] = [];
  const lanternPos: number[] = [];
  const rp: number[] = [], rn: number[] = [], rc: number[] = [], ri: number[] = [];
  const RING = 6;
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
    const globe = edge(sm, 1, top + 2.5, 0.22);
    P.set(globe[0], globe[1], globe[2]);
    // no lamp where the camera comes down over the balustrade onto the stair, and none across the keyhole
    const post =
      i % 6 === (main ? 5 : 0) && sm < END - 6 && !layout.flight.some((q) => q.distanceToSquared(P) < 1.4 * 1.4) && !layout.hidesDoor(P);
    if (post) pushPost(edge(sm, 1, top, 0.22));
    else pushBaluster(edge(sm, 1, top, 0.22), 1.45 + (heightAt(sm) - top));
    if (post) {
      const e = edge(sm, 1, top + 2.5, 0.22);
      pushLantern(e[0], e[1], e[2], 1);
    }
    if (pathFlare(path, sm) > 0.3) pushBaluster(edge(sm, -1, top, 0.22), 1.45 + (heightAt(sm) - top));
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
    hxStairs.endMain = layout.leave; // past that it is clear of the column
    hxStairs.offMain = END - nSteps * TREAD;
  } else {
    hxStairs.endTwin = END;
    hxStairs.offTwin = END - nSteps * TREAD;
  }

  // ---- hand rails: swept tubes ----
  const sweep = (from: number, to: number, side: number) => {
    const base = rp.length / 3;
    const steps = Math.ceil((to - from) / 0.6);
    for (let k = 0; k <= steps; k++) {
      const s = from + ((to - from) * k) / steps;
      const c = edge(s, side, heightAt(s) + 1.45, 0.22);
      pathTangent(path, s, T);
      for (let q = 0; q < RING; q++) {
        const a = (q / RING) * TAU;
        const cx = Math.cos(a), cy = Math.sin(a);
        rp.push(c[0] + T.z * cx * 0.11, c[1] + cy * 0.11, c[2] - T.x * cx * 0.11);
        rn.push(T.z * cx, cy, -T.x * cx);
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
    pos: new Vector3(x, HEND + dy, z),
    tilt: new Quaternion().setFromEuler(new Euler(rx, 0, rz)),
    scale,
    spin,
    phase: rand() * TAU,
  });
  const satellites = [
    sat(-30, -26, -12, -1.3, 0.1, 0.55, 0.16), // hangs below the fly-in, to its left
    sat(33, 8, -10, 1.0, 0.1, 0.5, 0.12), // slants down past the tower's far side in the first frames
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
    const r = 4 + (WALL_R - 6) * Math.sqrt(rand());
    const a = rand() * TAU;
    pp.push(r * Math.cos(a), HEND - 70 + rand() * 110, r * Math.sin(a));
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
  const postMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "post");
  const keyholeMat = withVoidFog(new MeshLambertMaterial({ vertexColors: true }), "keyhole");
  // The bridge and the arch stand in the koi's water: where, as an angle about the column
  const doorR = Math.hypot(doorPos.x, doorPos.z);
  pathAt(path, layout.leave + 8, P);
  const bridge0 = Math.atan2(P.z, P.x), bridge1 = Math.atan2(doorPos.z, doorPos.x);
  const sweepA = Math.atan2(Math.sin(bridge1 - bridge0), Math.cos(bridge1 - bridge0));
  // between the stair and the arcade, from far below the camera's start to far above the door;
  // they swim round the bridge, and frame the arch without touching it
  const koi = createKoi({
    count: 84, rMin: 18.5, rMax: WALL_R - 5, yMid: HEND - 18, yRange: 150, fogNear: FOG_NEAR, fogFar: FOG_FAR, skyGlsl: SKY_GLSL,
    keepOut: [{ angle: bridge0 + sweepA / 2, halfAngle: Math.abs(sweepA) / 2 + 0.2, y: HEND + 4, halfY: 6.5, r: doorR + 7.5 }],
    door: { centre: new Vector3(doorPos.x, HEND + DOOR_CY, doorPos.z), radius: 6.2, from: 16, to: 18.5 },
  });
  const glow = withVoidFog(new MeshBasicMaterial({ color: new Color(1.35, 0.6, 0.16) }), "globe");
  // lamplight in the keyhole until the portal opens: the globes' glass, turned down
  const veilMat = withVoidFog(new MeshBasicMaterial({ color: new Color(0.95, 0.4, 0.1), transparent: true }), "globe");
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
    index, layout, stairs, rails, column, wall, satellite,
    baluster: lathe(BALUSTER_PROFILE, 7),
    post: lathe(POST_PROFILE, 20),
    lantern: new SphereGeometry(0.22, 28, 16),
    sky: new SphereGeometry(1200, 24, 16),
    points, doorFrame, doorBack, doorPortal,
    stone, keyholeMat, columnMat, postMat, wallMat, stairMat, koi, glow, veilMat, skyMat, pointsMat,
    depthOnly: new MeshBasicMaterial({ colorWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
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

export default function Helix({ index, clock, camera, portalMaterial }: SceneProps) {
  const rig = useMemo(() => {
    const A = getAssets(index);
    const root = new Group();
    const sky = new Mesh(A.sky, A.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    // Draw order, so that stone nothing sees is never shaded: the column lays down its depth
    // first, the stair and all that stands on it follow, then the column itself, and the arcade
    // and the far stairs, which are behind it all, come last.
    const column = new Mesh(A.column, A.columnMat);
    const columnDepth = new Mesh(A.column, A.depthOnly);
    columnDepth.renderOrder = -5;
    column.renderOrder = 2;
    const stairs = new Mesh(A.stairs, A.stairMat);
    const rails = new Mesh(A.rails, A.stone);
    const balusters = instanced(A.baluster, A.postMat, A.balusterM);
    const postMesh = instanced(A.post, A.postMat, A.postM);
    const lanterns = instanced(A.lantern, A.glow, A.lanternM);
    const wall = instanced(A.wall, A.wallMat, A.wallM);
    wall.renderOrder = 3;
    const sats = new InstancedMesh(A.satellite, A.stone, A.satellites.length);
    sats.frustumCulled = false;
    sats.renderOrder = 3;
    const points = new Points(A.points, A.pointsMat);
    points.frustumCulled = false;
    const door = new Group();
    door.position.copy(A.doorPos);
    door.rotation.y = A.doorYaw;
    const portal = new Mesh(A.doorPortal, portalMaterial);
    const doorBack = new Mesh(A.doorBack, A.keyholeMat);
    doorBack.renderOrder = 1; // after the portal, so the depth test spares the carving behind it
    // The arch faces the way the camera flies in, and its portal is black until it shows the next
    // scene (t = TIMING.portalLive): till then the keyhole is full of lamplight, which then thins.
    const veil = new Mesh(A.doorPortal, A.veilMat);
    veil.position.z = 0.012;
    door.add(new Mesh(A.doorFrame, A.keyholeMat), doorBack, portal, veil);
    root.add(sky, columnDepth, column, stairs, rails, balusters, postMesh, lanterns, wall, sats, A.koi.mesh, points, door);
    return { A, root, sky, veil, columns: [column, columnDepth], sats, instancedMeshes: [balusters, postMesh, lanterns, wall, sats] };
  }, [index, portalMaterial]);

  useEffect(() => () => rig.instancedMeshes.forEach((m) => m.dispose()), [rig]);

  const tmp = useMemo(
    () => ({ pose: createFrame(), look: new Vector3(), side: new Vector3(), q: new Quaternion(), o: new Object3D(), fwd: new Vector3() }),
    [],
  );

  useFrame((state) => {
    const { A, sky, veil, columns, sats } = rig;
    const { stretch, origin } = A.layout;
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    const { pose, look, side, q, o, fwd } = tmp;

    // --- camera: the rail's. All the scene adds is where it looks, while the rail lets it ---
    const d = stretch.distance(t);
    stretch.frame(d, pose);
    const free = stretch.free(t);
    if (free > 0) {
      const s = d - stretch.joint;
      // degrees to the left of the rail's heading (the column is to the right), and above it
      const yaw = GLANCE_YAW(s) + 0.7 * Math.sin(t * 0.45);
      const pitch = GLANCE_PITCH(s) + 1.1 * Math.sin(t * 0.37 + 1);
      side.crossVectors(pose.tangent, Y_AXIS).normalize();
      look.copy(pose.tangent).applyAxisAngle(Y_AXIS, yaw * DEG).applyAxisAngle(side, pitch * DEG).multiplyScalar(20).add(pose.position);
      lookTowards(pose, look, free);
    }
    camera.position.copy(pose.position).sub(origin);
    camera.quaternion.copy(pose.quaternion);
    // The lens is long and steady while the cameras share the track, opens as the camera comes
    // down onto the stair, and has tightened again before they share the track on the way out.
    const fov =
      FOV_IN + (FOV - FOV_IN) * smooth(stretch.joint + 2.1, stretch.joint + 13, d) + (FOV_DOOR - FOV) * smooth(A.layout.off - 4, stretch.exit - stretch.joint - 1, d);
    if (camera.fov !== fov) camera.fov = fov;

    // --- the world turns ---
    sky.position.copy(camera.position);
    for (const m of columns) m.rotation.y = -t * 0.035;
    for (let i = 0; i < A.satellites.length; i++) {
      const sat = A.satellites[i]!;
      q.setFromAxisAngle(Y_AXIS, sat.phase + t * sat.spin);
      o.position.copy(sat.pos);
      o.quaternion.copy(sat.tilt).multiply(q);
      o.scale.setScalar(sat.scale);
      o.updateMatrix();
      sats.setMatrixAt(i, o.matrix);
    }
    sats.instanceMatrix.needsUpdate = true;
    hxTime.value = t;
    A.veilMat.opacity = 1 - smooth(TIMING.portalLive, TIMING.portalLive + 1.5, t);
    veil.visible = A.veilMat.opacity > 0;
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
