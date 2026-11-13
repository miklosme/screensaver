import { BufferAttribute, BufferGeometry, Group, Mesh, ShaderMaterial } from "three";
import { COMMON, TONE, type Shared } from "./glsl";
import { HEM } from "./layout";

/**
 * The hen: the lid of a covered dish, a hill-sized porcelain hen asleep on her nest. Her local
 * frame has its origin at the middle of the nest on the floor plane, her head towards +X and her
 * back up +Y. She is a signed distance field (plain, pressed-glass forms: a body, a breast, a neck,
 * a head with comb, wattle and beak, a fan of tail, a wing on each side), cut off at a scalloped
 * hem and turned into a mesh once, at mount, by surface nets.
 */

// --- the field --------------------------------------------------------------------------------

type V3 = [number, number, number];

const ellipsoid = (px: number, py: number, pz: number, c: V3, r: V3) => {
  const x = (px - c[0]) / r[0];
  const y = (py - c[1]) / r[1];
  const z = (pz - c[2]) / r[2];
  const k0 = Math.hypot(x, y, z);
  const k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 < 1e-9 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
};

/** a capsule whose radius runs from ra at a to rb at b */
const roundCone = (px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number) => {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const qx = px - a[0];
  const qy = py - a[1];
  const qz = pz - a[2];
  const k = Math.min(1, Math.max(0, (qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(qx - bx * k, qy - by * k, qz - bz * k) - (ra + (rb - ra) * k);
};

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** the scalloped hem: feather tips at HEM, arches between them */
export const HEM_TIPS = 22;
const hemAt = (x: number, z: number) => HEM + 0.26 * Math.abs(Math.sin(Math.atan2(z, x) * (HEM_TIPS / 2)));

interface Parts {
  body: number;
  red: number;
  beak: number;
}

function parts(x: number, y: number, z: number, out: Parts): Parts {
  // body: a dome over the nest, its back rising to the tail, its breast full
  let d = ellipsoid(x, y, z, [0, 2.2, 0], [12.3, 7.6, 11.8]);
  d = smin(d, ellipsoid(x, y, z, [-5, 5.6, 0], [7.5, 6.4, 9]), 3);
  d = smin(d, ellipsoid(x, y, z, [6, 5, 0], [6.6, 6, 8]), 3);
  // wings, in low relief, tipped up towards the tail
  {
    const c = Math.cos(0.26);
    const s = Math.sin(0.26);
    const wx = (x + 1.5) * c - (y - 6.4) * s;
    const wy = (x + 1.5) * s + (y - 6.4) * c;
    const az = Math.abs(z);
    d = smin(d, ellipsoid(wx, wy, az, [0, 0, 9.4], [8.2, 3.9, 2.6]), 0.7);
  }
  // neck and head
  d = smin(d, roundCone(x, y, z, [6.8, 7.2, 0], [9.2, 10.6, 0], 4.1, 2.5), 1.6);
  d = smin(d, ellipsoid(x, y, z, [9.9, 11.9, 0], [3.0, 2.7, 2.5]), 1.0);
  // the tail: a fan of three plumes, flat side on
  const tz = z * 2.0;
  let tail = roundCone(x, y, tz, [-8.5, 8, 0], [-12.6, 16.2, 0], 3.0, 1.7);
  tail = smin(tail, roundCone(x, y, tz, [-8.5, 7.5, 0], [-15.2, 13.6, 0], 3.0, 1.6), 1.0);
  tail = smin(tail, roundCone(x, y, tz, [-8.5, 7, 0], [-16.6, 10.2, 0], 3.0, 1.4), 1.0);
  d = smin(d, tail * 0.6, 1.8);
  // comb and wattle, persimmon
  const cz = z * 2.2;
  let red = ellipsoid(x, y, cz, [8.3, 14.1, 0], [0.95, 1.05, 1.5]);
  red = smin(red, ellipsoid(x, y, cz, [9.4, 14.75, 0], [1.05, 1.25, 1.5]), 0.4);
  red = smin(red, ellipsoid(x, y, cz, [10.6, 14.6, 0], [1.0, 1.15, 1.5]), 0.4);
  red = smin(red, ellipsoid(x, y, cz, [11.6, 13.9, 0], [0.8, 0.9, 1.5]), 0.4);
  red *= 0.45;
  red = Math.min(red, ellipsoid(x, y, Math.abs(z), [11.9, 10.1, 0.45], [0.6, 1.15, 0.42]));
  const beak = roundCone(x, y, z, [12.3, 11.9, 0], [14.0, 11.2, 0], 0.8, 0.14);
  out.body = d;
  out.red = red;
  out.beak = beak;
  return out;
}

const tmp: Parts = { body: 0, red: 0, beak: 0 };
function field(x: number, y: number, z: number): number {
  // far outside her, a cheap bound is enough to say "outside"
  const bound = ellipsoid(x, y, z, [-1.5, 8.5, 0], [19, 11, 14]);
  if (bound > 1) return bound;
  parts(x, y, z, tmp);
  let d = smin(tmp.body, tmp.red, 0.35);
  d = smin(d, tmp.beak, 0.3);
  // cut at the hem
  return Math.max(d, hemAt(x, z) - y);
}

// --- surface nets -----------------------------------------------------------------------------

function surfaceNets(f: (x: number, y: number, z: number) => number, min: V3, max: V3, h: number) {
  const nx = Math.ceil((max[0] - min[0]) / h);
  const ny = Math.ceil((max[1] - min[1]) / h);
  const nz = Math.ceil((max[2] - min[2]) / h);
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const F = new Float32Array(sx * sy * sz);
  const at = (i: number, j: number, k: number) => i + sx * (j + sy * k);
  // a coarse pass first: a fine point whose nearest coarse sample is well away from the surface
  // takes that sample's value, since only the sign matters there
  const C = new Float32Array(sx * sy * sz).fill(NaN);
  for (let k = 0; k < sz; k += 2)
    for (let j = 0; j < sy; j += 2)
      for (let i = 0; i < sx; i += 2) C[at(i, j, k)] = f(min[0] + i * h, min[1] + j * h, min[2] + k * h);
  const even = (i: number, n: number) => Math.min(n - 1 - ((n - 1) % 2), i + (i % 2));
  for (let k = 0; k < sz; k++)
    for (let j = 0; j < sy; j++)
      for (let i = 0; i < sx; i++) {
        const c = C[at(even(i, sx), even(j, sy), even(k, sz))]!;
        F[at(i, j, k)] = Math.abs(c) > 3 * h ? c : f(min[0] + i * h, min[1] + j * h, min[2] + k * h);
      }

  const cellV = new Int32Array(nx * ny * nz).fill(-1);
  const cat = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const pos: number[] = [];
  const corners: V3[] = [];
  for (let c = 0; c < 8; c++) corners.push([c & 1, (c >> 1) & 1, (c >> 2) & 1]);
  const edges: [number, number][] = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if ([1, 2, 4].includes(a ^ b)) edges.push([a, b]);
  const vals = new Float32Array(8);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, e] = corners[c]!;
          vals[c] = F[at(i + a, j + b, k + e)]!;
          if (vals[c]! < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let n = 0;
        for (const [a, b] of edges) {
          const va = vals[a]!;
          const vb = vals[b]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const A = corners[a]!;
          const B = corners[b]!;
          px += A[0] + (B[0] - A[0]) * t;
          py += A[1] + (B[1] - A[1]) * t;
          pz += A[2] + (B[2] - A[2]) * t;
          n++;
        }
        cellV[cat(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + px / n) * h, min[1] + (j + py / n) * h, min[2] + (k + pz / n) * h);
      }

  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        // edge along x from (i, j, k)
        const s0 = F[at(i, j, k)]! < 0;
        if (s0 !== F[at(i + 1, j, k)]! < 0)
          quad(cellV[cat(i, j - 1, k - 1)]!, cellV[cat(i, j, k - 1)]!, cellV[cat(i, j, k)]!, cellV[cat(i, j - 1, k)]!, !s0);
      }
  for (let k = 1; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const s0 = F[at(i, j, k)]! < 0;
        if (s0 !== F[at(i, j + 1, k)]! < 0)
          quad(cellV[cat(i - 1, j, k - 1)]!, cellV[cat(i - 1, j, k)]!, cellV[cat(i, j, k)]!, cellV[cat(i, j, k - 1)]!, !s0);
      }
  for (let k = 0; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const s0 = F[at(i, j, k)]! < 0;
        if (s0 !== F[at(i, j, k + 1)]! < 0)
          quad(cellV[cat(i - 1, j - 1, k)]!, cellV[cat(i, j - 1, k)]!, cellV[cat(i, j, k)]!, cellV[cat(i - 1, j, k)]!, !s0);
      }
  return { pos, idx };
}

// --- the mesh ---------------------------------------------------------------------------------

/** pivot of the nod, at the root of her neck */
export const NECK: V3 = [6.4, 7.0, 0];

function henGeometry() {
  const h = 0.24;
  const { pos, idx } = surfaceNets(field, [-19, 0, -12.8], [15.2, 18.6, 12.8], h);
  const n = pos.length / 3;
  const nor = new Float32Array(n * 3);
  const red = new Float32Array(n);
  const beak = new Float32Array(n);
  const head = new Float32Array(n);
  const ao = new Float32Array(n);
  const e = 0.05;
  const p: Parts = { body: 0, red: 0, beak: 0 };
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const z = pos[v * 3 + 2]!;
    let gx = field(x + e, y, z) - field(x - e, y, z);
    let gy = field(x, y + e, z) - field(x, y - e, z);
    let gz = field(x, y, z + e) - field(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl;
    gy /= gl;
    gz /= gl;
    nor.set([gx, gy, gz], v * 3);
    parts(x, y, z, p);
    red[v] = Math.min(1, Math.max(0, (p.body - p.red) / 0.25 + 0.5));
    beak[v] = Math.min(1, Math.max(0, (Math.min(p.body, p.red) - p.beak) / 0.2 + 0.5));
    // the nod carries the head and the top of the neck
    const ax = 9.9 - NECK[0];
    const ay = 11.9 - NECK[1];
    const k = ((x - NECK[0]) * ax + (y - NECK[1]) * ay) / (ax * ax + ay * ay);
    head[v] = Math.min(1, Math.max(0, (k - 0.1) / 0.6)) * Math.min(1, Math.max(0, (x - 3) / 3));
    // hollows: how far the field opens up a little way out along the normal
    const r = 1.1;
    ao[v] = Math.min(1, Math.max(0, field(x + gx * r, y + gy * r, z + gz * r) / r));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("aRed", new BufferAttribute(red, 1));
  g.setAttribute("aBeak", new BufferAttribute(beak, 1));
  g.setAttribute("aHead", new BufferAttribute(head, 1));
  g.setAttribute("aAO", new BufferAttribute(ao, 1));
  g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : idx);
  return g;
}

export interface Hen {
  /** place this at the hen's centre; the scene moves it to lift and lean her */
  group: Group;
  mesh: Mesh;
  material: ShaderMaterial;
  dispose(): void;
}

export function buildHen(shared: Shared): Hen {
  const geo = henGeometry();
  const material = new ShaderMaterial({
    uniforms: { ...shared, uNod: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uNod;
      attribute float aRed;
      attribute float aBeak;
      attribute float aHead;
      attribute float aAO;
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vPart;
      void main() {
        // the nod: the head turns down about the root of the neck
        float a = uNod * aHead;
        float c = cos(a), s = sin(a);
        vec2 q = position.xy - vec2(${NECK[0].toFixed(2)}, ${NECK[1].toFixed(2)});
        vec3 p = vec3(vec2(c * q.x - s * q.y, s * q.x + c * q.y) + vec2(${NECK[0].toFixed(2)}, ${NECK[1].toFixed(2)}), position.z);
        vec3 n = vec3(c * normal.x - s * normal.y, s * normal.x + c * normal.y, normal.z);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vObj = position;
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * n);
        vPart = vec3(aRed, aBeak, aAO);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader:
      COMMON +
      /* glsl */ `
      #define HEM ${HEM.toFixed(3)}
      #define TIPS ${HEM_TIPS.toFixed(1)}
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vPart;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        vec3 o = vObj;
        float phi = atan(o.z, o.x);
        float hem = HEM + 0.26 * abs(sin(phi * TIPS * 0.5));
        float above = o.y - hem;

        // the honey light inside the dish shows on her underside, under the hem
        if (above < 0.02 && vN.y < -0.5) {
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.4) * 3.2, 1.0);
          ${TONE}
          return;
        }

        vec3 base = mix(BONE, CELADON, (1.0 - vPart.z) * 0.85);
        float aa = fwidth(o.y) + 0.004;
        // the hem: a gilt edge and a cobalt line that follows the scallops
        float hemLine = 1.0 - smoothstep(0.05, 0.05 + aa, abs(above - 0.42));
        // feather tips: a row of cobalt-outlined scallops above the hem
        float cell = phi * TIPS / 6.2831853;
        vec2 f = vec2(fract(cell) - 0.5, (above - 0.55) / 1.6);
        float scal = abs(length(vec2(f.x * 1.0, f.y * 1.1 + 0.05)) - 0.45);
        float feather = (1.0 - smoothstep(0.025, 0.025 + fwidth(cell) * 1.5 + 0.01, scal)) * step(0.0, f.y) * step(above, 2.4);
        base = mix(base, COBALT * 1.3, max(hemLine, feather * 0.9));

        // a closed eye: a cobalt arc with lashes, on each side of the head
        vec2 e = vec2(o.x - 10.7, o.y - 12.5);
        float side = step(1.2, abs(o.z));
        float r = length(e);
        float lid = e.y < 0.05 ? abs(r - 0.62) : 1.0;
        float eye = 1.0 - smoothstep(0.07, 0.07 + aa * 1.5, lid);
        for (int i = 0; i < 3; i++) {
          float la = -0.75 - 0.75 * float(i);
          vec2 d = vec2(cos(la), sin(la));
          float along = dot(e, d);
          float off = length(e - d * along);
          eye = max(eye, (1.0 - smoothstep(0.045, 0.045 + aa, off)) * step(0.62, along) * step(along, 0.95));
        }
        base = mix(base, COBALT, eye * side);

        base = mix(base, PERSIMMON, vPart.x);
        vec3 col = capWhite(base * lightAt(vW, n) * (0.7 + 0.3 * vPart.z));
        // gilt: the beak and the very edge of the hem
        float gild = max(vPart.y, 1.0 - smoothstep(0.08, 0.08 + aa, above));
        col = mix(col, GOLD * (1.3 + 0.9 * max(dot(n, V), 0.0)), gild);
        col += glaze(vW, n, V, 0.9);
        col = mix(col, haze(cameraPosition, -V), fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }`,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  const group = new Group();
  group.add(mesh);
  return {
    group,
    mesh,
    material,
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
