import { BufferAttribute, BufferGeometry, DoubleSide, Matrix3, Matrix4, Mesh, ShaderMaterial, Vector3 } from "three";
import { COMMON, TONE, type Shared } from "./glsl";
import { CENTRE, FLOOR_Y, LIP_R, TAU, UNDER_Y, inHole, rng, type Layout } from "./layout";

/**
 * Teetering stacks of crockery: cups on saucers, nested bowls, plates, lidded jars, a teapot.
 * Half stand on the glaze and teeter, half hang from the underside and swing, and a slow sway
 * travels across the whole field. All of them are one merged geometry and one draw; the sway is
 * done in the vertex shader from the clock.
 */

type Profile = [number, number][];

/** lathe profiles, outside from the foot up to the rim, then the inside back down to the middle */
const PROFILES: Record<string, { p: Profile; rim: number; h: number; nest: number }> = {
  saucer: {
    p: [[0, 0], [0.42, 0], [0.46, 0.04], [0.8, 0.1], [0.97, 0.17], [1.0, 0.2], [0.95, 0.2], [0.78, 0.13], [0.46, 0.09], [0, 0.09]],
    rim: 5, h: 0.2, nest: 0.07,
  },
  plate: {
    p: [[0, 0], [0.62, 0], [0.66, 0.03], [1.12, 0.08], [1.24, 0.13], [1.25, 0.15], [1.2, 0.15], [1.08, 0.1], [0.64, 0.06], [0, 0.06]],
    rim: 5, h: 0.15, nest: 0.06,
  },
  bowl: {
    p: [[0, 0], [0.33, 0], [0.36, 0.05], [0.62, 0.17], [0.79, 0.36], [0.85, 0.52], [0.86, 0.55], [0.81, 0.55], [0.75, 0.38], [0.57, 0.2], [0.3, 0.1], [0, 0.09]],
    rim: 6, h: 0.55, nest: 0.16,
  },
  cup: {
    p: [[0, 0], [0.23, 0], [0.26, 0.04], [0.4, 0.17], [0.48, 0.42], [0.51, 0.62], [0.52, 0.66], [0.47, 0.66], [0.45, 0.43], [0.37, 0.2], [0.21, 0.1], [0, 0.09]],
    rim: 6, h: 0.66, nest: 0.66,
  },
  jar: {
    p: [[0, 0], [0.34, 0], [0.48, 0.12], [0.57, 0.42], [0.53, 0.78], [0.36, 0.94], [0.31, 0.97], [0.34, 1.02], [0.26, 1.07], [0.1, 1.1], [0.07, 1.14], [0.11, 1.2], [0, 1.24]],
    rim: 7, h: 1.24, nest: 1.24,
  },
  teapot: {
    p: [[0, 0], [0.4, 0], [0.6, 0.1], [0.72, 0.36], [0.64, 0.64], [0.4, 0.78], [0.37, 0.8], [0.38, 0.84], [0.24, 0.88], [0.08, 0.91], [0.06, 0.95], [0.1, 1.01], [0, 1.04]],
    rim: 6, h: 1.04, nest: 1.04,
  },
};

interface Piece {
  pos: number[];
  nor: number[];
  pat: number[];
  idx: number[];
}

function lathe(prof: Profile, rim: number, segs: number, paint: number, out: Piece) {
  const base = out.pos.length / 3;
  const n = prof.length;
  // arc length along the profile: v runs 0 .. 1 outside (foot to rim), 1 .. 2 inside
  const len: number[] = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1]! + Math.hypot(prof[i]![0] - prof[i - 1]![0], prof[i]![1] - prof[i - 1]![1]));
  const vOf = (i: number) => (i <= rim ? len[i]! / len[rim]! : 1 + (len[i]! - len[rim]!) / Math.max(1e-6, len[n - 1]! - len[rim]!));
  for (let i = 0; i < n; i++) {
    // profile normal from the neighbouring segments, pointing out of the solid
    const a = prof[Math.max(0, i - 1)]!;
    const b = prof[Math.min(n - 1, i + 1)]!;
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // outward = tangent rotated clockwise (profile runs up the outside)
    const nr = ty;
    const ny = -tx;
    for (let j = 0; j <= segs; j++) {
      const u = j / segs;
      const c = Math.cos(u * TAU);
      const s = Math.sin(u * TAU);
      out.pos.push(prof[i]![0] * c, prof[i]![1], prof[i]![0] * s);
      out.nor.push(nr * c, ny, nr * s);
      out.pat.push(u, vOf(i), paint);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < segs; j++) {
      const p = base + i * (segs + 1) + j;
      const q = p + segs + 1;
      out.idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
}

/** a tube along a polyline in the xy plane: handles and spouts */
function tube(path: [number, number][], radius: (k: number) => number, paint: number, out: Piece, ring = 8) {
  const base = out.pos.length / 3;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(n - 1, i + 1)]!;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const r = radius(i / (n - 1));
    for (let j = 0; j <= ring; j++) {
      const w = (j / ring) * TAU;
      const c = Math.cos(w);
      const s = Math.sin(w);
      out.pos.push(path[i]![0] + nx * c * r, path[i]![1] + ny * c * r, s * r);
      out.nor.push(nx * c, ny * c, s);
      out.pat.push(0, -1, paint);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < ring; j++) {
      const p = base + i * (ring + 1) + j;
      const q = p + ring + 1;
      out.idx.push(p, p + 1, q, p + 1, q + 1, q);
    }
}

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

/** one piece of crockery, unit scale, standing on y = 0 */
function piece(kind: keyof typeof PROFILES, segs: number, paint: number): Piece {
  const out: Piece = { pos: [], nor: [], pat: [], idx: [] };
  const P = PROFILES[kind]!;
  lathe(P.p, P.rim, segs, paint, out);
  if (kind === "cup") tube(arc(0.5, 0.36, 0.17, -1.45, 1.45, 10), () => 0.042, paint, out);
  if (kind === "teapot") {
    tube(arc(-0.7, 0.42, 0.24, Math.PI * 0.5, Math.PI * 1.5, 12), () => 0.05, paint, out);
    const spout: [number, number][] = Array.from({ length: 9 }, (_, i) => {
      const k = i / 8;
      return [0.6 + 0.46 * k, 0.28 + 0.5 * k * k + 0.05 * k];
    });
    tube(spout, (k) => 0.13 - 0.08 * k, paint, out);
  }
  return out;
}

export interface Stack {
  /** where it meets the slab */
  x: number;
  z: number;
  hanging: boolean;
  /** its whole height and its widest radius */
  height: number;
  radius: number;
}

const STACK_KINDS: (keyof typeof PROFILES)[][] = [
  ["plate", "plate", "saucer", "cup", "saucer", "cup", "saucer", "cup", "saucer", "cup"],
  ["plate", "bowl", "bowl", "bowl", "bowl", "saucer", "cup", "bowl", "bowl", "jar"],
  ["saucer", "cup", "plate", "bowl", "bowl", "saucer", "cup", "saucer", "cup", "teapot"],
  ["plate", "plate", "plate", "bowl", "saucer", "cup", "plate", "bowl", "bowl", "bowl", "saucer", "cup"],
  ["bowl", "bowl", "bowl", "plate", "saucer", "jar"],
  ["plate", "saucer", "cup", "saucer", "cup", "plate", "plate", "bowl", "saucer", "cup", "saucer", "cup", "teapot"],
];

/** a cup's rim takes the next piece, a bowl nests the next bowl, a plate stacks on a plate */
function sitHeight(below: keyof typeof PROFILES, above: keyof typeof PROFILES) {
  const P = PROFILES[below]!;
  if (below === above && (below === "bowl" || below === "plate" || below === "saucer")) return P.nest;
  return P.h;
}

export interface Stacks {
  mesh: Mesh;
  shade: Mesh;
  stacks: Stack[];
  dispose(): void;
}

export function buildStacks(shared: Shared, layout: Layout): Stacks {
  const rand = rng(2024);
  const stacks: (Stack & { scale: number; kind: number; pieces: number })[] = [];
  const hen = layout.hen;

  // the view from the approach to the hen stays open: the wedge from the track to her flanks
  const viewRays: [Vector3, Vector3][] = [];
  for (const s of layout.track)
    if (s.t >= 17.5 && s.t <= 25 && Math.round(s.t * 10) % 5 === 0)
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        const side = new Vector3(-(hen.z - s.p.z), 0, hen.x - s.p.x).normalize().multiplyScalar(13 * k);
        viewRays.push([s.p.clone().setY(0), hen.clone().add(side).setY(0)]);
      }
  const segDist = (x: number, z: number, a: Vector3, b: Vector3) => {
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const k = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
    return Math.hypot(x - a.x - ex * k, z - a.z - ez * k);
  };

  const fits = (x: number, z: number, hanging: boolean, height: number, radius: number) => {
    if (inHole(x, z, radius + 1.8)) return false;
    const dh = Math.hypot(x - hen.x, z - hen.z);
    if (dh < LIP_R + (hanging ? 2.5 : 5) + radius) return false;
    const y0 = hanging ? UNDER_Y - height - 2.4 : FLOOR_Y - 1;
    const y1 = hanging ? UNDER_Y + 1 : FLOOR_Y + height + 2.4;
    if (layout.clear(x, z, y0, y1) < radius + 2.6) return false;
    for (const s of stacks) if (s.hanging === hanging && Math.hypot(s.x - x, s.z - z) < s.radius + radius + 0.8) return false;
    if (!hanging) for (const [a, b] of viewRays) if (segDist(x, z, a, b) < radius + 0.5) return false;
    return true;
  };
  const tryPlace = (x: number, z: number, hanging: boolean, scale: number, kind: number, pieces: number) => {
    const height = estimateHeight(kind, pieces) * scale;
    const radius = 1.3 * scale;
    if (!fits(x, z, hanging, height, radius)) return false;
    stacks.push({ x, z, hanging, height, radius, scale, kind, pieces });
    return true;
  };

  // the teapot at the foot of a long hanging stack, passing on the right at t = 8
  tryPlace(3.5, -16, true, 1.55, 5, 13);
  // the avenue: stacks standing to the right of the approach, near enough to pass
  const fp = createAvenue(layout);
  for (const [x, z, s] of fp) tryPlace(x, z, false, s, Math.floor(rand() * STACK_KINDS.length), 6 + Math.floor(rand() * 6));

  let guard = 0;
  let under = 0;
  let over = 0;
  while ((under < 56 || over < 30) && guard++ < 6000) {
    const hanging = under < 56 && (over >= 30 || rand() < 0.6);
    const r = 9 + 95 * rand() ** 1.6;
    const a = rand() * TAU;
    const x = CENTRE.x + Math.cos(a) * r;
    const z = CENTRE.z + Math.sin(a) * r;
    // nearer ones are smaller and keep the eye's level clear; far ones are tall enough to make a skyline
    const far = Math.min(1, Math.max(0, (r - 25) / 70));
    const scale = (0.9 + 0.6 * rand()) * (1 + 1.5 * far);
    const kind = Math.floor(rand() * STACK_KINDS.length);
    const pieces = 5 + Math.floor(rand() * (STACK_KINDS[kind]!.length - 4));
    if (tryPlace(x, z, hanging, scale, kind, pieces)) hanging ? under++ : over++;
  }

  const geo = mergeStacks(stacks, rand);
  const mesh = new Mesh(geo, material(shared));
  mesh.frustumCulled = false;
  const shade = new Mesh(shadeGeometry(stacks), shadeMaterial(shared));
  shade.frustumCulled = false;
  shade.renderOrder = 1;
  return {
    mesh,
    shade,
    stacks,
    dispose() {
      geo.dispose();
      (mesh.material as ShaderMaterial).dispose();
      shade.geometry.dispose();
      (shade.material as ShaderMaterial).dispose();
    },
  };
}

function estimateHeight(kind: number, pieces: number) {
  const list = STACK_KINDS[kind]!.slice(0, pieces);
  let h = 0;
  for (let i = 0; i < list.length; i++) h += i + 1 < list.length ? sitHeight(list[i]!, list[i + 1]!) : PROFILES[list[i]!]!.h;
  return h;
}

/** spots beside the last stretch of track, on the side away from the hen */
function createAvenue(layout: Layout): [number, number, number][] {
  const out: [number, number, number][] = [];
  const rand = rng(31);
  for (const s of layout.track) {
    if (s.t < 17.2 || s.t > 24.6 || Math.round(s.t * 10) % 6 !== 0) continue;
    const right = new Vector3(-s.fwd.z, 0, s.fwd.x).normalize();
    const off = 4.2 + rand() * 3;
    const ahead = 1.5 + rand() * 2;
    out.push([s.p.x + right.x * off + s.fwd.x * ahead, s.p.z + right.z * off + s.fwd.z * ahead, 0.8 + rand() * 0.5]);
    if (rand() < 0.6) {
      const off2 = 9 + rand() * 6;
      out.push([s.p.x + right.x * off2, s.p.z + right.z * off2, 1.1 + rand() * 0.7]);
    }
  }
  return out;
}

function mergeStacks(stacks: (Stack & { scale: number; kind: number; pieces: number })[], rand: () => number) {
  const pos: number[] = [];
  const nor: number[] = [];
  const pat: number[] = [];
  const sta: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  const cache = new Map<string, Piece>();
  const m = new Matrix4();
  const r = new Matrix4();
  const nm = new Matrix3();
  const v = new Vector3();
  for (const st of stacks) {
    const seed = rand();
    const list = STACK_KINDS[st.kind]!.slice(0, st.pieces);
    const segs = st.radius > 2.5 ? 20 : 28;
    // one paint for the whole stack mostly, a few odd pieces
    const stackPaint = Math.floor(rand() * 5);
    let y = 0;
    let ox = 0;
    let oz = 0;
    const top = st.height;
    for (let i = 0; i < list.length; i++) {
      const kind = list[i]!;
      const paint = rand() < 0.75 ? stackPaint : Math.floor(rand() * 5);
      const key = `${kind}:${segs}:${paint}`;
      let p = cache.get(key);
      if (!p) cache.set(key, (p = piece(kind, segs, paint)));
      // teetering: each piece a little off the one below, and a little tipped
      ox += (rand() - 0.5) * 0.07;
      oz += (rand() - 0.5) * 0.07;
      const tip = (rand() - 0.5) * 0.07;
      const ta = rand() * TAU;
      r.makeRotationAxis(v.set(Math.cos(ta), 0, Math.sin(ta)), tip);
      m.makeScale(st.scale, st.scale, st.scale).premultiply(r);
      m.premultiply(new Matrix4().makeRotationY(rand() * TAU));
      m.setPosition(ox * st.scale, y * st.scale, oz * st.scale);
      nm.getNormalMatrix(m);
      const base = pos.length / 3;
      const sgn = st.hanging ? -1 : 1;
      for (let k = 0; k < p.pos.length / 3; k++) {
        v.set(p.pos[k * 3]!, p.pos[k * 3 + 1]!, p.pos[k * 3 + 2]!).applyMatrix4(m);
        const h = v.y;
        pos.push(st.x + v.x, (st.hanging ? UNDER_Y : FLOOR_Y) + sgn * v.y, st.z + v.z);
        v.set(p.nor[k * 3]!, p.nor[k * 3 + 1]!, p.nor[k * 3 + 2]!).applyMatrix3(nm).normalize();
        nor.push(v.x, sgn * v.y, v.z);
        pat.push(p.pat[k * 3]!, p.pat[k * 3 + 1]!, p.pat[k * 3 + 2]!);
        sta.push(st.x, st.hanging ? UNDER_Y : FLOOR_Y, st.z, sgn * top);
        sway.push(Math.max(0, h) / Math.max(top, 0.1), seed);
      }
      for (let k = 0; k < p.idx.length; k += 3) {
        // a mirrored piece turns its triangles inside out
        if (st.hanging) idx.push(base + p.idx[k]!, base + p.idx[k + 2]!, base + p.idx[k + 1]!);
        else idx.push(base + p.idx[k]!, base + p.idx[k + 1]!, base + p.idx[k + 2]!);
      }
      if (i + 1 < list.length) y += sitHeight(kind, list[i + 1]!);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("aPat", new BufferAttribute(new Float32Array(pat), 3));
  g.setAttribute("aStack", new BufferAttribute(new Float32Array(sta), 4));
  g.setAttribute("aSway", new BufferAttribute(new Float32Array(sway), 2));
  g.setIndex(pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : idx);
  return g;
}

/** the sway: a bend that grows up the stack, its phase travelling across the field */
const SWAY = /* glsl */ `
  vec3 swayed(vec3 p, vec4 st, vec2 sw) {
    float k = pow(sw.x, 1.5);
    float ph = uT * (0.55 + 0.25 * sw.y) + sw.y * 40.0 - dot(st.xz, vec2(0.045, 0.03));
    float a = 0.035 * (0.6 + 0.8 * sw.y) * sin(ph) + 0.012 * sin(ph * 2.3 + 1.0);
    vec2 dir = vec2(cos(sw.y * 30.0), sin(sw.y * 30.0));
    p.xz += dir * a * k * abs(st.w);
    return p;
  }
`;

function material(shared: Shared) {
  return new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      uniform float uT;
      attribute vec3 aPat;
      attribute vec4 aStack;
      attribute vec2 aSway;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vPat;
      ${SWAY}
      void main() {
        vec3 p = swayed(position, aStack, aSway);
        vW = p;
        vN = normal;
        vPat = aPat;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader:
      COMMON +
      /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vPat;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        if (dot(n, V) < 0.0) n = -n;
        float u = vPat.x;
        float v = vPat.y;
        float paint = vPat.z;
        vec3 base = BONE;
        float aa = fwidth(v) + 0.002;
        float line = 0.0;
        float gild = 0.0;
        if (v >= 0.0) {
          // a cobalt line under the rim on every piece
          line = 1.0 - smoothstep(0.018, 0.018 + aa, abs(v - 0.9));
          if (paint < 0.5) {
            line = max(line, 1.0 - smoothstep(0.012, 0.012 + aa, abs(v - 0.83)));
          } else if (paint < 1.5) {
            // willow brushwork: a zigzag between two bands
            float zig = 0.62 + 0.06 * abs(fract(u * 18.0) * 2.0 - 1.0) * 2.0 - 0.06;
            line = max(line, 1.0 - smoothstep(0.016, 0.016 + aa, abs(v - zig)));
            line = max(line, 1.0 - smoothstep(0.03, 0.03 + aa, abs(v - 0.48)));
          } else if (paint < 2.5) {
            gild = 1.0 - smoothstep(0.03, 0.03 + aa, abs(v - 1.0));
            float dots = length(vec2((fract(u * 24.0) - 0.5) * 2.2, (v - 0.7) * 14.0));
            line = max(line, 1.0 - smoothstep(0.45, 0.6, dots));
          } else if (paint < 3.5) {
            base = mix(BONE, CELADON, 0.75);
            gild = 1.0 - smoothstep(0.025, 0.025 + aa, abs(v - 1.0));
          } else {
            line = max(line, smoothstep(0.55, 0.56, v) * (1.0 - smoothstep(0.78, 0.79, v)) * step(0.5, fract(u * 12.0 + v * 3.0)));
          }
          // glaze pooled celadon in the bottom of the inside
          base = mix(base, CELADON, 0.6 * smoothstep(1.45, 1.95, v));
        }
        base = mix(base, COBALT, line);
        vec3 col = capWhite(base * lightAt(vW, n));
        col = mix(col, GOLD * (1.4 + 0.8 * max(dot(n, V), 0.0)), gild);
        col += glaze(vW, n, V, 0.7);
        col = mix(col, haze(cameraPosition, -V), fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }`,
    side: DoubleSide,
  });
}

/** a soft dark disc where each stack meets the slab: they touch it */
function shadeGeometry(stacks: Stack[]) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const s of stacks) {
    const R = s.radius * 1.5;
    const y = s.hanging ? UNDER_Y - 0.008 : FLOOR_Y + 0.008;
    const o = pos.length / 3;
    pos.push(s.x - R, y, s.z - R, s.x + R, y, s.z - R, s.x + R, y, s.z + R, s.x - R, y, s.z + R);
    uv.push(-1, -1, 1, -1, 1, 1, -1, 1);
    if (s.hanging) idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

function shadeMaterial(shared: Shared) {
  return new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        float a = (1.0 - smoothstep(0.35, 1.0, r)) * 0.55;
        gl_FragColor = vec4(0.12, 0.17, 0.11, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

