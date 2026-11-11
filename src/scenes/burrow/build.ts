import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from "three";

/**
 * Layout + procedural geometry of the burrow: a flat, single-level labyrinth made only of curves.
 * Round "junction" chambers (squashed spheroids) are joined by winding ribbed corridors. Openings
 * between the two are not modelled: the chamber shader discards the door-shaped hole and the
 * corridor shader discards whatever pokes inside a chamber spheroid (see materials.ts).
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

export interface Chamber {
  c: Vector3;
  R: number;
  H: number;
  yc: number;
  ridges: number;
  oculus: number;
  doors: Vector3[];
}

export interface GlowLight {
  p: Vector3;
  c: [number, number, number];
  r: number;
}

const v = (x: number, z: number, y = 0) => new Vector3(x, y, z);
const dir = (x: number, z: number) => new Vector3(x, 0, z).normalize();
const along = (c: Vector3, d: Vector3, dist: number, y = 0) => new Vector3(c.x + d.x * dist, y, c.z + d.z * dist);

/** resample a parametric range of a curve to (roughly) `step`-spaced points, uniform in arc length */
function sampleRange(curve: CatmullRomCurve3, ta: number, tb: number, step: number, multiple = 1): Vector3[] {
  const M = 1600;
  const fine: Vector3[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= M; i++) {
    fine.push(curve.getPoint(ta + ((tb - ta) * i) / M));
    if (i > 0) cum.push(cum[i - 1]! + fine[i]!.distanceTo(fine[i - 1]!));
  }
  const total = cum[M]!;
  const n = Math.max(multiple, Math.round(total / step / multiple) * multiple);
  const out: Vector3[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (k < M - 1 && cum[k + 1]! < s) k++;
    const f = (s - cum[k]!) / Math.max(1e-9, cum[k + 1]! - cum[k]!);
    out.push(fine[k]!.clone().lerp(fine[k + 1]!, Math.min(1, Math.max(0, f))));
  }
  return out;
}

/** arc-length lookup table over the camera spline; `at` allocates nothing */
export class PathTable {
  readonly n: number;
  readonly pos: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;
  constructor(curve: CatmullRomCurve3, n = 9000) {
    this.n = n;
    this.pos = new Float32Array((n + 1) * 3);
    this.cum = new Float32Array(n + 1);
    const p = new Vector3();
    for (let i = 0; i <= n; i++) {
      curve.getPoint(i / n, p);
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      if (i > 0) {
        const dx = p.x - this.pos[i * 3 - 3]!;
        const dy = p.y - this.pos[i * 3 - 2]!;
        const dz = p.z - this.pos[i * 3 - 1]!;
        this.cum[i] = this.cum[i - 1]! + Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
    this.length = this.cum[n]!;
  }
  /** arc length at spline parameter t (0..1) */
  sAt(t: number) {
    return this.cum[Math.round(t * this.n)]!;
  }
  at(s: number, out: Vector3) {
    const { cum, pos, n } = this;
    const ss = Math.min(this.length, Math.max(0, s));
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= ss) lo = mid;
      else hi = mid;
    }
    const a = cum[lo]!;
    const b = cum[hi]!;
    const f = b > a ? (ss - a) / (b - a) : 0;
    const i = lo * 3;
    const j = hi * 3;
    out.set(
      pos[i]! + (pos[j]! - pos[i]!) * f,
      pos[i + 1]! + (pos[j + 1]! - pos[i + 1]!) * f,
      pos[i + 2]! + (pos[j + 2]! - pos[i + 2]!) * f,
    );
    return out;
  }
}

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

/** ribbed corridor swept along floor-level points */
function buildCorridor(pts: Vector3[]): BufferGeometry {
  const rows = pts.length;
  const cols = PROFILE_SEGS;
  const position = new Float32Array(rows * (cols + 1) * 3);
  const pat = new Float32Array(rows * (cols + 1) * 2);
  const T = new Vector3();
  const side = new Vector3();
  const centres: Vector3[] = [];
  let o = 0;
  let q = 0;
  for (let i = 0; i < rows; i++) {
    const p = pts[i]!;
    T.copy(pts[Math.min(rows - 1, i + 1)]!).sub(pts[Math.max(0, i - 1)]!).normalize();
    side.crossVectors(T, UP).normalize();
    const s = i / RIB_SEGS;
    const fr = s - Math.floor(s) - 0.5;
    const ridge = Math.exp(-(fr * fr) / (2 * 0.115 * 0.115));
    // slow breathing of the bore so no two stretches are quite the same size
    const breathe = 1 + 0.05 * Math.sin(s * 0.9 + p.x * 0.3) + 0.03 * Math.sin(s * 0.37 + 1.7);
    centres.push(new Vector3(p.x, PROFILE.hc, p.z));
    for (let j = 0; j <= cols; j++) {
      const [x0, y0] = profilePoint((j / cols) * Math.PI * 2);
      const w = smoothstep(0.12, 1.3, y0);
      const m = 1 + w * (breathe - 1 + 0.07 - 0.2 * ridge);
      const x = x0 * m;
      const y = PROFILE.hc + (y0 - PROFILE.hc) * (y0 > PROFILE.hc ? m : 1);
      position[o++] = p.x + side.x * x;
      position[o++] = y;
      position[o++] = p.z + side.z * x;
      pat[q++] = s;
      pat[q++] = j / cols;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
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
  let o = 0;
  let q = 0;
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
      position[o++] = y;
      position[o++] = ch.c.z + Math.cos(th) * rho;
      pat[q++] = s;
      pat[q++] = vv;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setIndex(gridIndex(rows, cols));
  const c = new Vector3(ch.c.x, ch.yc, ch.c.z);
  finish(geo, cols, rows, () => c);
  return geo;
}

/** chamber floor: a very shallow dish with concentric ripples in the pattern coordinate */
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
      normal[o + 1] = 1;
      position[o++] = ch.c.x + Math.sin(th) * r;
      position[o++] = 0;
      position[o++] = ch.c.z + Math.cos(th) * r;
      pat[q++] = r / 1.6 + 0.5;
      pat[q++] = j / cols;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
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
function buildDoorFrame(ch: Chamber, d: Vector3): BufferGeometry {
  const pts: Vector3[] = [];
  const K = 0.95;
  const n = 56;
  const phiA = 0.5;
  const perp = new Vector3(d.z, 0, -d.x);
  for (let i = 0; i <= n; i++) {
    const phi = phiA + ((Math.PI * 2 - 2 * phiA) * i) / n;
    const [x, y] = profilePoint(phi, K);
    const e = (y - ch.yc) / ch.H;
    const rho = ch.R * Math.sqrt(Math.max(0.05, 1 - e * e));
    const f = Math.sqrt(Math.max(0.01, rho * rho - x * x)) - 0.06;
    const p = new Vector3(ch.c.x + d.x * f + perp.x * x, y, ch.c.z + d.z * f + perp.z * x);
    if (i === 0) pts.push(p.clone().setY(-0.5));
    pts.push(p);
    if (i === n) pts.push(p.clone().setY(-0.5));
  }
  return sweepTube(pts, false, 0.27, 10, d.clone().negate());
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

export function buildWorld() {
  // --- chambers -------------------------------------------------------------------------------
  const c1 = v(0, 0);
  const c2 = v(-7, -22);
  const c3 = v(33, -22);
  const d1in = dir(0, 1);
  const d1out = dir(-0.94, -0.34);
  const d1ahead = dir(0.26, -0.966);
  const d1right = dir(0.966, 0.26);
  const b2 = v(-15.6, -13.2);
  const d2in = dir(b2.x - c2.x, b2.z - c2.z);
  const d2out = dir(0.85, -0.527);
  const d2a = dir(0.1, -0.995);
  const d2b = dir(-0.9, -0.44);
  const cc2 = v(15.5, -26.6);
  const d3in = dir(cc2.x - c3.x, cc2.z - c3.z);

  const chambers: Chamber[] = [
    { c: c1, R: 6, H: 6.5, yc: 2, ridges: 14, oculus: 1.0, doors: [d1in, d1out, d1ahead, d1right] },
    { c: c2, R: 6, H: 7.5, yc: 2, ridges: 14, oculus: 1.0, doors: [d2in, d2out, d2a, d2b] },
    { c: c3, R: 11, H: 10.5, yc: 2.5, ridges: 26, oculus: 1.8, doors: [d3in] },
  ];
  const [ch1, ch2, ch3] = chambers as [Chamber, Chamber, Chamber];

  // --- the route (floor level; the camera rides EYE above it) -----------------------------------
  const IN = 1.5; // how far inside the chamber wall a corridor centreline starts
  const OUT = 2.5;
  // final straight run into the hoop
  const h3 = d3in.clone().negate(); // heading into the last chamber
  const r3 = new Vector3(-h3.z, 0, h3.x); // its right-hand side
  const ang = 0.26;
  const approach = new Vector3() // unit vector from the hoop towards the arriving camera
    .addScaledVector(h3, -Math.cos(ang))
    .addScaledVector(r3, Math.sin(ang));
  const rise = (HOOP.y - EYE - 0.3) / 5.5;
  const onLine = (dist: number) => along(c3, approach, dist, HOOP.y - EYE - dist * rise);

  const route: Vector3[] = [
    v(10, 34),
    v(7.5, 27),
    v(1.5, 21.5), // 2: camera start
    v(-2.5, 15.5),
    along(c1, d1in, ch1.R + OUT), // 4
    along(c1, d1in, ch1.R - IN), // 5: corridor A ends
    v(-2.5, 1.5),
    along(c1, d1out, ch1.R - IN), // 7: corridor B starts
    along(c1, d1out, ch1.R + OUT),
    v(-12.6, -5.2),
    v(-15.4, -9),
    b2,
    along(c2, d2in, ch2.R + OUT),
    along(c2, d2in, ch2.R - IN), // 13: corridor B ends
    v(c2.x + 1.6, c2.z + 3.1),
    along(c2, d2out, ch2.R - IN), // 15: corridor C starts
    along(c2, d2out, ch2.R + OUT),
    v(4.5, -29.2),
    v(8.5, -30.3),
    v(12.5, -28.6),
    cc2,
    along(c3, d3in, ch3.R + OUT),
    along(c3, d3in, ch3.R - IN), // 22: corridor C ends
    onLine(5.5),
    onLine(3.5),
    onLine(1.75),
    onLine(0), // 26: the hoop
    onLine(-3),
    onLine(-6),
  ];
  const START = 2;
  const HOOP_INDEX = 26;
  const spline = new CatmullRomCurve3(route, false, "centripetal");
  const table = new PathTable(spline);
  const tOf = (index: number) => index / (route.length - 1);
  const sStart = table.sAt(tOf(START)) + 3.5;
  const sHoop = table.sAt(tOf(HOOP_INDEX));

  // --- corridors --------------------------------------------------------------------------------
  const flat = (pts: Vector3[]) => pts.map((p) => p.setY(0));
  const mainCorridors = [
    [0, 5],
    [7, 13],
    [15, 22],
  ].map(([a, b]) => flat(sampleRange(spline, tOf(a!), tOf(b!), RIB_STEP, RIB_SEGS)));

  const sideDefs: { ch: Chamber; d: Vector3; mids: Vector3[]; lure: [number, number, number] }[] = [
    { ch: ch1, d: d1right, mids: [v(14, 2.5), v(19, 6), v(20.5, 12), v(17, 17.5)], lure: [0.25, 1.0, 0.7] },
    { ch: ch1, d: d1ahead, mids: [v(3.5, -13.5), v(8, -17), v(14, -16), v(19, -12)], lure: [0.55, 0.3, 1.0] },
    { ch: ch2, d: d2a, mids: [v(-7, -36), v(-11, -40.5), v(-17, -41), v(-21, -37)], lure: [1.0, 0.55, 0.2] },
    { ch: ch2, d: d2b, mids: [v(-20, -27), v(-24, -23), v(-24.5, -17), v(-21, -12.5)], lure: [0.2, 0.75, 1.0] },
  ];
  const lures: GlowLight[] = [];
  const sideCorridors = sideDefs.map((def) => {
    const curve = new CatmullRomCurve3(
      [along(def.ch.c, def.d, def.ch.R - IN), along(def.ch.c, def.d, def.ch.R + OUT), ...def.mids],
      false,
      "centripetal",
    );
    const pts = flat(sampleRange(curve, 0, 1, RIB_STEP, RIB_SEGS));
    const at = pts[Math.floor(pts.length * 0.62)]!;
    lures.push({ p: new Vector3(at.x, 2.4, at.z), c: [def.lure[0] * 3.2, def.lure[1] * 3.2, def.lure[2] * 3.2], r: 4.5 });
    return pts;
  });
  const corridorPts = [...mainCorridors, ...sideCorridors];

  // --- the thread that leads the way ---------------------------------------------------------
  const threadPts: Vector3[] = [];
  {
    const p = new Vector3();
    const end = sHoop - 0.35;
    const n = Math.round(end / 0.3);
    for (let i = 0; i <= n; i++) {
      table.at((end * i) / n, p);
      threadPts.push(new Vector3(p.x, 0.035, p.z));
    }
  }

  // --- baked light ------------------------------------------------------------------------------
  const hoopPos = new Vector3(c3.x, HOOP.y, c3.z);
  const lights: GlowLight[] = [
    { p: new Vector3(c1.x, 2.7, c1.z), c: [2.6, 1.15, 1.0], r: 3.6 },
    { p: new Vector3(c1.x, ch1.yc + ch1.H - 0.6, c1.z), c: [1.6, 0.9, 1.1], r: 3.2 },
    { p: new Vector3(c2.x, 2.9, c2.z), c: [2.4, 1.3, 0.75], r: 3.6 },
    { p: new Vector3(c2.x, ch2.yc + ch2.H - 0.6, c2.z), c: [1.3, 0.8, 1.4], r: 3.4 },
    { p: hoopPos, c: [1.0, 2.2, 1.9], r: 4.2 },
    { p: new Vector3(c3.x, ch3.yc + ch3.H - 0.8, c3.z), c: [1.9, 1.0, 1.5], r: 6.5 },
    ...lures,
  ];
  for (let i = 0; i < threadPts.length; i += 4) {
    const p = threadPts[i]!;
    lights.push({ p: new Vector3(p.x, 0.12, p.z), c: [0.07, 0.3, 0.24], r: 0.9 });
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
      const p = pts[i]!;
      const a = rnd() * 6.283;
      const rr = Math.sqrt(rnd()) * 1.15;
      addMote(p.x + Math.cos(a) * rr, 0.5 + rnd() * 3.2, p.z + Math.sin(a) * rr);
    }
  for (const ch of chambers) {
    const count = Math.round(ch.R * ch.R * 2.2);
    for (let i = 0; i < count; i++) {
      const a = rnd() * 6.283;
      const rr = Math.sqrt(rnd()) * ch.R * 0.8;
      addMote(ch.c.x + Math.cos(a) * rr, 0.4 + rnd() * rnd() * ch.H * 0.9, ch.c.z + Math.sin(a) * rr);
    }
  }
  const motes = new BufferGeometry();
  motes.setAttribute("position", new BufferAttribute(new Float32Array(motePos), 3));
  motes.setAttribute("seed", new BufferAttribute(new Float32Array(moteSeed), 4));

  const hoopYaw = Math.atan2(approach.x, approach.z);

  return {
    chambers,
    table,
    sStart,
    sHoop,
    corridors,
    corridorPts,
    shells,
    floors,
    frames,
    thread,
    hoop,
    hoopPos,
    hoopYaw,
    motes,
  };
}

export type World = ReturnType<typeof buildWorld>;
