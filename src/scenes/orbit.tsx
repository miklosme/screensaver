import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RAIL, createRide } from "./rail";
import { TIMING, type SceneProps } from "./types";
import { createSky } from "./orbit/sky";
import { mergeGeometries, mergeVertices, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * ORBIT — the inside-out world.
 *
 * A night town wrapped around the inside of a great cylinder. Everything is laid out in
 * "unrolled" coordinates (s = arc length around, z = along the axis, h = height above ground)
 * and bent onto the cylinder by `frame()`. The camera glides down from mid-air onto a
 * lantern-lit road, circles a tiny moon-gate hut and leaves through its round door.
 */

const R = 70;
const C = Math.PI * 2 * R;
const ZH = 180; // half length of the cylinder
const FOG_COLOR = "#131747";
const FOG_NEAR = 30;
const FOG_FAR = 400;

const HUT_Z = 30; // hut sits at s = 0 (world: x = 0, y = -R), so its local frame is the world frame
const DOOR_H = 3.5;
const DOOR_R = 2.68;
const DOOR_Z = HUT_Z - 4.6;
const PORTAL_Z = DOOR_Z + 0.14;
const PLAZA_R = 14;
const LEAF_T = 0.22; // leaf thickness, bevel included
const HUT_WINDOWS = [0, Math.PI * 0.5, Math.PI, Math.PI * 0.25, Math.PI * 0.75];
const HUT_WIN_R = 4.36;
const HUT_WIN_Y = 2.15;
/** the stepped base: radius and top of each tier, bottom first */
const STEP_R = [7.6, 6.7, 5.8];
const STEP_Y = [0.42, 0.62, 0.82];

/** camera way-points: [s, z, h] */
const WAY: [number, number, number][] = [
  [-125, -85, 28],
  [-106, -58, 21],
  [-88, -36, 15],
  [-72, -18, 9.2],
  [-56, -5, 4.2],
  [-42, 10, 3.7],
  [-30, 27, 4.2],
  [-18, 43, 5],
  [0, 52, 5.6],
  [15, 46, 5.2],
  [22, 31, 4.6],
  [21.5, 16, 4.1],
  [18.8, 2.2, 3.9],
  [11, -1, 3.8],
  [3.2, 2.2, 3.7],
  [0, 10, 3.6],
  [0, 16, DOOR_H],
  [0, 21, DOOR_H],
  [0, PORTAL_Z, DOOR_H],
];

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

const wrapS = (ds: number) => ds - C * Math.round(ds / C);
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------- depth: air between the layers
/** the indigo the far town sinks into (mixed after the colour-space step, like three's fog) */
const AIR = new THREE.Color("#272c78");
const AIR_GLSL = `vec3(${AIR.r.toFixed(4)}, ${AIR.g.toFixed(4)}, ${AIR.b.toFixed(4)})`;
/** 0 near the camera, ~0.4 at the middle towers, ~0.8 for the town overhead */
const EXT_GLSL = "(1.0 - exp(-max(vFogDepth - 16.0, 0.0) * 0.0135))";
const LAMP_PARS = /* glsl */ `
uniform sampler2D uLamp;
/** lamp light at the foot of a world point, from the baked map in unrolled (s, z) */
vec3 lampAt(vec3 p) {
  return texture2D(uLamp, vec2(atan(p.x, -p.y) * ${(1 / (2 * Math.PI)).toFixed(6)}, p.z / ${(2 * ZH).toFixed(1)} + 0.5)).rgb;
}`;

/**
 * The moon hangs at the +z end of the cylinder. Silhouettes catch a cool rim on the side that faces
 * it, added after the air so towers part from the sky. It is strongest on the middle-distance towers
 * and on moon-facing normals; overhead it is kept to a restrained edge, because there the layers
 * already part by value (`LAYER_GLSL`). Lit materials only (they have `normal` and `vViewPosition`);
 * kept under the bloom threshold so it reads as an edge.
 */
const RIM_GLSL = /* glsl */ `
  {
    vec3 nW = transpose(mat3(viewMatrix)) * normal;
    float graze = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    float e = ${EXT_GLSL};
    float rim = graze * graze * graze * (0.2 + 0.8 * smoothstep(-0.1, 0.7, nW.z))
      * smoothstep(0.08, 0.35, e) * (1.0 - 0.25 * smoothstep(0.5, 0.8, e));
    gl_FragColor.rgb += vec3(0.17, 0.25, 0.52) * 0.8 * rim;
  }`;

/**
 * Value between the layers: across the town overhead a nearer tower is a step lighter and a touch
 * warmer than the street it hangs from and the towers behind it, so successive layers separate
 * without an outline on each.
 */
const LAYER_GLSL = /* glsl */ `
  gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.08, 1.05, 1.0), smoothstep(50.0, 90.0, vFogDepth))
    * mix(vec3(1.0), vec3(0.8, 0.82, 0.92), smoothstep(100.0, 230.0, vFogDepth));
`;

/**
 * Wet street: each light near the camera is mirrored in the ground as a streak stretched towards
 * the eye. Everything is in unrolled (s, z) ground coordinates; the lights (s, z, height, weight)
 * and the eye's foot and height are chosen per frame from the camera pose (`pickReflections`).
 */
const REFL_N = 12;
const WET_GLSL = /* glsl */ `
uniform vec4 uRL[${REFL_N}];   // mirror point (s, z), unit direction towards the eye
uniform vec3 uRW[${REFL_N}];   // 1 / half-width, 1 / reach towards the eye, 1 / reach back to the lamp
uniform vec3 uRC[${REFL_N}];   // colour times weight
uniform int uRN;
uniform vec3 uEyeG;
float wrapC(float x) { return x - ${C.toFixed(3)} * floor(x / ${C.toFixed(3)} + 0.5); }
/** reflected light at ground point g (unrolled), before the roughness mask; zero past its reach */
vec3 wetSheen(vec2 g) {
  vec3 acc = vec3(0.0);
  vec2 ge = vec2(wrapC(g.x - uEyeG.x), g.y - uEyeG.y);
  float dEye = dot(ge, ge);
  if (dEye > ${(48 * 48).toFixed(1)}) return acc;
  for (int i = 0; i < ${REFL_N}; i++) {
    if (i >= uRN) break;
    vec4 L = uRL[i];
    vec3 W = uRW[i];
    vec2 q = vec2(wrapC(g.x - L.x), g.y - L.y);
    float a = dot(q, L.zw) * (dot(q, L.zw) > 0.0 ? W.y : W.z);
    float b = (q.y * L.z - q.x * L.w) * W.x;
    acc += uRC[i] * exp(-(a * a + b * b));
  }
  return acc * (1.0 - smoothstep(${(30 * 30).toFixed(1)}, ${(48 * 48).toFixed(1)}, dEye));
}
float hashW(vec2 p) { return fract(sin(dot(p, vec2(12.99, 78.23))) * 43758.5); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashW(i), hashW(i + vec2(1.0, 0.0)), f.x), mix(hashW(i + vec2(0.0, 1.0)), hashW(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

/** a height field h tilts a view-space normal; scale-true, from screen derivatives */
const BUMP_GLSL = /* glsl */ `
vec3 bumpV(vec3 surfPos, vec3 n, float h, float face) {
  vec3 dpx = dFdx(surfPos);
  vec3 dpy = dFdy(surfPos);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1) * face;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}`;

/** overlapping round shingles in cell units (rows run up `sv.y`): x is the tone, y a height for a bump */
const SHINGLE_GLSL = /* glsl */ `
vec2 shingle(vec2 sv) {
  sv.x += 0.5 * mod(floor(sv.y), 2.0);
  vec2 f = fract(sv);
  float d = length(vec2(f.x - 0.5, max(0.5 - f.y, 0.0)));
  float tile = smoothstep(0.52, 0.44, d);
  float hem = tile * smoothstep(0.34, 0.44, d);
  float tone = fract(sin(dot(floor(sv), vec2(12.99, 78.23))) * 43758.5);
  return vec2(mix(0.5, (0.8 + 0.5 * f.y) * (0.88 + 0.24 * tone), tile) + 0.5 * hem, tile * (1.0 - 0.7 * f.y));
}`;

// ---------------------------------------------------------------- the moon-gate hut's own shading
const HUT_ORIGIN = `vec3(0.0, ${(-R).toFixed(1)}, ${HUT_Z.toFixed(1)})`;
const GATE_C = `vec3(0.0, ${DOOR_H.toFixed(2)}, ${(DOOR_Z - HUT_Z).toFixed(2)})`;
const HUT_PARS = /* glsl */ `
varying vec3 vHp;
${SHINGLE_GLSL}
/** a height field h (world units) tilts the view-space normal; scale-true, from screen derivatives */
vec3 bumpN(vec3 surfPos, vec3 n, float h, float face) {
  vec3 dpx = dFdx(surfPos);
  vec3 dpy = dFdy(surfPos);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1) * face;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
/** warm light thrown by the gold ring of the gate onto a hut-local point, falling off with distance */
vec3 gateWash(vec3 p, vec3 nW) {
  vec3 q = p - ${GATE_C};
  float rho = max(length(q.xy), 1e-3);
  vec3 L = vec3(q.xy * (2.86 / rho), 0.0) - q;
  float d = max(length(L), 1e-3);
  float lam = 0.3 + 0.7 * max(dot(nW, L / d), 0.0);
  return vec3(1.0, 0.58, 0.2) * lam / (1.0 + d * d * 1.1);
}
float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.99, 78.23))) * 43758.5); }
`;

/** a 4-point star: two thin rhombi */
const STAR_GLSL = /* glsl */ `
float sdStar(vec2 p, float s) {
  p = abs(p);
  return min(p.x / s + p.y / (s * 0.24), p.x / (s * 0.24) + p.y / s) * s * 0.23 - s * 0.23;
}`;

/**
 * Patches a hut material: `pattern` runs once the normal is known (it may change `diffuseColor`,
 * `normal` and `hutGlow`), then the gate's warm wash and, with `rim`, a cool moon rim are added.
 */
function hutShader(mat: THREE.Material, key: string, pattern: string, wash: number, rim = 0, leaf = false) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vHp;${leaf ? "\nattribute vec2 aq;\nvarying vec2 vQ;\nvarying float vNz;" : ""}`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vHp = (modelMatrix * vec4(transformed, 1.0)).xyz - ${HUT_ORIGIN};
        ${leaf ? "vQ = aq; vNz = normal.z;" : ""}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${HUT_PARS}${leaf ? `\nvarying vec2 vQ;\nvarying float vNz;\n${STAR_GLSL}` : ""}`,
      )
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\nvec3 hutGlow = vec3(0.0);\n{\n${pattern}\n}`)
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        {
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          totalEmissiveRadiance += hutGlow + (diffuseColor.rgb * 1.7 + 0.05) * gateWash(vHp, nW) * ${wash.toFixed(2)};
          ${
            rim > 0
              ? `float g = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          totalEmissiveRadiance += vec3(0.32, 0.55, 1.0) * g * g * g * smoothstep(-0.25, 0.75, nW.z) * ${rim.toFixed(2)};`
              : ""
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => `orbit-hut-${key}`;
}

/**
 * Chains a material's own shader patch with distance extinction: the colour sinks into AIR by
 * `k` times the extinction factor. Every patched material gets its own program key.
 */
function withAir(
  mat: THREE.Material,
  key: string,
  k: number,
  patch?: (sh: THREE.WebGLProgramParametersWithUniforms) => void,
  rim = false,
) {
  mat.onBeforeCompile = (sh) => {
    patch?.(sh);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <fog_fragment>",
      `#include <fog_fragment>
      #ifdef USE_FOG
        gl_FragColor.rgb = mix(gl_FragColor.rgb, ${AIR_GLSL}, clamp(${EXT_GLSL} * ${k.toFixed(3)}, 0.0, 1.0));
        ${LAYER_GLSL}
        ${rim ? RIM_GLSL : ""}
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => `orbit-${key}`;
}

/**
 * Lit windows are lights, not wall: distance takes only a little of their saturation and none of
 * their brightness beyond three's own fog, so the town overhead stays inhabited.
 */
function windowAir(mat: THREE.Material) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vWq;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float ww = length(instanceMatrix[0].xyz);
          float wh = length(instanceMatrix[1].xyz);
          // beyond the reach of its halo a window shrinks to the opening and its sill
          vec3 wc = (modelMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
          if (distance(wc, cameraPosition) > 52.0) transformed.xy = clamp(transformed.xy, vec2(-0.5 - 0.08 / ww, -0.1 / wh), vec2(0.5 + 0.08 / ww, 1.0));
          vWq = vec4(transformed.x * ww, transformed.y * wh, ww, wh);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vWq;")
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        // the opening, in wall units: a round-headed arch, set into the wall
        vec2 Q = vWq.xy;
        float hw = vWq.z * 0.5;
        float yc = vWq.w - hw;
        float dw = Q.y > yc ? length(Q - vec2(0.0, yc)) - hw : max(abs(Q.x) - hw, -Q.y);
        float pxw = fwidth(dw) + 1e-4;
        float detail = 1.0 - smoothstep(0.012, 0.05, pxw);
        float wIn = 1.0 - smoothstep(-pxw, pxw, dw);
        vec3 lit = diffuseColor.rgb;
        // glass: brightest low in the middle, a dark reveal round the edge, a mullion and a transom
        float glow = 0.82 + 0.4 * (1.0 - smoothstep(0.0, vWq.w, length((Q - vec2(0.0, yc * 0.45)) * vec2(1.6, 1.0))));
        float reveal = smoothstep(-0.075, -0.03, dw);
        float bars = max(1.0 - smoothstep(0.016, 0.016 + pxw, abs(Q.x)), 1.0 - smoothstep(0.016, 0.016 + pxw, abs(Q.y - yc)));
        vec3 frameCol = lit * 0.06 + vec3(0.025, 0.02, 0.05);
        vec3 c = lit * mix(1.0, glow, detail);
        c = mix(c, frameCol, detail * max(reveal * 0.85, bars * step(dw, 0.0)));
        diffuseColor.rgb = c;
        // a lit sill under the opening, and the glow the window throws on the brick round it
        float sill = (1.0 - smoothstep(-pxw, pxw, max(abs(Q.x) - hw - 0.07, abs(Q.y + 0.045) - 0.045))) * (1.0 - wIn);
        float edgeQ = max(abs(vWq.x / vWq.z) / 1.3, max((vWq.y / vWq.w - 0.525) / 0.925, 0.0));
        vec3 wHalo = lit * (0.42 * exp(-max(dw, 0.0) / 0.13) + 0.08 * exp(-max(dw, 0.0) / 0.3)) * (1.0 - wIn) * (1.0 - smoothstep(0.35, 0.9, edgeQ));
        wHalo *= 1.0 + 0.6 * smoothstep(0.2, -0.3, Q.y);
        vec3 sillCol = lit * 0.28 + vec3(0.04, 0.035, 0.07);
        if (wIn + sill < 0.002 && dot(wHalo, vec3(1.0)) < 0.004) discard;
        diffuseColor.rgb = mix(diffuseColor.rgb, sillCol, sill * detail);
        wIn = max(wIn, sill * detail);`,
      )
      .replace(
        "#include <fog_fragment>",
        `vec3 unfogged = gl_FragColor.rgb;
      #include <fog_fragment>
      #ifdef USE_FOG
      {
        // half of what the fog took comes back: a window is a light seen through the air
        float e = ${EXT_GLSL};
        vec3 c = mix(gl_FragColor.rgb, unfogged, 0.5);
        gl_FragColor.rgb = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))), 0.25 * e) * (1.0 + 0.15 * e);
        // the halo is light on near brick: it goes with distance, so the far town keeps its points
        wHalo *= (1.0 - smoothstep(0.05, 0.35, e)) * (1.0 - fogFactor);
      }
      #endif
      gl_FragColor = vec4(gl_FragColor.rgb * wIn + wHalo, wIn);`,
      );
  };
  mat.customProgramCacheKey = () => "orbit-window";
}

function toWorld(s: number, z: number, h: number, out: THREE.Vector3) {
  const th = s / R;
  const r = R - h;
  return out.set(r * Math.sin(th), -r * Math.cos(th), z);
}

/** local frame on the cylinder: x = around, y = up (towards the axis), z = along the axis */
function frame(s: number, z: number, h: number, m: THREE.Matrix4) {
  const th = s / R;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const r = R - h;
  return m.set(c, -sn, 0, r * sn, sn, c, 0, -r * c, 0, 0, 1, z, 0, 0, 0, 1);
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

class Inst {
  m: number[] = [];
  c: number[] = [];
  private fm = new THREE.Matrix4();
  private lm = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  /** frame(s,z,0) * rotY * translate(ox,oy,oz) * scale */
  add(
    s: number,
    z: number,
    rotY: number,
    ox: number,
    oy: number,
    oz: number,
    sx: number,
    sy: number,
    sz: number,
    col?: THREE.Color,
    mul = 1,
  ) {
    frame(s, z, 0, this.fm);
    this.q.setFromAxisAngle(Y_AXIS, rotY);
    this.p.set(ox, oy, oz).applyQuaternion(this.q);
    this.lm.compose(this.p, this.q, this.sc.set(sx, sy, sz));
    this.fm.multiply(this.lm);
    this.pushMatrix(this.fm, col, mul);
  }
  pushMatrix(mat: THREE.Matrix4, col?: THREE.Color, mul = 1) {
    for (let i = 0; i < 16; i++) this.m.push(mat.elements[i]!);
    if (col) this.c.push(col.r * mul, col.g * mul, col.b * mul);
  }
  get count() {
    return this.m.length / 16;
  }
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
    const mesh = new THREE.InstancedMesh(geo, mat, this.count);
    (mesh.instanceMatrix.array as Float32Array).set(this.m);
    if (this.c.length) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
    mesh.frustumCulled = false;
    return mesh;
  }
}

interface Poly {
  pts: [number, number][];
  kind: "river" | "road" | "main";
}

function buildWorld() {
  const rnd = mulberry32(20261);
  const col = new THREE.Color();

  // ---------------------------------------------------------------- camera path
  const path = new THREE.CatmullRomCurve3(
    WAY.map(([s, z, h]) => new THREE.Vector3(s, h, z)),
    false,
    "centripetal",
  );
  path.arcLengthDivisions = 800;
  const pathLen = path.getLength();

  // ---------------------------------------------------------------- roads & river (unrolled)
  const polys: Poly[] = [];
  const samples: { s: number; z: number; clear: number; anchor: boolean; main: boolean }[] = [];
  const addPoly = (pts: [number, number][], kind: Poly["kind"], clear: number) => {
    polys.push({ pts, kind });
    for (const [s, z] of pts) samples.push({ s, z, clear, anchor: kind !== "river", main: kind === "main" });
  };

  const riverZ = (s: number) => -40 + 12 * Math.sin((2 * s) / R + 1) + 5 * Math.sin((5 * s) / R);
  const ring = (fz: (s: number) => number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 300; i++) {
      const s = (i / 300) * C;
      pts.push([s, fz(s)]);
    }
    return pts;
  };
  addPoly(ring(riverZ), "river", 5);
  addPoly(ring((s) => 78 + 8 * Math.sin((3 * s) / R + 2)), "road", 1.5);
  addPoly(ring((s) => -112 + 7 * Math.sin((2 * s) / R)), "road", 1.5);
  addPoly(ring((s) => 4 + 9 * Math.sin((4 * s) / R + 0.5)), "road", 1.5);
  addPoly(ring((s) => 140 + 6 * Math.sin((3 * s) / R + 4)), "road", 1.5);
  for (let j = 0; j < 6; j++) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 260; i++) {
      const z = -(ZH - 8) + (i / 260) * 2 * (ZH - 8);
      pts.push([(j * C) / 6 + 9 * Math.sin(z / 23 + j * 1.7), z]);
    }
    addPoly(pts, "road", 1.5);
  }
  const mainPts: [number, number][] = [];
  const mainH: number[] = [];
  const v = new THREE.Vector3();
  const MAIN_N = 260;
  for (let i = 0; i <= MAIN_N; i++) {
    path.getPointAt(i / MAIN_N, v);
    mainPts.push([v.x, v.z]);
    mainH.push(v.y);
  }
  addPoly(mainPts, "main", 6);

  const blocked = (s: number, z: number, rad: number) => {
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i]!;
      const dz = z - p.z;
      const lim = rad + p.clear;
      if (dz > lim || dz < -lim) continue;
      const ds = wrapS(s - p.s);
      if (ds * ds + dz * dz < lim * lim) return true;
    }
    const ds = wrapS(s);
    const dz = z - HUT_Z;
    return ds * ds + dz * dz < (PLAZA_R + rad + 1) ** 2;
  };
  const nearMain = (s: number, z: number, d: number) => {
    for (let i = 0; i < mainPts.length; i++) {
      const ds = wrapS(s - mainPts[i]![0]);
      const dz = z - mainPts[i]![1];
      if (ds * ds + dz * dz < d * d) return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- glow points
  const pPos: number[] = [];
  const pCol: number[] = [];
  const pData: number[] = [];
  const wp = new THREE.Vector3();
  const addPoint = (
    s: number,
    z: number,
    h: number,
    size: number,
    c: THREE.Color,
    mul: number,
    drift = 0,
    twinkle = 0,
  ) => {
    toWorld(s, z, h, wp);
    pPos.push(wp.x, wp.y, wp.z);
    pCol.push(c.r * mul, c.g * mul, c.b * mul);
    pData.push(size, rnd() * 6.283, drift, twinkle);
  };
  const GOLD = new THREE.Color("#ffb347");
  const CYAN = new THREE.Color("#58e6ff");

  // ---------------------------------------------------------------- buildings
  const anchors = samples.filter((p) => p.anchor);
  const buildings: { s: number; z: number; rad: number; H: number }[] = [];
  const bodies = new Inst();
  const domes = [new Inst(), new Inst(), new Inst()];
  const windows = new Inst();
  const DOME_H = [1.45, 2.2, 3.4];
  const fm = new THREE.Matrix4();
  const lm = new THREE.Matrix4();
  const bx = new THREE.Vector3();
  const by = new THREE.Vector3();
  const bz = new THREE.Vector3();
  const MAX_WINDOWS = 15000;
  // Occupancy has its own stream so the town's layout (drawn from `rnd`) stays as it was.
  const occRnd = mulberry32(7741);
  const doorPools: { s: number; z: number }[] = [];
  /** lights that can be mirrored in the wet street: unrolled foot (s, z), height, colour */
  const reflLights: { s: number; z: number; h: number; c: THREE.Color; far: number }[] = [];
  let nearRoad = false;

  const addWindow = (b: { s: number; z: number; rad: number; H: number }, phi: number, y: number, w: number, hh: number, c: THREE.Color, mul: number) => {
    const rr = b.rad * (1 - 0.12 * (y / b.H)) + 0.05;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    bx.set(sp * w, 0, -cp * w);
    by.set(0, hh, 0);
    bz.set(cp, 0, sp);
    lm.makeBasis(bx, by, bz).setPosition(cp * rr, y, sp * rr);
    frame(b.s, b.z, 0, fm).multiply(lm);
    windows.pushMatrix(fm, c, mul);
    if (nearRoad && y < 4.5) {
      reflLights.push({ s: b.s + cp * (rr + 0.3), z: b.z + sp * (rr + 0.3), h: y + hh * 0.5, c: c.clone().multiplyScalar(mul * (y < 0.5 ? 0.7 : 0.5)), far: 1.7 });
    }
  };

  for (let attempt = 0; attempt < 9000 && buildings.length < 760; attempt++) {
    const a = anchors[Math.floor(rnd() * anchors.length)]!;
    const ang = rnd() * 6.283;
    const dist = 3 + Math.pow(rnd(), 1.4) * 26;
    const s = a.s + Math.cos(ang) * dist;
    const z = a.z + Math.sin(ang) * dist;
    const tall = rnd() < 0.075;
    const rad = tall ? 3.4 + rnd() * 2.4 : 1.5 + rnd() * 2.3;
    const H = tall ? 22 + rnd() * 20 : rad * (1.5 + rnd() * 2.8) + 2;
    const type = tall ? (rnd() < 0.6 ? 2 : 1) : Math.floor(rnd() * 3);
    const hueRoll = rnd();
    const litRoll = rnd();
    if (Math.abs(z) > ZH - 10 || blocked(s, z, rad + 0.7)) continue;
    let ok = true;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!;
      const dz = z - b.z;
      const lim = rad + b.rad + 0.6;
      if (dz > lim || dz < -lim) continue;
      const ds = wrapS(s - b.s);
      if (ds * ds + dz * dz < lim * lim) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const b = { s, z, rad, H };
    buildings.push(b);
    nearRoad = nearMain(s, z, rad + 12);

    if (hueRoll < 0.16) col.setHSL(0.68, 0.3, 0.5 + rnd() * 0.12);
    else col.setHSL(0.62 + hueRoll * 0.12, 0.32 + rnd() * 0.2, 0.2 + rnd() * 0.14);
    bodies.add(s, z, rnd() * 6.283, 0, 0, 0, rad, H, rad, col);
    const ds = rad * 0.88 * (type === 2 ? 1.0 : 1.02);
    const roof = rnd();
    if (roof < 0.5) col.setHSL(0.52 + rnd() * 0.04, 0.55, 0.2 + rnd() * 0.08);
    else if (roof < 0.82) col.setHSL(0.78 + rnd() * 0.05, 0.4, 0.2 + rnd() * 0.08);
    else col.setHSL(0.09 + rnd() * 0.03, 0.75, 0.42);
    domes[type]!.add(s, z, 0, 0, H, 0, ds, ds * (0.9 + rnd() * 0.35), ds, col);
    if (tall || rnd() < 0.12) addPoint(s, z, H + DOME_H[type]! * ds * 1.05 + 0.3, tall ? 3.4 : 1.8, rnd() < 0.5 ? CYAN : GOLD, 0.9, 0, 0.5);

    // windows
    if (windows.count < MAX_WINDOWS) {
      const cyanHouse = rnd() < 0.06;
      const lit = 0.3 + litRoll * 0.45;
      // who is home tonight: a few houses quieter, most well lit, the odd one blazing. The floor is
      // high, and windows the layout left dark are lit back from the occupancy stream, so the town
      // carries at least as many windows as before. (Only `occRnd` decides this: the layout's
      // `rnd` stream must be consumed exactly as before or every house moves.)
      const oRoll = occRnd();
      const occ = oRoll < 0.1 ? 0.55 : oRoll < 0.8 ? 0.8 + occRnd() * 0.2 : 1;
      const extra = oRoll < 0.1 ? 0.08 : oRoll < 0.8 ? 0.22 : 0.36;
      const cols = Math.max(4, Math.floor((6.283 * rad) / 2.1));
      const phi0 = rnd() * 6.283;
      let row = 0;
      for (let y = 2.0; y < H - 1.3; y += 2.35, row++) {
        for (let k = 0; k < cols; k++) {
          if (rnd() > lit) {
            if (occRnd() < extra) {
              if (cyanHouse) col.copy(CYAN);
              else col.setHSL(0.06 + occRnd() * 0.045, 1, 0.5 + occRnd() * 0.06);
              addWindow(b, phi0 + ((k + (row % 2) * 0.5) / cols) * 6.283, y, 0.5, 1.0, col, 0.45 + occRnd() * 0.75);
            }
            continue;
          }
          if (cyanHouse) col.copy(CYAN);
          else col.setHSL(0.06 + rnd() * 0.045, 1, 0.5 + rnd() * 0.06);
          const mul = 0.45 + rnd() * 0.75;
          if (occRnd() > occ) continue;
          addWindow(b, phi0 + ((k + (row % 2) * 0.5) / cols) * 6.283, y, 0.5, 1.0, col, mul);
        }
      }
      // a lit doorway at street level
      const doors = tall ? 3 : 1;
      for (let k = 0; k < doors; k++) {
        col.setHSL(0.075, 1, 0.52);
        const phi = phi0 + 1 + (k / doors) * 6.283;
        addWindow(b, phi, 0, 0.85, 1.7, col, 1.1);
        doorPools.push({ s: s + Math.cos(phi) * (rad + 1.2), z: z + Math.sin(phi) * (rad + 1.2) });
      }
    }
  }

  // ---------------------------------------------------------------- trees
  const trees = new Inst();
  for (let attempt = 0, n = 0; attempt < 5000 && n < 300; attempt++) {
    const a = anchors[Math.floor(rnd() * anchors.length)]!;
    const ang = rnd() * 6.283;
    const dist = 2.5 + rnd() * 16;
    const s = a.s + Math.cos(ang) * dist;
    const z = a.z + Math.sin(ang) * dist;
    const cypress = rnd() < 0.35;
    const r = cypress ? 0.7 + rnd() * 0.5 : 1.1 + rnd() * 1.3;
    const k = cypress ? 2.6 + rnd() * 1.2 : 0.85 + rnd() * 0.5;
    const hue = 0.47 + rnd() * 0.1;
    const light = 0.1 + rnd() * 0.08;
    if (Math.abs(z) > ZH - 10 || blocked(s, z, r + 0.4)) continue;
    let ok = true;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!;
      const dz = z - b.z;
      const lim = r + b.rad + 0.2;
      if (dz > lim || dz < -lim) continue;
      const ds = wrapS(s - b.s);
      if (ds * ds + dz * dz < lim * lim) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    col.setHSL(hue, 0.55, light);
    trees.add(s, z, rnd() * 6, 0, r * k * 0.8, 0, r, r * k, r, col);
    n++;
  }

  // ---------------------------------------------------------------- lanterns
  const posts = new Inst();
  const bulbs = new Inst();
  const lanterns: { s: number; z: number; cyan: boolean }[] = [];
  const cones = new Inst();
  const addLantern = (s: number, z: number, cyan: boolean) => {
    if (nearMain(s, z, 3.8)) return;
    lanterns.push({ s, z, cyan });
    posts.add(s, z, 0, 0, 0, 0, 1, 1, 1);
    bulbs.add(s, z, 0, 0, 2.9, 0, 1, 1.25, 1, cyan ? CYAN : GOLD, 1.6);
    addPoint(s, z, 2.9, 3.4, cyan ? CYAN : GOLD, 0.75);
    if (!cyan) {
      reflLights.push({ s, z, h: 2.9, c: GOLD.clone(), far: 1 });
      cones.add(s, z, 0, 0, 0, 0, 1, 1, 1);
    }
  };
  // along the camera road, alternating sides
  {
    let side = 1;
    for (let d = 70; d < pathLen - 30; d += 7.5) {
      const u = d / pathLen;
      path.getPointAt(u, v);
      const t = path.getTangentAt(u);
      const len = Math.hypot(t.x, t.z) || 1;
      const ls = v.x + (t.z / len) * 4 * side;
      const lz = v.z - (t.x / len) * 4 * side;
      side = -side;
      if (Math.hypot(wrapS(ls), lz - HUT_Z) < 9) continue;
      addLantern(ls, lz, false);
    }
  }
  // along the other roads
  for (const poly of polys) {
    if (poly.kind !== "road") continue;
    for (let i = 4; i < poly.pts.length - 1; i += 9) {
      const [s0, z0] = poly.pts[i]!;
      const [s1, z1] = poly.pts[i + 1]!;
      const len = Math.hypot(s1 - s0, z1 - z0) || 1;
      const side = (i / 9) % 2 < 1 ? 1 : -1;
      const ls = s0 + ((z1 - z0) / len) * 2.3 * side;
      const lz = z0 - ((s1 - s0) / len) * 2.3 * side;
      if (nearMain(ls, lz, 5) || Math.hypot(wrapS(ls), lz - HUT_Z) < PLAZA_R + 2) continue;
      if (Math.abs(lz - riverZ(ls)) < 5) continue;
      addLantern(ls, lz, false);
    }
  }
  // cyan ring around the plaza
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 6.283 + 0.26;
    const ls = Math.cos(a) * 12.3;
    const lz = HUT_Z + Math.sin(a) * 12.3;
    if (nearMain(ls, lz, 3.6)) continue;
    addLantern(ls, lz, true);
  }
  // floating lights on the river
  for (let i = 0; i < 150; i++) {
    const s = (i / 150) * C + rnd() * 2;
    addPoint(s, riverZ(s) + (rnd() - 0.5) * 3.4, 0.35, 1.3, CYAN, 0.8, 0.12, 0.4);
  }
  // fireflies / drifting motes
  for (let i = 0; i < 520; i++) {
    const s = rnd() * C;
    const z = -160 + rnd() * 320;
    const h = 1 + Math.pow(rnd(), 1.8) * 50;
    addPoint(s, z, h, 0.35 + rnd() * 0.5, rnd() < 0.7 ? GOLD : CYAN, 0.9, 1.2 + rnd() * 1.5, 0.8);
  }
  // hut finial
  addPoint(0, HUT_Z, 10.5, 6, CYAN, 1.0, 0, 0.25);

  // ---------------------------------------------------------------- arcade over the camera road
  const arches = new Inst();
  const pillars = new Inst();
  const stone = new THREE.Color().setHSL(0.66, 0.3, 0.42);
  const arcadeLamps: { s: number; z: number }[] = [];
  for (let d = 108; d <= 172; d += 9.2) {
    const u = d / pathLen;
    path.getPointAt(u, v);
    const t = path.getTangentAt(u);
    const alpha = Math.atan2(t.x, t.z);
    arches.add(v.x, v.z, alpha, 0, 2.6, 0, 1, 1, 1, stone);
    pillars.add(v.x, v.z, alpha, 5.4, 0, 0, 1, 1, 1, stone);
    pillars.add(v.x, v.z, alpha, -5.4, 0, 0, 1, 1, 1, stone);
    addPoint(v.x, v.z, 7.35, 3.0, GOLD, 0.9);
    arcadeLamps.push({ s: v.x, z: v.z });
    reflLights.push({ s: v.x, z: v.z, h: 7.35, c: GOLD.clone(), far: 1 });
    bulbs.add(v.x, v.z, 0, 0, 7.35, 0, 1, 1.3, 1, GOLD, 1.6);
    // a string of small festoon bulbs hung under the rib
    for (const a of [0.55, 1.0, 2.14, 2.59]) {
      bulbs.add(v.x, v.z, alpha, Math.cos(a) * 4.72, 2.6 + Math.sin(a) * 4.72, 0, 0.42, 0.5, 0.42, GOLD, 1.9);
    }
  }

  // ---------------------------------------------------------------- ground texture
  const W = 2048;
  const H = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#090c28";
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(W / C, 0, 0, H / (2 * ZH), 0, H / 2);
  const blob = (s: number, z: number, r: number, rgb: string, a: number) => {
    const s0 = ((s % C) + C) % C;
    for (let k = -1; k <= 1; k++) {
      const cx = s0 + k * C;
      if (cx + r < 0 || cx - r > C) continue;
      const g = ctx.createRadialGradient(cx, z, 0, cx, z, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, z - r, 2 * r, 2 * r);
    }
  };
  const stroke = (pts: [number, number][], width: number, style: string, dash?: number[]) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(dash ?? []);
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i]![0] + k * C;
        if (i === 0) ctx.moveTo(x, pts[i]![1]);
        else ctx.lineTo(x, pts[i]![1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  const prnd = mulberry32(99);
  const PATCH = ["14,70,82", "52,30,100", "22,34,104", "4,5,18", "10,52,60", "4,5,18"];
  for (let i = 0; i < 620; i++) {
    blob(prnd() * C, (prnd() * 2 - 1) * ZH, 7 + prnd() * 24, PATCH[Math.floor(prnd() * PATCH.length)]!, 0.3 + prnd() * 0.3);
  }
  for (let i = 0; i < 3200; i++) {
    blob(prnd() * C, (prnd() * 2 - 1) * ZH, 0.5 + prnd() * 1.6, prnd() < 0.5 ? "70,100,190" : "30,120,120", 0.1 + prnd() * 0.12);
  }
  // river
  const river = polys[0]!.pts;
  stroke(river, 13, "rgba(20,130,160,0.22)");
  stroke(river, 8, "#0b5d78");
  stroke(river, 6, "#1596b4");
  stroke(river, 3.4, "rgba(70,210,235,0.7)");
  stroke(river, 1.2, "rgba(190,250,255,0.55)");
  // roads
  for (const poly of polys) {
    if (poly.kind !== "road") continue;
    stroke(poly.pts, 5, "rgba(110,115,210,0.14)");
    stroke(poly.pts, 3.9, "rgba(125,130,215,0.5)");
    stroke(poly.pts, 2.9, "#262b66");
    stroke(poly.pts, 1.6, "rgba(70,76,150,0.5)");
  }
  stroke(mainPts, 7.5, "rgba(120,125,220,0.2)");
  stroke(mainPts, 5.2, "#2d3274");
  // plaza
  ctx.fillStyle = "#2d3274";
  ctx.beginPath();
  ctx.arc(0, HUT_Z, PLAZA_R, 0, 6.3);
  ctx.arc(C, HUT_Z, PLAZA_R, 0, 6.3);
  ctx.fill();
  // contact shadows: every tower sits in a soft dark ring where it meets the cobbles
  for (const b of buildings) blob(b.s, b.z, b.rad + 2.4, "3,4,16", 0.75);
  // light pools: lamps and doorways pour soft light onto the street (a falloff, not a disc)
  const pool = (s: number, z: number, r: number, rgb: string, a: number) => {
    const s0 = ((s % C) + C) % C;
    for (let k = -1; k <= 1; k++) {
      const cx = s0 + k * C;
      if (cx + r < 0 || cx - r > C) continue;
      const g = ctx.createRadialGradient(cx, z, 0, cx, z, r);
      for (let i = 0; i <= 6; i++) {
        const x = i / 6;
        g.addColorStop(x, `rgba(${rgb},${(a * Math.exp(-4.2 * x * x) * (1 - x)).toFixed(3)})`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, z - r, 2 * r, 2 * r);
    }
  };
  ctx.globalCompositeOperation = "lighter";
  for (const d of doorPools) pool(d.s, d.z, 3.6, "255,150,60", 0.4);
  for (const l of lanterns) pool(l.s, l.z, l.cyan ? 6 : 6.5, l.cyan ? "60,220,255" : "255,168,72", l.cyan ? 0.8 : 0.75);
  blob(0, HUT_Z, 24, "90,170,255", 0.14);
  blob(0, HUT_Z - 9, 9, "255,190,110", 0.4);
  ctx.globalCompositeOperation = "source-over";

  // ---------------------------------------------------------------- lamp light map
  // What the lamps throw on the walls and the plaza, in the same unrolled (s, z) layout as the
  // ground texture. Shaders look it up at a surface's foot and fade it with height.
  const LW = 1024;
  const lightCanvas = document.createElement("canvas");
  lightCanvas.width = lightCanvas.height = LW;
  const lctx = lightCanvas.getContext("2d")!;
  lctx.fillStyle = "#000";
  lctx.fillRect(0, 0, LW, LW);
  lctx.setTransform(LW / C, 0, 0, LW / (2 * ZH), 0, LW / 2);
  lctx.globalCompositeOperation = "lighter";
  const glow = (s: number, z: number, r: number, rgb: string, a: number) => {
    const s0 = ((s % C) + C) % C;
    for (let k = -1; k <= 1; k++) {
      const cx = s0 + k * C;
      if (cx + r < 0 || cx - r > C) continue;
      const g = lctx.createRadialGradient(cx, z, 0, cx, z, r);
      for (let i = 0; i <= 6; i++) {
        const x = i / 6;
        g.addColorStop(x, `rgba(${rgb},${(a * Math.exp(-3.5 * x * x) * (1 - x)).toFixed(3)})`);
      }
      lctx.fillStyle = g;
      lctx.fillRect(cx - r, z - r, 2 * r, 2 * r);
    }
  };
  for (const l of lanterns) glow(l.s, l.z, 6.5, l.cyan ? "70,225,255" : "255,165,70", 1);
  for (const d of doorPools) glow(d.s, d.z, 3.5, "255,140,50", 0.5);
  for (const a of arcadeLamps) glow(a.s, a.z, 9, "255,175,85", 0.7);
  const lightTex = new THREE.CanvasTexture(lightCanvas);
  lightTex.colorSpace = THREE.SRGBColorSpace;
  lightTex.flipY = false;
  lightTex.generateMipmaps = false;
  lightTex.minFilter = THREE.LinearFilter;
  lightTex.wrapS = THREE.RepeatWrapping;

  // a light blur hides the canvas' gradient dithering when the texture is magnified
  const soft = document.createElement("canvas");
  soft.width = W;
  soft.height = H;
  const sctx = soft.getContext("2d")!;
  sctx.filter = "blur(0.6px)";
  sctx.drawImage(canvas, 0, 0);
  const groundTex = new THREE.CanvasTexture(soft);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.flipY = false;
  groundTex.anisotropy = 8;

  // ---------------------------------------------------------------- main road ribbon (crisp, real geometry)
  const roadGeo = new THREE.BufferGeometry();
  {
    const pos: number[] = [];
    const colr: number[] = [];
    const rd: number[] = [];
    const idx: number[] = [];
    const kerb = new THREE.Color("#8a8ce6");
    const edge = new THREE.Color("#252a68");
    const mid = new THREE.Color("#3a3f8c");
    const cols = [kerb, kerb, edge, mid, edge, kerb, kerb];
    const offs = [-2.85, -2.4, -2.4, 0, 2.4, 2.4, 2.85];
    const N = 440;
    let rows = 0;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      path.getPointAt(u, v);
      if (u > 0.8 && Math.hypot(v.x, v.z - HUT_Z) < PLAZA_R - 0.4) break;
      const t = path.getTangentAt(u);
      const len = Math.hypot(t.x, t.z) || 1;
      for (let k = 0; k < offs.length; k++) {
        const s = v.x + (t.z / len) * offs[k]!;
        const z = v.z - (t.x / len) * offs[k]!;
        toWorld(s, z, 0.07, wp);
        pos.push(wp.x, wp.y, wp.z);
        rd.push(u * pathLen, offs[k]!, s, z);
        let warm = 0;
        let cool = 0;
        for (const l of lanterns) {
          const dz = z - l.z;
          if (dz > 9 || dz < -9) continue;
          const ds = wrapS(s - l.s);
          const g = Math.exp(-(ds * ds + dz * dz) / 11);
          if (l.cyan) cool += g;
          else warm += g;
        }
        const c = cols[k]!;
        colr.push(c.r + warm * 0.5 + cool * 0.05, c.g + warm * 0.2 + cool * 0.3, c.b + warm * 0.04 + cool * 0.4);
      }
      rows++;
    }
    const K = offs.length;
    for (let r = 0; r < rows - 1; r++) {
      for (const k of [0, 2, 3, 5]) {
        const a = r * K + k;
        idx.push(a, a + K, a + 1, a + 1, a + K, a + K + 1);
      }
    }
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
    roadGeo.setAttribute("aRd", new THREE.Float32BufferAttribute(rd, 4));
    roadGeo.setIndex(idx);
  }

  // ---------------------------------------------------------------- plaza (curved patch + its own crisp texture)
  const plazaGeo = new THREE.BufferGeometry();
  {
    const NR = 10;
    const NA = 64;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= NR; j++) {
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2;
        const r = (j / NR) * PLAZA_R;
        toWorld(Math.cos(a) * r, HUT_Z + Math.sin(a) * r, 0.11, wp);
        pos.push(wp.x, wp.y, wp.z);
        uv.push(0.5 + (0.5 * Math.cos(a) * r) / PLAZA_R, 0.5 + (0.5 * Math.sin(a) * r) / PLAZA_R);
      }
    }
    for (let j = 0; j < NR; j++) {
      for (let i = 0; i < NA; i++) {
        const a = j * (NA + 1) + i;
        idx.push(a, a + NA + 1, a + 1, a + 1, a + NA + 1, a + NA + 2);
      }
    }
    plazaGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    plazaGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    plazaGeo.setIndex(idx);
  }
  const plazaCanvas = document.createElement("canvas");
  plazaCanvas.width = plazaCanvas.height = 1024;
  {
    const c = plazaCanvas.getContext("2d")!;
    c.translate(512, 512);
    c.scale(512, 512);
    const g = c.createRadialGradient(0, 0, 0.2, 0, 0, 1);
    g.addColorStop(0, "#4a56b4");
    g.addColorStop(0.62, "#2c3380");
    g.addColorStop(1, "#1d2260");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 1, 0, 6.3);
    c.fill();
    const gold = (a: number) => `rgba(240,190,105,${a})`;
    const ringAt = (r: number, w: number, a: number) => {
      c.strokeStyle = gold(a);
      c.lineWidth = w;
      c.beginPath();
      c.arc(0, 0, r, 0, 6.3);
      c.stroke();
    };
    // rosette of petals
    for (const [r0, r1, n, w, a] of [
      [0.6, 0.9, 12, 0.012, 0.9],
      [0.6, 0.78, 24, 0.007, 0.6],
    ] as const) {
      c.strokeStyle = gold(a);
      c.lineWidth = w;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 6.2832;
        const a1 = ((i + 1) / n) * 6.2832;
        const am = (a0 + a1) / 2;
        c.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
        c.quadraticCurveTo(Math.cos(a0) * r1, Math.sin(a0) * r1, Math.cos(am) * r1, Math.sin(am) * r1);
        c.quadraticCurveTo(Math.cos(a1) * r1, Math.sin(a1) * r1, Math.cos(a1) * r0, Math.sin(a1) * r0);
      }
      c.stroke();
    }
    ringAt(0.975, 0.03, 0.95);
    ringAt(0.925, 0.008, 0.7);
    ringAt(0.6, 0.016, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * 6.2832;
      c.fillStyle = "rgba(120,235,255,0.9)";
      c.beginPath();
      c.arc(Math.cos(a) * 0.925, Math.sin(a) * 0.925, 0.016, 0, 6.3);
      c.fill();
    }
    c.globalCompositeOperation = "lighter";
    const g2 = c.createRadialGradient(0, -0.62, 0, 0, -0.62, 0.5);
    g2.addColorStop(0, "rgba(255,180,90,0.45)");
    g2.addColorStop(1, "rgba(255,180,90,0)");
    c.fillStyle = g2;
    c.fillRect(-1, -1, 2, 2);
  }
  const plazaTex = new THREE.CanvasTexture(plazaCanvas);
  plazaTex.colorSpace = THREE.SRGBColorSpace;
  plazaTex.flipY = false;
  plazaTex.anisotropy = 8;

  // ---------------------------------------------------------------- geometries
  const groundGeo = new THREE.BufferGeometry();
  {
    const NT = 96;
    const NZ = 10;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NT; i++) {
        const th = (i / NT) * Math.PI * 2;
        pos.push(R * Math.sin(th), -R * Math.cos(th), -ZH + (j / NZ) * 2 * ZH);
        nor.push(-Math.sin(th), Math.cos(th), 0);
        uv.push(i / NT, j / NZ);
      }
    }
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NT; i++) {
        const a = j * (NT + 1) + i;
        const b = a + 1;
        const c = a + NT + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    groundGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    groundGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    groundGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    groundGeo.setIndex(idx);
  }

  const bodyGeo = new THREE.CylinderGeometry(0.88, 1, 1, 24, 1, true).translate(0, 0.5, 0);
  {
    const p = bodyGeo.getAttribute("position");
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0.5;
      // a faint warm wash from the street; the lamps' own pools do the rest
      c[i * 3] = top ? 0.72 : 1.3;
      c[i * 3 + 1] = top ? 0.8 : 1.0;
      c[i * 3 + 2] = top ? 1.05 : 0.85;
    }
    bodyGeo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  }
  const lathe = (pts: [number, number][], seg: number) =>
    new THREE.LatheGeometry(
      pts.map(([x, y]) => new THREE.Vector2(x, y)),
      seg,
    );
  const domeGeos = [
    lathe([[1.1, 0], [1.08, 0.12], [0.93, 0.5], [0.66, 0.84], [0.3, 1.04], [0, 1.45]], 12),
    lathe([[1.02, 0], [1.24, 0.38], [1.1, 0.82], [0.58, 1.25], [0.14, 1.62], [0, 2.2]], 12),
    lathe([[1.28, 0], [0.9, 0.26], [0.5, 0.9], [0.22, 1.8], [0.06, 2.8], [0, 3.4]], 12),
  ];
  // a quad with room round the opening for its halo on the brick; the arched opening, its
  // reveal, mullion, transom and sill are cut in the shader
  const windowGeo = new THREE.BufferGeometry();
  windowGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1.3, -0.4, 0, 1.3, -0.4, 0, 1.3, 1.45, 0, -1.3, 1.45, 0], 3),
  );
  windowGeo.setIndex([0, 1, 2, 0, 2, 3]);
  // topiary: a smooth, gently lumpy ball (welded so its normals are smooth)
  const treeGeo = (() => {
    const g0 = new THREE.IcosahedronGeometry(1, 4);
    g0.deleteAttribute("normal");
    g0.deleteAttribute("uv");
    const g = mergeVertices(g0);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + 0.045 * Math.sin(3.1 * x + 1.3) * Math.sin(2.7 * y + 0.4) * Math.sin(3.3 * z + 2.1) + 0.025 * Math.sin(6.3 * x + 5.1 * z + 3.7 * y);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const postGeo = new THREE.CylinderGeometry(0.06, 0.1, 2.75, 8, 1, true).translate(0, 1.375, 0);
  const bulbGeo = new THREE.SphereGeometry(0.28, 16, 10);
  // a soft cone of light under each street lamp, from the head to the cobbles
  const coneGeo = new THREE.CylinderGeometry(0.2, 1.75, 2.8, 20, 3, true).translate(0, 1.42, 0);
  const archGeo = new THREE.TorusGeometry(5.4, 0.36, 16, 72, Math.PI);
  // pillar: plinth, shaft and a moulded capital whose collar swallows the foot of the rib
  const pillarGeo = lathe(
    [
      [0.001, 0], [0.66, 0], [0.66, 0.16], [0.58, 0.22], [0.56, 0.3], [0.5, 0.36], [0.46, 0.5], [0.42, 2.1],
      [0.46, 2.18], [0.5, 2.24], [0.48, 2.3], [0.55, 2.38], [0.6, 2.5], [0.6, 2.62], [0.52, 2.68], [0.44, 2.86], [0.4, 3.0], [0.001, 3.02],
    ],
    32,
  );

  const pointsGeo = new THREE.BufferGeometry();
  pointsGeo.setAttribute("position", new THREE.Float32BufferAttribute(pPos, 3));
  pointsGeo.setAttribute("aColor", new THREE.Float32BufferAttribute(pCol, 3));
  pointsGeo.setAttribute("aData", new THREE.Float32BufferAttribute(pData, 4));

  // hut
  // a round wall under a flared eave, then a bell of shingles up to a gold finial
  const hutGeo = lathe(
    [
      [4.3, 0], [4.36, 1.5], [4.32, 3.15], [4.42, 3.26], [4.68, 3.36], [4.7, 3.5], [4.5, 3.6], [4.12, 4.0],
      [3.55, 5.1], [2.75, 6.4], [1.85, 7.6], [1.05, 8.5], [0.5, 9.0], [0.3, 9.1], [0, 9.12],
    ],
    96,
  );
  const finialGeo2 = lathe(
    [[0.001, 8.95], [0.5, 8.95], [0.56, 9.08], [0.42, 9.2], [0.2, 9.3], [0.15, 9.42], [0.3, 9.6], [0.32, 9.72],
      [0.2, 9.86], [0.08, 9.98], [0.06, 10.1], [0.001, 10.12]],
    32,
  );
  // a gold crescent moon cradles the cyan orb
  const crescentGeo = (() => {
    const sh = new THREE.Shape();
    const n = 40;
    const ro = 0.62;
    const ri = 0.5;
    const off = 0.24; // the inner circle is shifted right, so the horns open that way
    const a0 = Math.acos((ro * ro - ri * ri + off * off) / (2 * ro * off));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((2 * Math.PI - 2 * a0) * i) / n;
      if (i === 0) sh.moveTo(ro * Math.cos(a), ro * Math.sin(a));
      else sh.lineTo(ro * Math.cos(a), ro * Math.sin(a));
    }
    const b0 = Math.atan2(ro * Math.sin(a0), ro * Math.cos(a0) - off);
    for (let i = 0; i <= n; i++) {
      const b = 2 * Math.PI - b0 - ((2 * Math.PI - 2 * b0) * i) / n;
      sh.lineTo(off + ri * Math.cos(b), ri * Math.sin(b));
    }
    return toCreasedNormals(
      new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 1 }).translate(-0.12, 0, -0.02),
      0.9,
    );
  })();
  const porchGeo = new THREE.CylinderGeometry(3.02, 3.02, 4.6, 32, 1, true).rotateX(Math.PI / 2);
  const frameGeo = new THREE.TorusGeometry(2.86, 0.23, 10, 56);
  const portalGeo = new THREE.CircleGeometry(2.9, 48);
  // The leaves: thick half-discs with a rounded bevel all round. `aq` keeps door-centred
  // coordinates for the lattice, which is cut in the shader.
  const leafGeo = (side: 1 | -1) => {
    const bev = 0.045;
    const rr = DOOR_R - bev;
    const a0 = Math.acos(bev / rr);
    const shape = new THREE.Shape();
    const n = 72;
    for (let i = 0; i <= n; i++) {
      const a = -a0 + (2 * a0 * i) / n;
      const x = side * Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.lineTo(side * bev, -Math.sin(a0) * rr);
    let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: LEAF_T - 2 * bev,
      bevelEnabled: true,
      bevelThickness: bev,
      bevelSize: bev,
      bevelSegments: 4,
      curveSegments: 1,
    }).translate(0, 0, -(LEAF_T / 2 - bev));
    g.deleteAttribute("uv");
    g = toCreasedNormals(g, 0.9);
    const pos = g.getAttribute("position");
    const aq = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      aq[i * 2] = pos.getX(i);
      aq[i * 2 + 1] = pos.getY(i);
    }
    g.setAttribute("aq", new THREE.BufferAttribute(aq, 2));
    return g.translate(-side * DOOR_R, 0, 0);
  };
  const leafGeoL = leafGeo(-1);
  const leafGeoR = leafGeo(1);
  const trimGeoL = new THREE.TorusGeometry(1.7, 0.06, 8, 48, Math.PI).rotateZ(Math.PI / 2).translate(DOOR_R, 0, -LEAF_T / 2);
  const trimGeoR = new THREE.TorusGeometry(1.7, 0.06, 8, 48, Math.PI).rotateZ(-Math.PI / 2).translate(-DOOR_R, 0, -LEAF_T / 2);
  const stepGeo = new THREE.CylinderGeometry(1, 1.02, 1.2, 128).translate(0, -0.6, 0);
  const roundWinGeo = new THREE.CircleGeometry(0.55, 24);
  // gold rims round the hut's porthole windows, merged into one draw
  const winFrameGeo = mergeGeometries(
    HUT_WINDOWS.map((a) =>
      new THREE.TorusGeometry(0.6, 0.07, 6, 28)
        .rotateY(Math.PI / 2 - a)
        .translate(Math.cos(a) * HUT_WIN_R, HUT_WIN_Y, Math.sin(a) * HUT_WIN_R),
    ),
  );
  const beamGeo = new THREE.CylinderGeometry(0.05, 0.2, 56, 8, 1, true).translate(0, 28, 0);
  const beamGeo2 = new THREE.CylinderGeometry(0.4, 1.3, 56, 12, 1, true).translate(0, 28, 0);
  const finialGeo = new THREE.SphereGeometry(0.34, 12, 8);
  const moonGeo = new THREE.CircleGeometry(R + 2, 64);

  // ---------------------------------------------------------------- materials
  const reflU = {
    uRL: { value: Array.from({ length: REFL_N }, () => new THREE.Vector4()) },
    uRW: { value: Array.from({ length: REFL_N }, () => new THREE.Vector3()) },
    uRC: { value: Array.from({ length: REFL_N }, () => new THREE.Vector3()) },
    uRN: { value: 0 },
    uEyeG: { value: new THREE.Vector3(0, 0, 4) },
  };
  const groundMat = new THREE.MeshLambertMaterial({
    map: groundTex,
    emissiveMap: groundTex,
    emissive: 0xffffff,
    emissiveIntensity: 0.85,
  });
  // Cobbles: fans of setts in the unrolled ground coordinates, fading out where they would shimmer.
  withAir(groundMat, "ground", 0.8, (sh) => {
    Object.assign(sh.uniforms, reflU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGs;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvGs = uv * vec2(${C.toFixed(3)}, ${(2 * ZH).toFixed(1)});`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vGs;\n${WET_GLSL}`)
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec2 p = vGs / 1.45;
          float fade = 1.0 - smoothstep(0.08, 0.5, length(fwidth(p)));
          p.x += 0.5 * mod(floor(p.y), 2.0);
          vec2 f = fract(p) - vec2(0.5, 0.0);
          float d = length(f) * 4.6;                     // rings of setts fanning out from each cell's foot
          float a = atan(f.y, f.x) * (floor(d) * 1.7 + 2.0);
          float mortar = min(min(fract(d), 1.0 - fract(d)), min(fract(a), 1.0 - fract(a)) * 0.8);
          float sett = fract(sin(dot(floor(vec2(d, a)) + floor(p) * 13.0, vec2(12.99, 78.23))) * 43758.5);
          float cob = mix(1.0, (0.7 + 0.4 * smoothstep(0.02, 0.2, mortar)) * (0.92 + 0.24 * sett), fade);
          diffuseColor.rgb *= cob;
          totalEmissiveRadiance *= cob;
          // wet setts: polished tops mirror the lamps, the mortar and the dry patches do not
          // (not under the plaza, which is drawn over the cobbles)
          vec2 gz = vec2(vGs.x, vGs.y - ${ZH.toFixed(1)});
          vec2 gp = vec2(wrapC(gz.x), gz.y - ${HUT_Z.toFixed(1)});
          vec3 ws = dot(gp, gp) < ${((PLAZA_R - 0.5) ** 2).toFixed(1)} ? vec3(0.0) : wetSheen(gz);
          if (ws.r + ws.g > 1e-3) {
            float puddle = smoothstep(0.3, 0.8, vnoise(vGs * vec2(0.22, 0.3) + 7.0));
            float wet = mix(0.25, 1.0, puddle) * mix(0.7, smoothstep(0.03, 0.14, mortar) * (0.5 + 0.5 * sett), fade);
            totalEmissiveRadiance += ws * wet * 2.2;
          }
        }`,
      );
  });
  const overlay = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, side: THREE.DoubleSide };
  const roadMat = new THREE.MeshBasicMaterial({ vertexColors: true, ...overlay });
  // The carriageway: worn setts in courses across the road, a raised crown, grain, and the wet
  // shine of every lamp and window near the camera. The luminous kerbs stay as they were.
  withAir(roadMat, "road", 0.8, (sh) => {
    Object.assign(sh.uniforms, reflU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aRd;\nvarying vec4 vRd;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRd = aRd;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec4 vRd;\n${WET_GLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          float off = vRd.y;
          float d = vRd.x;
          float inner = 1.0 - smoothstep(2.32, 2.42, abs(off));
          vec2 cell = vec2(0.36, 0.25);
          vec2 p = vec2(off, d) / cell;
          p.x += 0.5 * mod(floor(p.y), 2.0) + 0.17 * mod(floor(p.y), 3.0);
          vec2 id = floor(p);
          vec2 f = fract(p);
          vec2 e = min(f, 1.0 - f) * cell;
          float ed = min(e.x, e.y);
          vec2 fw = fwidth(p) * cell;
          float px = max(fw.x, fw.y);
          float fade = 1.0 - smoothstep(0.025, 0.1, px);
          float mortar = 1.0 - smoothstep(0.012, 0.03 + px, ed);
          float tone = hashW(id);
          float dome = smoothstep(0.0, 0.08, ed);
          float grain = vnoise(vec2(off, d) * vec2(23.0, 17.0));
          float crown = 1.0 - (off / 2.4) * (off / 2.4);
          float m = (0.74 + 0.36 * tone) * mix(0.8, 1.04, dome) * (1.0 - 0.6 * mortar);
          m = mix(1.0, m, fade) * (0.9 + 0.2 * mix(0.5, grain, 1.0 - smoothstep(0.02, 0.06, px)));
          diffuseColor.rgb *= mix(1.0, m * (0.78 + 0.32 * crown), inner);
          float puddle = smoothstep(0.3, 0.8, vnoise(vec2(off * 0.7, d * 0.16) + 3.0));
          float wet = mix(0.35, 1.0, puddle) * mix(0.75, (1.0 - mortar) * (0.45 + 0.55 * tone) * mix(0.8, 1.1, dome), fade);
          diffuseColor.rgb += wetSheen(vRd.zw) * wet * mix(1.4, 2.4, inner);
        }`,
      );
  });
  const lampUniform = { value: lightTex };
  const plazaMat = new THREE.MeshBasicMaterial({ map: plazaTex, ...overlay });
  // the cyan ring of plaza lamps lights the paving under it
  withAir(plazaMat, "plaza", 0.8, (sh) => {
    sh.uniforms.uLamp = lampUniform;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWp;\n${LAMP_PARS}`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        { vec3 L = lampAt(vWp); diffuseColor.rgb += diffuseColor.rgb * L * 2.0 + L * 0.32; }
        // the hut's stepped base sits on the paving: a soft contact shadow round its foot
        diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(${STEP_R[0]!.toFixed(2)}, ${(STEP_R[0]! + 1.5).toFixed(2)}, length(vec2(vWp.x, vWp.z - ${HUT_Z.toFixed(1)}))) + step(0.0, vWp.y));`,
      );
  });
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Towers: brick courses, a string course under every row of windows, a plinth and a cornice.
  // Far towers lose their masonry into the air; lamps light the foot of the nearest walls.
  withAir(bodyMat, "body", 0.75, (sh) => {
    sh.uniforms.uLamp = lampUniform;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTw;\nvarying vec3 vLp;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vTw = vec3(atan(position.z, position.x), position.y * length(instanceMatrix[1].xyz), length(instanceMatrix[1].xyz));
        {
          mat4 iw = modelMatrix * instanceMatrix;
          // the light map is read a step out from the wall, so a lamp lights the face that sees it
          vLp = (iw * vec4(transformed, 1.0)).xyz + normalize(mat3(iw) * vec3(position.x, 0.0, position.z)) * 1.3;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vTw;\nvarying vec3 vLp;\n${LAMP_PARS}\n${BUMP_GLSL}`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 L = lampAt(vLp) * (1.0 - smoothstep(0.3, 7.0, vTw.y));
          totalEmissiveRadiance += (diffuseColor.rgb * 1.8 + 0.05) * L;
        }`,
      )
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = bumpV(-vViewPosition, normal, brickH, faceDirection);")
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float brickH = 0.0;
        {
          float h = vTw.y;
          float px = fwidth(h) + 1e-4;
          float fade = 1.0 - smoothstep(0.05, 0.3, px);
          float row = floor(h / 0.42);
          float bx = vTw.x * 4.4563 + 0.5 * mod(row, 2.0);   // 28 bricks round the tower
          float fy = fract(h / 0.42);
          float fx = fract(bx);
          float joint = 1.0 - smoothstep(0.03, 0.03 + px, min(min(fy, 1.0 - fy) * 0.42, min(fx, 1.0 - fx) * 0.5));
          float tone = fract(sin(dot(vec2(floor(bx), row), vec2(12.99, 78.23))) * 43758.5);
          float m = (0.9 + 0.22 * tone) * (1.0 - 0.25 * joint) * (1.0 + 0.14 * smoothstep(0.62, 0.92, fy) * (1.0 - joint));
          // mouldings: the windows sit on rows 2.35 apart, starting at 2.0
          float course = 1.0 - smoothstep(0.09, 0.09 + px, abs(fract((h - 1.62) / 2.35 + 0.5) - 0.5) * 2.35);
          float crown = smoothstep(vTw.z - 0.75, vTw.z - 0.7, h);
          float dentil = step(0.5, fract(vTw.x * 7.0)) * step(vTw.z - 0.38, h);
          m = mix(m, 1.5, max(course * step(1.0, h), crown * (1.0 - 0.3 * dentil)));
          m *= mix(0.7, 1.0, smoothstep(0.62, 0.68, h));
          #ifdef USE_FOG
            fade *= 1.0 - 0.9 * smoothstep(0.0, 0.55, ${EXT_GLSL});
          #endif
          diffuseColor.rgb *= mix(1.0, m, fade);
          brickH = (-0.014 * joint + 0.03 * course * step(1.0, h)) * fade;
          diffuseColor.rgb *= mix(0.3, 1.0, smoothstep(0.0, 2.2, h)); // contact shade at the foot
          #ifdef USE_FOG
            // overhead, a tower brightens towards its tip: it stands out of the darker street it hangs from
            diffuseColor.rgb *= 1.0 + 0.8 * smoothstep(0.35, 0.75, ${EXT_GLSL}) * smoothstep(0.15, 1.0, h / vTw.z);
          #endif
        }`,
      );
  }, true);
  const domeMat = new THREE.MeshLambertMaterial({ emissive: "#0a0d30" });
  // Roofs: overlapping round shingles, a pale ridge at every hem.
  domeMat.defines = { USE_UV: "" };
  withAir(domeMat, "dome", 0.75, (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${SHINGLE_GLSL}`).replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
      {
        vec2 sv = vec2(vUv.x * 20.0, vUv.y * 11.0);
        float fade = 1.0 - smoothstep(0.1, 0.6, length(fwidth(sv)));
        #ifdef USE_FOG
          fade *= 1.0 - 0.85 * smoothstep(0.0, 0.55, ${EXT_GLSL});
        #endif
        diffuseColor.rgb *= mix(1.0, shingle(sv).x, fade);
      }`,
    );
  }, true);
  // premultiplied: the opening covers the wall, the halo adds light to it
  const windowMat = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  windowAir(windowMat);
  const treeMat = new THREE.MeshLambertMaterial({ emissive: "#03141a" });
  // Topiary: clipped leaf scales over a smooth ball, lit from above, with a warm rim where a lamp is near.
  withAir(treeMat, "tree", 0.85, (sh) => {
    sh.uniforms.uLamp = lampUniform;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLo;\nvarying vec3 vLp;\nvarying vec2 vSc;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLo = position;
        vSc = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        {
          mat4 iw = modelMatrix * instanceMatrix;
          vLp = (iw * vec4(transformed, 1.0)).xyz + normalize(mat3(iw) * vec3(position.x, 0.0, position.z)) * 1.6;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vLo;\nvarying vec3 vLp;\nvarying vec2 vSc;\n${LAMP_PARS}\n${BUMP_GLSL}\n${SHINGLE_GLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float leafH = 0.0;
        {
          vec3 n = normalize(vLo);
          float th = acos(clamp(n.y, -1.0, 1.0));
          float sn = sin(th);
          // leaves about 0.17 across whatever the bush's size; fewer round the crown so they keep their shape
          float N = floor(vSc.x * 36.0) * exp2(clamp(floor(log2(sn * 1.3 + 1e-3)), -3.0, 0.0));
          vec2 sv = vec2((atan(n.z, n.x) * 0.159155 + 0.5) * N, (3.14159 - th) * vSc.y * 6.0);
          vec2 sh = shingle(sv);
          float fade = 1.0 - smoothstep(0.15, 0.7, length(fwidth(sv)));
          #ifdef USE_FOG
            fade *= 1.0 - smoothstep(0.0, 0.4, ${EXT_GLSL});
          #endif
          diffuseColor.rgb *= mix(1.0, 0.4 + 0.75 * sh.x, fade);
          leafH = 0.03 * sh.y * fade;
          diffuseColor.rgb *= mix(0.32, 1.5, smoothstep(-0.8, 0.95, n.y));
        }`,
      )
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = bumpV(-vViewPosition, normal, leafH, faceDirection);")
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        {
          vec3 Lw = lampAt(vLp);
          float g = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          totalEmissiveRadiance += Lw * (diffuseColor.rgb * 1.2 + 0.7 * g * g) + vec3(1.0, 0.62, 0.3) * 0.1 * g * g * g;
        }`,
      );
  });
  const postMat = new THREE.MeshLambertMaterial({ color: "#3a3f78" });
  withAir(postMat, "post", 0.85);
  const bulbMat = new THREE.MeshBasicMaterial();
  // a round glass head: white-hot where it faces the eye, its own colour falling off to the limb
  withAir(bulbMat, "bulb", 0.6, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vNv;\nvarying vec3 vVv;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvNv = normalMatrix * (mat3(instanceMatrix) * normal);\nvVv = -mvPosition.xyz;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vNv;\nvarying vec3 vVv;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float ndv = clamp(abs(dot(normalize(vNv), normalize(vVv))), 0.0, 1.0);
          diffuseColor.rgb *= 0.3 + 1.6 * ndv * ndv;
          diffuseColor.rgb += vec3(1.0, 0.9, 0.75) * 1.6 * smoothstep(0.55, 0.95, ndv) * dot(diffuseColor.rgb, vec3(0.3));
        }`,
      );
  });
  const stoneMat = new THREE.MeshLambertMaterial({ emissive: "#0c0f33" });
  stoneMat.defines = { USE_UV: "" };
  // Arch ribs: dressed voussoirs with a raised keystone, warm on the underside where the lamps hang.
  withAir(stoneMat, "arch", 0.85, (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${BUMP_GLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float stoneH = 0.0;
        float under = 0.0;
        {
          float a = vUv.x * 19.0;
          float k = floor(a);
          float f = fract(a);
          float pxa = fwidth(a) + 1e-4;
          float joint = 1.0 - smoothstep(0.0, 0.04 + pxa, min(f, 1.0 - f));
          float key = 1.0 - step(0.5, abs(k - 9.0));
          float tone = fract(sin(k * 12.99) * 43758.5);
          float rnd = cos(vUv.y * 6.2832);
          // a moulded band along each face of the rib
          float band = 1.0 - smoothstep(0.02, 0.05, abs(abs(fract(vUv.y + 0.25) - 0.5) - 0.25));
          diffuseColor.rgb *= (0.86 + 0.22 * tone) * (1.0 - 0.45 * joint) * (1.0 + 0.18 * key) * (1.0 + 0.12 * band);
          stoneH = -0.02 * joint + 0.03 * key * (1.0 - joint) + 0.012 * band;
          under = smoothstep(0.1, -0.9, rnd);
          diffuseColor.rgb *= mix(1.0, 0.75, under);
        }`,
      )
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = bumpV(-vViewPosition, normal, stoneH, faceDirection);")
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        {
          // the lamp under the crown and the festoon bulbs warm the soffit
          float x = vUv.x;
          float w = exp(-pow((x - 0.5) / 0.07, 2.0)) * 1.2
            + exp(-pow((x - 0.175) / 0.04, 2.0)) + exp(-pow((x - 0.318) / 0.04, 2.0))
            + exp(-pow((x - 0.682) / 0.04, 2.0)) + exp(-pow((x - 0.825) / 0.04, 2.0));
          totalEmissiveRadiance += vec3(1.0, 0.6, 0.26) * (diffuseColor.rgb * 1.4 + 0.04) * w * (0.25 + 0.75 * under);
        }`,
      );
  }, true);
  const pillarMat = new THREE.MeshLambertMaterial({ emissive: "#0c0f33" });
  // Piers: ashlar courses, a dark contact at the foot and a shaded collar under the capital.
  withAir(pillarMat, "pillar", 0.85, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPy;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPy = vec2(position.y, atan(position.z, position.x));");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vPy;\n${BUMP_GLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float pierH = 0.0;
        {
          float y = vPy.x;
          float row = floor(y / 0.38);
          float fy = fract(y / 0.38);
          float bx = vPy.y * 1.2732 + 0.5 * mod(row, 2.0);
          float px = fwidth(y / 0.38) + 1e-4;
          float shaft = step(0.5, y) * step(y, 2.1);
          float joint = shaft * (1.0 - smoothstep(0.0, 0.05 + px, min(min(fy, 1.0 - fy), min(fract(bx), 1.0 - fract(bx)) * 0.6)));
          float tone = fract(sin(dot(vec2(floor(bx), row), vec2(12.99, 78.23))) * 43758.5);
          diffuseColor.rgb *= (0.88 + 0.2 * tone * shaft) * (1.0 - 0.4 * joint);
          diffuseColor.rgb *= mix(0.4, 1.0, smoothstep(0.0, 0.5, y));             // on the cobbles
          diffuseColor.rgb *= 1.0 - 0.45 * smoothstep(1.8, 2.2, y) * (1.0 - smoothstep(2.2, 2.32, y)); // under the collar
          diffuseColor.rgb *= 1.0 - 0.35 * smoothstep(2.62, 2.75, y);             // the rib's seat, in shade
          pierH = -0.015 * joint;
        }`,
      )
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = bumpV(-vViewPosition, normal, pierH, faceDirection);");
  }, true);
  // the soft cone a street lamp throws down onto the cobbles
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color("#ffb860") } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * (mat3(instanceMatrix) * normal));
        vV = -mv.xyz;
        vY = position.y / 2.84;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float d = length(vV);
        float ndv = abs(dot(normalize(vN), vV / d));
        float a = ndv * ndv * (0.35 + 0.65 * vY * vY) * smoothstep(0.0, 0.25, vY) * smoothstep(1.0, 0.9, vY);
        a *= smoothstep(1.5, 5.0, d) * (1.0 - smoothstep(25.0, 140.0, d));
        gl_FragColor = vec4(uCol * a * 0.26, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const hutMat = new THREE.MeshLambertMaterial({ color: "#c9cdf2", emissive: "#1c2256" });
  // Hut: an ashlar wall darkening into its footing, a gold bead under the eave, a shingled bell.
  hutShader(
    hutMat,
    "body",
    /* glsl */ `
    // the porch tube runs out through the eave to the gate: nothing of the hut inside it
    if (vHp.z < 0.0 && length(vHp.xy - vec2(0.0, ${DOOR_H.toFixed(2)})) < 3.0) discard;
    float y = vHp.y;
    float rr = length(vHp.xz);
    float aa = atan(vHp.z, vHp.x);
    float h = 0.0;
    if (y < 3.2) {
      float row = floor(y / 0.46);
      float bx = aa * (4.34 / 0.92) + 0.5 * mod(row, 2.0);
      float fy = fract(y / 0.46);
      float jd = min(min(fy, 1.0 - fy) * 0.46, min(fract(bx), 1.0 - fract(bx)) * 0.92);
      float joint = 1.0 - smoothstep(0.012, 0.03, jd);
      float tone = hash12(vec2(floor(bx), row));
      diffuseColor.rgb *= (0.9 + 0.14 * tone) * (1.0 - 0.3 * joint);
      h = -0.012 * joint;
      diffuseColor.rgb *= mix(0.35, 1.0, smoothstep(${STEP_Y[2]!.toFixed(2)}, 1.9, y)); // its footing in the step
    } else if (y < 3.62) {
      diffuseColor.rgb = vec3(0.3, 0.27, 0.62);
      float bead = 1.0 - smoothstep(0.02, 0.02 + fwidth(y) * 1.5, abs(y - 3.43));
      hutGlow += vec3(1.0, 0.66, 0.3) * 1.3 * bead;
    } else {
      float N = 9.0 * exp2(clamp(floor(log2(rr / 0.62)), 0.0, 2.0));
      vec2 sh = shingle(vec2(aa * 0.15915 * N, (y - 3.62) / 0.4));
      diffuseColor.rgb = vec3(0.4, 0.36, 0.86) * sh.x;
      h = 0.035 * sh.y;
      diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(3.62, 4.3, y)); // under the eave
    }
    normal = bumpN(-vViewPosition, normal, h, faceDirection);`,
    0.9,
    0.55,
  );
  const porchMat = new THREE.MeshLambertMaterial({ color: "#b4b8ea", emissive: "#1c2256" });
  hutShader(porchMat, "porch", "", 1.2, 0.4);
  // Base: masonry tiers, each tread shaded where the tier above stands on it, each riser where it
  // meets the tread below, and the hut's own contact shadow on the top tread.
  const stepMat = new THREE.MeshLambertMaterial({ color: "#bfc3ee", emissive: "#161b4a" });
  hutShader(
    stepMat,
    "step",
    /* glsl */ `
    vec3 n0 = inverseTransformDirection(normal, viewMatrix);
    float rr = length(vHp.xz);
    float aa = atan(vHp.z, vHp.x);
    float y = vHp.y;
    float h = 0.0;
    float ao = 1.0;
    float joint = 0.0;
    float tone = 0.5;
    if (n0.y > 0.6) {
      float i = clamp(floor((y - ${STEP_Y[0]!.toFixed(2)}) / 0.2 + 0.5), 0.0, 2.0);
      float rOut = ${STEP_R[0]!.toFixed(2)} - 0.9 * i;
      float rIn = i < 1.5 ? rOut - 0.9 : 4.36;
      float bx = aa * (rOut - 0.45) / 1.1 + 0.37 * i;
      float ring = i < 1.5 ? 0.0 : 1.0;
      float fr = (rr - rIn) / (rOut - rIn);
      float jd = min(min(fract(bx), 1.0 - fract(bx)) * 1.1, ring > 0.5 ? abs(fr - 0.5) * (rOut - rIn) : 9.0);
      joint = 1.0 - smoothstep(0.012, 0.035, jd);
      tone = hash12(vec2(floor(bx), i + step(0.5, fr) * ring * 7.0));
      ao = mix(i < 1.5 ? 0.45 : 0.25, 1.0, smoothstep(0.0, i < 1.5 ? 0.55 : 1.4, rr - rIn));
      ao *= 1.0 + 0.22 * smoothstep(rOut - 0.1, rOut - 0.015, rr); // worn bright arris
    } else {
      float i = clamp(floor((${STEP_R[0]!.toFixed(2)} - rr) / 0.9 + 0.5), 0.0, 2.0);
      float yTop = ${STEP_Y[0]!.toFixed(2)} + 0.2 * i;
      float yb = i < 0.5 ? 0.0 : yTop - 0.2;
      float bx = aa * (${STEP_R[0]!.toFixed(2)} - 0.9 * i) / 0.75 + 0.5 * mod(i, 2.0);
      joint = 1.0 - smoothstep(0.01, 0.03, min(fract(bx), 1.0 - fract(bx)) * 0.75);
      tone = hash12(vec2(floor(bx), i + 13.0));
      ao = mix(0.4, 1.0, smoothstep(yb, yb + 0.16, y));
      ao *= 1.0 + 0.25 * smoothstep(yTop - 0.05, yTop - 0.005, y);
    }
    diffuseColor.rgb *= (0.88 + 0.18 * tone) * (1.0 - 0.35 * joint) * ao;
    h = -0.01 * joint;
    normal = bumpN(-vViewPosition, normal, h, faceDirection);`,
    1.0,
  );
  const goldMat = new THREE.MeshLambertMaterial({ color: "#ffc66a", emissive: "#d98a25", emissiveIntensity: 0.9 });
  // Leaves: indigo enamel in a gilded frame, a sunburst engraved behind a pierced crescent moon,
  // stars and a ring of round piercings. The cut-outs glow gold, hot enough to bloom.
  const leafMat = new THREE.MeshLambertMaterial({ color: "#33296e", emissive: "#0e0a30" });
  hutShader(
    leafMat,
    "leaf",
    /* glsl */ `
    vec2 q = vec2(abs(vQ.x), vQ.y);
    float rho = length(q);
    float ang = atan(q.y, q.x);
    float cap = smoothstep(0.8, 0.97, abs(vNz));
    vec2 c1 = vec2(0.98, 0.4);
    float moon = max(length(q - c1) - 0.56, -(length(q - c1 - vec2(-0.22, 0.16)) - 0.47));
    float stars = min(
      min(sdStar(q - vec2(0.8, -0.62), 0.36), sdStar(q - vec2(1.34, -0.28), 0.17)),
      min(sdStar(q - vec2(0.44, -1.2), 0.2), sdStar(q - vec2(0.36, 0.06), 0.14)));
    float k = clamp(floor(ang / 0.17 + 0.5), -8.0, 8.0);
    float dots = length(q - 2.07 * vec2(cos(k * 0.17), sin(k * 0.17))) - 0.075;
    float hole = min(min(moon, stars), dots);
    float fw = fwidth(hole) + 1e-4;
    float cut = (1.0 - smoothstep(-fw, fw, hole)) * cap;
    // relief: a raised gilded frame and stile, sunburst rays engraved inside the gold arc
    float fr = fwidth(rho) + 1e-4;
    float frame = max(smoothstep(2.4 - fr, 2.45 + fr, rho), smoothstep(0.22 + fr, 0.16 - fr, q.x));
    float perp = rho * abs(fract(ang / 0.1309 + 0.5) - 0.5) * 0.1309;
    float groove = (1.0 - smoothstep(0.008, 0.02 + fwidth(perp), perp)) * smoothstep(0.3, 0.45, rho) * smoothstep(1.6, 1.5, rho);
    float lip = smoothstep(0.0, 0.045, hole);
    float h = (0.028 * frame - 0.008 * groove) * lip - 0.014 * (1.0 - lip);
    h *= cap;
    normal = bumpN(-vViewPosition, normal, h, faceDirection);
    vec3 gilt = vec3(0.46, 0.27, 0.07);
    float gild = max(frame * cap, 1.0 - cap);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.92 + 0.16 * hash12(floor(q * 7.0))), gilt, gild);
    diffuseColor.rgb *= 1.0 - 0.4 * groove * cap;
    hutGlow += vec3(1.0, 0.62, 0.26) * (0.18 * groove + 0.45 * (1.0 - lip)) * cap;
    hutGlow += vec3(1.0, 0.66, 0.3) * 2.8 * cut;
    diffuseColor.rgb *= 1.0 - cut;`,
    0.75,
    0,
    true,
  );
  const roundWinMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb347").multiplyScalar(1.6), side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({
    color: "#7fefff",
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamMat2 = beamMat.clone();
  beamMat2.opacity = 0.07;
  const finialMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#8ff2ff").multiplyScalar(1.5) });

  const pointsMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec4 aData; // size, phase, drift, twinkle
      uniform float uTime;
      uniform float uScale;
      varying vec3 vColor;
      void main() {
        float ph = aData.y;
        vec3 p = position + aData.z * vec3(
          sin(uTime * 0.31 + ph), sin(uTime * 0.23 + ph * 1.7), sin(uTime * 0.27 + ph * 2.3));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(0.01, -mv.z);
        gl_PointSize = min(aData.x * uScale / d, 320.0);
        float fog = clamp((d - ${FOG_NEAR.toFixed(1)}) / ${(FOG_FAR - FOG_NEAR).toFixed(1)}, 0.0, 1.0);
        float tw = 1.0 - aData.w * (0.5 + 0.5 * sin(uTime * 1.3 + ph * 5.0));
        vColor = aColor * (1.0 - fog) * tw;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = max(0.0, 1.0 - r);
        a = a * a * a * 0.6 + smoothstep(0.22, 0.0, r) * 0.7;
        gl_FragColor = vec4(vColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const fogC = new THREE.Color(FOG_COLOR);
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { uFog: { value: fogC } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy / ${R.toFixed(1)};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float disc = smoothstep(0.335, 0.32, r);
        float shade = mix(0.72, 1.0, smoothstep(-0.35, 0.3, vP.x * 0.6 + vP.y));
        float halo = exp(-max(r - 0.32, 0.0) * 5.5);
        float rings = 0.5 + 0.5 * cos(r * 60.0);
        vec3 col = uFog * (1.0 + 0.25 * rings * smoothstep(0.34, 0.5, r));
        col += vec3(0.16, 0.42, 0.62) * halo * (1.0 - disc);
        col = mix(col, vec3(0.80, 0.95, 1.0) * shade * 1.15, disc);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    fog: false,
    side: THREE.DoubleSide,
  });

  const sky = createSky({ R, fogColor: fogC, fogNear: FOG_NEAR, fogFar: FOG_FAR }, pointsMat);

  return {
    path,
    pathLen,
    sky,
    inst: { bodies, domes, windows, trees, posts, bulbs, arches, pillars, cones },
    reflLights,
    reflU,
    geo: {
      groundGeo, bodyGeo, domeGeos, windowGeo, treeGeo, postGeo, bulbGeo, archGeo, pillarGeo, pointsGeo, coneGeo,
      roadGeo, plazaGeo, hutGeo, porchGeo, frameGeo, portalGeo, leafGeoL, leafGeoR, trimGeoL, trimGeoR, stepGeo, roundWinGeo,
      winFrameGeo, beamGeo, beamGeo2, finialGeo, finialGeo2, crescentGeo, moonGeo,
    },
    mat: {
      groundMat, bodyMat, domeMat, windowMat, treeMat, postMat, bulbMat, stoneMat, pillarMat, coneMat, hutMat, porchMat, stepMat, goldMat, leafMat,
      roadMat, plazaMat, roundWinMat, beamMat, beamMat2, finialMat, pointsMat, moonMat,
    },
  };
}

type World = ReturnType<typeof buildWorld>;

/**
 * Chooses the lights the wet street mirrors for a camera pose: the REFL_N nearest (those behind
 * the camera count as further away). Each fades out as it nears the distance of the first light
 * left out, so the choice changes without a pop as the camera moves.
 */
function createReflectionPicker({ reflLights, reflU }: World) {
  const n = reflLights.length;
  const score = new Float32Array(n);
  const best = new Int32Array(REFL_N + 1);
  return (eye: THREE.Vector3, look: THREE.Vector3) => {
    const es = Math.atan2(eye.x, -eye.y) * R;
    const ez = eye.z;
    let fs = wrapS(Math.atan2(look.x, -look.y) * R - es);
    let fz = look.z - ez;
    const fl = Math.hypot(fs, fz) || 1;
    fs /= fl;
    fz /= fl;
    const eh = Math.max(0.5, R - Math.hypot(eye.x, eye.y));
    reflU.uEyeG.value.set(es, ez, eh);
    let m = 0;
    for (let i = 0; i < n; i++) {
      const l = reflLights[i]!;
      const ds = wrapS(l.s - es);
      const dz = l.z - ez;
      const d = (Math.hypot(ds, dz) + 2.5 * Math.max(0, -(ds * fs + dz * fz))) * l.far;
      score[i] = d;
      if (d > 52) continue;
      // insert into the sorted short list
      if (m > REFL_N && d >= score[best[REFL_N]!]!) continue;
      let j = Math.min(m, REFL_N);
      while (j > 0 && score[best[j - 1]!]! > d) {
        best[j] = best[j - 1]!;
        j--;
      }
      best[j] = i;
      if (m <= REFL_N) m++;
    }
    const far = m > REFL_N ? Math.min(52, score[best[REFL_N]!]!) : 52;
    const band = Math.max(2, Math.min(10, far * 0.4));
    const count = Math.min(m, REFL_N);
    reflU.uRN.value = count;
    for (let k = 0; k < count; k++) {
      const l = reflLights[best[k]!]!;
      const w = smooth((far - score[best[k]!]!) / band);
      // The mirror image sits where the line from the eye to the lamp's reflection meets the
      // street; the streak runs back from there to the lamp's foot and a little on towards the eye.
      const fs = wrapS(es - l.s);
      const fz2 = ez - l.z;
      const D = Math.hypot(fs, fz2) + 1e-3;
      const kk = l.h / (l.h + eh);
      const dX = D * (1 - kk);
      reflU.uRL.value[k]!.set(l.s + fs * kk, l.z + fz2 * kk, fs / D, fz2 / D);
      reflU.uRW.value[k]!.set(1 / ((0.14 + 0.01 * dX + 0.025 * l.h) * 1.15), 1 / (0.6 + 0.12 * dX), 1 / (0.4 + D * kk));
      reflU.uRC.value[k]!.set(l.c.r * w, l.c.g * w, l.c.b * w);
    }
  };
}
let cachedWorld: World | null = null;
/** geometry / textures / layout are built once and shared by every (re)mount of the scene */
const getWorld = () => (cachedWorld ??= buildWorld());

function buildObjects(w: World, portalMaterial: THREE.Material) {
  const { inst, geo, mat } = w;
  const root = new THREE.Group();
  const instanced: THREE.InstancedMesh[] = [];
  const addInst = (i: Inst, g: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = i.mesh(g, m);
    instanced.push(mesh);
    root.add(mesh);
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = root) => {
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false;
    parent.add(o);
    return o;
  };

  mesh(geo.groundGeo, mat.groundMat);
  mesh(geo.moonGeo, mat.moonMat).position.z = ZH - 0.5;
  mesh(geo.roadGeo, mat.roadMat);
  mesh(geo.plazaGeo, mat.plazaMat);
  addInst(inst.bodies, geo.bodyGeo, mat.bodyMat);
  inst.domes.forEach((d, i) => addInst(d, geo.domeGeos[i]!, mat.domeMat));
  addInst(inst.windows, geo.windowGeo, mat.windowMat);
  addInst(inst.trees, geo.treeGeo, mat.treeMat);
  addInst(inst.posts, geo.postGeo, mat.postMat);
  addInst(inst.bulbs, geo.bulbGeo, mat.bulbMat);
  addInst(inst.arches, geo.archGeo, mat.stoneMat);
  addInst(inst.pillars, geo.pillarGeo, mat.pillarMat);
  addInst(inst.cones, geo.coneGeo, mat.coneMat);
  const points = new THREE.Points(geo.pointsGeo, mat.pointsMat);
  points.frustumCulled = false;
  root.add(points, w.sky.root);

  // the moon-gate hut (its local frame coincides with the world frame at s = 0)
  const hut = new THREE.Group();
  hut.position.set(0, -R, HUT_Z);
  root.add(hut);
  STEP_R.forEach((r, i) => {
    const s = mesh(geo.stepGeo, mat.stepMat, hut);
    s.scale.set(r, 1, r);
    s.position.y = STEP_Y[i]!;
  });
  mesh(geo.hutGeo, mat.hutMat, hut);
  mesh(geo.porchGeo, mat.porchMat, hut).position.set(0, DOOR_H, -2.3);
  mesh(geo.frameGeo, mat.goldMat, hut).position.set(0, DOOR_H, DOOR_Z - HUT_Z - 0.04);
  mesh(geo.portalGeo, portalMaterial, hut).position.set(0, DOOR_H, PORTAL_Z - HUT_Z);
  const leafL = new THREE.Group();
  leafL.position.set(-DOOR_R, DOOR_H, DOOR_Z - HUT_Z);
  mesh(geo.leafGeoL, mat.leafMat, leafL);
  mesh(geo.trimGeoL, mat.goldMat, leafL);
  mesh(geo.trimGeoL, mat.goldMat, leafL).position.z = LEAF_T;
  const leafR = new THREE.Group();
  leafR.position.set(DOOR_R, DOOR_H, DOOR_Z - HUT_Z);
  mesh(geo.leafGeoR, mat.leafMat, leafR);
  mesh(geo.trimGeoR, mat.goldMat, leafR);
  mesh(geo.trimGeoR, mat.goldMat, leafR).position.z = LEAF_T;
  hut.add(leafL, leafR);
  for (const a of HUT_WINDOWS) {
    const wdw = mesh(geo.roundWinGeo, mat.roundWinMat, hut);
    wdw.position.set(Math.cos(a) * (HUT_WIN_R - 0.02), HUT_WIN_Y, Math.sin(a) * (HUT_WIN_R - 0.02));
    wdw.rotation.y = Math.PI / 2 - a;
  }
  mesh(geo.winFrameGeo, mat.goldMat, hut);
  mesh(geo.finialGeo2, mat.goldMat, hut);
  mesh(geo.crescentGeo, mat.goldMat, hut).position.y = 10.4;
  mesh(geo.finialGeo, mat.finialMat, hut).position.y = 10.4;
  mesh(geo.beamGeo, mat.beamMat, hut).position.y = 10.4;
  mesh(geo.beamGeo2, mat.beamMat2, hut).position.y = 10.4;

  const lamp = new THREE.PointLight("#ffb46a", 95, 80, 2);
  root.add(lamp);

  return { root, instanced, leafL, leafR, lamp };
}

const LOOK_AHEAD = 0.05;
/** fraction of the track the camera has behind it when it takes over the screen (t = TIMING.arrival) */
const TAKEOVER_AT = 0.32;
/** seconds over which the arriving camera is handed from its straight lead-in to the winding path */
const HAND_OVER = 3.5;
const _pt = new THREE.Vector3();

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  up: THREE.Vector3;
}
const newPose = (): Pose => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() });

/**
 * The camera track. `world.path` lives in unrolled coordinates, where lengths are not true once
 * bent onto the cylinder, so the ride is laid out over a table of real world distances.
 */
function createTrack({ path, pathLen }: World) {
  const N = 4000;
  const dist = new Float32Array(N + 1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    path.getPointAt(i / N, _pt);
    toWorld(_pt.x, _pt.z, _pt.y, b);
    if (i > 0) dist[i] = dist[i - 1]! + a.distanceTo(b);
    a.copy(b);
  }
  const total = dist[N]!;
  // Released from the seam the camera swoops: it picks up a brisk glide that winds down again as
  // it nears the hut. The profile is scaled so that the takeover still happens in mid-air.
  const ride = createRide({
    cruise: (t) => (total / TIMING.total) * (1.4 - 1.2 * (t / TIMING.total) ** 2),
    length: total * (1 - TAKEOVER_AT) + RAIL.speed * TIMING.arrival,
    rampIn: 4.5,
    rampOut: 3.5,
  });
  /** path parameter (0..1, may run past 1) at local time t */
  const uAt = (t: number) => {
    const d = total - ride.length + ride.at(t);
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (dist[mid]! <= d) lo = mid;
      else hi = mid;
    }
    return (lo + (d - dist[lo]!) / (dist[hi]! - dist[lo]!)) / N;
  };
  /** where the winding path alone would put the camera */
  const onPath = (t: number, out: Pose) => {
    const u = uAt(t);
    path.getPointAt(Math.min(1, u), _pt);
    const th = _pt.x / R;
    toWorld(_pt.x, _pt.z, _pt.y, out.pos);
    const ul = u + LOOK_AHEAD;
    if (ul <= 1) {
      path.getPointAt(ul, _pt);
      toWorld(_pt.x, _pt.z, _pt.y, out.look);
    } else {
      toWorld(0, PORTAL_Z + (ul - 1) * pathLen, DOOR_H, out.look);
    }
    out.up.set(-Math.sin(th), Math.cos(th), 0);
    return out;
  };

  // The arriving camera may not turn (see rail.ts), and nothing on a cylinder is straight. So it
  // comes in on the tangent to the path at the moment of release, and is then handed over.
  const anchor = onPath(RAIL.release, newPose());
  const ahead = onPath(RAIL.release + 0.05, newPose()).pos.sub(onPath(RAIL.release - 0.05, newPose()).pos).normalize();
  const reach = anchor.pos.distanceTo(anchor.look);
  const line = newPose();
  const pose = (t: number, out: Pose) => {
    onPath(t, out);
    if (t >= RAIL.release + HAND_OVER) return out;
    const w = smooth((t - RAIL.release) / HAND_OVER);
    line.pos.copy(anchor.pos).addScaledVector(ahead, ride.at(t) - ride.at(RAIL.release));
    line.look.copy(line.pos).addScaledVector(ahead, reach);
    out.pos.lerpVectors(line.pos, out.pos, w);
    out.look.lerpVectors(line.look, out.look, w);
    out.up.lerpVectors(anchor.up, out.up, w).normalize();
    return out;
  };
  return { pose };
}

export default function Orbit({ clock, camera, portalMaterial }: SceneProps) {
  const world = getWorld();
  const objs = useMemo(() => buildObjects(world, portalMaterial), [world, portalMaterial]);
  useEffect(
    () => () => {
      for (const m of objs.instanced) m.dispose();
    },
    [objs],
  );
  const track = useMemo(() => createTrack(world), [world]);
  const pickReflections = useMemo(() => createReflectionPicker(world), [world]);
  const tmp = useMemo(newPose, []);
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    track.pose(t, tmp);
    camera.position.copy(tmp.pos);
    camera.up.copy(tmp.up);
    camera.lookAt(tmp.look);
    camera.fov = 62;
    camera.near = 0.05;
    camera.far = 800;

    pickReflections(tmp.pos, tmp.look);
    objs.lamp.position.copy(tmp.pos).lerp(tmp.look, 0.3).addScaledVector(camera.up, 2.5);

    world.sky.update(t, tmp.pos, forward.subVectors(tmp.look, tmp.pos).normalize());

    const open = smooth((t - 15.8) / 4.6) * 2.25;
    objs.leafL.rotation.y = open;
    objs.leafR.rotation.y = -open;

    const pm = world.mat.pointsMat.uniforms;
    pm.uTime!.value = t;
    pm.uScale!.value = state.gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  });

  return (
    <>
      <color attach="background" args={[FOG_COLOR]} />
      <fog attach="fog" args={[FOG_COLOR, FOG_NEAR, FOG_FAR]} />
      <ambientLight color="#6670d8" intensity={1.0} />
      <directionalLight color="#8fdcff" intensity={1.3} position={[0, 0, 1]} />
      <primitive object={objs.root} />
    </>
  );
}
