import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { createFrame, type Stretch } from "../rail";

/**
 * Layout + procedural geometry of the burrow: a labyrinth made only of curves, grown around the
 * stretch of rail the scene rides (../rail.ts). The main tunnel is swept along the rail itself,
 * EYE below the camera, so it sweeps, dives and climbs exactly as the camera does; the rail's
 * bank is left to the camera, so the tunnel stays upright and the lean shows. Round "junction"
 * chambers (squashed spheroids) sit on the rail where it is level, each a little to the inside of
 * the bend so the camera swings round whatever floats in the middle, and side corridors curl away
 * from them. The last chamber is centred on the joint the stretch ends at.
 *
 * Openings between corridors and chambers are not modelled: the chamber shader discards the
 * door-shaped hole and the corridor shader discards whatever pokes inside a chamber spheroid
 * (see materials.ts).
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
}

/** where a corridor meets a chamber: a point on the corridor's centreline at the wall, and the way out */
export interface Door {
  /** in plan (y is ignored) */
  p: Vector3;
  /** unit, in plan: along the corridor, pointing out of the chamber */
  t: Vector3;
  /** unit, in plan: from the chamber's centre towards the door */
  dir: Vector3;
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
}

/** level of a chamber's floor at plan distance r from its centre */
export const floorY = (ch: Chamber, r: number) => ch.c.y - ch.dish * (1 - smoothstep(ch.R * 0.25, ch.R * 0.85, r));

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
  const centres: Vector3[] = [];
  let o = 0;
  let q = 0;
  let k = 0;
  for (let i = 0; i < rows; i++) {
    const { c: p, side, up } = pts[i]!;
    const s = i / RIB_SEGS;
    const fr = s - Math.floor(s) - 0.5;
    const ridge = Math.exp(-(fr * fr) / (2 * 0.115 * 0.115));
    // slow breathing of the bore so no two stretches are quite the same size
    const breathe = 1 + 0.05 * Math.sin(s * 0.9 + p.x * 0.3) + 0.03 * Math.sin(s * 0.37 + 1.7);
    centres.push(p.clone().addScaledVector(up, PROFILE.hc));
    for (let j = 0; j <= cols; j++) {
      const [x0, y0] = profilePoint((j / cols) * Math.PI * 2);
      const w = smoothstep(0.12, 1.3, y0);
      const m = 1 + w * (breathe - 1 + 0.07 - 0.2 * ridge);
      const x = x0 * m;
      const y = PROFILE.hc + (y0 - PROFILE.hc) * (y0 > PROFILE.hc ? m : 1);
      position[o++] = p.x + side.x * x + up.x * y;
      position[o++] = p.y + side.y * x + up.y * y;
      position[o++] = p.z + side.z * x + up.z * y;
      pat[q++] = s;
      pat[q++] = j / cols;
      hgt[k++] = y;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setAttribute("hgt", new BufferAttribute(hgt, 1));
  geo.setIndex(gridIndex(rows, cols));
  finish(geo, cols, rows, (i) => centres[i]!);
  return geo;
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
  let o = 0;
  let q = 0;
  let k = 0;
  for (let i = 0; i < rows; i++) {
    const vv = i / (rows - 1);
    const psi = psi0 + (psi1 - psi0) * vv;
    const y = ch.yc + ch.H * Math.sin(psi);
    for (let j = 0; j <= cols; j++) {
      const th = (j / cols) * Math.PI * 2;
      const s = (j / cols) * ch.ridges;
      const fr = s - Math.floor(s) - 0.5;
      const ridge = Math.exp(-(fr * fr) / (2 * 0.15 * 0.15));
      const rho = ch.R * Math.cos(psi) * (1 - 0.055 * ridge * (1 - 0.6 * vv) - 0.012 * Math.sin(vv * 40));
      position[o++] = ch.c.x + Math.sin(th) * rho;
      position[o++] = ch.c.y + y;
      position[o++] = ch.c.z + Math.cos(th) * rho;
      pat[q++] = s;
      pat[q++] = vv;
      hgt[k++] = y;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setAttribute("hgt", new BufferAttribute(hgt, 1));
  geo.setIndex(gridIndex(rows, cols));
  const c = new Vector3(ch.c.x, ch.c.y + ch.yc, ch.c.z);
  finish(geo, cols, rows, () => c);
  return geo;
}

/** chamber floor: a shallow dish with concentric ripples in the pattern coordinate */
function buildFloor(ch: Chamber): BufferGeometry {
  const cols = 72;
  const rows = 14;
  const position = new Float32Array(rows * (cols + 1) * 3);
  const normal = new Float32Array(rows * (cols + 1) * 3);
  const pat = new Float32Array(rows * (cols + 1) * 2);
  let o = 0;
  let q = 0;
  for (let i = 0; i < rows; i++) {
    const r = (ch.R * i) / (rows - 1);
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

/** the bead that trims a doorway, lying on the chamber's spheroid */
function buildDoorFrame(ch: Chamber, door: Door): BufferGeometry {
  const pts: Vector3[] = [];
  const K = 0.95;
  const n = 56;
  const phiA = 0.5;
  const { t } = door;
  const perp = new Vector3(t.z, 0, -t.x);
  for (let i = 0; i <= n; i++) {
    const phi = phiA + ((Math.PI * 2 - 2 * phiA) * i) / n;
    const [x, y] = profilePoint(phi, K);
    const e = (y - ch.yc) / ch.H;
    const rho = ch.R * Math.sqrt(Math.max(0.05, 1 - e * e));
    // where the corridor's outline, carried along the corridor, leaves the spheroid
    const qx = door.p.x - ch.c.x + perp.x * x;
    const qz = door.p.z - ch.c.z + perp.z * x;
    const qt = qx * t.x + qz * t.z;
    const f = -qt + Math.sqrt(Math.max(0.01, qt * qt - qx * qx - qz * qz + rho * rho)) - 0.06;
    const p = new Vector3(ch.c.x + qx + t.x * f, ch.c.y + y, ch.c.z + qz + t.z * f);
    if (i === 0) pts.push(p.clone().setY(ch.c.y - 0.5));
    pts.push(p);
    if (i === n) pts.push(p.clone().setY(ch.c.y - 0.5));
  }
  const geo = sweepTube(pts, false, 0.27, 10, t.clone().negate());
  const pos = geo.getAttribute("position") as BufferAttribute;
  const hgt = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) hgt[i] = pos.getY(i) - ch.c.y;
  geo.setAttribute("hgt", new BufferAttribute(hgt, 1));
  return geo;
}

function bake(geo: BufferGeometry, lights: GlowLight[]) {
  const pos = geo.getAttribute("position") as BufferAttribute;
  const nrm = geo.getAttribute("normal") as BufferAttribute;
  const glow = new Float32Array(pos.count * 3);
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
    }
    glow[i * 3] = r;
    glow[i * 3 + 1] = g;
    glow[i * 3 + 2] = b;
  }
  geo.setAttribute("glow", new BufferAttribute(glow, 3));
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
  /** which way the fork leaves, in degrees to the left of the camera's way through the chamber */
  leave: number;
  /** degrees it curls through, positive to the left */
  curl: number;
  length: number;
  lure: [number, number, number];
}

export function buildWorld(stretch: Stretch) {
  const f = createFrame();
  /** the tunnel's cross-section under the camera at rail distance d */
  const station = (d: number): Station => {
    stretch.frame(d, f);
    return { c: f.position.clone().addScaledVector(f.up, -EYE), side: f.right.clone(), up: f.up.clone() };
  };
  /** the camera's heading in plan at rail distance d (0 = -Z, positive to the left) */
  const headingAt = (d: number) => {
    stretch.frame(d, f);
    return Math.atan2(-f.tangent.x, -f.tangent.z);
  };
  const ahead = (heading: number) => new Vector3(-Math.sin(heading), 0, -Math.cos(heading));

  // --- chambers: on the rail where it runs level, a little to the inside of its bend ----------------
  const chambers: Chamber[] = [];
  const mids: number[] = [];
  const onRail = (d: number, inside: number, spec: ChamberSpec) => {
    const st = station(d);
    const ch: Chamber = { ...spec, dish: spec.dish ?? 0, c: st.c.clone().addScaledVector(st.side, inside), doors: [] };
    chambers.push(ch);
    mids.push(d);
    return ch;
  };
  const J = stretch.joint;
  // junction 1 sits in summer's first sweep (to the right), junction 2 in the long curl to the left
  const ch1 = onRail(J + 14, 2.6, { R: 6, H: 6.5, yc: 2, ridges: 14, oculus: 1.0 });
  const ch2 = onRail(J + 52, -2.6, { R: 6, H: 7.5, yc: 2, ridges: 14, oculus: 1.0 });
  // the dead end is centred on the joint, and its floor is dished so the hoop hangs clear of it
  const ch3 = onRail(stretch.exit, 0, { R: 11, H: 10.5, yc: 2.5, ridges: 26, oculus: 1.8, dish: HOOP.y - HOOP_LIFT - EYE });

  /** rail distance, walking from a chamber's middle in steps of `step`, at which the floor line is r from its centre */
  const crossing = (i: number, step: number, r: number) => {
    let d = mids[i]!;
    while (planDist(station(d).c, chambers[i]!.c) < r) d += step;
    return d;
  };
  const railDoor = (i: number, step: number) => {
    const ch = chambers[i]!;
    const d = crossing(i, step, ch.R * 0.97);
    const p = station(d).c;
    ch.doors.push({ p, t: ahead(headingAt(d)).multiplyScalar(Math.sign(step)), dir: new Vector3(p.x - ch.c.x, 0, p.z - ch.c.z).normalize() });
  };
  railDoor(0, -0.02);
  railDoor(0, 0.02);
  railDoor(1, -0.02);
  railDoor(1, 0.02);
  railDoor(2, -0.02);

  // --- the main tunnel: swept along the rail, from chamber to chamber ---------------------------
  const sweep = (from: number, to: number) => {
    const n = Math.max(RIB_SEGS, Math.round((to - from) / RIB_STEP / RIB_SEGS) * RIB_SEGS);
    const pts: Station[] = [];
    for (let i = 0; i <= n; i++) pts.push(station(from + ((to - from) * i) / n));
    return pts;
  };
  const mainCorridors = [
    sweep(-BEHIND, crossing(0, -0.02, ch1.R - IN)),
    sweep(crossing(0, 0.02, ch1.R - IN), crossing(1, -0.02, ch2.R - IN)),
    sweep(crossing(1, 0.02, ch2.R - IN), crossing(2, -0.02, ch3.R - IN)),
  ];

  // --- forks: level corridors that leave a junction and curl out of sight -------------------------
  const forks: ForkSpec[] = [
    // junction 1: both on the outside of the sweep, one curling on ahead and one back the way we came
    { ch: ch1, leave: -65, curl: 110, length: 20, lure: [0.25, 1.0, 0.7] },
    { ch: ch1, leave: -118, curl: -70, length: 20, lure: [0.55, 0.3, 1.0] },
    // junction 2: both on the outside of the curl, parting like a wishbone
    { ch: ch2, leave: -115, curl: -130, length: 24, lure: [1.0, 0.55, 0.2] },
    { ch: ch2, leave: -55, curl: 130, length: 24, lure: [0.2, 0.75, 1.0] },
  ];
  const lures: GlowLight[] = [];
  const sideCorridors = forks.map((fork) => {
    const { ch } = fork;
    const start = headingAt(mids[chambers.indexOf(ch)]!) + (fork.leave * Math.PI) / 180;
    const dir = ahead(start);
    const n = Math.round(fork.length / RIB_STEP / RIB_SEGS) * RIB_SEGS;
    const step = fork.length / n;
    // straight through the wall, then the curl eases in
    const bend = (s: number) => ((fork.curl * Math.PI) / 180) * smoothstep(IN + OUT, fork.length + 4, s) ** 1.2;
    const p = new Vector3(ch.c.x, ch.c.y, ch.c.z).addScaledVector(dir, ch.R - IN);
    const pts: Station[] = [];
    for (let i = 0; i <= n; i++) {
      const h = start + bend(i * step);
      pts.push({ c: p.clone(), side: new Vector3(Math.cos(h), 0, -Math.sin(h)), up: UP });
      p.addScaledVector(ahead(start + bend((i + 0.5) * step)), step);
    }
    ch.doors.push({ p: new Vector3(ch.c.x, 0, ch.c.z).addScaledVector(dir, ch.R * 0.97), t: dir, dir });
    const at = pts[Math.floor(pts.length * 0.62)]!.c;
    lures.push({ p: new Vector3(at.x, at.y + 2.4, at.z), c: [fork.lure[0] * 3.2, fork.lure[1] * 3.2, fork.lure[2] * 3.2], r: 4.5 });
    return pts;
  });
  const corridorPts = [...mainCorridors, ...sideCorridors];

  // --- the thread that leads the way: the rail's own line, laid on the floor ------------------------
  const threadPts: Vector3[] = [];
  {
    const from = -BEHIND + 1;
    const end = stretch.exit - 0.35;
    const n = Math.round((end - from) / 0.3);
    for (let i = 0; i <= n; i++) {
      const st = station(from + ((end - from) * i) / n);
      const r = planDist(st.c, ch3.c);
      if (r < ch3.R) st.c.y = floorY(ch3, r);
      threadPts.push(st.c.addScaledVector(st.up, 0.035));
    }
  }

  // --- baked light ------------------------------------------------------------------------------
  const hoopPos = stretch.frame(stretch.exit).position.clone();
  hoopPos.y += HOOP_LIFT;
  const above = (ch: Chamber, h: number) => new Vector3(ch.c.x, ch.c.y + h, ch.c.z);
  const sights = [above(ch1, 2.7), above(ch2, 2.9)];
  const lights: GlowLight[] = [
    { p: sights[0]!, c: [2.6, 1.15, 1.0], r: 3.6 },
    { p: above(ch1, ch1.yc + ch1.H - 0.6), c: [1.6, 0.9, 1.1], r: 3.2 },
    { p: sights[1]!, c: [2.4, 1.3, 0.75], r: 3.6 },
    { p: above(ch2, ch2.yc + ch2.H - 0.6), c: [1.3, 0.8, 1.4], r: 3.4 },
    { p: hoopPos, c: [1.0, 2.2, 1.9], r: 4.2 },
    { p: above(ch3, ch3.yc + ch3.H - 0.8), c: [1.9, 1.0, 1.5], r: 6.5 },
    ...lures,
  ];
  for (let i = 0; i < threadPts.length; i += 4) {
    const p = threadPts[i]!;
    lights.push({ p: new Vector3(p.x, p.y + 0.085, p.z), c: [0.07, 0.3, 0.24], r: 0.9 });
  }

  // --- geometry ---------------------------------------------------------------------------------
  const corridors = corridorPts.map(buildCorridor);
  const shells = chambers.map(buildChamber);
  const floors = chambers.map(buildFloor);
  const frames: BufferGeometry[] = [];
  for (const ch of chambers) for (const d of ch.doors) frames.push(buildDoorFrame(ch, d));
  const thread = sweepTube(threadPts, false, 0.04, 6, UP);
  for (const g of [...corridors, ...shells, ...floors, ...frames]) bake(g, lights);

  // hoop: a thin elliptical band, far too thin to hold anything
  const hoopPts: Vector3[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    hoopPts.push(new Vector3(Math.cos(a) * (HOOP.rx + 0.09), Math.sin(a) * (HOOP.ry + 0.09), 0));
  }
  const hoop = sweepTube(hoopPts, true, 0.1, 10, new Vector3(0, 0, 1));

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
      const { c, side, up } = pts[i]!;
      const x = Math.cos(rnd() * 6.283) * Math.sqrt(rnd()) * 1.15;
      const y = 0.5 + rnd() * 3.2;
      addMote(c.x + side.x * x + up.x * y, c.y + side.y * x + up.y * y, c.z + side.z * x + up.z * y);
    }
  for (const ch of chambers) {
    const count = Math.round(ch.R * ch.R * 2.2);
    for (let i = 0; i < count; i++) {
      const a = rnd() * 6.283;
      const rr = Math.sqrt(rnd()) * ch.R * 0.8;
      addMote(ch.c.x + Math.cos(a) * rr, ch.c.y + 0.4 + rnd() * rnd() * ch.H * 0.9, ch.c.z + Math.sin(a) * rr);
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
    sights,
    hoop,
    hoopPos,
    hoopYaw,
    /** unit vector in plan from the hoop towards the arriving camera */
    arrive,
    motes,
  };
}

export type World = ReturnType<typeof buildWorld>;
