import {
  BufferAttribute,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Material,
} from "three";

/**
 * The small life of the dune garden: drifts of flowers along the way, pinwheels turning on tall
 * stalks, and two flocks of paper birds circling high overhead.
 *
 * All three are single instanced draws animated in the vertex shader from the scene clock.
 * Flowers stay below knee height, pinwheels are planted clear of the camera's track, and the
 * birds never come below the tree tops, so none of them can cross the line of flight.
 */

const TAU = Math.PI * 2;
type RGB = [number, number, number];

// three's ACES filmic curve, which the director's final pass applies to every scene (post.ts)
const ACES_IN = new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777).invert();
const ACES_OUT = new Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert();
/** the curve's fit `(v (v + a) - b) / (v (c v + d) + e)`, solved for v */
const unfit = (y: number) => {
  y = Math.min(Math.max(y, 0), 0.99);
  const A = y * 0.983729 - 1;
  const B = y * 0.432951 - 0.0245786;
  const C = y * 0.238081 + 0.000090537;
  return (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A);
};
const _v = new Vector3();
/**
 * The linear light that reaches the screen as `hex`.
 *
 * The final tone curve squeezes bright colours together and greys them, so a pastel has to go in
 * far more saturated than it comes out (a candy pink is about 7 : 1 : 1.5, and above 1 in red).
 * The scene's palette is therefore written as the colours a viewer should see, and solved back
 * through the curve here. Colours near white ask for a lot of light; keep channels below ~0xf4.
 */
export function onScreen(hex: string): RGB {
  const c = new Color(hex);
  _v.set(c.r, c.g, c.b).applyMatrix3(ACES_OUT);
  _v.set(unfit(_v.x), unfit(_v.y), unfit(_v.z)).applyMatrix3(ACES_IN);
  return [Math.max(0, _v.x * 0.6), Math.max(0, _v.y * 0.6), Math.max(0, _v.z * 0.6)];
}
/** `onScreen` as a GLSL vec3 */
export const glScreen = (hex: string) => `vec3(${onScreen(hex).map((v) => v.toFixed(4)).join(",")})`;

export interface GardenOptions {
  ground: (x: number, z: number) => number;
  /** true where nothing else stands within r of (x, z) and the camera does not pass */
  clear: (x: number, z: number, r: number) => boolean;
  /** points along the camera's track (the drifts the garden first had were placed from these) */
  path: { x: number; z: number }[];
  /** evenly spaced points along the camera's track: the flower beds border it */
  track: { x: number; z: number }[];
  /** true where no flower may grow: the stele's plinth, the doorways, the stepping stones */
  blocked: (x: number, z: number) => boolean;
  rnd: () => number;
  /** GLSL defining `vec3 applyFog(vec3 colour, float distance)` */
  fogGlsl: string;
  /** the scene's sun, pointing towards it */
  sun: { x: number; y: number; z: number };
  /** GLSL defining `float groundAt(vec2 xz)`, the same dunes as `ground` */
  groundGlsl: string;
  /** a cast-shadow material around the given vertex shader, which sets vW and vA (see dollhouse.tsx) */
  shadowMaterial: (vertexShader: string) => ShaderMaterial;
  /** a contact-shadow material around the given vertex shader, which sets vW, vA and vQ (see dollhouse.tsx) */
  contactMaterial: (vertexShader: string) => ShaderMaterial;
}

export interface Garden {
  root: Group;
  /** each flower drift: centre, radius and petal colour (linear light), for the shadow and the fallen petals under it */
  drifts: { x: number; z: number; r: number; hue: RGB }[];
  /** foot of each pinwheel stalk, and the height of its hub (the stalk's shadow is baked with the scene's) */
  pinwheels: { x: number; z: number; size: number; top: number }[];
  /** `eye` the camera's position, `at` a point it looks towards: the flowers drawn are those in view */
  update(t: number, eye: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }): void;
  dispose(): void;
}

const VARYINGS = /* glsl */ `
  varying vec3 vCol;
  varying vec3 vW;
`;
const FRAGMENT = (fogGlsl: string, flat: boolean) => /* glsl */ `
  ${VARYINGS}
  ${fogGlsl}
  void main() {
    vec3 col = vCol;
    ${
      flat
        ? /* glsl */ `
    // folded paper: every facet takes its own share of the sun
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    col *= 0.62 + 0.5 * abs(dot(n, normalize(vec3(0.45, 0.6, 0.75))));`
        : ""
    }
    gl_FragColor = vec4(applyFog(col, length(cameraPosition - vW)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function geometry(pos: number[], part: number[]) {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aPart", new BufferAttribute(new Float32Array(part), 1));
  return g;
}

/** a small generator of its own (mulberry32) */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** draws from `rnd` exactly what the garden's first flower drifts drew, so later placements keep their places */
function skipOldDrifts(rnd: () => number, path: { x: number; z: number }[]) {
  const COUNT = 3200;
  let n = 0;
  while (n < COUNT) {
    const at = path[Math.floor(rnd() * path.length)]!;
    const a = rnd() * TAU;
    const d = 3 + rnd() ** 1.5 * 34;
    const cx = at.x + Math.cos(a) * d;
    const cz = at.z + Math.sin(a) * d;
    rnd();
    const spread = 1.2 + rnd() * 3.5;
    rnd();
    const k = Math.min(COUNT - n, 10 + Math.floor(rnd() * 40));
    for (let i = 0; i < k; i++) {
      const b = rnd() * TAU;
      const r = spread * Math.sqrt(rnd());
      if (Math.hypot(cx + Math.cos(b) * r, cz + Math.sin(b) * r) > 8.6) rnd();
      rnd();
      n++;
    }
  }
}

type V3 = [number, number, number];
/** an indexed mesh grown part by part, each part a grid of points f(u, v), its normals from f's slopes */
class Sheet {
  pos: number[] = [];
  nor: number[] = [];
  part: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** `up` says which way the part's front faces (and its normals) should point at a sample point */
  grid(f: (u: number, v: number) => V3, nu: number, nv: number, part: number, up: (q: V3, n: V3) => number) {
    const base = this.pos.length / 3;
    const e = 1e-3;
    const normal = (u: number, v: number): V3 => {
      const a = f(u + e, v);
      const b = f(u - e, v);
      const c = f(u, v + e);
      const d = f(u, v - e);
      const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      const n: V3 = [du[1]! * dv[2]! - du[2]! * dv[1]!, du[2]! * dv[0]! - du[0]! * dv[2]!, du[0]! * dv[1]! - du[1]! * dv[0]!];
      const l = Math.hypot(...n);
      return l < 1e-12 ? [0, 0, 0] : [n[0] / l, n[1] / l, n[2] / l];
    };
    const mid = normal(0.5, 0.5);
    const flip = up(f(0.5, 0.5), mid) < 0 ? -1 : 1;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const u = i / nu;
        const v = j / nv;
        let n = normal(u, v);
        if (n[0] === 0 && n[1] === 0 && n[2] === 0) n = normal(Math.max(u, 0.02), v);
        this.pos.push(...f(u, v));
        this.nor.push(n[0] * flip, n[1] * flip, n[2] * flip);
        this.part.push(part);
        this.uv.push(u, v);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = base + i * (nv + 1) + j;
        const b = a + nv + 1;
        if (flip > 0) this.idx.push(a, b, a + 1, b, b + 1, a + 1);
        else this.idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  geometry() {
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("aPart", new BufferAttribute(new Float32Array(this.part), 1));
    g.setAttribute("aUV", new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** where the stem ends and the head sits, a flower being 1 tall */
const HEAD_X = 0.12;
const HEAD_Y = 0.96;
/** the distances over which a flower hands over to its few-triangle self; grass is gone a little past them */
const LOD_NEAR = 8.5;
const LOD_FAR = 12.5;

interface FlowerKind {
  petals: number;
  /** petal length and half width */
  len: number;
  width: number;
  /** how far the petals rise towards their tips, roll up at their rims, and curl back at the end */
  cup: number;
  roll: number;
  curl: number;
  eye: number;
}
const FLOWER_KINDS: FlowerKind[] = [
  // a cosmos: eight broad-tipped petals in a shallow bowl
  { petals: 8, len: 0.36, width: 0.12, cup: 0.5, roll: 0.45, curl: 0.35, eye: 0.11 },
  // a cupped poppy: five round petals, deep
  { petals: 5, len: 0.34, width: 0.21, cup: 1.1, roll: 0.3, curl: 0.12, eye: 0.1 },
  // a daisy: nine narrow rays round a big eye, curling back at their tips
  { petals: 9, len: 0.4, width: 0.075, cup: 0.3, roll: 0.6, curl: 0.7, eye: 0.14 },
];

/** a flower of kind k; `far` is the few-triangle one drawn where it is only a few pixels across */
function flowerGeometry(k: FlowerKind, far = false) {
  const s = new Sheet();
  // the stem: a quadratic curve from the foot to the head, tapering
  const P1 = [-0.04, 0.5];
  const bez = (u: number) => [2 * (1 - u) * u * P1[0]! + u * u * HEAD_X, 2 * (1 - u) * u * P1[1]! + u * u * HEAD_Y];
  const tan = (u: number) => {
    const t = [2 * (1 - u) * P1[0]! + 2 * u * (HEAD_X - P1[0]!), 2 * (1 - u) * P1[1]! + 2 * u * (HEAD_Y - P1[1]!)];
    const l = Math.hypot(t[0]!, t[1]!);
    return [t[0]! / l, t[1]! / l];
  };
  s.grid(
    (u, v) => {
      const [x, y] = bez(u);
      const [tx, ty] = tan(u);
      const r = 0.03 - 0.015 * u;
      const a = v * TAU;
      // across the curve in its plane is (ty, -tx); the other way is z
      return [x! + r * Math.cos(a) * ty!, y! - r * Math.cos(a) * tx!, r * Math.sin(a)];
    },
    far ? 1 : 2,
    far ? 2 : 3,
    0,
    (q, n) => n[2] * q[2] + n[0] * (q[0] - bez(0.5)[0]!) + n[1] * (q[1] - bez(0.5)[1]!),
  );
  // the head, nodding along the stem's last direction
  const [hx, hy] = tan(1);
  const th = Math.atan2(hx!, hy!);
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const head =
    (f: (u: number, v: number) => V3) =>
    (u: number, v: number): V3 => {
      const [x, y, z] = f(u, v);
      return [HEAD_X + x * ct + y * st, HEAD_Y - x * st + y * ct, z];
    };
  const outward = (q: V3, n: V3) => n[0] * (q[0] - HEAD_X) + n[2] * q[2];
  const upward = (_q: V3, n: V3) => -n[0] * st + n[1] * ct;
  // the calyx: a little cone up to the head, and five pointed sepals turned down under it
  if (!far) s.grid(
    head((u, v) => {
      const r = 0.016 + (k.eye * 0.75 - 0.016) * u ** 1.6;
      return [r * Math.cos(v * TAU), -0.07 + 0.065 * u, r * Math.sin(v * TAU)];
    }),
    1,
    5,
    3,
    outward,
  );
  for (let j = 0; j < (far ? 0 : 5); j++) {
    const a = (j / 5) * TAU + 0.3;
    s.grid(
      head((u, v) => {
        const r = k.eye * 0.5 + 0.14 * u;
        const w = 0.045 * (1 - u) * (v * 2 - 1);
        return [Math.cos(a) * r - Math.sin(a) * w, -0.02 - 0.09 * u * u, Math.sin(a) * r + Math.cos(a) * w];
      }),
      1,
      1,
      3,
      upward,
    );
  }
  // the petals
  for (let j = 0; j < k.petals; j++) {
    const a = (j / k.petals) * TAU + (j % 2) * 0.04;
    const lift = (j % 2) * 0.012;
    s.grid(
      head((u, v) => {
        const vv = v * 2 - 1;
        // far off, a petal is one quad: cut off before its tip, so that it stays broad
        if (far) u = 0.12 + 0.68 * u;
        const r = k.eye * 0.55 + u * k.len;
        const w = (far ? 1.3 : 1) * k.width * Math.sqrt(Math.max(0, 1 - ((u - 0.42) / 0.58) ** 2)) * (0.4 + 0.6 * Math.min(1, u * 3));
        const y = lift + k.cup * k.len * 0.6 * u ** 1.6 + k.roll * vv * vv * w - k.curl * k.len * Math.max(0, u - 0.6) ** 2 * 3;
        return [Math.cos(a) * r - Math.sin(a) * vv * w, y, Math.sin(a) * r + Math.cos(a) * vv * w];
      }),
      far ? 1 : 3,
      1,
      1,
      upward,
    );
  }
  // the eye: a low dome
  s.grid(
    head((u, v) => {
      const r = k.eye * u;
      return [r * Math.cos(v * TAU), 0.02 + 0.045 * (1 - u * u), r * Math.sin(v * TAU)];
    }),
    1,
    far ? 4 : 6,
    2,
    upward,
  );
  return s.geometry();
}

/** a tuft of grass: five tapering blades leaning out, 1 tall */
function tuftGeometry() {
  const s = new Sheet();
  const r = seeded(77);
  for (let j = 0; j < 5; j++) {
    const a = (j / 5) * TAU + r() * 0.9;
    const h = 0.55 + r() * 0.45;
    const lean = 0.2 + r() * 0.35;
    s.grid(
      (u, v) => {
        const w = 0.04 * (1 - u) ** 0.8 * (v * 2 - 1);
        const out = 0.03 + lean * u * u;
        return [Math.cos(a) * out - Math.sin(a) * w, h * u - 0.1 * lean * u * u, Math.sin(a) * out + Math.cos(a) * w];
      },
      3,
      1,
      4,
      (q, n) => n[0] * q[0] + n[2] * q[2],
    );
  }
  return s.geometry();
}

export function createGarden(o: GardenOptions): Garden {
  const { rnd, ground } = o;
  const root = new Group();
  const drifts: Garden["drifts"] = [];
  const pinwheels: Garden["pinwheels"] = [];
  const materials: ShaderMaterial[] = [];
  const geometries: InstancedBufferGeometry[] = [];
  const pools: {
    g: InstancedBufferGeometry;
    list: { x: number; z: number }[];
    d0: number;
    d1: number;
    attrs: { a: InstancedBufferAttribute; from: Float32Array }[];
  }[] = [];
  const add = (g: InstancedBufferGeometry, m: ShaderMaterial) => {
    if (!m.uniforms.uT) m.uniforms.uT = { value: 0 };
    const mesh = new Mesh(g, m as Material);
    mesh.frustumCulled = false;
    root.add(mesh);
    materials.push(m);
    geometries.push(g);
  };
  const shader = (vertexShader: string, flat = false) =>
    new ShaderMaterial({ uniforms: { uT: { value: 0 } }, vertexShader, fragmentShader: FRAGMENT(o.fogGlsl, flat), side: DoubleSide });

  // -------------------------------------------------------------------------------------------
  // flowers and grass. Every flower is a bent, tapering stem, a green calyx, a ring of cupped
  // petals whose rims roll up and whose tips curl back, and a domed eye; three shapes of head
  // (aPart 0 stem, 1 petal, 2 eye, 3 calyx; tufts of grass are aPart 4). They grow in beds that
  // border the camera's way, and each stands in a soft shadow of its own (a decal, see below).
  // -------------------------------------------------------------------------------------------
  {
    // the drifts the scene had before are still drawn from `rnd`, so that everything placed after
    // them (the pinwheels) stays where it was; the beds have a generator of their own
    skipOldDrifts(rnd, o.path);
    const rb = seeded(90731);

    const kinds = FLOWER_KINDS.map((k) => flowerGeometry(k));
    const tuftGeo = tuftGeometry();
    type Plant = { x: number; y: number; z: number; s: number; hue: RGB; ph: number };
    const byKind: Plant[][] = kinds.map(() => []);
    const tufts: Plant[] = [];
    const P = o.track;
    const lane = (x: number, z: number) => {
      let best = Infinity;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i]!;
        const b = P[i + 1]!;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const k = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(x - a.x - ex * k, z - a.z - ez * k));
      }
      return best;
    };
    // deeper than the sand they stand on in every case, so that a bed is a patch of colour from afar
    const hues = ["#f285a2", "#f4cc55", "#ea6a98", "#74aef0", "#b094ec", "#f4955a", "#5fcdb0"].map(onScreen);
    const grass = ["#8cc49a", "#a3d2a2", "#93ccb2"].map(onScreen);
    const plant = (list: Plant[], x: number, z: number, s: number, hue: RGB, clearance: number) => {
      if (o.blocked(x, z) || lane(x, z) < clearance) return false;
      list.push({ x, y: ground(x, z) - 0.02, z, s, hue, ph: rb() * TAU });
      return true;
    };
    /** a bed: an ellipse `along` by `across`, centred at (cx, cz), its long axis along (tx, tz) */
    const bed = (cx: number, cz: number, tx: number, tz: number, along: number, across: number, density: number, near: boolean) => {
      const hue = hues[Math.floor(rb() * hues.length)]!;
      const main = Math.floor(rb() * kinds.length);
      const size = near ? 0.3 + rb() * 0.16 : 0.26 + rb() * 0.18;
      const count = Math.round(Math.PI * along * across * density);
      for (let i = 0; i < count; i++) {
        const rr = Math.sqrt(rb());
        const b = rb() * TAU;
        const lx = Math.cos(b) * rr * along;
        const lz = Math.sin(b) * rr * across;
        const x = cx + tx * lx - tz * lz;
        const z = cz + tz * lx + tx * lz;
        // taller in the middle of a bed, so that it mounds
        const s = size * (0.62 + 0.5 * (1 - rr * rr)) * (0.85 + 0.3 * rb());
        const kind = rb() < 0.82 ? main : Math.floor(rb() * kinds.length);
        plant(byKind[kind]!, x, z, s, hue, 1.15);
      }
      // grass round the rim of the bed
      for (let i = 0, m = Math.round((along + across) * 3); i < m; i++) {
        const b = rb() * TAU;
        const rr = 0.85 + 0.35 * rb();
        const x = cx + tx * Math.cos(b) * rr * along - tz * Math.sin(b) * rr * across;
        const z = cz + tz * Math.cos(b) * rr * along + tx * Math.sin(b) * rr * across;
        plant(tufts, x, z, 0.24 + rb() * 0.16, grass[Math.floor(rb() * grass.length)]!, 0.95);
      }
      if (Math.hypot(cx, cz) > 9.5) drifts.push({ x: cx, z: cz, r: Math.sqrt(along * across), hue });
    };
    const along = (i: number) => {
      const a = P[i]!;
      const b = P[Math.min(P.length - 1, i + 1)]!;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { a, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l };
    };
    // beds bordering the way, on both sides: clusters of two or three, each its own colour,
    // overlapping one another along the way
    for (let n = 0; n < 30; n++) {
      const { a, tx, tz } = along(Math.floor(rb() * (P.length - 1)));
      const side = rb() < 0.5 ? -1 : 1;
      const off = 1.6 + rb() ** 1.4 * 5.5;
      for (let m = 0, k = 2 + Math.floor(rb() * 2); m < k; m++) {
        const lA = 1.1 + rb() * 1.6;
        const lB = 0.6 + rb() * 0.8;
        const s = (m - (k - 1) / 2) * 1.7 + (rb() - 0.5) * 0.6;
        const o2 = off + lB * 0.6 + (rb() - 0.3) * 1.2;
        bed(a.x - tz * side * o2 + tx * s, a.z + tx * side * o2 + tz * s, tx, tz, lA, lB, 7 + rb() * 3, true);
      }
    }
    // and further out, round drifts that read as patches of colour across the garden
    for (let n = 0; n < 28; n++) {
      const { a } = along(Math.floor(rb() * (P.length - 1)));
      const ang = rb() * TAU;
      const d = 9 + rb() ** 1.5 * 30;
      const r = 1.2 + rb() * 1.6;
      bed(a.x + Math.cos(ang) * d, a.z + Math.sin(ang) * d, 1, 0, r, r, 4.2, false);
    }
    // grass, and a few small blossoms, close beside the way
    for (let n = 0; n < 1100; n++) {
      const { a, tx, tz } = along(Math.floor(rb() * (P.length - 1)));
      const side = rb() < 0.5 ? -1 : 1;
      const off = 1.0 + rb() ** 1.6 * 4.5;
      const sl = (rb() - 0.5) * 2;
      const x = a.x - tz * side * off + tx * sl;
      const z = a.z + tx * side * off + tz * sl;
      if (rb() < 0.2) plant(byKind[Math.floor(rb() * kinds.length)]!, x, z, 0.13 + rb() * 0.08, hues[Math.floor(rb() * hues.length)]!, 1.0);
      else plant(tufts, x, z, 0.2 + rb() * 0.2, grass[Math.floor(rb() * grass.length)]!, 0.9);
    }

    const material = (far: number) => new ShaderMaterial({
      uniforms: { uT: { value: 0 }, uFar: { value: far } },
      side: DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aPart;
        attribute vec2 aUV;
        attribute vec4 aPlace; // foot, size
        attribute vec4 aLook;  // colour, phase
        uniform float uT;
        uniform float uFar;
        varying vec3 vCol;
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vUP;
        void main() {
          // near the eye the full flower; past ${LOD_NEAR} m the few-triangle one; between, one
          // shrinks into the sand as the other grows out of it
          // each flower hands over at a distance of its own, the two overlapping for a stride, so
          // the change never sweeps across a bed as a line and nothing shrinks
          float dist = length(cameraPosition - aPlace.xyz);
          float swap = ${LOD_NEAR.toFixed(1)} + ${(LOD_FAR - LOD_NEAR).toFixed(1)} * fract(aLook.w * 7.13);
          float grow = uFar > 1.5 ? 1.0 - smoothstep(${(LOD_FAR - 3).toFixed(1)}, ${(LOD_FAR + 2).toFixed(1)}, dist)
                     : uFar > 0.5 ? step(swap - 0.5, dist) : step(dist, swap + 0.5);
          if (grow <= 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          float yaw = aLook.w * 5.0;
          mat2 R = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw));
          vec3 p = position;
          vec3 n = normal;
          p.xz = R * p.xz;
          n.xz = R * n.xz;
          // a breeze crosses the garden in slow waves; the stem bends, and the head nods with it
          float gust = sin(uT * 1.4 + aPlace.x * 0.22 + aPlace.z * 0.17) + 0.4 * sin(uT * 3.1 + aLook.w);
          float k = 0.16 * gust * (aPart > 3.5 ? 0.7 : 1.0);
          p.x += k * position.y * position.y;
          n.y -= 2.0 * k * position.y * n.x;
          vW = aPlace.xyz + p * aPlace.w * grow;
          vN = normalize(n);
          vUP = vec3(aUV, aPart);
          vCol = aPart < 0.5 ? ${glScreen("#3f9468")} * (0.45 + 0.6 * position.y)
               : aPart < 1.5 ? aLook.rgb
               : aPart < 2.5 ? ${glScreen("#5c2a50")}
               : aPart < 3.5 ? ${glScreen("#4f9f6c")}
               : aLook.rgb * (0.5 + 0.6 * position.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vUP;
        const vec3 SUN = vec3(${o.sun.x.toFixed(4)}, ${o.sun.y.toFixed(4)}, ${o.sun.z.toFixed(4)});
        ${o.fogGlsl}
        void main() {
          vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
          vec3 col = vCol;
          float part = vUP.z;
          if (part > 0.5 && part < 1.5) {
            float u = vUP.x;
            float across = abs(vUP.y * 2.0 - 1.0);
            // deeper at the heart, paler towards the rim, a fine crease down the middle
            col *= mix(0.7, 1.07, smoothstep(0.0, 0.8, u));
            col *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.2, across)) * (1.0 - 0.7 * u);
            // the underside is a duskier shade of the same colour
            if (!gl_FrontFacing) col *= vec3(0.64, 0.58, 0.7);
          } else if (part > 1.5 && part < 2.5) {
            // the eye: a ring of pollen round a dark middle
            col = mix(col, ${glScreen("#e8b85a")}, 0.55 * smoothstep(0.55, 0.85, vUP.x));
          }
          // a wrapped sun, so that the side turned from it is shaded, never black
          float w = clamp(dot(n, SUN) * 0.5 + 0.5, 0.0, 1.0);
          col *= 0.55 + 0.56 * w;
          gl_FragColor = vec4(applyFog(col, length(cameraPosition - vW)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const nearMat = material(0);
    const farMat = material(1);
    const grassMat = material(2);
    materials.push(nearMat, farMat, grassMat);
    /**
     * Instances drawn from a list: every frame only those in view and within [d0, d1) of the eye
     * are copied to the front of the geometry's instance buffers, so nothing out of sight is
     * transformed at all.
     */
    const pool = (g: InstancedBufferGeometry, m: ShaderMaterial, list: Plant[], d0: number, d1: number, src: Record<string, Float32Array>) => {
      const attrs = Object.entries(src).map(([name, from]) => {
        const a = new InstancedBufferAttribute(new Float32Array(from.length), 4);
        a.setUsage(DynamicDrawUsage);
        g.setAttribute(name, a);
        return { a, from };
      });
      g.instanceCount = 0;
      const mesh = new Mesh(g, m);
      mesh.frustumCulled = false;
      root.add(mesh);
      geometries.push(g);
      pools.push({ g, list, d0, d1, attrs });
    };
    const plantAttrs = (list: Plant[]) => {
      const place = new Float32Array(Math.max(1, list.length) * 4);
      const look = new Float32Array(Math.max(1, list.length) * 4);
      list.forEach((f, i) => {
        place.set([f.x, f.y, f.z, f.s], i * 4);
        look.set([f.hue[0], f.hue[1], f.hue[2], f.ph], i * 4);
      });
      return { aPlace: place, aLook: look };
    };
    kinds.forEach((g, i) => {
      const list = byKind[i]!;
      const src = plantAttrs(list);
      pool(g, nearMat, list, 0, LOD_FAR + 1, src);
      pool(flowerGeometry(FLOWER_KINDS[i]!, true), farMat, list, LOD_NEAR - 1, 64, src);
    });
    pool(tuftGeo, grassMat, tufts, 0, LOD_FAR + 2, plantAttrs(tufts));

    // the shadows: a dark pool at each foot, and a soft one where the sun throws the head
    const dg = new InstancedBufferGeometry();
    const corners = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
    const dpos: number[] = [];
    const dpart: number[] = [];
    for (let q = 0; q < 2; q++) {
      for (let c = 0; c < 4; c++) {
        dpos.push(corners[c * 2]!, 0, corners[c * 2 + 1]!);
        dpart.push(q);
      }
    }
    dg.setAttribute("position", new BufferAttribute(new Float32Array(dpos), 3));
    dg.setAttribute("aPart", new BufferAttribute(new Float32Array(dpart), 1));
    // wound to face up
    dg.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    const all = byKind.flat().map((f) => [f, 1] as const);
    const dec = new Float32Array(all.length * 4);
    const dec2 = new Float32Array(all.length * 4);
    all.forEach(([f], i) => {
      dec.set([f.x, f.y, f.z, f.s], i * 4);
      // phase, the foot pool's width, the head's shadow, the foot pool's strength
      dec2.set([f.ph, 0.42, 0.3, 0.65], i * 4);
    });
    const DECAL_VS = /* glsl */ `
        attribute float aPart;
        attribute vec4 aDec;
        attribute vec4 aDec2;
        uniform float uT;
        varying vec3 vW;
        varying float vA;
        varying vec2 vQ;
        const vec3 SUN = vec3(${o.sun.x.toFixed(4)}, ${o.sun.y.toFixed(4)}, ${o.sun.z.toFixed(4)});
        ${o.groundGlsl}
        void main() {
          vec3 c = aDec.xyz;
          float d;
          // only near the eye: further off the bed's own broad shadow is enough
          float fade = 1.0 - smoothstep(${(LOD_FAR - 5).toFixed(1)}, ${(LOD_FAR + 2).toFixed(1)}, length(cameraPosition - c));
          if (fade <= 0.0 || aDec2.z <= 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          if (aPart < 0.5) {
            d = aDec2.y * aDec.w;
            vA = aDec2.w * fade;
          } else {
            if (aDec2.z <= 0.0) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              return;
            }
            // the head, swaying as the flower does, thrown along the sun onto the sand
            float yaw = aDec2.x * 5.0;
            float gust = sin(uT * 1.4 + c.x * 0.22 + c.z * 0.17) + 0.4 * sin(uT * 3.1 + aDec2.x);
            vec2 head = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw)) * vec2(${HEAD_X.toFixed(3)}, 0.0) + vec2(0.16 * gust * ${(HEAD_Y * HEAD_Y).toFixed(3)}, 0.0);
            c.xz += (head - SUN.xz / SUN.y * ${HEAD_Y.toFixed(3)}) * aDec.w;
            d = 0.95 * aDec.w;
            vA = aDec2.z * fade;
          }
          vec3 w = vec3(c.x + position.x * d, 0.0, c.z + position.z * d);
          w.y = groundAt(w.xz) + 0.03;
          vW = w;
          vQ = position.xz;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`;
    const decalMat = o.contactMaterial(DECAL_VS);
    if (!decalMat.uniforms.uT) decalMat.uniforms.uT = { value: 0 };
    materials.push(decalMat);
    pool(dg, decalMat, all.map(([f]) => f), 0, LOD_FAR + 3, { aDec: dec, aDec2: dec2 });
    if (import.meta.env.DEV) console.debug(`dollhouse: ${byKind.map((l) => l.length).join(" + ")} flowers, ${tufts.length} tufts`);
  }

  // -------------------------------------------------------------------------------------------
  // pinwheels: a stalk, four two-tone sails and a hub (aPart 0 / 1 / 2 / 3)
  // -------------------------------------------------------------------------------------------
  {
    const pos: number[] = [];
    const part: number[] = [];
    const tri = (a: number[], b: number[], c: number[], p: number) => {
      pos.push(...a, ...b, ...c);
      part.push(p, p, p);
    };
    const STALK = 3.2;
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * TAU;
      const a1 = ((k + 1) / 4) * TAU;
      const w = 0.035;
      const at = (a: number, y: number) => [Math.cos(a) * w, y, Math.sin(a) * w - 0.05];
      tri(at(a0, -STALK), at(a1, -STALK), at(a1, 0), 0);
      tri(at(a0, -STALK), at(a1, 0), at(a0, 0), 0);
    }
    const sail = (r: number, a: number, z = 0) => [Math.cos(a) * r, Math.sin(a) * r, z];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      tri(sail(0, 0), sail(1, a), sail(0.68, a + TAU / 8, 0.1), 1);
      tri(sail(0, 0), sail(0.68, a + TAU / 8, 0.1), sail(0.36, a + TAU / 4, 0.16), 2);
    }
    for (let k = 0; k < 6; k++) tri(sail(0, 0, 0.2), sail(0.1, (k / 6) * TAU, 0.18), sail(0.1, ((k + 1) / 6) * TAU, 0.18), 3);
    const g = geometry(pos, part);

    const COUNT = 54;
    const place = new Float32Array(COUNT * 4);
    const spin = new Float32Array(COUNT * 4);
    const hues = ["#ee6f8e", "#f4c540", "#4fc6ac", "#659eee", "#a888f0", "#f48650"].map(onScreen);
    const hue = new Float32Array(COUNT * 3);
    for (let n = 0, tries = 0; n < COUNT && tries < 4000; tries++) {
      const a = rnd() * TAU;
      const r = 14 + rnd() ** 0.8 * 70;
      const x = Math.cos(a) * r;
      const z = 18 + Math.sin(a) * r;
      const size = 0.9 + rnd() ** 1.5 * 1.7;
      if (!o.clear(x, z, 4 + size)) continue;
      place.set([x, ground(x, z) + STALK * size - 0.1, z, size], n * 4);
      pinwheels.push({ x, z, size, top: ground(x, z) + STALK * size - 0.1 });
      spin.set([rnd() * TAU, (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 2.6) / size, rnd() * TAU, 0], n * 4);
      hue.set(hues[Math.floor(rnd() * hues.length)]!, n * 3);
      n++;
    }
    g.setAttribute("aPlace", new InstancedBufferAttribute(place, 4));
    g.setAttribute("aSpin", new InstancedBufferAttribute(spin, 4));
    g.setAttribute("aHue", new InstancedBufferAttribute(hue, 3));
    g.instanceCount = COUNT;
    // the dune under each pinwheel as a plane (normal, offset), for its shadow
    const plane = new Float32Array(COUNT * 4);
    pinwheels.forEach((p, i) => {
      const e = 1.5;
      const nx = ground(p.x - e, p.z) - ground(p.x + e, p.z);
      const nz = ground(p.x, p.z - e) - ground(p.x, p.z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      const [ax, ay, az] = [nx / l, (2 * e) / l, nz / l];
      plane.set([ax, ay, az, ax * p.x + ay * (ground(p.x, p.z) + 0.05) + az * p.z], i * 4);
    });
    const sg = new InstancedBufferGeometry();
    for (const name of ["position", "aPart"]) sg.setAttribute(name, g.getAttribute(name));
    for (const name of ["aPlace", "aSpin"]) sg.setAttribute(name, g.getAttribute(name));
    sg.setAttribute("aPlane", new InstancedBufferAttribute(plane, 4));
    sg.instanceCount = COUNT;
    const shadowOf = (vs: string) => Object.assign(o.shadowMaterial(vs), { side: DoubleSide });
    add(
      sg,
      shadowOf(/* glsl */ `
        attribute float aPart;
        attribute vec4 aPlace;
        attribute vec4 aSpin;
        attribute vec4 aPlane; // ground normal, offset
        uniform float uT;
        varying vec3 vW;
        varying float vA;
        varying vec2 vQ;
        const vec3 SUN = vec3(${o.sun.x.toFixed(4)}, ${o.sun.y.toFixed(4)}, ${o.sun.z.toFixed(4)});
        ${o.groundGlsl}
        void main() {
          // the stalk's shadow is baked into the sand with every other still thing's
          if (aPart < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec3 p = position;
          if (aPart > 0.5) {
            float a = aSpin.z + uT * aSpin.y;
            float c = cos(a), s = sin(a);
            p.xy = mat2(c, s, -s, c) * p.xy;
          }
          float c = cos(aSpin.x), s = sin(aSpin.x);
          p.xz = mat2(c, s, -s, c) * p.xz;
          vec3 w0 = aPlace.xyz + p * aPlace.w;
          // slid along the sun onto the dune: first onto its tangent plane under the stalk, then
          // onto the dune itself, so the shadow lies on the sand however it curves
          float k = (dot(aPlane.xyz, w0) - aPlane.w) / dot(aPlane.xyz, SUN);
          for (int i = 0; i < 3; i++) k = (w0.y - groundAt(w0.xz - SUN.xz * k) - 0.04) / SUN.y;
          vec3 w = w0 - SUN * k;
          vW = w;
          // the sails' shadow is a little lighter, and paler still far off, where it would only flicker
          vA = 0.85 * (1.0 - 0.6 * smoothstep(25.0, 110.0, length(cameraPosition - w)));
          vQ = vec2(0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`),
    );
    add(
      g,
      shader(
        /* glsl */ `
        attribute float aPart;
        attribute vec4 aPlace; // hub, size
        attribute vec4 aSpin;  // yaw, speed, phase
        attribute vec3 aHue;
        uniform float uT;
        ${VARYINGS}
        void main() {
          vec3 p = position;
          if (aPart > 0.5) {
            float a = aSpin.z + uT * aSpin.y;
            float c = cos(a), s = sin(a);
            p.xy = mat2(c, s, -s, c) * p.xy;
          }
          float c = cos(aSpin.x), s = sin(aSpin.x);
          p.xz = mat2(c, s, -s, c) * p.xz;
          vW = aPlace.xyz + p * aPlace.w;
          vCol = aPart < 0.5 ? ${glScreen("#8d6a80")} : aPart < 1.5 ? aHue : aPart < 2.5 ? ${glScreen("#f4ecd8")} : ${glScreen("#5a2a4c")};
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
        true,
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // paper birds: a folded body and two wings that beat (aPart: 0 body, +-1 wing tip)
  // -------------------------------------------------------------------------------------------
  {
    const pos: number[] = [];
    const part: number[] = [];
    const tri = (a: number[], b: number[], c: number[], pa: number, pb: number, pc: number) => {
      pos.push(...a, ...b, ...c);
      part.push(pa, pb, pc);
    };
    // body: a long keel, nose up at +z, tail fanned at -z
    tri([0, 0.06, 0.75], [0.1, 0, 0.1], [-0.1, 0, 0.1], 0, 0, 0);
    tri([0.1, 0, 0.1], [-0.1, 0, 0.1], [0, -0.12, -0.2], 0, 0, 0);
    tri([0.1, 0, 0.1], [0, -0.12, -0.2], [0.16, 0.05, -0.7], 0, 0, 0);
    tri([-0.1, 0, 0.1], [0, -0.12, -0.2], [-0.16, 0.05, -0.7], 0, 0, 0);
    tri([0, 0.06, 0.75], [0, 0.2, 0.95], [0, 0.02, 0.55], 0, 0, 0);
    for (const sgn of [1, -1]) {
      tri([sgn * 0.08, 0.01, 0.28], [sgn * 0.08, 0.01, -0.3], [sgn * 1.25, 0.01, -0.22], 0, 0, sgn);
      tri([sgn * 0.08, 0.01, 0.28], [sgn * 1.25, 0.01, -0.22], [sgn * 0.7, 0.01, 0.2], 0, sgn, sgn * 0.6);
    }
    const g = geometry(pos, part);

    const COUNT = 46;
    const orbit = new Float32Array(COUNT * 4);
    const bird = new Float32Array(COUNT * 4);
    const hues = ["#f3f0ea", "#f4d3c0", "#c4e8d6", "#cbdff6", "#f4e6ac"].map(onScreen);
    const hue = new Float32Array(COUNT * 3);
    for (let n = 0; n < COUNT; n++) {
      const flock = n % 2;
      const lead = flock ? 2.6 : 3.1; // where each flock is when the scene begins
      const r = (flock ? 50 : 82) + (rnd() - 0.5) * 30;
      const speed = (flock ? -1 : 1) * (7.5 + rnd() * 1.5);
      orbit.set([r, lead + (rnd() - 0.5) * 0.75 * (60 / r), (flock ? 17 : 24) + rnd() * 14, speed / r], n * 4);
      bird.set([2.4 + rnd() * 1.8, rnd() * TAU, 4.5 + rnd() * 2, rnd()], n * 4);
      hue.set(hues[Math.floor(rnd() * hues.length)]!, n * 3);
    }
    g.setAttribute("aOrbit", new InstancedBufferAttribute(orbit, 4));
    g.setAttribute("aBird", new InstancedBufferAttribute(bird, 4));
    g.setAttribute("aHue", new InstancedBufferAttribute(hue, 3));
    g.instanceCount = COUNT;
    add(
      g,
      shader(
        /* glsl */ `
        attribute float aPart;
        attribute vec4 aOrbit; // radius, angle, height, angular speed
        attribute vec4 aBird;  // size, phase, wing beat, seed
        attribute vec3 aHue;
        uniform float uT;
        ${VARYINGS}
        void main() {
          float ang = aOrbit.y + uT * aOrbit.w;
          float dir = sign(aOrbit.w);
          vec3 centre = vec3(aOrbit.x * cos(ang), aOrbit.z + 2.5 * sin(uT * 0.5 + aBird.y), 18.0 + aOrbit.x * sin(ang));
          vec3 fwd = vec3(-sin(ang), 0.0, cos(ang)) * dir;
          vec3 right = vec3(fwd.z, 0.0, -fwd.x);
          // a few strong beats, then a glide
          float beat = sin(uT * aBird.z + aBird.y) * (0.35 + 0.65 * smoothstep(-0.2, 0.5, sin(uT * 0.7 + aBird.y * 3.0)));
          vec3 p = position;
          float reach = abs(aPart);
          float lift = beat * 0.95 + 0.2;
          p.y += abs(p.x) * sin(lift) * reach;
          p.x *= mix(1.0, cos(lift), reach);
          p.y -= 0.12 * beat * (1.0 - reach);
          vW = centre + (right * p.x + vec3(0.0, p.y, 0.0) + fwd * p.z) * aBird.x;
          vCol = aHue * (1.0 + 0.15 * reach);
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
        true,
      ),
    );
  }

  // pools drawn from one list are chosen in one pass over it
  const poolGroups = new Map<object, typeof pools>();
  for (const p of pools) poolGroups.set(p.list, [...(poolGroups.get(p.list) ?? []), p]);
  let last: number[] = [];

  return {
    root,
    drifts,
    pinwheels,
    update(t, eye, at) {
      for (const m of materials) m.uniforms.uT!.value = t;
      // what is in view: a cone round the line of sight a little wider than the widest view
      if (eye.x === last[0] && eye.y === last[1] && eye.z === last[2] && at.x === last[3] && at.z === last[4]) return;
      last = [eye.x, eye.y, eye.z, at.x, at.z];
      let fx = at.x - eye.x;
      let fz = at.z - eye.z;
      const fl = Math.sqrt(fx * fx + fz * fz) || 1;
      fx /= fl;
      fz /= fl;
      const ey = (eye.y - 1) * (eye.y - 1);
      for (const group of poolGroups.values()) {
        const list = group[0]!.list;
        const counts = group.map(() => 0);
        for (let i = 0; i < list.length; i++) {
          const f = list[i]!;
          const dx = f.x - eye.x;
          const dz = f.z - eye.z;
          const d = Math.sqrt(dx * dx + dz * dz + ey);
          if (dx * fx + dz * fz < 0.5 * d - 2.5) continue;
          for (let k = 0; k < group.length; k++) {
            const p = group[k]!;
            if (d < p.d0 || d >= p.d1) continue;
            const n = counts[k]!;
            for (const { a, from } of p.attrs) {
              const to = a.array as Float32Array;
              to[n * 4] = from[i * 4]!;
              to[n * 4 + 1] = from[i * 4 + 1]!;
              to[n * 4 + 2] = from[i * 4 + 2]!;
              to[n * 4 + 3] = from[i * 4 + 3]!;
            }
            counts[k] = n + 1;
          }
        }
        group.forEach((p, k) => {
          const n = counts[k]!;
          p.g.instanceCount = n;
          for (const { a } of p.attrs) {
            a.clearUpdateRanges();
            a.addUpdateRange(0, Math.max(1, n) * 4);
            a.needsUpdate = true;
          }
        });
      }
    },
    dispose() {
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
    },
  };
}
