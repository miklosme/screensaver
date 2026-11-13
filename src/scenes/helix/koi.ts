import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

/**
 * A school of lantern koi that swims up the shaft on slow helices, against the turn of the stair.
 *
 * Every fish is placed in the vertex shader from its instance attributes and the scene clock, so
 * the school is a pure function of `uT`. Fish also keep out of a cone in front of the camera
 * (`uEye` / `uFwd`): they may drift alongside, but never onto the line of flight.
 */

const TAU = Math.PI * 2;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let k = Math.imul(s ^ (s >>> 15), 1 | s);
    k = (k + Math.imul(k ^ (k >>> 7), 61 | k)) ^ k;
    return ((k ^ (k >>> 14)) >>> 0) / 4294967296;
  };
}

/** One fish, nose at x = +0.5, tail fin trailing to x = -1.1. `aFin` is 1 on the fins. */
function koiGeometry(): InstancedBufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const fin: number[] = [];
  const idx: number[] = [];
  const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, f: number) => {
    pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    fin.push(f);
    return pos.length / 3 - 1;
  };
  const half = (u: number): [number, number] => {
    let r = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.75);
    if (u > 0.5) r = Math.max(r, 0.2);
    return [0.17 * r, 0.115 * r];
  };

  // body
  const NR = 14;
  const NS = 10;
  for (let i = 0; i <= NR; i++) {
    const u = i / NR;
    const [hh, hw] = half(u);
    for (let j = 0; j <= NS; j++) {
      const a = (j / NS) * TAU;
      if (i === 0) vert(0.5, 0, 0, 1, 0, 0, 0);
      else vert(0.5 - u, hh * Math.cos(a), hw * Math.sin(a), 0.25 * (u < 0.33 ? 1 : -1), Math.cos(a) / hh, Math.sin(a) / hw, 0);
    }
  }
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NS; j++) {
      const a = i * (NS + 1) + j;
      const b = a + NS + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }

  /** a flat fin: a grid between two edge curves, k = 0 at the root and 1 at the tip */
  const sheet = (
    cols: number,
    lo: (k: number) => [number, number, number],
    hi: (k: number) => [number, number, number],
    n: [number, number, number],
  ) => {
    const base = pos.length / 3;
    for (let i = 0; i <= cols; i++) {
      const k = i / cols;
      const a = lo(k);
      const b = hi(k);
      for (let j = 0; j <= 2; j++) {
        const f = j / 2;
        vert(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, n[0], n[1], n[2], 1);
      }
    }
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < 2; j++) {
        const a = base + i * 3 + j;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
  };
  // a long forked veil of a tail
  for (const sgn of [1, -1]) {
    sheet(
      7,
      (k) => [-0.46 - 0.66 * k, sgn * 0.19 * Math.max(0, k - 0.3) ** 1.3, 0],
      (k) => [-0.46 - 0.7 * k, sgn * (0.035 + 0.36 * k ** 0.75), 0],
      [0, 0, 1],
    );
  }
  // dorsal sail
  sheet(
    6,
    (k) => [0.2 - 0.5 * k, half(0.3 + 0.5 * k)[0] - 0.01, 0],
    (k) => [0.14 - 0.56 * k, half(0.3 + 0.5 * k)[0] + 0.13 * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.6, 0],
    [0, 0, 1],
  );
  // pectoral fins
  for (const sgn of [1, -1]) {
    sheet(
      3,
      (k) => [0.2 - 0.2 * k, -0.06 - 0.1 * k, sgn * (0.08 + 0.17 * k)],
      (k) => [0.1 - 0.26 * k, -0.08 - 0.17 * k, sgn * (0.07 + 0.25 * k)],
      [0, 0.8, sgn * 0.6],
    );
  }

  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("aFin", new BufferAttribute(new Float32Array(fin), 1));
  g.setIndex(idx);
  return g;
}

export interface KoiOptions {
  count: number;
  /** the school lives between these radii (clear of the stair and of the shaft wall) */
  rMin: number;
  rMax: number;
  /** middle and height of the stretch of shaft the school wraps around in */
  yMid: number;
  yRange: number;
  fogNear: number;
  fogFar: number;
  /** GLSL that defines `vec3 hxSky(vec3 dir)` */
  skyGlsl: string;
  /** shafts of light the fish brighten in: a line from `a` along unit `dir`, flaring from r0 to r1 */
  shafts?: { a: Vector3; dir: Vector3; len: number; r0: number; r1: number }[];
}

export interface Koi {
  mesh: Mesh;
  material: ShaderMaterial;
  /** call every frame with the scene clock and the camera's position and view direction */
  update(t: number, eye: Vector3, forward: Vector3): void;
}

export function createKoi(o: KoiOptions): Koi {
  const rand = rng(4242);
  const geometry = koiGeometry();
  const orbit = new Float32Array(o.count * 4);
  const fish = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count; i++) {
    const r = o.rMin + (o.rMax - o.rMin) * rand() ** 0.8;
    const size = 2.3 + 3.4 * rand() ** 1.7;
    orbit.set([r, rand() * TAU, rand() * o.yRange, -(1.1 + rand() * 1.5) / r], i * 4);
    fish.set([size, rand() * TAU, rand(), 0.35 + rand() * 0.75], i * 4);
  }
  geometry.setAttribute("aOrbit", new InstancedBufferAttribute(orbit, 4));
  geometry.setAttribute("aFish", new InstancedBufferAttribute(fish, 4));
  geometry.instanceCount = o.count;

  const v3 = (v: Vector3) => `vec3(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
  // a fish brightens while it crosses a shaft: distance from its centre to each shaft's axis
  const shaftGlsl = (o.shafts ?? [])
    .map(
      (sh) => /* glsl */ `
        {
          vec3 q = c - ${v3(sh.a)};
          float u = clamp(dot(q, ${v3(sh.dir)}) / ${sh.len.toFixed(2)}, 0.0, 1.0);
          float rr = ${sh.r0.toFixed(2)} + ${(sh.r1 - sh.r0).toFixed(2)} * u;
          float dd = length(q - ${v3(sh.dir)} * u * ${sh.len.toFixed(2)});
          vLit = max(vLit, (1.0 - smoothstep(rr * 0.3, rr * 1.05, dd)) * smoothstep(0.0, 0.18, u) * (1.0 - smoothstep(0.55, 1.0, u)));
        }`,
    )
    .join("");
  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uT: { value: 0 }, uEye: { value: new Vector3() }, uFwd: { value: new Vector3(0, 0, -1) } },
    vertexShader: /* glsl */ `
      attribute float aFin;
      attribute vec4 aOrbit; // radius, angle, height, angular speed
      attribute vec4 aFish;  // size, phase, seed, climb speed
      uniform float uT;
      uniform vec3 uEye;
      uniform vec3 uFwd;
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      varying float vFin;
      varying float vSeed;
      varying float vLit;
      void main() {
        float ang = aOrbit.y + uT * aOrbit.w;
        float yy = mod(aOrbit.z + uT * aFish.w, ${o.yRange.toFixed(1)});
        // the wrap happens far below and far above; fish shrink to nothing there
        float grow = smoothstep(0.0, 10.0, yy) * smoothstep(${o.yRange.toFixed(1)}, ${(o.yRange - 10).toFixed(1)}, yy);
        float r = aOrbit.x + 1.4 * sin(uT * 0.21 + aFish.y * 3.0);
        vec3 c = vec3(r * cos(ang), ${(o.yMid - o.yRange / 2).toFixed(1)} + yy + 0.7 * sin(uT * 0.6 + aFish.y), r * sin(ang));

        // keep the line of flight clear: nudge the fish out of a cone ahead of the camera
        vec3 rel = c - uEye;
        float along = dot(rel, uFwd);
        vec3 perp = rel - uFwd * along;
        float d = max(length(perp), 1e-3);
        float need = (3.4 + 0.2 * max(along, 0.0)) * smoothstep(-5.0, 1.0, along) * (1.0 - smoothstep(40.0, 60.0, along));
        c += perp / d * max(0.0, need + aFish.x * 0.6 - d);
        vLit = 0.0;
        ${shaftGlsl}

        vec3 fwd = normalize(vec3(-sin(ang) * r * aOrbit.w, aFish.w, cos(ang) * r * aOrbit.w));
        vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        vec3 up = cross(side, fwd);

        // the swim: a wave that grows towards the tail, and fins that trail behind it
        vec3 p = position;
        float w = smoothstep(0.35, -1.0, p.x);
        float k = p.x * 4.2 + uT * (2.2 + aFish.w * 1.6) + aFish.y;
        float sway = sin(k) * (0.025 + 0.3 * w * w) + aFin * 0.05 * sin(k * 1.7 + p.y * 9.0);
        p.z += sway;
        vec3 n = normalize(normal + vec3(-cos(k) * (0.1 + 1.2 * w * w), 0.0, 0.0) * normal.z);

        float s = aFish.x * grow;
        vec3 world = c + (fwd * p.x + up * p.y + side * p.z) * s;
        vObj = position;
        vW = world;
        vN = fwd * n.x + up * n.y + side * n.z;
        vFin = aFin;
        vSeed = aFish.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      varying float vFin;
      varying float vSeed;
      varying float vLit;
      ${o.skyGlsl}
      float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float kNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(kHash(i), kHash(i + vec2(1, 0)), f.x), mix(kHash(i + vec2(0, 1)), kHash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 n = normalize(vN);
        if (dot(n, V) < 0.0) n = -n;

        // the coat: four varieties, picked by the fish's seed
        vec2 q = vec2(vObj.x * 3.1 + vSeed * 31.0, vObj.y * 5.0 + sign(vObj.z) * 1.7 + vSeed * 7.0);
        float blotch = smoothstep(0.44, 0.5, kNoise(q) * 0.7 + kNoise(q * 2.3) * 0.3);
        vec3 pearl = vec3(1.0, 0.93, 0.82);
        vec3 red = vec3(1.0, 0.27, 0.08);
        vec3 gold = vec3(1.0, 0.62, 0.14);
        vec3 ink = vec3(0.05, 0.1, 0.16);
        vec3 col;
        if (vSeed < 0.46) col = mix(pearl, red, blotch);
        else if (vSeed < 0.68) col = mix(gold, pearl, smoothstep(0.0, -0.12, vObj.y) * 0.6);
        else if (vSeed < 0.84) col = mix(pearl, red, smoothstep(0.1, 0.07, length(vObj.xy - vec2(0.3, 0.07))));
        else col = mix(ink, vec3(0.2, 0.95, 0.85), blotch * 0.9);
        // scales catch the light along the flank
        vec2 sc = vec2(vObj.x * 26.0, atan(vObj.y, abs(vObj.z) + 1e-4) * 6.0);
        sc.x += 0.5 * mod(floor(sc.y), 2.0);
        float scale = length(fract(sc) - vec2(0.75, 0.5));
        col *= 0.88 + 0.18 * smoothstep(0.75, 0.2, scale) * (1.0 - vFin);
        // fins are veils: paler, ribbed, bright at the hem
        float ribs = 0.5 + 0.5 * sin((vObj.y + vObj.z) * 70.0 / (1.0 + 3.0 * abs(vObj.x + 0.46)));
        col = mix(col, mix(col, pearl, 0.55) * (0.8 + 0.3 * ribs), vFin);
        // eye
        col = mix(col, vec3(0.02), smoothstep(0.03, 0.022, length(vec3(vObj.x - 0.37, vObj.y - 0.035, abs(vObj.z) - 0.07))));

        // they are lanterns: mostly self lit, shaped by the shaft's amber down-light
        float ndl = dot(n, normalize(vec3(-0.35, 1.0, -0.6))) * 0.5 + 0.5;
        float rim = pow(1.0 - max(dot(n, V), 0.0), 2.5);
        col = col * (0.42 + 0.8 * ndl) + vec3(1.0, 0.55, 0.2) * rim * 0.35;
        // in a shaft of light the lantern flares up, its rim catching the beam
        col += (col * 0.55 + vec3(1.0, 0.6, 0.26) * (0.18 + 0.6 * rim)) * vLit;

        float dist = length(cameraPosition - vW);
        float f = smoothstep(${o.fogNear.toFixed(1)}, ${o.fogFar.toFixed(1)}, dist);
        col = mix(col, hxSky(-V), f * 0.97);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    material,
    update(t, eye, forward) {
      material.uniforms.uT!.value = t;
      material.uniforms.uEye!.value.copy(eye);
      material.uniforms.uFwd!.value.copy(forward);
    },
  };
}
