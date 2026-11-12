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

function whaleMaterial(o: SkyOptions) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFog: { value: o.fogColor } },
    vertexShader: /* glsl */ `
      attribute vec3 aData;
      uniform float uTime;
      varying vec3 vData;
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec3 p = position;
        // the stroke of the tail runs down the back half of the body
        float w = smoothstep(0.12, -0.6, p.z);
        float k = p.z * 5.2 + uTime * 1.25;
        p.y += 0.062 * sin(k) * w * w - 0.012 * sin(k - 1.2) * (1.0 - w);
        // flippers row slowly, bending towards their tips
        float reach = max(abs(p.x) - 0.085, 0.0);
        if (aData.z > 1.5 && aData.z < 2.5) p.y += reach * (0.5 * sin(uTime * 0.8 + reach * 4.0) - 0.15);
        if (aData.z > 0.5 && aData.z < 1.5) p.y += abs(p.x) * 0.25 * sin(k - 0.6);
        vec3 n = normalize(normal + vec3(0.0, 0.0, -0.32 * cos(k) * w * w) * normal.y);
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
      /** a field of twinkling stars on a wrapped grid */
      vec3 stars(vec2 g, float density) {
        vec2 cell = floor(g);
        float h = wHash(cell);
        vec2 at = vec2(0.3) + 0.4 * vec2(wHash(cell + 3.1), wHash(cell + 7.7));
        float d = length(fract(g) - at);
        float tw = 0.45 + 0.55 * sin(uTime * (1.0 + 2.0 * h) + h * 40.0);
        float s = step(1.0 - density, h) * (smoothstep(0.16, 0.0, d) * 0.6 + smoothstep(0.05, 0.02, d)) * tw;
        return mix(vec3(0.35, 0.95, 1.0), vec3(1.0, 0.78, 0.4), step(0.93, wHash(cell + 1.3))) * s;
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

        vec3 back = mix(vec3(0.035, 0.05, 0.24), vec3(0.09, 0.07, 0.36), u);
        vec3 pale = vec3(0.36, 0.5, 0.86);
        vec3 col = mix(back, pale, belly * smoothstep(0.98, 0.5, u));
        // throat pleats from the chin to the flippers
        float pleat = 0.5 + 0.5 * cos(ang * 34.0);
        col *= 1.0 - 0.3 * pleat * belly * smoothstep(0.52, 0.3, u) * body;
        // fins: dark, with a pale ribbed hem
        float hem = smoothstep(0.55, 1.0, vData.x) * (1.0 - body);
        col = mix(col, pale * (0.8 + 0.2 * sin(vData.y * 30.0)), hem * 0.6);

        // light: the moon ahead, the town's glow from everywhere else
        float moon = max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0);
        float ndv = max(dot(n, V), 0.0);
        vec3 lit = col * (vec3(0.5, 0.45, 0.75) + vec3(0.5, 0.75, 1.0) * moon);
        lit += vec3(0.25, 0.6, 1.0) * pow(1.0 - ndv, 3.0) * 0.55;

        // her freckles are stars; a denser river of them runs along each flank
        vec2 g = body > 0.5 ? vec2(u * 46.0, vData.y * 30.0) : vec2(vData.x * 9.0, vData.y * 3.0 + vData.z * 5.0);
        float flank = body * exp(-pow((abs(vData.y - 0.5) - 0.24) * 9.0, 2.0));
        lit += stars(g, 0.16 + 0.5 * flank) * (0.9 + 1.2 * flank);
        lit += stars(g * 2.7 + 11.0, 0.1) * 0.5;
        // a small bright eye
        vec3 e = vec3(abs(vObj.x) - 0.1, vObj.y + 0.022, vObj.z - 0.325);
        lit += vec3(1.0, 0.85, 0.55) * smoothstep(0.014, 0.006, length(e)) * 2.0 * body;

        float fog = smoothstep(${o.fogNear.toFixed(1)}, ${o.fogFar.toFixed(1)}, length(cameraPosition - vW));
        gl_FragColor = vec4(mix(lit, uFog, fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
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
  /** angle around the axis, distance from it and position along it at t = 0, and their rates */
  th: number;
  rho: number;
  z: number;
  dTh: number;
  dZ: number;
  phase: number;
}

export function createSky(o: SkyOptions, pointsMat: THREE.Material): Sky {
  const root = new THREE.Group();
  const rnd = mulberry32(777);

  // ---- the whales: swimming down the axis into the moon, the calf tucked under her flipper
  const geo = whaleGeometry();
  const mat = whaleMaterial(o);
  const swimmers: Swimmer[] = [
    { size: 50, th: -1.7, rho: 20, z: 40, dTh: 0.085, dZ: 4.5, phase: 0 },
    { size: 20, th: -2.05, rho: 27, z: 56, dTh: 0.087, dZ: 4.5, phase: 2.1 },
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
  const ahead = new THREE.Vector3();
  const up = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const place = (s: Swimmer, t: number, out: THREE.Vector3) => {
    const th = s.th + s.dTh * t;
    const rho = s.rho + 1.5 * Math.sin(t * 0.21 + s.phase);
    return out.set(rho * Math.sin(th), -rho * Math.cos(th), s.z + s.dZ * t);
  };

  return {
    root,
    update(t, eye, forward) {
      mat.uniforms.uTime!.value = t;
      lanternMat.uniforms.uTime!.value = t;
      lanternMat.uniforms.uEye!.value.copy(eye);
      lanternMat.uniforms.uFwd!.value.copy(forward);
      for (const s of swimmers) {
        place(s, t, pos);
        place(s, t + 0.5, ahead);
        const th = s.th + s.dTh * t;
        // back to the axis, plus a slow roll
        up.set(-Math.sin(th), Math.cos(th), 0).applyAxisAngle(dir.subVectors(ahead, pos).normalize(), 0.12 * Math.sin(t * 0.3 + s.phase));
        // Matrix4.lookAt points +z from the target to the eye, i.e. the whale's head at `ahead`
        m.lookAt(ahead, pos, up);
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
