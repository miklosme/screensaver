import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { createFrame, type Stretch } from "../rail";

/**
 * Layout + procedural geometry of the burrow: a labyrinth made only of curves, grown around the
 * stretch of rail the scene rides (../rail.ts).
 *
 * The rail is given; the world is placed around what the camera on it can see. `buildWorld` lays
 * that out, and each choice there says which sightline it serves:
 *
 * - The main tunnel follows the rail, EYE below the camera, but not slavishly: its centreline may
 *   lie up to a unit to one side of the rail and its bore may be wider (`OFF`, `BORE`), so the
 *   tunnel can open a sightline round a bend or curl more than the track does while the camera
 *   takes the racing line through it. The rail's bank is left to the camera, so the tunnel stays
 *   upright and the lean shows.
 * - Round "junction" chambers (squashed spheroids) sit where the rail is level, on the OUTSIDE of
 *   its bend, with whatever floats in them on the straight line the camera arrives along: it is
 *   then the lit thing at the end of the tunnel for seconds before the rail veers away round it.
 * - Forks leave the junctions where the arriving camera faces them, and curl out of sight.
 * - The last chamber is centred on the joint the stretch ends at.
 *
 * Openings between corridors and chambers are not modelled: the chamber shader discards the
 * door-shaped hole and the corridor shader discards whatever pokes inside a chamber spheroid
 * (see materials.ts). A doorway's hole, its trim and the corridor behind it are all drawn from
 * one `Door`: the corridor's outline carried along `t` through the wall.
 */

export const EYE = 1.7;

// corridor cross-section: a soft pointed vault (superellipse, n < 2) over a rounded trough (n = 3)
export const PROFILE = { hc: 1.75, a: 1.7, bUp: 2.7, bLo: 1.75, nUp: 1.6, nLo: 3 } as const;

const RIB_SEGS = 10; // lengthwise segments per rib
const RIB_STEP = 0.21; // world units per lengthwise segment (rib period = 2.1)
const PROFILE_SEGS = 44;

const UP = new Vector3(0, 1, 0);

function profilePoint(phi: number, k = 1): [number, number] {
  // phi = 0 is the floor centre; returns [lateral x, height above floor]
  const s = Math.sin(phi);
  const c = -Math.cos(phi);
  const up = c >= 0;
  const n = up ? PROFILE.nUp : PROFILE.nLo;
  const b = up ? PROFILE.bUp : PROFILE.bLo;
  const x = PROFILE.a * Math.sign(s) * Math.abs(s) ** (2 / n);
  const y = PROFILE.hc + b * Math.sign(c) * Math.abs(c) ** (2 / n);
  return [x * k, y * k];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// the skin: where every scale of the walls lies (the shader in materials.ts draws them)
// ---------------------------------------------------------------------------------------------

/** world size of one scale across, and the pitch of the rings of scales along the flow, in a bore of scale 1 */
const SCALE_W = 0.16;
const SCALE_PITCH = 0.1;

/** how far round the corridor's profile each of its columns lies, by true arc length, as a fraction */
const PROFILE_ARC = (() => {
  const at = [0];
  let [px, py] = profilePoint(0);
  for (let j = 1; j <= PROFILE_SEGS; j++) {
    const [x, y] = profilePoint((j / PROFILE_SEGS) * Math.PI * 2);
    at.push(at[j - 1]! + Math.hypot(x - px, y - py));
    px = x;
    py = y;
  }
  const total = at[PROFILE_SEGS]!;
  return { frac: at.map((d) => d / total), total };
})();

/** scales round one ring of a corridor */
export const CORRIDOR_SCALES = Math.round(PROFILE_ARC.total / SCALE_W);

/** scales round a chamber at its widest, the rings of them from oculus to floor, and the latitudes of the first and last */
export const chamberSkin = (ch: Chamber) => {
  const psi0 = Math.asin(-ch.yc / ch.H);
  const psi1 = Math.acos(ch.oculus / ch.R);
  // the big dome is seen from across the room: its scales are sized to it, or they are only a grain
  const k = ch.R > 9 ? 2.6 : 1;
  return { round: (Math.PI * 2 * ch.R) / (SCALE_W * k), rings: Math.round(((psi1 - psi0) * (ch.R + ch.H)) / 2 / (SCALE_PITCH * k)), psi0, psi1 };
};

/**
 * Slow swells through the rock the burrow is dug in, by world position, so the two sides of a
 * mesh's seam agree: two that push the scales about (in scales across, and in rings), which is what
 * makes them larger here and smaller there, and how strongly they stand out of the wall (0.5 .. 1).
 */
function swell(x: number, y: number, z: number): [number, number, number] {
  const a = Math.sin(x * 0.57 + 1.3 * Math.sin(z * 0.41 + 0.6)) + Math.sin(y * 0.83 + z * 0.37 + 2.1);
  const b = Math.sin(z * 0.49 + 1.2 * Math.sin(x * 0.36 + y * 0.3)) + Math.sin(y * 0.71 - x * 0.44 + 0.8);
  const c = Math.sin(x * 0.29 + z * 0.23 + 1.1 * Math.sin(y * 0.4)) + Math.sin(z * 0.34 - x * 0.19 + y * 0.53 + 4.0);
  return [0.9 * a, 1.5 * b, 0.75 + 0.125 * c];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------

/** one cross-section of a corridor: the middle of its floor, and the axes its profile is drawn in */
export interface Station {
  c: Vector3;
  side: Vector3;
  up: Vector3;
  /** scale of the profile here: 1 is the burrow's ordinary bore */
  k: number;
  /** how much of the ribbing shows: it fades out where a corridor passes through a chamber's wall */
  rib: number;
}

/** where a corridor meets a chamber: a point on the corridor's centreline at the wall, and the way out */
export interface Door {
  /** in plan (y is ignored) */
  p: Vector3;
  /** unit, in plan: along the corridor, pointing out of the chamber */
  t: Vector3;
  /** unit, in plan: from the chamber's centre towards the door */
  dir: Vector3;
  /** scale of the corridor's profile where it comes through the wall */
  k: number;
}

export interface Chamber {
  /** centre in plan; y is the level of the floor's rim */
  c: Vector3;
  R: number;
  H: number;
  /** height of the spheroid's centre above the floor's rim */
  yc: number;
  ridges: number;
  oculus: number;
  /** how far the middle of the floor lies below its rim */
  dish: number;
  doors: Door[];
}

export interface GlowLight {
  p: Vector3;
  c: [number, number, number];
  r: number;
  /**
   * The corridor a light hangs in and the chamber that corridor opens into, when the light is shut
   * in there: nothing is traced, so without this it would shine through the rock on whatever
   * tunnel passes nearby.
   */
  home?: { corridor: number; chamber: Chamber };
  /** how much of it is the mint of the mushrooms and the thread, which the wet skin gives back whatever its own colour */
  mint?: number;
}

/** plan radius at which a chamber's wall meets its floor */
export const footRadius = (ch: Chamber) => ch.R * Math.sqrt(1 - (ch.yc / ch.H) ** 2);

/**
 * Level of a chamber's floor at plan distance r from its centre. Past the foot of the wall the
 * floor dips away underground: it is still there under a doorway's sill, but never level with the
 * floor of the corridor that starts there.
 */
export const floorY = (ch: Chamber, r: number) => {
  const out = Math.max(0, (r - footRadius(ch) - 0.012 * ch.R) / (0.05 * ch.R));
  return ch.c.y - ch.dish * (1 - smoothstep(ch.R * 0.25, ch.R * 0.85, r)) - 0.6 * out * out;
};

/** height of a corridor's trough above the middle of its floor at lateral offset x, for a bore of scale k */
export const troughY = (x: number, k = 1) =>
  k * (PROFILE.hc - PROFILE.bLo * Math.cbrt(Math.max(0, 1 - Math.abs(x / (k * PROFILE.a)) ** PROFILE.nLo)));

/** how far out of a doorway's outline a point is: 1 on the corridor's own profile, below 1 inside it */
function doorReach(ch: Chamber, door: Door, x: number, y: number, z: number): number {
  const ox = x - door.p.x;
  const oz = z - door.p.z;
  if (ox * door.t.x + oz * door.t.z < -3) return Infinity;
  const lat = Math.abs(ox * door.t.z - oz * door.t.x) / (PROFILE.a * door.k);
  const h = (y - ch.c.y) / door.k - PROFILE.hc;
  const n = h > 0 ? PROFILE.nUp : PROFILE.nLo;
  return (lat ** n + (Math.abs(h) / (h > 0 ? PROFILE.bUp : PROFILE.bLo)) ** n) ** (1 / n);
}

/** smoothstep-eased curve through [x, value] keys */
export const keyed = (keys: readonly (readonly [number, number])[]) => (x: number) => {
  let i = 0;
  while (i < keys.length - 2 && x > keys[i + 1]![0]) i++;
  const [x0, v0] = keys[i]!;
  const [x1, v1] = keys[i + 1]!;
  return v0 + (v1 - v0) * smoothstep(x0, x1, x);
};

const planDist = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------------------------------------
// geometry builders
// ---------------------------------------------------------------------------------------------

function finish(geo: BufferGeometry, cols: number, rows: number, centreOf: (row: number) => Vector3 | null) {
  // smooth normals, stitched across the duplicated seam column, pointing at the viewer side (inwards)
  geo.computeVertexNormals();
  const nrm = geo.getAttribute("normal") as BufferAttribute;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const a = new Vector3();
  const b = new Vector3();
  const stride = cols + 1;
  for (let i = 0; i < rows; i++) {
    const i0 = i * stride;
    const i1 = i0 + cols;
    a.fromBufferAttribute(nrm, i0);
    b.fromBufferAttribute(nrm, i1);
    a.add(b).normalize();
    nrm.setXYZ(i0, a.x, a.y, a.z);
    nrm.setXYZ(i1, a.x, a.y, a.z);
    const c = centreOf(i);
    if (!c) continue;
    for (let j = 0; j <= cols; j++) {
      a.fromBufferAttribute(nrm, i0 + j);
      b.fromBufferAttribute(pos, i0 + j).sub(c).negate();
      if (a.dot(b) < 0) nrm.setXYZ(i0 + j, -a.x, -a.y, -a.z);
    }
  }
}

function gridIndex(rows: number, cols: number) {
  const idx: number[] = [];
  const stride = cols + 1;
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  return idx;
}

/** ribbed corridor swept along its stations */
function buildCorridor(pts: Station[]): BufferGeometry {
  const rows = pts.length;
  const cols = PROFILE_SEGS;
  const position = new Float32Array(rows * (cols + 1) * 3);
  const pat = new Float32Array(rows * (cols + 1) * 2);
  const hgt = new Float32Array(rows * (cols + 1));
  const skin = new Float32Array(rows * (cols + 1) * 3);
  const centres: Vector3[] = [];
  let o = 0;
  let q = 0;
  let h = 0;
  let sk = 0;
  // rings of scales are counted along the corridor's own centre line, by true length, and are
  // spaced as the bore is wide: a scale stays as long as it is broad
  let ring = 0;
  for (let i = 0; i < rows; i++) {
    const { c: p, side, up, k, rib } = pts[i]!;
    const s = i / RIB_SEGS;
    const fr = s - Math.floor(s) - 0.5;
    const ridge = Math.exp(-(fr * fr) / (2 * 0.115 * 0.115));
    // slow breathing of the bore so no two stretches are quite the same size
    const breathe = 1 + 0.05 * Math.sin(s * 0.9 + p.x * 0.3) + 0.03 * Math.sin(s * 0.37 + 1.7);
    centres.push(p.clone().addScaledVector(up, PROFILE.hc * k));
    if (i > 0) ring += centres[i]!.distanceTo(centres[i - 1]!) / (SCALE_PITCH * 0.5 * (k + pts[i - 1]!.k));
    for (let j = 0; j <= cols; j++) {
      const [x0, yp] = profilePoint((j / cols) * Math.PI * 2);
      // At a doorway the trough is pressed flat, level with the chamber's floor from foot to foot of
      // the trim: no sill is left standing above that floor for the eye to get under.
      const y0 = yp * (1 - (1 - rib) * (1 - smoothstep(0, 0.7, yp)));
      const w = smoothstep(0.12, 1.3, yp);
      // where the ribbing is faded out the bore is plain and a little wide: a doorway's trim hides its rim
      const m = 1 + w * (0.07 + rib * (breathe - 1 - 0.2 * ridge));
      const x = x0 * m * k;
      const y0m = PROFILE.hc + (y0 - PROFILE.hc) * (y0 > PROFILE.hc ? m : 1);
      const y = y0m * k;
      position[o++] = p.x + side.x * x + up.x * y;
      position[o++] = p.y + side.y * x + up.y * y;
      position[o++] = p.z + side.z * x + up.z * y;
      pat[q++] = s;
      pat[q++] = j / cols;
      hgt[h++] = y0m;
      const [wa, wr, strength] = swell(position[o - 3]!, position[o - 2]!, position[o - 1]!);
      skin[sk++] = PROFILE_ARC.frac[j]! + wa / CORRIDOR_SCALES;
      skin[sk++] = ring + wr;
      skin[sk++] = strength;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setAttribute("hgt", new BufferAttribute(hgt, 1));
  geo.setAttribute("skin", new BufferAttribute(skin, 3));
  geo.setIndex(gridIndex(rows, cols));
  finish(geo, cols, rows, (i) => centres[i]!);
  return geo;
}

/**
 * How far a chamber's wall stands in from its spheroid, as a factor on the plan radius, at angle
 * th round it and height y above its floor: meridional ridges and a fine ripple. Round a doorway
 * the wall is the plain spheroid, which is what the doorway's hole, its trim and the corridor's
 * cut are all measured against: nothing is left for a gap to show through.
 */
export function wallRelief(ch: Chamber, th: number, y: number): number {
  const psi0 = Math.asin(-ch.yc / ch.H);
  const psi1 = Math.acos(ch.oculus / ch.R);
  const psi = Math.asin(Math.min(1, Math.max(-1, (y - ch.yc) / ch.H)));
  const vv = (psi - psi0) / (psi1 - psi0);
  const s = (th / (Math.PI * 2)) * ch.ridges;
  const fr = s - Math.floor(s) - 0.5;
  const ridge = Math.exp(-(fr * fr) / (2 * 0.15 * 0.15));
  const sx = ch.c.x + Math.sin(th) * ch.R * Math.cos(psi);
  const sz = ch.c.z + Math.cos(th) * ch.R * Math.cos(psi);
  let reach = Infinity;
  for (const door of ch.doors) reach = Math.min(reach, doorReach(ch, door, sx, ch.c.y + y, sz));
  return 1 - smoothstep(1.2, 2.0, reach) * (0.055 * ridge * (1 - 0.6 * vv) + 0.012 * Math.sin(vv * 40));
}

/** chamber shell: floor rim up to the oculus, with meridional ridges */
function buildChamber(ch: Chamber): BufferGeometry {
  const cols = ch.ridges * 10;
  const rows = 34;
  const psi0 = Math.asin(-ch.yc / ch.H);
  const psi1 = Math.acos(ch.oculus / ch.R);
  const position = new Float32Array(rows * (cols + 1) * 3);
  const pat = new Float32Array(rows * (cols + 1) * 2);
  const hgt = new Float32Array(rows * (cols + 1));
  const skin = new Float32Array(rows * (cols + 1) * 3);
  const { round, rings } = chamberSkin(ch);
  let o = 0;
  let q = 0;
  let k = 0;
  let sk = 0;
  for (let i = 0; i < rows; i++) {
    const vv = i / (rows - 1);
    const psi = psi0 + (psi1 - psi0) * vv;
    const y = ch.yc + ch.H * Math.sin(psi);
    for (let j = 0; j <= cols; j++) {
      const th = (j / cols) * Math.PI * 2;
      const s = (j / cols) * ch.ridges;
      const rho = ch.R * Math.cos(psi) * wallRelief(ch, th, y);
      position[o++] = ch.c.x + Math.sin(th) * rho;
      position[o++] = ch.c.y + y;
      position[o++] = ch.c.z + Math.cos(th) * rho;
      pat[q++] = s;
      pat[q++] = vv;
      hgt[k++] = y;
      // rings of scales hang down the dome from the oculus, each ring with as many as fit round it
      const [wa, wr, strength] = swell(position[o - 3]!, position[o - 2]!, position[o - 1]!);
      skin[sk++] = j / cols + wa / round;
      skin[sk++] = (1 - vv) * rings + wr;
      skin[sk++] = strength;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setAttribute("hgt", new BufferAttribute(hgt, 1));
  geo.setAttribute("skin", new BufferAttribute(skin, 3));
  geo.setIndex(gridIndex(rows, cols));
  const c = new Vector3(ch.c.x, ch.c.y + ch.yc, ch.c.z);
  finish(geo, cols, rows, () => c);
  return geo;
}

/** chamber floor: a shallow dish with concentric ripples in the pattern coordinate, running on under the wall */
function buildFloor(ch: Chamber): BufferGeometry {
  // fine enough to carry the light and the occlusion baked into its vertices (the dish itself is the same)
  const cols = 180;
  const rows = 46;
  const position = new Float32Array(rows * (cols + 1) * 3);
  const normal = new Float32Array(rows * (cols + 1) * 3);
  const pat = new Float32Array(rows * (cols + 1) * 2);
  let o = 0;
  let q = 0;
  for (let i = 0; i < rows; i++) {
    const r = (ch.R * 1.12 * i) / (rows - 1);
    for (let j = 0; j <= cols; j++) {
      const th = (j / cols) * Math.PI * 2;
      // the dish is shallow enough to light as if it were flat
      normal[o + 1] = 1;
      position[o++] = ch.c.x + Math.sin(th) * r;
      position[o++] = floorY(ch, r);
      position[o++] = ch.c.z + Math.cos(th) * r;
      pat[q++] = r / 1.6 + 0.5;
      pat[q++] = j / cols;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setAttribute("hgt", new BufferAttribute(new Float32Array(rows * (cols + 1)), 1));
  geo.setIndex(gridIndex(rows, cols));
  return geo;
}

/** round tube swept along points; `ref` fixes which side of the tube pattern column 0.5 faces */
export function sweepTube(pts: Vector3[], closed: boolean, radius: number, radial: number, ref: Vector3): BufferGeometry {
  const n = pts.length;
  const rows = closed ? n + 1 : n;
  const position = new Float32Array(rows * (radial + 1) * 3);
  const normal = new Float32Array(rows * (radial + 1) * 3);
  const pat = new Float32Array(rows * (radial + 1) * 2);
  const T = new Vector3();
  const N = new Vector3();
  const B = new Vector3();
  let o = 0;
  let q = 0;
  for (let i = 0; i < rows; i++) {
    const k = i % n;
    const next = closed ? pts[(k + 1) % n]! : pts[Math.min(n - 1, k + 1)]!;
    const prev = closed ? pts[(k + n - 1) % n]! : pts[Math.max(0, k - 1)]!;
    T.copy(next).sub(prev).normalize();
    N.copy(ref).addScaledVector(T, -T.dot(ref)).normalize();
    B.crossVectors(T, N);
    const p = pts[k]!;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a);
      const sx = Math.sin(a);
      const nx = N.x * cx + B.x * sx;
      const ny = N.y * cx + B.y * sx;
      const nz = N.z * cx + B.z * sx;
      normal[o] = nx;
      normal[o + 1] = ny;
      normal[o + 2] = nz;
      position[o++] = p.x + nx * radius;
      position[o++] = p.y + ny * radius;
      position[o++] = p.z + nz * radius;
      pat[q++] = j / radial + 0.5;
      pat[q++] = i / (rows - 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setIndex(gridIndex(rows, radial));
  return geo;
}

/**
 * The bead that trims a doorway: a closed loop lying on the chamber's spheroid, along the line
 * where the corridor's outline (carried along the corridor, as the shader's hole is) comes through
 * it. Its lower run is sunk under the floor, so the two feet rise out of the ground like roots and
 * there is no end to cap.
 */
function doorLoop(ch: Chamber, door: Door): Vector3[] {
  const pts: Vector3[] = [];
  const K = 0.95 * door.k;
  const n = 84;
  const { t } = door;
  const perp = new Vector3(t.z, 0, -t.x);
  for (let i = 0; i < n; i++) {
    const [x, y] = profilePoint((Math.PI * 2 * i) / n, K);
    const e = (y - ch.yc) / ch.H;
    const rho = ch.R * Math.sqrt(Math.max(0.05, 1 - e * e));
    // where the corridor's outline, carried along the corridor, leaves the spheroid
    const qx = door.p.x - ch.c.x + perp.x * x;
    const qz = door.p.z - ch.c.z + perp.z * x;
    const qt = qx * t.x + qz * t.z;
    const f = -qt + Math.sqrt(Math.max(0.01, qt * qt - qx * qx - qz * qz + rho * rho)) - 0.04;
    const sunk = y - 0.46 * door.k * (1 - smoothstep(0.04, 0.8, y / door.k));
    pts.push(new Vector3(ch.c.x + qx + t.x * f, ch.c.y + sunk, ch.c.z + qz + t.z * f));
  }
  return pts;
}

function buildDoorFrame(ch: Chamber, door: Door): BufferGeometry {
  const geo = sweepTube(doorLoop(ch, door), true, 0.27 * Math.sqrt(door.k), 10, door.t.clone().negate());
  const pos = geo.getAttribute("position") as BufferAttribute;
  const hgt = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) hgt[i] = pos.getY(i) - ch.c.y;
  geo.setAttribute("hgt", new BufferAttribute(hgt, 1));
  return geo;
}

/** something standing on a surface: it darkens what is within r of p, by s at most */
interface Occluder {
  p: Vector3;
  r: number;
  s: number;
}

/**
 * Light that does not move, per vertex. `glow` is what the glowing things shed on the surface.
 * `ground` is what standing things do to it: x is how open the surface is to light at all (1,
 * falling where something stands on it), y is the mint light pooled on it.
 */
function bake(geo: BufferGeometry, all: GlowLight[], occluders: Occluder[], corridor: number, chamber?: Chamber) {
  const lights = all.filter((L) => !L.home || L.home.corridor === corridor || L.home.chamber === chamber);
  const pos = geo.getAttribute("position") as BufferAttribute;
  const nrm = geo.getAttribute("normal") as BufferAttribute;
  const glow = new Float32Array(pos.count * 3);
  const ground = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    let r = 0;
    let g = 0;
    let b = 0;
    let pool = 0;
    for (let k = 0; k < lights.length; k++) {
      const L = lights[k]!;
      const dx = L.p.x - px;
      const dy = L.p.y - py;
      const dz = L.p.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const rr = L.r * L.r;
      if (d2 > rr * 60) continue;
      const d = Math.sqrt(d2) + 1e-4;
      const ndl = Math.abs(nx * dx + ny * dy + nz * dz) / d; // shells are thin & double sided
      const w = (0.35 + 0.65 * ndl) / (1 + d2 / rr);
      r += L.c[0] * w;
      g += L.c[1] * w;
      b += L.c[2] * w;
      // a pool is a tighter thing than the light that fills the tunnel
      if (L.mint) pool += (L.mint * (0.35 + 0.65 * ndl)) / (1 + (d2 * d2) / (rr * rr));
    }
    let open = 1;
    for (let k = 0; k < occluders.length; k++) {
      const O = occluders[k]!;
      const dx = O.p.x - px;
      const dy = O.p.y - py;
      const dz = O.p.z - pz;
      const u = 1 - (dx * dx + dy * dy + dz * dz) / (O.r * O.r);
      if (u > 0) open *= 1 - O.s * u * u;
    }
    glow[i * 3] = r;
    glow[i * 3 + 1] = g;
    glow[i * 3 + 2] = b;
    ground[i * 2] = open;
    ground[i * 2 + 1] = pool;
  }
  geo.setAttribute("glow", new BufferAttribute(glow, 3));
  geo.setAttribute("ground", new BufferAttribute(ground, 2));
}

// ---------------------------------------------------------------------------------------------
// the world
// ---------------------------------------------------------------------------------------------

export const HOOP = { rx: 1.7, ry: 2.1, y: 2.6 } as const;
/** the hoop's centre hangs this far above the camera's line, as it always has */
const HOOP_LIFT = 0.3;

/** how far inside a chamber's wall a corridor's geometry starts, and how far outside it a fork runs straight */
const IN = 1.5;
const OUT = 2.5;
/** the tunnel starts this far behind where the camera is at t = 0 */
const BEHIND = 7;

/**
 * THE MAIN TUNNEL ROUND THE RAIL, by rail distance (the camera is at 0 at t = 0, at the joint,
 * 18.8, at t = 5, and at the hoop, 117.8, at t = 25).
 *
 * OFF is how far to the right of the rail the tunnel's centreline lies, BORE the scale of its
 * profile. Both exist for what the camera sees:
 *
 * - 0 .. 27, the arrival. The approach sweeps 26 degrees to the left and then runs straight at the
 *   knot. From the first frame the straight line to the knot passes up to 2.2 units to the left of
 *   the rail, through what would be the inside wall of the bend. So the gallery is wide there and
 *   lies to the left of the rail: the knot hangs in view from t = 0 on.
 * - 44 .. 66, the long curl down to the fork: a hand's width to the inside, to see further round.
 * - 92 .. 107, the last stretch. The rail runs nearly straight here and then sweeps left to the
 *   hoop, which on its own would be a straight bore; the tunnel swings out to the right and back
 *   hard to the left across the rail, so the camera looks down a curl and takes it on the inside,
 *   and the doorway of the dome ends up to the left of the rail, where the hoop is first seen.
 */
const OFF = keyed([
  [0.5, 0],
  [7, -0.8],
  [12.5, -0.8],
  [20, -0.5],
  [27, -0.25],
  [31, 0],
  [44, 0],
  [50, -0.2],
  [62, -0.2],
  [68, -0.1],
  [80, 0],
  [93, 0],
  [99.5, 0.55],
  [105.5, -0.8],
  [112, -0.8],
]);
const BORE = keyed([
  [12, 1.38],
  [26.7, 1.2],
  [39, 1.12],
  [46, 1],
  [61, 1],
  [68, 1.1],
  [84, 1.05],
  [94, 1.3],
]);

interface ChamberSpec {
  R: number;
  H: number;
  yc: number;
  ridges: number;
  oculus: number;
  dish?: number;
}

interface ForkSpec {
  ch: Chamber;
  /** which way the fork leaves its chamber, as a heading in plan (0 = -Z, positive to the left) */
  heading: number;
  /** degrees it curls through, positive to the left, and the length of corridor it takes to do so */
  curl: number;
  over: number;
  length: number;
  /** how far it climbs on the way */
  rise?: number;
  lure: [number, number, number];
}

export function buildWorld(stretch: Stretch) {
  const f = createFrame();
  const centreOf = (d: number, out: Vector3) => {
    stretch.frame(d, f);
    return out.copy(f.position).addScaledVector(f.up, -EYE).addScaledVector(f.right, OFF(d));
  };
  const a = new Vector3();
  const b = new Vector3();
  /** the main tunnel's cross-section at rail distance d, as the rail and OFF / BORE give it */
  const rawTube = (d: number): Station => {
    const T = centreOf(d + 0.05, a).sub(centreOf(d - 0.05, b)).normalize();
    const c = centreOf(d, new Vector3());
    const side = new Vector3().crossVectors(T, f.up).normalize();
    return { c, side, up: new Vector3().crossVectors(side, T), k: BORE(d), rib: 1 };
  };
  const DEG = Math.PI / 180;
  const ahead = (heading: number) => new Vector3(-Math.sin(heading), 0, -Math.cos(heading));

  // --- chambers ---------------------------------------------------------------------------------
  const chambers: Chamber[] = [];
  const mids: number[] = [];
  /** a chamber whose centre is `right` units to the right of the rail at distance d */
  const onRail = (d: number, right: number, spec: ChamberSpec) => {
    stretch.frame(d, f);
    const c = f.position.clone().addScaledVector(f.up, -EYE).addScaledVector(f.right, right);
    const ch: Chamber = { ...spec, dish: spec.dish ?? 0, c, doors: [] };
    chambers.push(ch);
    mids.push(d);
    return ch;
  };
  // Junction 1 is on the outside of summer's first sweep (to the right), so the approach, which runs
  // dead straight for the 12 units before the sweep, is aimed into the middle of it. The knot hangs
  // on that straight line, 3.1 to the left of where the rail swings past.
  const ch1 = onRail(33, -2, { R: 7, H: 7, yc: 2, ridges: 16, oculus: 1.0 });
  // Junction 2 is on the outside of the long curl to the left, where the rail has levelled out at the
  // bottom of its dive: the orrery in the middle of it is dead ahead for the last third of the curl.
  const ch2 = onRail(73.8, 2.9, { R: 7.5, H: 7.5, yc: 2, ridges: 17, oculus: 1.0 });
  // the dead end is centred on the joint, and its floor is dished so the hoop hangs clear of it
  const ch3 = onRail(stretch.exit, 0, { R: 11, H: 10.5, yc: 2.5, ridges: 26, oculus: 1.8, dish: HOOP.y - HOOP_LIFT - EYE });

  const above = (ch: Chamber, h: number) => new Vector3(ch.c.x, ch.c.y + h, ch.c.z);
  stretch.frame(mids[0]!, f);
  const knotAt = f.position.clone().addScaledVector(f.right, -3.1).setY(ch1.c.y + 2.7);
  const orreryAt = above(ch2, 2.9);

  /** rail distance, walking from a chamber's middle in steps of `step`, at which the tunnel's floor line is r from its centre */
  const crossing = (i: number, step: number, r: number) => {
    let d = mids[i]!;
    while (planDist(centreOf(d, a), chambers[i]!.c) < r) d += step;
    return d;
  };
  /** where the main tunnel passes through a wall, and the level its floor has to come to there */
  const sills: { d: number; y: number }[] = [];
  const railDoor = (i: number, step: number) => {
    const ch = chambers[i]!;
    const d = crossing(i, step, ch.R * 0.97);
    const st = rawTube(d);
    const t = new Vector3().crossVectors(st.up, st.side).setY(0).normalize().multiplyScalar(Math.sign(step));
    ch.doors.push({ p: st.c, t, dir: new Vector3(st.c.x - ch.c.x, 0, st.c.z - ch.c.z).normalize(), k: st.k });
    sills.push({ d, y: ch.c.y });
  };
  railDoor(0, -0.02);
  railDoor(0, 0.02);
  railDoor(1, -0.02);
  railDoor(1, 0.02);
  railDoor(2, -0.02);

  /** the main tunnel's cross-section at rail distance d as it is built: level with a chamber's floor and smooth where it meets one */
  const tube = (d: number): Station => {
    const st = rawTube(d);
    for (const sill of sills) {
      const away = Math.abs(d - sill.d);
      st.c.y += (sill.y - st.c.y) * (1 - smoothstep(0.6, 3.4, away));
      st.rib = Math.min(st.rib, smoothstep(0.9, 2.8, away));
    }
    return st;
  };

  // --- the main tunnel, from chamber to chamber -------------------------------------------------
  const sweep = (from: number, to: number) => {
    const n = Math.max(RIB_SEGS, Math.round((to - from) / RIB_STEP / RIB_SEGS) * RIB_SEGS);
    const pts: Station[] = [];
    for (let i = 0; i <= n; i++) pts.push(tube(from + ((to - from) * i) / n));
    return pts;
  };
  const mainCorridors = [
    sweep(-BEHIND, crossing(0, -0.02, ch1.R - IN)),
    sweep(crossing(0, 0.02, ch1.R - IN), crossing(1, -0.02, ch2.R - IN)),
    sweep(crossing(1, 0.02, ch2.R - IN), crossing(2, -0.02, ch3.R - IN)),
  ];

  // --- forks: corridors that leave a junction and curl out of sight -------------------------------
  const forks: ForkSpec[] = [
    // Junction 1. One mouth in the far wall, straight behind the knot as the camera arrives: it curls
    // away to the right and climbs, over the long curl the rail goes down next. One to the left of
    // it, curling back the way we came.
    { ch: ch1, heading: -8, curl: -112, over: 12.5, length: 24, rise: 4.2, lure: [0.25, 1.0, 0.7] },
    { ch: ch1, heading: 100, curl: 105, over: 11.5, length: 21, lure: [0.55, 0.3, 1.0] },
    // Junction 2. One mouth beside the way out, to its right: the two tunnel mouths the camera sees
    // side by side as it comes round. One in the far wall behind the orrery.
    { ch: ch2, heading: 130, curl: -120, over: 15, length: 22, lure: [1.0, 0.55, 0.2] },
    { ch: ch2, heading: 75, curl: -110, over: 14, length: 21, lure: [0.2, 0.75, 1.0] },
  ];
  const lures: GlowLight[] = [];
  const sideCorridors = forks.map((fork, forkIndex) => {
    const { ch } = fork;
    const start = fork.heading * DEG;
    const dir = ahead(start);
    const n = Math.round(fork.length / RIB_STEP / RIB_SEGS) * RIB_SEGS;
    const step = fork.length / n;
    // straight through the wall, then an even curl that eases in and out
    const rate = (s: number) => {
      const u = (s - IN - OUT) / fork.over;
      return ((fork.curl * DEG) / (0.8 * fork.over)) * smoothstep(0, 0.2, u) * (1 - smoothstep(0.8, 1, u));
    };
    const climb = (s: number) => (fork.rise ?? 0) * smoothstep(IN + OUT, IN + OUT + fork.over, s);
    const p = new Vector3(ch.c.x, ch.c.y, ch.c.z).addScaledVector(dir, ch.R - IN);
    const pts: Station[] = [];
    let h = start;
    for (let i = 0; i <= n; i++) {
      const s = i * step;
      pts.push({
        c: p.clone().setY(ch.c.y + climb(s)),
        side: new Vector3(Math.cos(h), 0, -Math.sin(h)),
        up: UP,
        k: 1,
        rib: smoothstep(0.9, 2.8, Math.abs(s - IN)),
      });
      p.addScaledVector(ahead(h + 0.5 * step * rate(s + 0.25 * step)), step);
      h += step * rate(s + 0.5 * step);
    }
    ch.doors.push({ p: new Vector3(ch.c.x, 0, ch.c.z).addScaledVector(dir, ch.R * 0.97), t: dir, dir, k: 1 });
    // the lure hangs just round the first of the curl, where it colours what can be seen from the junction
    const at = pts[Math.floor(pts.length * 0.42)]!.c;
    lures.push({
      p: new Vector3(at.x, at.y + 2.4, at.z),
      c: [fork.lure[0] * 3.2, fork.lure[1] * 3.2, fork.lure[2] * 3.2],
      r: 4.5,
      home: { corridor: mainCorridors.length + forkIndex, chamber: ch },
    });
    return pts;
  });
  const corridorPts = [...mainCorridors, ...sideCorridors];

  // --- the thread that leads the way: the rail's own line, laid on whatever floor is under it -----
  const threadPts: Vector3[] = [];
  {
    const from = -BEHIND + 1;
    const end = stretch.exit - 0.35;
    const n = Math.round((end - from) / 0.3);
    for (let i = 0; i <= n; i++) {
      const d = from + ((end - from) * i) / n;
      const st = tube(d);
      stretch.frame(d, f);
      const x = a.copy(f.position).addScaledVector(f.up, -EYE).sub(st.c).dot(st.side);
      const p = st.c.clone().addScaledVector(st.side, x).addScaledVector(st.up, troughY(x, st.k));
      for (const ch of chambers) {
        const r = planDist(p, ch.c);
        if (r < footRadius(ch)) p.y = floorY(ch, r);
      }
      p.y += 0.035;
      threadPts.push(p);
    }
  }

  // --- groves: a stand of tall mushrooms at the foot of the wall, and the light they give -----------
  // One wherever a sightline down the tunnel would otherwise end on a bare wall.
  const groves: { p: Vector3; lean: Vector3; tall: boolean }[] = [];
  for (const [d, sgn] of [
    [45.5, -1],
    [52, 1],
    [58.5, 1],
    [64, 1],
    [86, -1],
    [92.5, 1],
    [100.5, 1],
  ] as const) {
    const st = tube(d);
    const x = sgn * 1.32 * st.k;
    groves.push({
      p: st.c.clone().addScaledVector(st.side, x).addScaledVector(st.up, troughY(x, st.k)),
      lean: st.side.clone().multiplyScalar(-sgn),
      tall: false,
    });
  }

  // and in junction 1, to either side of the way out and in the lee of the knot, where the camera swings past
  for (const [bearing, r] of [
    [-88, 5.7],
    [-41, 5.9],
    [-12, 4.4],
  ] as const) {
    const dir = ahead(bearing * DEG);
    groves.push({ p: new Vector3(ch1.c.x + dir.x * r, floorY(ch1, r), ch1.c.z + dir.z * r), lean: dir.clone().negate(), tall: true });
  }

  // --- baked light ------------------------------------------------------------------------------
  const hoopPos = stretch.frame(stretch.exit).position.clone();
  hoopPos.y += HOOP_LIFT;

  // the dome's foreground: big mushrooms to either side of the lens at t = 22, framing the hoop. Each
  // stands well clear of every point the camera passes through from there to the hoop.
  const foreground: { p: Vector3; h: number; lean: Vector3 }[] = [];
  {
    const d22 = stretch.distance(22);
    const flight: Vector3[] = [];
    for (let d = d22 - 1; d <= stretch.exit + 0.5; d += 0.25) flight.push(stretch.frame(d, f).position.clone());
    for (const [ahead, right, h] of [
      [2.6, 2.05, 1.95],
      [3.6, -2.35, 1.6],
      [1.3, 2.9, 1.3],
    ] as const) {
      stretch.frame(d22 + ahead, f);
      const side = f.right.clone().setY(0).normalize();
      const p = f.position.clone().addScaledVector(side, right);
      // keep the cap (a third of the height across) clear of the line of flight, and off the fairy ring
      const clear = 1.05 + 0.34 * h;
      for (let i = 0; i < 40; i++) {
        const near = Math.min(...flight.map((q) => planDist(p, q)));
        if (near >= clear && planDist(p, hoopPos) > HOOP.rx + 2.3) break;
        p.addScaledVector(side, Math.sign(right) * 0.1);
      }
      p.y = floorY(ch3, planDist(p, ch3.c)) - 0.03;
      foreground.push({ p, h, lean: side.clone().multiplyScalar(Math.sign(right)) });
    }
  }

  const sights = [knotAt, orreryAt];
  const lights: GlowLight[] = [
    { p: knotAt, c: [2.6, 1.15, 1.0], r: 3.6 },
    { p: above(ch1, ch1.yc + ch1.H - 0.6), c: [1.6, 0.9, 1.1], r: 3.2 },
    { p: orreryAt, c: [2.4, 1.3, 0.75], r: 3.6 },
    { p: above(ch2, ch2.yc + ch2.H - 0.6), c: [1.3, 0.8, 1.4], r: 3.4 },
    { p: hoopPos, c: [1.0, 2.2, 1.9], r: 4.2 },
    // what the hoop gives the dome: the far wall is never just dark
    { p: hoopPos, c: [1.15, 0.62, 0.7], r: 7.5, home: { corridor: -99, chamber: ch3 } },
    ...foreground.map((g): GlowLight => ({ p: new Vector3(g.p.x, g.p.y + g.h * 0.85, g.p.z), c: [0.45, 1.7, 1.3], r: 1.3 * g.h, mint: 0.7 })),
    { p: above(ch3, ch3.yc + ch3.H - 0.8), c: [1.9, 1.0, 1.5], r: 6.5 },
    ...lures,
    ...groves.map((g): GlowLight => ({ p: new Vector3(g.p.x, g.p.y + 0.9, g.p.z).addScaledVector(g.lean, 0.3), c: [0.5, 2.0, 1.5], r: 1.7, mint: 1 })),
  ];
  for (let i = 0; i < threadPts.length; i += 4) {
    const p = threadPts[i]!;
    lights.push({ p: new Vector3(p.x, p.y + 0.085, p.z), c: [0.07, 0.3, 0.24], r: 0.9, mint: 0.12 });
  }

  // --- geometry ---------------------------------------------------------------------------------
  const corridors = corridorPts.map(buildCorridor);
  const shells = chambers.map(buildChamber);
  const floors = chambers.map(buildFloor);
  const frames: BufferGeometry[] = [];
  const frameOf: Chamber[] = [];
  for (const ch of chambers)
    for (const d of ch.doors) {
      frames.push(buildDoorFrame(ch, d));
      frameOf.push(ch);
    }
  const thread = sweepTube(threadPts, false, 0.04, 6, UP);
  // what stands on the floor shades it: each stand of mushrooms, and the two feet of every doorway's trim
  const occluders: Occluder[] = [];
  for (const g of groves) {
    const p = g.p.clone().addScaledVector(g.lean, -0.1);
    occluders.push({ p, r: 1.05, s: 0.5 }, { p, r: 0.5, s: 0.4 });
  }
  for (const g of foreground) occluders.push({ p: g.p, r: 0.5 * g.h, s: 0.5 });
  for (const ch of chambers)
    for (const door of ch.doors) {
      const loop = doorLoop(ch, door);
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!;
        const q = loop[(i + 1) % loop.length]!;
        // where the bead goes into the ground
        if (p.y - ch.c.y > 0 !== q.y - ch.c.y > 0)
          occluders.push({ p: new Vector3((p.x + q.x) / 2, ch.c.y, (p.z + q.z) / 2), r: 1.0 * Math.sqrt(door.k), s: 0.62 });
      }
    }
  corridors.forEach((g, i) => bake(g, lights, occluders, i));
  shells.forEach((g, i) => bake(g, lights, occluders, -1, chambers[i]));
  floors.forEach((g, i) => bake(g, lights, occluders, -1, chambers[i]));
  frames.forEach((g, i) => bake(g, lights, occluders, -1, frameOf[i]));

  // hoop: a thin elliptical band, far too thin to hold anything, with mint beads set in its channels
  const hoop = buildHoopRing();
  const hoopBeads = buildHoopBeads();

  // --- drifting motes ---------------------------------------------------------------------------
  const rnd = mulberry32(7);
  const motePos: number[] = [];
  const moteSeed: number[] = [];
  const addMote = (x: number, y: number, z: number) => {
    motePos.push(x, y, z);
    moteSeed.push(rnd() * 6.283, 0.3 + rnd() * 0.7, 0.5 + rnd() * rnd() * 2.2, rnd());
  };
  for (const pts of corridorPts)
    for (let i = 2; i < pts.length - 2; i += 3) {
      if (rnd() > 0.55) continue;
      const { c, side, up, k } = pts[i]!;
      const x = Math.cos(rnd() * 6.283) * Math.sqrt(rnd()) * 1.15 * k;
      const y = (0.5 + rnd() * 3.2) * k;
      addMote(c.x + side.x * x + up.x * y, c.y + side.y * x + up.y * y, c.z + side.z * x + up.z * y);
    }
  for (const ch of chambers) {
    const count = Math.round(ch.R * ch.R * 2.2);
    for (let i = 0; i < count; i++) {
      const ang = rnd() * 6.283;
      const rr = Math.sqrt(rnd()) * ch.R * 0.8;
      addMote(ch.c.x + Math.cos(ang) * rr, ch.c.y + 0.4 + rnd() * rnd() * ch.H * 0.9, ch.c.z + Math.sin(ang) * rr);
    }
  }
  const motes = new BufferGeometry();
  motes.setAttribute("position", new BufferAttribute(new Float32Array(motePos), 3));
  motes.setAttribute("seed", new BufferAttribute(new Float32Array(moteSeed), 4));

  // the hoop ends up square-on to the camera, which arrives along the rail's tangent at the joint
  const arrive = stretch.frame(stretch.exit).tangent.clone().negate();
  const hoopYaw = Math.atan2(arrive.x, arrive.z);

  return {
    chambers,
    corridors,
    corridorPts,
    shells,
    floors,
    frames,
    thread,
    /** the thread's course, for whatever must keep off it */
    route: threadPts,
    /** what floats in the two junctions: the knot and the orrery */
    sights,
    groves,
    hoop,
    hoopBeads,
    hoopPos,
    /** big mushrooms that frame the hoop from beside the lens */
    foreground,
    hoopYaw,
    /** unit vector in plan from the hoop towards the arriving camera */
    arrive,
    motes,
  };
}

export type World = ReturnType<typeof buildWorld>;

// ---------------------------------------------------------------------------------------------
// the hoop
// ---------------------------------------------------------------------------------------------

/** the hoop's cross-section: half its width across the band, half its depth, and its channels */
const RING = { w: 0.1, d: 0.066, groove: 0.026, gw: 0.03 } as const;
const RING_A = HOOP.rx + 0.09;
const RING_B = HOOP.ry + 0.09;

/** a point of the band's surface: u round the hoop (0..1), th round the cross-section */
function ringPoint(u: number, th: number, out: Vector3, chan?: { v: number }) {
  const a = u * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nx = RING_B * c;
  const ny = RING_A * s;
  const nl = Math.hypot(nx, ny);
  // a rounded box, rounder on the outside edge than the inside
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const p = 0.5;
  const x = RING.w * Math.sign(ct) * Math.abs(ct) ** (ct > 0 ? 0.75 : p);
  let z = RING.d * Math.sign(st) * Math.abs(st) ** p;
  // a channel down the middle of each face
  const g = Math.exp(-((x / RING.gw) ** 2)) * smoothstep(0.55, 0.85, Math.abs(st));
  z -= Math.sign(st) * RING.groove * g;
  if (chan) chan.v = g;
  return out.set(RING_A * c + (nx / nl) * x, RING_B * s + (ny / nl) * x, z);
}

function buildHoopRing(): BufferGeometry {
  const cols = 240;
  const rows = 44;
  const n = (cols + 1) * (rows + 1);
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const pat = new Float32Array(n * 2);
  const sec = new Float32Array(n * 3);
  const p = new Vector3();
  const pu = new Vector3();
  const pt = new Vector3();
  const chan = { v: 0 };
  const e = 1e-4;
  let o = 0;
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    for (let j = 0; j <= rows; j++) {
      const th = (j / rows) * Math.PI * 2;
      ringPoint(u, th, p, chan);
      ringPoint(u + e, th, pu).sub(p);
      ringPoint(u, th + e, pt).sub(p);
      const nn = new Vector3().crossVectors(pu, pt).normalize();
      position.set([p.x, p.y, p.z], o * 3);
      normal.set([nn.x, nn.y, nn.z], o * 3);
      pat.set([u, j / rows], o * 2);
      sec.set([Math.cos(th), Math.sin(th), chan.v], o * 3);
      o++;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setAttribute("sec", new BufferAttribute(sec, 3));
  geo.setIndex(index);
  return geo;
}

/** beads of light down both channels: little lens-shaped studs, one per segment of the band */
function buildHoopBeads(): BufferGeometry {
  const count = 60;
  const lat = 6;
  const lon = 10;
  const r = 0.021;
  const position: number[] = [];
  const normal: number[] = [];
  const pat: number[] = [];
  const index: number[] = [];
  const c = new Vector3();
  for (const face of [1, -1])
    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count;
      ringPoint(u, (face * Math.PI) / 2, c);
      c.z += face * 0.004;
      const base = position.length / 3;
      for (let i = 0; i <= lat; i++) {
        const v = (i / lat) * Math.PI;
        for (let j = 0; j <= lon; j++) {
          const w = (j / lon) * Math.PI * 2;
          const nx = Math.sin(v) * Math.cos(w);
          const ny = Math.sin(v) * Math.sin(w);
          const nz = Math.cos(v);
          // flattened into the channel: a cabochon, not a ball
          position.push(c.x + nx * r, c.y + ny * r, c.z + nz * r * 0.6);
          normal.push(nx, ny, nz);
          pat.push(k, u);
        }
      }
      for (let i = 0; i < lat; i++)
        for (let j = 0; j < lon; j++) {
          const a = base + i * (lon + 1) + j;
          const b = a + lon + 1;
          index.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(normal), 3));
  geo.setAttribute("pat", new BufferAttribute(new Float32Array(pat), 2));
  geo.setIndex(index);
  return geo;
}
