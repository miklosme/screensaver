import * as THREE from "three";

/**
 * What lives in the air of the cylinder town: a whale freckled with stars that swims down the
 * axis towards the moon with her calf, and paper lanterns let go from the streets. In a world
 * wrapped around its own sky "up" is the axis, so that is where the lanterns all drift.
 *
 * Both are animated in their vertex shaders from the scene clock alone.
 */

const TAU = Math.PI * 2;

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

export interface SkyOptions {
  /** radius of the cylinder */
  R: number;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
}

// ---------------------------------------------------------------------------------------------
// whale
// ---------------------------------------------------------------------------------------------

/** One whale of length 1: head at z = +0.45, back towards +y. aData = (u along the body, angle, part). */
function whaleGeometry() {
  const pos: number[] = [];
  const nor: number[] = [];
  const data: number[] = [];
  const idx: number[] = [];
  const radius = (u: number) => Math.max(0.011, 0.142 * (1 - Math.exp(-u * 18)) ** 0.55 * (1 - u) ** 0.78);

  const NR = 34;
  const NS = 24;
  for (let i = 0; i <= NR; i++) {
    const u = i / NR;
    const r = radius(u);
    const dr = (radius(Math.min(1, u + 0.01)) - radius(Math.max(0, u - 0.01))) / 0.02;
    for (let j = 0; j <= NS; j++) {
      const a = (j / NS) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ky = c > 0 ? 0.88 : 1.0; // a flatter back over a full belly
      pos.push(r * s * 1.06, r * c * ky, 0.45 - u * 0.95);
      const n = new THREE.Vector3(s / 1.06, c / ky, dr * 1.05).normalize();
      nor.push(n.x, n.y, n.z);
      data.push(u, j / NS, 0);
    }
  }
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NS; j++) {
      const a = i * (NS + 1) + j;
      const b = a + NS + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }

  /** a thin fin between two edge curves (k = 0 at the root, 1 at the tip) */
  const sheet = (
    cols: number,
    lead: (k: number) => [number, number, number],
    trail: (k: number) => [number, number, number],
    n: [number, number, number],
    part: number,
  ) => {
    const base = pos.length / 3;
    for (let i = 0; i <= cols; i++) {
      const k = i / cols;
      const a = lead(k);
      const b = trail(k);
      for (let j = 0; j <= 2; j++) {
        const f = j / 2;
        pos.push(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
        nor.push(n[0], n[1], n[2]);
        data.push(k, f, part);
      }
    }
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < 2; j++) {
        const a = base + i * 3 + j;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
  };
  for (const sgn of [1, -1]) {
    // flukes: two swept crescents
    sheet(
      8,
      (k) => [sgn * 0.27 * k ** 0.85, 0, -0.475 - 0.035 * k - 0.1 * k * k],
      (k) => [sgn * 0.25 * k, 0, -0.515 - 0.045 * Math.sin(Math.PI * k) - 0.115 * k ** 1.6],
      [0, 1, 0],
      1,
    );
    // flippers: long, like a humpback's
    sheet(
      8,
      (k) => [sgn * (0.085 + 0.3 * k), -0.07 - 0.07 * k, 0.21 - 0.16 * k],
      (k) => [sgn * (0.085 + 0.29 * k), -0.075 - 0.075 * k, 0.21 - 0.07 * (1 - k) ** 0.7 - 0.2 * k],
      [0, 1, 0],
      2,
    );
  }
  // a small dorsal fin, far back
  sheet(
    4,
    (k) => [0, radius(0.62 + 0.09 * k) * 0.86, 0.45 - (0.62 + 0.09 * k) * 0.95],
    (k) => [0, radius(0.62 + 0.09 * k) * 0.86 + 0.034 * Math.sin(Math.PI * Math.min(1, k * 1.25)) ** 0.7, 0.45 - (0.66 + 0.07 * k) * 0.95],
    [1, 0, 0],
    3,
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aData", new THREE.Float32BufferAttribute(data, 3));
  g.setIndex(idx);
  return g;
}

/** where the moon hangs: the middle of the cylinder's +z end cap (orbit.tsx puts it at ZH - 0.5) */
const MOON = new THREE.Vector3(0, 0, 179.5);

function whaleMaterial(o: SkyOptions) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSwim: { value: 0 }, uFog: { value: o.fogColor } },
    vertexShader: /* glsl */ `
      attribute vec3 aData;
      uniform float uSwim;
      varying vec3 vData;
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec3 p = position;
        // a travelling wave runs from the chest to the flukes: barely a ripple at the head,
        // a slow full stroke at the tail
        float w = smoothstep(0.25, -0.55, p.z);
        float k = p.z * 4.2 + uSwim;
        float bend = 0.075 * sin(k) * w * w;
        p.y += bend - 0.01 * sin(k - 1.4) * (1.0 - w);
        // flukes stay flat across, but pitch with the stroke
        if (aData.z > 0.5 && aData.z < 1.5) p.y += abs(p.x) * 0.3 * sin(k - 0.7);
        // flippers row slowly, bending towards their tips
        float reach = max(abs(p.x) - 0.085, 0.0);
        if (aData.z > 1.5 && aData.z < 2.5) p.y += reach * (0.45 * sin(uSwim * 0.5 + reach * 4.0) - 0.12);
        float slope = 0.075 * 4.2 * cos(k) * w * w;
        vec3 n = normalize(normal + vec3(0.0, 0.0, -slope) * normal.y);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vData = aData;
        vObj = position;
        vW = world.xyz;
        vN = mat3(modelMatrix) * n;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFog;
      varying vec3 vData;
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      /** where a cell's star sits (cell units) */
      vec2 starAt(vec2 cell) { return cell + vec2(0.22) + 0.56 * vec2(wHash(cell + 3.1), wHash(cell + 7.7)); }
      float segDist(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a;
        return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
      }
      /**
       * Constellations on a grid in body units (g.x along the body, g.y round it): a star in some
       * cells, and faint lines from a star to its neighbours ahead and above, so they join up
       * into figures. Returns (star, line).
       */
      vec2 constellation(vec2 g, float density) {
        vec2 cell = floor(g);
        float star = 0.0;
        float line = 0.0;
        for (int j = -1; j <= 1; j++)
          for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            if (wHash(c) < 1.0 - density) continue;
            vec2 a = starAt(c);
            float d = length(g - a);
            float big = 0.6 + 0.8 * wHash(c + 5.3);
            float tw = 0.75 + 0.25 * sin(uTime * (0.8 + 1.6 * wHash(c + 9.1)) + wHash(c) * 40.0);
            star += (smoothstep(0.075 * big, 0.0, d) * 1.6 + smoothstep(0.3 * big, 0.0, d) * 0.25) * big * tw;
            // join to the next star along, or the one round the flank
            vec2 n1 = c + vec2(1.0, 0.0);
            vec2 n2 = c + vec2(0.0, 1.0);
            if (wHash(n1) >= 1.0 - density && wHash(c + 11.0) < 0.75) line = max(line, smoothstep(0.035, 0.0, segDist(g, a, starAt(n1))));
            if (wHash(n2) >= 1.0 - density && wHash(c + 13.0) < 0.45) line = max(line, smoothstep(0.035, 0.0, segDist(g, a, starAt(n2))));
          }
        return vec2(star, line);
      }
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 n = normalize(vN);
        if (dot(n, V) < 0.0) n = -n;
        float body = step(vData.z, 0.5);
        float u = body > 0.5 ? vData.x : 0.5;
        float ang = vData.y * 6.2831853;
        // 1 on the belly, 0 on the back
        float belly = body > 0.5 ? smoothstep(0.25, -0.45, cos(ang)) : 0.25;

        // ink-blue back, a dusk-blue belly: a silhouette darker than the sky behind it
        vec3 back = mix(vec3(0.018, 0.024, 0.12), vec3(0.04, 0.035, 0.17), u);
        vec3 pale = vec3(0.12, 0.16, 0.36);
        vec3 col = mix(back, pale, belly * smoothstep(0.98, 0.5, u));
        // throat pleats from the chin to the flippers
        float pleat = 0.5 + 0.5 * cos(ang * 34.0);
        col *= 1.0 - 0.35 * pleat * belly * smoothstep(0.52, 0.3, u) * body;
        // fins: dark, with a pale ribbed hem
        float hem = smoothstep(0.55, 1.0, vData.x) * (1.0 - body);
        col = mix(col, pale * (0.8 + 0.2 * sin(vData.y * 30.0)), hem * 0.35);

        // light: the moon at the +z end, the town's warm glow from below
        vec3 L = normalize(vec3(${MOON.x.toFixed(1)}, ${MOON.y.toFixed(1)}, ${MOON.z.toFixed(1)}) - vW);
        float ndl = dot(n, L);
        float ndv = max(dot(n, V), 0.0);
        vec3 lit = col * (vec3(0.3, 0.3, 0.5) + vec3(0.4, 0.6, 1.0) * max(ndl, 0.0) * 0.6);
        // moonlight running along the edge of her back: a thin silver-blue rim that cuts her from the sky
        float edge = pow(1.0 - ndv, 5.0);
        float toMoon = smoothstep(-0.2, 0.6, ndl);
        float onBack = mix(1.0, 0.25, belly);
        lit += vec3(0.5, 0.75, 1.0) * edge * (0.12 + 1.1 * toMoon) * onBack;

        // her freckles are stars, and on each flank they join into constellations
        vec2 g = body > 0.5 ? vec2(u * 30.0, vData.y * 20.0) : vec2(vData.x * 6.0, vData.y * 2.0 + vData.z * 5.0);
        float flank = body * exp(-pow((abs(vData.y - 0.5) - 0.24) * 7.0, 2.0)) * smoothstep(0.02, 0.12, u) * smoothstep(0.97, 0.8, u);
        vec2 con = constellation(g, 0.12 + 0.4 * flank);
        float gold = step(0.88, wHash(floor(g) + 1.3));
        vec3 starCol = mix(vec3(0.55, 0.92, 1.0), vec3(1.0, 0.8, 0.45), gold);
        lit += starCol * con.x * (1.2 + 2.6 * flank);
        lit += vec3(0.35, 0.65, 1.0) * con.y * flank * 0.55;
        // a dusting of finer stars everywhere
        vec2 fine = constellation(g * 2.6 + 11.0, 0.08);
        lit += vec3(0.6, 0.85, 1.0) * fine.x * 0.45;
        // a small bright eye
        vec3 e = vec3(abs(vObj.x) - 0.1, vObj.y + 0.022, vObj.z - 0.325);
        lit += vec3(1.0, 0.85, 0.55) * smoothstep(0.014, 0.006, length(e)) * 3.0 * body;

        float fog = smoothstep(${o.fogNear.toFixed(1)}, ${o.fogFar.toFixed(1)}, length(cameraPosition - vW));
        gl_FragColor = vec4(mix(lit, uFog, fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * The pair's flight, in the town's unrolled coordinates: [t, s (arc length at the ground), z, height].
 * The camera turns about 300 degrees between t = 12 and 22, so she is placed against its track:
 *  - until 12.5 she waits down the -z end, behind a camera that looks along +z;
 *  - 13.5 to 16.5: as it turns to face -z she comes up out of the far end and crosses its view
 *    from left to right, in profile against the open sky;
 *  - 16.5 to 18.5: out of sight above and behind it she sweeps round and up the axis, fast;
 *  - 19 to 20.7: she has slowed to a drift across the moon (at the top left of the turning view
 *    at 19), she and her calf a large silhouette in profile on its disc;
 *  - 20.7 to 22: she swims off sideways past its right-hand limb, the calf dropping in below her,
 *    so the hut's crescent finial (on the disc's middle from t = 21 to 22.5) stands on bare moon;
 *    from there to the portal the pair climbs gently away up and to the right.
 */
const FLIGHT: [number, number, number, number][] = [
  [0, -60, -150, 34],
  [10, -60, -125, 34],
  [12.5, -50, -96, 32],
  [14.5, 18, -54, 25],
  [15.5, 50, -42, 22],
  [16.5, 74, -22, 24],
  [17.4, 74, 30, 29],
  [18.2, 38, 84, 34],
  [19, -5, 106, 35],
  [20, -10, 96, 37],
  [20.7, -19, 96, 37.5],
  [21.4, -40, 98.5, 37.5],
  [22, -56, 100.5, 37.5],
  [23, -70, 101.5, 37.5],
  [24.5, -86, 102.5, 37],
  [26, -100, 103.5, 36],
];

/** Catmull-Rom through the keys, with tangents from the actual key spacing in time */
function flightAt(t: number, out: number[]) {
  const K = FLIGHT;
  const n = K.length;
  let i = 0;
  while (i < n - 2 && t > K[i + 1]![0]) i++;
  const k0 = K[Math.max(0, i - 1)]!;
  const k1 = K[i]!;
  const k2 = K[i + 1]!;
  const k3 = K[Math.min(n - 1, i + 2)]!;
  const h = k2[0] - k1[0];
  const s = Math.min(1, Math.max(0, (t - k1[0]) / h));
  const s2 = s * s;
  const s3 = s2 * s;
  for (let c = 1; c <= 3; c++) {
    const m1 = ((k2[c]! - k0[c]!) / Math.max(1e-6, k2[0] - k0[0])) * h;
    const m2 = ((k3[c]! - k1[c]!) / Math.max(1e-6, k3[0] - k1[0])) * h;
    out[c - 1] = (2 * s3 - 3 * s2 + 1) * k1[c]! + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * k2[c]! + (s3 - s2) * m2;
  }
  return out;
}

export interface Sky {
  root: THREE.Group;
  /** t: scene clock; eye / forward: the camera, which the lanterns keep clear of */
  update(t: number, eye: THREE.Vector3, forward: THREE.Vector3): void;
  dispose(): void;
}

interface Swimmer {
  mesh: THREE.Mesh;
  size: number;
  /** offset from the flight line in her frame: right, up, forward (in mother lengths) */
  off: [number, number, number];
  /** the offset she moves to as the pair leaves the moon's middle for the side (t = 20.5 to 21.8) */
  offLate: [number, number, number];
  /** seconds behind the mother on the flight line */
  lag: number;
  phase: number;
}

export function createSky(o: SkyOptions, pointsMat: THREE.Material): Sky {
  const root = new THREE.Group();
  const rnd = mulberry32(777);

  // ---- the whales: a mother and, tucked in at her right flipper, her calf
  const geo = whaleGeometry();
  const mat = whaleMaterial(o);
  const MOTHER = 30;
  const swimmers: Swimmer[] = [
    { size: MOTHER, off: [0, 0, 0] as [number, number, number], offLate: [0, 0, 0] as [number, number, number], lag: 0, phase: 0 },
    {
      size: MOTHER * 0.42,
      off: [-0.12, 0.32, 0.12] as [number, number, number],
      offLate: [-0.1, -0.35, 0.1] as [number, number, number],
      lag: 0.12,
      phase: 1.9,
    },
  ].map((s) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.scale.setScalar(s.size);
    root.add(mesh);
    return { ...s, mesh };
  });

  // a wake of plankton light that travels with the mother
  {
    const n = 150;
    const p: number[] = [];
    const c: number[] = [];
    const d: number[] = [];
    for (let i = 0; i < n; i++) {
      const back = rnd() ** 0.7;
      const a = rnd() * TAU;
      const r = 0.05 + 0.2 * rnd() + 0.2 * back;
      p.push(Math.cos(a) * r, Math.sin(a) * r * 0.7, 0.3 - back * 1.9);
      const gold = rnd() < 0.25;
      const m = 0.9 * (1 - back * 0.6);
      c.push((gold ? 1 : 0.35) * m, (gold ? 0.7 : 0.9) * m, (gold ? 0.28 : 1) * m);
      d.push(0.5 + rnd() * 0.9, rnd() * TAU, 0.012 + rnd() * 0.02, 0.8);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(c, 3));
    g.setAttribute("aData", new THREE.Float32BufferAttribute(d, 4));
    const wake = new THREE.Points(g, pointsMat);
    wake.frustumCulled = false;
    swimmers[0]!.mesh.add(wake);
  }

  // ---- paper lanterns
  const COUNT = 260;
  const TOP = o.R - 6; // they wink out just short of the axis
  const lg = new THREE.InstancedBufferGeometry();
  {
    const base = new THREE.CylinderGeometry(0.42, 0.26, 0.9, 8, 1, true).translate(0, 0.45, 0);
    lg.index = base.index;
    lg.setAttribute("position", base.getAttribute("position"));
    lg.setAttribute("normal", base.getAttribute("normal"));
    const place = new Float32Array(COUNT * 4);
    const look = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      place.set([rnd() * TAU * o.R, -150 + rnd() * 300, rnd() * TOP, 0.9 + rnd() * 1.5], i * 4);
      look.set([1.2 + rnd() * 1.7, rnd() * TAU, rnd(), 0], i * 4);
    }
    lg.setAttribute("aPlace", new THREE.InstancedBufferAttribute(place, 4));
    lg.setAttribute("aLook", new THREE.InstancedBufferAttribute(look, 4));
    lg.instanceCount = COUNT;
  }
  const lanternMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uEye: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3(0, 0, 1) }, uFog: { value: o.fogColor } },
    vertexShader: /* glsl */ `
      attribute vec4 aPlace; // s, z, height, rise speed
      attribute vec4 aLook;  // size, phase, hue
      uniform float uTime;
      uniform vec3 uEye;
      uniform vec3 uFwd;
      varying float vY;
      varying float vHue;
      varying float vFade;
      varying float vFlick;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        float h = mod(aPlace.z + uTime * aPlace.w, ${TOP.toFixed(1)});
        float th = aPlace.x / ${o.R.toFixed(1)} + 0.02 * sin(uTime * 0.2 + aLook.y);
        float r = ${o.R.toFixed(1)} - h;
        vec3 up = vec3(-sin(th), cos(th), 0.0);
        vec3 right = vec3(cos(th), sin(th), 0.0);
        vec3 c = vec3(r * sin(th), -r * cos(th), aPlace.y + 1.5 * sin(uTime * 0.17 + aLook.y * 2.0));
        // stay off the line of flight
        vec3 rel = c - uEye;
        float along = dot(rel, uFwd);
        vec3 perp = rel - uFwd * along;
        float d = max(length(perp), 1e-3);
        float need = (2.2 + 0.16 * max(along, 0.0)) * smoothstep(-4.0, 1.0, along) * (1.0 - smoothstep(30.0, 50.0, along));
        c += perp / d * max(0.0, need - d);
        // they sway as they climb
        float tilt = 0.14 * sin(uTime * 0.9 + aLook.y * 3.0);
        vec3 p = position * aLook.x * smoothstep(0.0, 3.0, h) * smoothstep(${TOP.toFixed(1)}, ${(TOP - 8).toFixed(1)}, h);
        p.x += p.y * tilt;
        vec3 world = c + right * p.x + up * p.y + vec3(0.0, 0.0, p.z);
        vY = position.y / 0.9;
        vHue = aLook.z;
        vFlick = 0.8 + 0.2 * sin(uTime * (5.0 + aLook.z * 4.0) + aLook.y * 9.0);
        vN = right * normal.x + up * normal.y + vec3(0.0, 0.0, normal.z);
        vW = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog;
      varying float vY;
      varying float vHue;
      varying float vFlick;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        // paper lit from the flame at its mouth: hot at the bottom, a cool shade at the crown
        vec3 paper = mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.28, 0.32), step(0.72, vHue));
        paper = mix(paper, vec3(0.5, 0.95, 1.0), step(0.93, vHue));
        float glow = mix(1.9, 0.55, smoothstep(0.0, 1.0, vY));
        float ribs = 0.9 + 0.1 * step(0.5, fract(vY * 3.0 + 0.25));
        vec3 col = paper * glow * ribs * vFlick * (0.75 + 0.25 * abs(dot(normalize(vN), V)));
        float fog = smoothstep(${o.fogNear.toFixed(1)}, ${o.fogFar.toFixed(1)}, length(cameraPosition - vW));
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const lanterns = new THREE.Mesh(lg, lanternMat);
  lanterns.frustumCulled = false;
  root.add(lanterns);

  const pos = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const key = [0, 0, 0];
  /** a point on the flight line, bent onto the cylinder */
  const flight = (t: number, out: THREE.Vector3) => {
    flightAt(t, key);
    const th = key[0]! / o.R;
    const rho = o.R - key[2]!;
    return out.set(rho * Math.sin(th), -rho * Math.cos(th), key[1]!);
  };

  return {
    root,
    update(t, eye, forward) {
      mat.uniforms.uTime!.value = t;
      // a slow stroke, one beat every four seconds
      mat.uniforms.uSwim!.value = t * 1.6;
      lanternMat.uniforms.uTime!.value = t;
      lanternMat.uniforms.uEye!.value.copy(eye);
      lanternMat.uniforms.uFwd!.value.copy(forward);
      for (const s of swimmers) {
        const tt = t - s.lag;
        flight(tt, pos);
        flight(tt - 0.25, prev);
        flight(tt + 0.25, next);
        fwd.subVectors(next, prev).normalize();
        // her back is to the axis; she banks into her turns and rolls a little as she swims
        up.set(-pos.x, -pos.y, 0).normalize();
        const turn = next.add(prev).addScaledVector(pos, -2); // curvature, towards the inside of the turn
        right.crossVectors(fwd, up).normalize();
        const bank = THREE.MathUtils.clamp(turn.dot(right) * 0.06, -0.5, 0.5) + 0.1 * Math.sin(t * 0.55 + s.phase);
        up.addScaledVector(fwd, -up.dot(fwd)).normalize().applyAxisAngle(fwd, bank);
        right.crossVectors(fwd, up).normalize();
        // the calf keeps station off her flipper, drifting in and out a little
        const k = MOTHER;
        const late = THREE.MathUtils.smoothstep(t, 20.5, 21.8);
        const o0 = THREE.MathUtils.lerp(s.off[0], s.offLate[0], late);
        const o1 = THREE.MathUtils.lerp(s.off[1], s.offLate[1], late);
        const o2 = THREE.MathUtils.lerp(s.off[2], s.offLate[2], late);
        pos
          .addScaledVector(right, o0 * k * (1 + 0.12 * Math.sin(t * 0.4 + s.phase)))
          .addScaledVector(up, o1 * k + (s.lag ? 0.6 * Math.sin(t * 0.7) : 0))
          .addScaledVector(fwd, o2 * k);
        // and both keep out of a cone ahead of the camera
        rel.subVectors(pos, eye);
        const along = rel.dot(forward);
        rel.addScaledVector(forward, -along);
        const d = Math.max(rel.length(), 1e-3);
        const need = (s.size * 0.25 + 3 + 0.2 * Math.max(along, 0)) * THREE.MathUtils.smoothstep(along, -s.size * 0.5, 2);
        if (d < need) pos.addScaledVector(rel, (need - d) / d);
        // Matrix4.lookAt points +z from the target to the eye, i.e. the whale's head along fwd
        m.lookAt(next.copy(pos).add(fwd), pos, up);
        s.mesh.position.copy(pos);
        s.mesh.quaternion.setFromRotationMatrix(m);
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      lg.dispose();
      lanternMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// the moon
// ---------------------------------------------------------------------------------------------

/**
 * The moon on the cylinder's +z end cap (a disc of radius R + 2 in its own xy). A full pearl moon,
 * 0.6 to 0.85 in linear light: well over the director's bloom threshold (0.45), so it glows, but
 * short of the old 1.15 that clipped to a white patch and swallowed the hut's finial. Around it a
 * bright rim of glow and a wide, low halo fade into the fog colour of the sky.
 */
export function moonMaterial(o: { R: number; fogColor: THREE.Color }) {
  return new THREE.ShaderMaterial({
    uniforms: { uFog: { value: o.fogColor } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying float vCut;
      vec2 ndc(vec3 p) {
        vec4 c = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        return c.xy / max(c.w, 1e-4);
      }
      void main() {
        vP = position.xy / ${o.R.toFixed(1)};
        // how far the frame's edge cuts into the disc: the room between its centre and the nearer
        // edge, in disc radii (1 = just whole). It is the same for every vertex.
        const float RW = ${(0.335 * o.R).toFixed(2)};
        vec2 c = ndc(vec3(0.0));
        vec2 rad = vec2(length(ndc(vec3(RW, 0.0, 0.0)) - c), length(ndc(vec3(0.0, RW, 0.0)) - c));
        vec2 room = (1.0 - abs(c)) / max(vec2(max(rad.x, rad.y)), vec2(1e-4));
        vCut = smoothstep(1.3, 0.55, min(room.x, room.y));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog;
      varying vec2 vP;
      varying float vCut;
      float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float mNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mHash(i), mHash(i + vec2(1, 0)), f.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        const float RD = 0.335;
        float r = length(vP);
        float disc = smoothstep(RD + 0.004, RD - 0.004, r);
        // a full moon: nearly flat, a little brighter towards its upper left, its limb only just
        // dimmed, with soft grey-blue seas
        vec2 q = vP / RD;
        float nz = sqrt(max(1.0 - dot(q, q), 0.0));
        float lean = smoothstep(-1.2, 1.0, dot(q, vec2(-0.6, 0.8)));
        float seas = mNoise(q * 2.3 + 4.0) * 0.6 + mNoise(q * 5.1 - 2.0) * 0.4;
        float sea = smoothstep(0.46, 0.72, seas);
        vec3 face = mix(vec3(0.86, 0.92, 1.0), vec3(0.62, 0.72, 0.9), sea * 0.45);
        vec3 col = face * mix(0.7, 0.86, lean) * mix(0.84, 1.0, pow(nz, 0.4));

        // the sky around it: faint rings of light, a bright rim of glow and a wide, low halo
        float rings = 0.5 + 0.5 * cos(r * 60.0);
        vec3 sky = uFog * (1.0 + 0.2 * rings * smoothstep(0.34, 0.5, r) * smoothstep(1.1, 0.6, r));
        float d = max(r - RD, 0.0);
        sky += vec3(0.2, 0.36, 0.6) * (0.55 * exp(-d * 14.0) + 0.4 * exp(-d * 4.5) + 0.2 * exp(-d * 1.6)) * (1.0 - 0.2 * vCut);
        // cut by the frame's edge the moon is a fragment, not the whole disc: it dims to below the
        // bloom's reach, so the corner of the frame is moonlit rather than a blown-out patch
        col *= 1.0 - 0.18 * vCut;
        gl_FragColor = vec4(mix(sky, col, disc), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    fog: false,
    side: THREE.DoubleSide,
  });
}

/**
 * The finial's beam of light (an open cylinder 56 tall standing on its base): strongest where it
 * leaves the orb, thinning out as it climbs, so that up in front of the moon it is only a thread.
 */
export function beamMaterial(opacity: number, R: number, color = "#7fefff") {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vW;
      void main() {
        vH = uv.y;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vH;
      varying vec3 vW;
      void main() {
        float a = uOpacity * (0.15 + 0.85 * exp(-vH * 4.0)) * smoothstep(1.0, 0.75, vH);
        // where it crosses the moon's disc on screen it all but goes out, so the disc stays whole
        vec3 toMoon = vec3(${MOON.x.toFixed(1)}, ${MOON.y.toFixed(1)}, ${MOON.z.toFixed(1)}) - cameraPosition;
        float disc = ${(0.335 * R).toFixed(2)} / length(toMoon);
        float off = acos(clamp(dot(normalize(vW - cameraPosition), normalize(toMoon)), -1.0, 1.0));
        a *= mix(0.22, 1.0, smoothstep(disc * 0.85, disc * 1.6, off));
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
