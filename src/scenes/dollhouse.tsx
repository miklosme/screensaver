import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CustomBlending,
  CylinderGeometry,
  DstColorFactor,
  ExtrudeGeometry,
  DoubleSide,
  FrontSide,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Path,
  Quaternion,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  ZeroFactor,
  type Group,
} from "three";
import { RAIL, RAIL_LEAD_IN, RAIL_LEAD_OUT, createRide } from "./rail";
import type { SceneProps } from "./types";
import { createGarden } from "./dollhouse/garden";

/**
 * DOLLHOUSE — bigger on the inside.
 *
 * A soft daylight dune garden scattered with paper-thin free-standing doorways and tiny domed
 * huts. Seen from the front every one of them contains a vast domed rotunda (analytically
 * ray-traced in the fragment shader of a flat arch, so it has true parallax); seen from behind
 * they are just empty frames. The camera orbits one doorway front -> edge -> back, flies through
 * its empty frame, and commits to the big stele whose double doors swing open onto the next scene.
 */

// ───────────────────────────── palette ─────────────────────────────
const HORIZON = "#fdd2b8";
// the haze starts well past the garden, so near props keep their full colour and only the far
// dunes fade to peach
const FOG_NEAR = 95;
const FOG_FAR = 430;
const SUN_DIR = new Vector3(0.45, 0.6, 0.75).normalize();
const glc = (hex: string) => `vec3(${new Color(hex).toArray().map((v) => v.toFixed(4)).join(",")})`;
const CREAM = "#fdeccd";
const glv = (v: Vector3) => `vec3(${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`;

// ───────────────────────────── helpers ─────────────────────────────
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
const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Dunes: almost flat in the garden around the two hero doors, rolling further out. */
function ground(x: number, z: number) {
  const d = Math.hypot(x, z - 18);
  const m1 = smoothstep(26, 90, d);
  const m2 = smoothstep(90, 260, d);
  return (
    m1 * (4.2 * Math.sin(x * 0.035 + 1.3) * Math.cos(z * 0.03 + 0.4) + 2.8 * Math.sin((x + z) * 0.021 + 0.5) + 1.4 * Math.sin(x * 0.08 - z * 0.06)) +
    m2 * (16 * Math.sin(x * 0.012 + 2.0) * Math.sin(z * 0.013 + 1.0) + 7)
  );
}

/** Round-headed arch outline, feet at y0, springline at hs, half width a. */
function archPath<T extends Path>(p: T, a: number, hs: number, y0: number): T {
  p.moveTo(-a, y0);
  p.lineTo(a, y0);
  p.lineTo(a, hs);
  p.absarc(0, hs, a, 0, Math.PI, false);
  p.lineTo(-a, y0);
  return p;
}

/** An arch-shaped band (open at the bottom), extruded with a soft bevel and centred in z. */
function frameGeometry(a: number, hs: number, band: number, depth: number, y0 = -1) {
  const A = a + band;
  const s = new Shape();
  s.moveTo(-A, y0);
  s.lineTo(-A, hs);
  s.absarc(0, hs, A, Math.PI, 0, true);
  s.lineTo(A, y0);
  s.lineTo(a, y0);
  s.lineTo(a, hs);
  s.absarc(0, hs, a, 0, Math.PI, false);
  s.lineTo(-a, y0);
  s.lineTo(-A, y0);
  const bevel = Math.min(0.09, depth * 0.3);
  const g = new ExtrudeGeometry(s, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

/** Unit normal of the dunes at (x, z). */
function groundNormal(x: number, z: number, out: Vector3) {
  const e = 1.5;
  return out.set(ground(x - e, z) - ground(x + e, z), 2 * e, ground(x, z - e) - ground(x, z + e)).normalize();
}
const _n = new Vector3();
/** Matrix that flattens geometry along the sun direction onto the dune tangent plane at (x, z). */
function shadowMatrix(x: number, z: number, out: Matrix4) {
  const n = groundNormal(x, z, _n);
  const c = n.x * x + n.y * (ground(x, z) + 0.05) + n.z * z;
  const k = 1 / n.dot(SUN_DIR);
  const L = SUN_DIR;
  // p' = p - L * (n.p - c) / (n.L)
  return out.set(
    1 - L.x * n.x * k, -L.x * n.y * k, -L.x * n.z * k, L.x * c * k,
    -L.y * n.x * k, 1 - L.y * n.y * k, -L.y * n.z * k, L.y * c * k,
    -L.z * n.x * k, -L.z * n.y * k, 1 - L.z * n.z * k, L.z * c * k,
    0, 0, 0, 1,
  );
}

// ───────────────────────────── layout ─────────────────────────────
// Thin doorway D1 (the one we orbit and fly through)
const D_A = 2.2;
const D_HS = 3.4;
const D1 = { x: 0, z: 30 };
// Hero stele (the real portal) at the origin, facing +z
const P_A = 2.4;
const P_HS = 3.2;
const PLINTH = 0.3;
const HERO_Y = ground(0, 0);
const EXIT_Y = HERO_Y + PLINTH + 2.2;

// The camera track. It opens with a dead straight glide at the thin doorway (the arriving camera
// may not turn, see rail.ts), peels off to the right, rounds the doorway, comes back through its
// empty frame and ends on a straight run into the stele.
const LEAD_FROM = new Vector3(8.5, 5.9, 0.5);
const LEAD_DIR = new Vector3(5.2, 2.9, D1.z).sub(LEAD_FROM).normalize(); // passes right of the doorway
const lead = (dist: number) => LEAD_FROM.clone().addScaledVector(LEAD_DIR, dist);
const CAM_KEYS: Vector3[] = [
  // collinear: the curve stays exactly on the line up to the third key
  lead(0),
  lead(10),
  lead(RAIL_LEAD_IN + 1),
  lead(RAIL_LEAD_IN + 3),
  new Vector3(9.2, 3.5, 26.4),
  new Vector3(11.6, 3.25, 31.2),
  new Vector3(11.0, 3.1, 35.6),
  new Vector3(7.2, 2.95, 39.8),
  new Vector3(1.2, 2.75, 41.0),
  new Vector3(0.0, 2.65, 34.5),
  new Vector3(1.0, 2.6, 25.0),
  new Vector3(2.6, 2.55, 16.5),
  // collinear again: straight through the stele's doors
  new Vector3(0, EXIT_Y, 2 * RAIL_LEAD_OUT + 0.4),
  new Vector3(0, EXIT_Y, RAIL_LEAD_OUT + 0.2),
  new Vector3(0, EXIT_Y, 0),
];

interface DoorDef {
  x: number;
  z: number;
  /** direction the front faces (world x,z) */
  fx: number;
  fz: number;
  scale: number;
  pal: number;
  frame: number;
  hut?: boolean;
  /** world radius of the rotunda inside */
  R: number;
}
const DOORS: DoorDef[] = [
  { x: D1.x, z: D1.z, fx: 0.0, fz: -1, scale: 1, pal: 0, frame: 0, R: 14 },
  // seen behind D1 in the opening shot
  { x: -21, z: 50, fx: 0.75, fz: -1, scale: 1.25, pal: 1, frame: 2, R: 22 },
  { x: 5, z: 58, fx: 0.15, fz: -1, scale: 0.34, pal: 3, frame: 1, hut: true, R: 14 },
  { x: -42, z: 78, fx: 0.7, fz: -1, scale: 1.7, pal: 2, frame: 3, R: 26 },
  // seen across D1 while orbiting
  { x: -13, z: 33, fx: 1, fz: 0.25, scale: 0.36, pal: 2, frame: 2, hut: true, R: 15 },
  { x: -27, z: 22, fx: 1, fz: 0.35, scale: 1.1, pal: 3, frame: 1, R: 20 },
  { x: -46, z: 40, fx: 1, fz: 0.0, scale: 0.5, pal: 1, frame: 3, hut: true, R: 16 },
  // behind / beside the hero stele, seen on the final approach
  { x: -15, z: -13, fx: 0.25, fz: 1, scale: 1.15, pal: 1, frame: 3, R: 20 },
  { x: 17, z: -24, fx: -0.3, fz: 1, scale: 1.4, pal: 2, frame: 1, R: 24 },
  { x: 10.5, z: -3, fx: -0.25, fz: 1, scale: 0.34, pal: 0, frame: 2, hut: true, R: 14 },
  { x: -9, z: 7, fx: 0.45, fz: 1, scale: 0.3, pal: 3, frame: 0, hut: true, R: 13 },
  { x: -34, z: -44, fx: 0.4, fz: 1, scale: 2.0, pal: 0, frame: 2, R: 30 },
  { x: 40, z: -58, fx: -0.4, fz: 1, scale: 0.6, pal: 1, frame: 0, hut: true, R: 18 },
  { x: 30, z: 6, fx: -1, fz: 0.5, scale: 0.9, pal: 3, frame: 3, R: 18 },
];

/** true where a prop of radius r stands clear of the camera's track, the doors and the stele */
const clearOf = (pathPts: Vector3[]) => (x: number, z: number, r: number) => {
  for (const p of pathPts) if (Math.hypot(p.x - x, p.z - z) < r) return false;
  for (const d of DOORS) if (Math.hypot(d.x - x, d.z - z) < r + d.scale * 3) return false;
  if (Math.hypot(x, z) < 6 + r) return false;
  // keep the sight line D1 -> stele open
  if (Math.abs(x) < 6 && z > -2 && z < 44) return false;
  return true;
};

/**
 * One sun for everything. Props are lit by a wrapped (half-Lambert) warm key and a cool lavender
 * fill, so the side turned from the sun goes lavender rather than grey; the ground uses the same
 * light, and a cast shadow is the ground lit by the fill alone.
 */
const SUN_GLSL = /* glsl */ `
  const vec3 SUN = ${glv(SUN_DIR)};
  const vec3 KEY = vec3(1.0, 0.83, 0.62) * 1.12;
  const vec3 FILL = vec3(0.6, 0.57, 0.95) * 0.46;
  const vec3 BOUNCE = vec3(1.0, 0.7, 0.55) * 0.1;
  /** lit: 1 in the sun, 0 in shadow */
  vec3 sunLight(vec3 n, float lit) {
    float w = clamp(dot(n, SUN) * 0.5 + 0.5, 0.0, 1.0);
    float up = n.y * 0.5 + 0.5;
    return FILL * (0.72 + 0.28 * up) + BOUNCE * (1.0 - up) + KEY * (w * w * lit);
  }
`;

/**
 * Lights a Lambert material with the scene's sun and paints a pattern onto it in the object space
 * of each instance, so that no two trees, domes or hoops need be alike. `glsl` may read vOb
 * (object position) and vSeed (0..1 per instance), and mixes `second(colour)` into diffuseColor
 * where its pattern goes. `ao` is a float expression of vOb: 0 where the prop meets the ground.
 */
function sunlit(mat: MeshLambertMaterial, key: string, glsl = "", ao = "1.0") {
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOb;\nvarying float vSeed;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vOb = position;
        #ifdef USE_INSTANCING
          vSeed = fract(instanceMatrix[3].x * 0.371 + instanceMatrix[3].z * 0.713);
        #else
          vSeed = 0.0;
        #endif`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec3 vOb;
        varying float vSeed;
        const float TAU = 6.2831853;
        ${SUN_GLSL}
        /** pale things get a darker second colour, coloured things a paler one */
        vec3 second(vec3 c) { return mix(mix(c, vec3(1.0), 0.6), c * vec3(0.7, 0.62, 0.78), step(0.78, dot(c, vec3(0.3333)))); }`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + glsl)
      .replace(
        "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
        /* glsl */ `vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
        float occ = clamp(${ao}, 0.0, 1.0);
        vec3 outgoingLight = diffuseColor.rgb * sunLight(nW, occ) * mix(0.62, 1.0, occ) + totalEmissiveRadiance;`,
      );
  };
  mat.customProgramCacheKey = () => "dollhouse-" + key;
  return mat;
}

const PATTERNS = {
  // lollipop trees: candy swirls, polka dots, hoops, or plain
  crown: /* glsl */ `
    {
      vec3 q = normalize(vOb);
      float ang = atan(q.z, q.x) / TAU;
      float px = length(fwidth(q)) * 1.5 + 1e-4;
      float kind = fract(vSeed * 7.31);
      float m = 0.0;
      if (kind < 0.36) {
        m = smoothstep(-px * 6.0, px * 6.0, sin((ang * 3.0 + q.y * 1.1 + vSeed) * TAU));
      } else if (kind < 0.62) {
        vec2 g = vec2(ang * 10.0, q.y * 3.4 + 0.5);
        g.x += 0.5 * mod(floor(g.y), 2.0);
        m = (1.0 - smoothstep(0.27 - px * 3.0, 0.27 + px * 3.0, length(fract(g) - 0.5))) * smoothstep(0.95, 0.8, abs(q.y));
      } else if (kind < 0.82) {
        m = smoothstep(-px * 8.0, px * 8.0, sin(q.y * 9.0 + vSeed * 6.0));
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, second(diffuseColor.rgb), m);
    }`,
  // pavilion domes: banded like a beach ball, with a ring of round windows and a cap
  dome: /* glsl */ `
    {
      vec3 q = normalize(vOb);
      float ang = atan(q.z, q.x) / TAU;
      float px = length(fwidth(q)) * 1.5 + 1e-4;
      float gores = 6.0 + floor(vSeed * 3.0) * 2.0;
      float m = smoothstep(-px * gores, px * gores, sin(ang * gores * TAU)) * smoothstep(0.2, 0.26, q.y) * step(q.y, 0.93);
      m = max(m, smoothstep(0.93 - px, 0.93 + px, q.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, second(diffuseColor.rgb), m);
      vec2 w = vec2((fract(ang * 14.0) - 0.5) * 0.45, q.y - 0.08);
      float win = 1.0 - smoothstep(0.045 - px, 0.045 + px, length(w));
      float rim = 1.0 - smoothstep(0.062 - px, 0.062 + px, length(w));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.9), rim);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.33, 0.42, 0.78), win);
    }`,
  // hoops: barber-pole stripes along the arc
  loop: /* glsl */ `
    {
      float s = vUv.x * (9.0 + floor(vSeed * 4.0) * 2.0) + vUv.y;
      float px = fwidth(vUv.x) * 12.0 + 1e-4;
      diffuseColor.rgb = mix(diffuseColor.rgb, second(diffuseColor.rgb), smoothstep(-px * 6.0, px * 6.0, sin(s * TAU)));
    }`,
  // stepping stones: a spiral, like the top of a lollipop
  stone: /* glsl */ `
    {
      float r = length(vOb.xz);
      float px = fwidth(r) + 1e-4;
      float m = smoothstep(-px * 14.0, px * 14.0, sin((r * 2.6 - atan(vOb.z, vOb.x) / TAU + vSeed) * TAU));
      diffuseColor.rgb = mix(diffuseColor.rgb, second(diffuseColor.rgb), 0.7 * m * step(0.5, vOb.y) * smoothstep(0.98, 0.93, r));
    }`,
};

const TREES = 220;
const CONTACTS = 560;
const FRAME_COLORS = ["#fff7ea", "#ffd9c2", "#cdeedd", "#c9e0f7"];
const HUT_COLORS = ["#fff3e2", "#ffcdb6", "#bfe8d4", "#bcd8f5"];

// interior palettes: wall low, wall high, floor, glow, orb
const INTERIORS: [string, string, string, string, string][] = [
  ["#3a4fa3", "#8fb4f2", "#2c3a86", "#ffe6b8", "#ff9f8c"],
  ["#c0507a", "#f7a9b4", "#96406c", "#fff1c9", "#8fe3d2"],
  ["#6a4fb0", "#bfaaf5", "#4f3c8e", "#ffdcc8", "#ffd47a"],
  ["#1f8a80", "#93e3c9", "#186863", "#fff4c6", "#ff93a6"],
];

// ───────────────────────────── shaders ─────────────────────────────
const FOG_GLSL = /* glsl */ `
  vec3 applyFog(vec3 c, float d) {
    float f = smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, d);
    return mix(c, ${glc(HORIZON)}, f);
  }
`;

/**
 * The sand: its colour (contour bands, mint and teal up the dunes, richer and darker close by) and
 * its wind ripples at two scales, which only tilt the normal so that they read as lit and shaded
 * faces. Shared by the ground and by every shadow lying on it, so a shadow is exactly the sand
 * without the sun.
 */
const SAND_GLSL = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + 1.0), f.x), f.y);
  }
  vec3 sandAlbedo(vec3 w, float d) {
    float hgt = w.y;
    vec3 sand = ${glc("#f6a596")};
    vec3 cream = ${glc("#fde0c4")};
    vec3 mint = ${glc("#a9dcc0")};
    vec3 teal = ${glc("#6cbfae")};
    // wind-combed contour bands that follow the dunes
    float warp = sin(w.x * 0.045 + sin(w.z * 0.03) * 1.7) * 2.2 + sin(w.z * 0.05 + w.x * 0.02) * 1.6;
    float bands = sin((hgt * 1.5 + warp) * 2.4 + w.x * 0.10 + w.z * 0.07);
    float bw = fwidth(bands) * 1.2;
    float band = smoothstep(-bw, bw, bands);
    float fadeB = 1.0 - smoothstep(60.0, 160.0, d);
    vec3 col = mix(sand, cream, smoothstep(-3.0, 1.0, hgt + (band - 0.5) * 1.6 * fadeB + 0.6));
    col = mix(col, mint, smoothstep(1.2, 6.0, hgt));
    col = mix(col, teal, smoothstep(9.0, 22.0, hgt));
    col *= 1.0 - 0.07 * (1.0 - band) * fadeB;
    // drifts of darker, coarser sand
    col *= 1.0 - 0.08 * smoothstep(0.45, 0.8, vnoise(w.xz * 0.07)) * fadeB;
    // the sand at your feet is darker and richer than the far dunes
    float near = 1.0 - smoothstep(8.0, 70.0, d);
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    return mix(col, mix(vec3(l), col, 1.3) * 0.87, near);
  }
  /** the ground normal n tilted by wind ripples: long asymmetric ones, and a fine patchy set */
  vec3 rippleNormal(vec3 n, vec3 w, float d) {
    vec2 p = w.xz;
    vec2 q = p + vec2(sin(p.y * 0.11 + 1.7 * sin(p.x * 0.07)), sin(p.x * 0.09 + 1.3 * sin(p.y * 0.13))) * 3.5;
    vec2 W1 = vec2(0.62, 0.78);
    float c1 = dot(q, W1) / 0.95 + 0.7 * sin(q.x * 0.31 + 2.0 * sin(q.y * 0.23));
    float s1 = fract(c1);
    float slope1 = 1.25 - 6.25 * (smoothstep(0.72, 0.82, s1) - smoothstep(0.93, 1.0, s1));
    float aa1 = (1.0 - smoothstep(0.12, 0.4, fwidth(c1))) * (1.0 - smoothstep(20.0, 60.0, d)) * (0.7 + 0.3 * sin(q.x * 0.13 - q.y * 0.07));
    vec2 W2 = vec2(0.42, 0.91);
    float c2 = (dot(q, W2) + 0.25 * sin(p.x * 1.3 + 1.6 * sin(p.y * 0.9))) / 0.26;
    float s2 = fract(c2);
    float slope2 = 1.25 - 6.25 * (smoothstep(0.72, 0.84, s2) - smoothstep(0.92, 1.0, s2));
    float aa2 = (1.0 - smoothstep(0.12, 0.4, fwidth(c2))) * (1.0 - smoothstep(6.0, 26.0, d)) * smoothstep(0.3, 0.65, vnoise(p * 0.21 + 3.0));
    vec2 g = W1 * slope1 * 0.05 * aa1 + W2 * slope2 * 0.045 * aa2;
    return normalize(n - vec3(g.x, 0.0, g.y));
  }
`;

function makeInteriorMaterial(pal: number, R: number) {
  const p = INTERIORS[pal]!;
  return new ShaderMaterial({
    side: FrontSide,
    uniforms: {
      uT: { value: 0 },
      R: { value: R },
      cLow: { value: new Color(p[0]) },
      cHigh: { value: new Color(p[1]) },
      cFloor: { value: new Color(p[2]) },
      cGlow: { value: new Color(p[3]) },
      cOrb: { value: new Color(p[4]) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      varying vec3 vCam;
      void main() {
        vP = position;
        vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float R;
      uniform float uT;
      uniform vec3 cLow, cHigh, cFloor, cGlow, cOrb;
      varying vec3 vP;
      varying vec3 vCam;
      const float TAU = 6.2831853;
      float aastep(float e, float x) { float w = fwidth(x) * 0.75 + 1e-5; return smoothstep(e - w, e + w, x); }
      void main() {
        vec3 ro = vP;
        vec3 rd = normalize(vP - vCam);
        vec3 C = vec3(0.0, 0.0, -R * 0.9);         // centre of the rotunda floor
        // dome
        vec3 oc = ro - C;
        float b = dot(oc, rd);
        float h = b * b - (dot(oc, oc) - R * R);
        float tS = -b + sqrt(max(h, 0.0));
        float tF = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
        float t = min(tS, tF);
        vec3 p = ro + rd * t;
        vec3 q = p - C;
        float ang = atan(q.x, q.z);
        vec3 col;
        if (tF < tS) {
          // floor: polar checker, pool of light from the oculus, shadow of the orb
          float r = length(q.xz) / R;
          float rings = r * 9.0;
          float seg = ang / TAU * 28.0;
          float chk = abs(mix(-1.0, 1.0, aastep(0.5, fract(rings))) * mix(-1.0, 1.0, aastep(0.5, fract(seg))) * 0.5 + 0.5);
          chk = mix(0.5, chk, smoothstep(0.03, 0.12, r) * (1.0 - smoothstep(0.0, 0.9, fwidth(seg))) * (1.0 - smoothstep(0.0, 0.9, fwidth(rings))));
          col = mix(cFloor, mix(cFloor, cHigh, 0.45), chk);
          col += cHigh * 0.35 * exp(-r * r * 7.0);
          col *= 1.0 - 0.35 * (1.0 - smoothstep(0.08, 0.2, r));
          col = mix(col, cLow, smoothstep(0.75, 1.0, r) * 0.5);
        } else {
          float y = q.y / R;                          // 0 at the floor, 1 at the crown
          col = mix(cLow, cHigh, smoothstep(0.0, 0.95, y));
          // meridian ribs + latitude bands
          float rib = abs(fract(ang / TAU * 22.0) - 0.5);
          col = mix(col, cHigh, 0.35 * (1.0 - smoothstep(0.0, 0.035, rib)) * smoothstep(0.42, 0.5, y));
          float lat = abs(fract(y * 7.0) - 0.5);
          col *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.05, lat)) * smoothstep(0.44, 0.5, y);
          // arcade of glowing arches round the wall: more doors, more worlds
          float u = (fract(ang / TAU * 22.0 + 0.5) - 0.5) * 2.0;
          float v = y / 0.34;
          float au = abs(u) / 0.56;
          float inside = step(au, 1.0) * step(v, 0.62 + 0.36 * sqrt(max(0.0, 1.0 - au * au)));
          float edge = step(abs(u) / 0.66, 1.0) * step(v, 0.66 + 0.40 * sqrt(max(0.0, 1.0 - min(1.0, au * au * 0.72))));
          col = mix(col, cLow * 0.82, (edge - inside) * 0.9);
          // the arches take turns to brighten, a slow wave going round the room
          float lit = 0.8 + 0.2 * sin(uT * 1.1 - floor(ang / TAU * 22.0 + 0.5) * 0.9);
          col = mix(col, mix(cGlow, cOrb, 0.25 + 0.5 * v) * lit, inside * 0.92);
          // oculus
          float oc2 = smoothstep(0.955, 0.965, y);
          col = mix(col, cGlow, 0.5 * smoothstep(0.7, 0.96, y));
          col = mix(col, vec3(1.0, 0.99, 0.95), oc2);
        }
        // haze of distance
        col = mix(col, mix(cHigh, cGlow, 0.35), 0.3 * (1.0 - exp(-t / (R * 1.9))));
        // floating orb under the oculus
        vec3 oC = C + vec3(0.0, R * (0.36 + 0.04 * sin(uT * 0.8 + R)), 0.0);
        float oR = R * 0.15;
        vec3 oo = ro - oC;
        float ob = dot(oo, rd);
        float oh = ob * ob - (dot(oo, oo) - oR * oR);
        if (oh > 0.0) {
          float to = -ob - sqrt(oh);
          if (to > 0.0 && to < t) {
            vec3 n = (ro + rd * to - oC) / oR;
            float l = 0.5 + 0.5 * n.y;
            vec3 oc3 = mix(cOrb * 0.62, mix(cOrb, cGlow, 0.5), l * l);
            oc3 += 0.25 * cGlow * pow(1.0 - max(0.0, -dot(n, rd)), 3.0);
            float aa = smoothstep(0.0, fwidth(oh) * 1.5, oh);
            col = mix(col, oc3, aa);
          }
        }
        // soft dark threshold so the opening reads as depth
        float edgeShade = smoothstep(0.0, 0.5, vP.y);
        col *= 0.86 + 0.14 * edgeShade;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function makeTerrainMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      varying float vD;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normal;
        vec4 mv = viewMatrix * w;
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      varying float vD;
      ${FOG_GLSL}
      ${SUN_GLSL}
      ${SAND_GLSL}
      void main() {
        vec3 n = rippleNormal(normalize(vN), vW, vD);
        vec3 col = sandAlbedo(vW, vD) * sunLight(n, 1.0);
        // a few grains catch the sun as the eye moves past
        vec2 g = vW.xz * 9.0;
        vec2 cell = floor(g);
        float h = hash12(cell);
        vec2 at = cell + 0.5 + (vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5) * 0.6;
        vec3 v = normalize(vW - cameraPosition);
        float glint = pow(max(0.0, sin(h * 91.0 + dot(v, vec3(23.0, 17.0, 29.0)))), 12.0);
        float dotm = 1.0 - smoothstep(0.06, 0.16, length(g - at));
        float spark = step(0.965, h) * glint * dotm * (1.0 - smoothstep(4.0, 16.0, vD)) * (1.0 - smoothstep(0.08, 0.16, fwidth(g.x)));
        col += vec3(1.0, 0.95, 0.85) * spark * 1.4 * max(0.0, dot(n, SUN));
        gl_FragColor = vec4(applyFog(col, vD), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Shadows lying on the sand. A shadow multiplies what is under it by how much darker the ground is
 * out of the sun than in it (fading out in the haze), so it costs almost nothing to draw. CAST:
 * geometry flattened onto the ground along the sun, its edge softened where the surface turns
 * side-on to the sun. FLAT: a flat silhouette flattened the same way, lighter towards its far end.
 * CONTACT: a round dark pool, its strength in the length of the instance's y axis.
 */
const SHADOW_FRAG = /* glsl */ `
  varying vec3 vW;
  varying float vA;
  varying vec2 vQ;
  ${SUN_GLSL}
  void main() {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    n *= sign(n.y);
    vec3 k = sunLight(n, 0.0) / sunLight(n, 1.0);
    float a = vA;
    #ifdef CONTACT
      float r = length(vQ) * 2.0;
      a *= pow(1.0 - smoothstep(0.0, 1.0, r), 1.5);
      k *= 0.6;
    #endif
    a *= 1.0 - smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, length(cameraPosition - vW));
    gl_FragColor = vec4(mix(vec3(1.0), k, a), 1.0);
    #include <colorspace_fragment>
  }
`;

function makeShadowMaterial(kind: "CAST" | "FLAT" | "CONTACT", vertexShader?: string) {
  return new ShaderMaterial({
    defines: { [kind]: "" },
    uniforms: { uT: { value: 0 } },
    transparent: true,
    depthWrite: false,
    // dst * src: the shadow darkens whatever sand, ripple or sparkle lies under it
    blending: CustomBlending,
    blendSrc: DstColorFactor,
    blendDst: ZeroFactor,
    side: kind === "FLAT" ? DoubleSide : FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    vertexShader:
      vertexShader ??
      /* glsl */ `
      varying vec3 vW;
      varying float vA;
      varying vec2 vQ;
      const vec3 SUN = ${glv(SUN_DIR)};
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz;
        vQ = position.xz;
        #if defined(CONTACT)
          vA = length(m[1].xyz);
        #elif defined(FLAT)
          vA = 1.0 - 0.3 * smoothstep(0.0, 8.0, position.y);
        #else
          vA = smoothstep(0.0, 0.5, dot(normal, SUN));
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: SHADOW_FRAG,
  });
}

function makeSkyMaterial() {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sun: { value: SUN_DIR }, horizon: { value: new Color(HORIZON) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sun;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 peach = ${glc("#ffbfa3")};
        vec3 blue = ${glc("#78bbf6")};
        vec3 deep = ${glc("#4f8fe6")};
        vec3 col = mix(horizon, peach, smoothstep(0.0, 0.07, y) * (1.0 - smoothstep(0.05, 0.22, y)) * 0.55);
        col = mix(col, blue, smoothstep(0.03, 0.3, y));
        col = mix(col, deep, smoothstep(0.35, 1.0, y));
        float s = max(dot(d, sun), 0.0);
        col += vec3(1.0, 0.86, 0.66) * (0.10 * pow(s, 8.0) + 0.22 * pow(s, 70.0));
        col = mix(col, vec3(1.0, 0.985, 0.93), smoothstep(0.9982, 0.9987, s));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ───────────────────────────── scene ─────────────────────────────
export default function Dollhouse({ clock, camera, portalMaterial }: SceneProps) {
  const leafL = useRef<Group>(null);
  const leafR = useRef<Group>(null);
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const domes = useRef<InstancedMesh>(null);
  const loops = useRef<InstancedMesh>(null);
  const clouds = useRef<InstancedMesh>(null);
  const stones = useRef<InstancedMesh>(null);
  const blobShadows = useRef<InstancedMesh>(null);
  const trunkShadows = useRef<InstancedMesh>(null);
  const loopShadows = useRef<InstancedMesh>(null);
  const domeShadows = useRef<InstancedMesh>(null);
  const contacts = useRef<InstancedMesh>(null);

  const cam = useMemo(() => {
    const curve = new CatmullRomCurve3(CAM_KEYS, false, "centripetal");
    curve.arcLengthDivisions = 4000;
    const length = curve.getLength();
    return {
      curve,
      length,
      // brisk on the way in and out, lingering while it rounds the back of the doorway; the
      // profile is scaled so that it uses up the track exactly
      ride: createRide({
        cruise: (t) => 4.6 - 1.7 * smoothstep(8, 11, t) * (1 - smoothstep(12.5, 15.5, t)),
        length,
        rampIn: 4,
      }),
      look: new Vector3(),
      lookA: new Vector3(D1.x, 2.9, D1.z),
      lookB: new Vector3(0, EXIT_Y, -40),
    };
  }, []);

  const geo = useMemo(() => {
    // terrain
    const terrain = new PlaneGeometry(720, 720, 160, 160);
    terrain.rotateX(-Math.PI / 2);
    const pos = terrain.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setY(i, ground(pos.getX(i), pos.getZ(i)));
    terrain.computeVertexNormals();

    // thin doorway
    const frame = frameGeometry(D_A, D_HS, 0.42, 0.26);
    const opening = new ShapeGeometry(archPath(new Shape(), D_A + 0.02, D_HS, -0.6), 28);
    // flat silhouettes used only to cast the projected shadows
    const fs = new Shape();
    const FA = D_A + 0.42;
    fs.moveTo(-FA, 0);
    fs.lineTo(-FA, D_HS);
    fs.absarc(0, D_HS, FA, Math.PI, 0, true);
    fs.lineTo(FA, 0);
    fs.lineTo(D_A, 0);
    fs.lineTo(D_A, D_HS);
    fs.absarc(0, D_HS, D_A, 0, Math.PI, false);
    fs.lineTo(-D_A, 0);
    fs.lineTo(-FA, 0);
    const frameFlat = new ShapeGeometry(fs, 20);
    const steleFlat = new ShapeGeometry(archPath(new Shape(), P_A + 1.45, P_HS + 0.55, -PLINTH), 24);
    const hutShell = new SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const hutCap = new SphereGeometry(1, 16, 10);

    // hero stele
    const steleShape = archPath(new Shape(), P_A + 1.45, P_HS + 0.55, -1);
    const steleBack = new ExtrudeGeometry(steleShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.05,
      bevelSegments: 2,
      curveSegments: 36,
    });
    steleBack.translate(0, 0, -0.22);
    const steleFront = frameGeometry(P_A, P_HS, 1.45, 0.3, -1);
    // lift the outer springline so the band is even
    steleFront.dispose();
    const sf = new Shape();
    const A = P_A + 1.45;
    const HS = P_HS + 0.55;
    sf.moveTo(-A, -1);
    sf.lineTo(-A, HS);
    sf.absarc(0, HS, A, Math.PI, 0, true);
    sf.lineTo(A, -1);
    sf.lineTo(P_A, -1);
    sf.lineTo(P_A, P_HS);
    sf.absarc(0, P_HS, P_A, 0, Math.PI, false);
    sf.lineTo(-P_A, -1);
    sf.lineTo(-A, -1);
    const steleRing = new ExtrudeGeometry(sf, {
      depth: 0.2,
      bevelEnabled: true,
      bevelSize: 0.07,
      bevelThickness: 0.07,
      bevelSegments: 3,
      curveSegments: 36,
    });
    steleRing.translate(0, 0, -0.07);
    const trim = frameGeometry(P_A, P_HS, 0.3, 0.16, 0);
    const portal = new ShapeGeometry(archPath(new Shape(), P_A + 0.03, P_HS, 0), 40);
    // one door leaf (the right-hand one, hinge at x = 0 of its own space, leaf towards -x)
    const ls = new Shape();
    ls.moveTo(-P_A, 0);
    ls.lineTo(0, 0);
    ls.lineTo(0, P_HS);
    ls.absarc(-P_A, P_HS, P_A, 0, Math.PI / 2, false);
    ls.lineTo(-P_A, 0);
    const leaf = new ExtrudeGeometry(ls, {
      depth: 0.05,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 1,
      curveSegments: 24,
    });
    // raised round-headed panel on the leaf
    const lp = new Shape();
    const pa = P_A * 0.5 - 0.32;
    lp.moveTo(-pa, 0.45);
    lp.lineTo(pa, 0.45);
    lp.lineTo(pa, P_HS + 0.2);
    lp.absarc(0, P_HS + 0.2, pa, 0, Math.PI, false);
    lp.lineTo(-pa, 0.45);
    const leafPanel = new ExtrudeGeometry(lp, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 2,
      curveSegments: 16,
    });
    leafPanel.translate(-P_A * 0.5, 0, 0.06);

    const disc = new CylinderGeometry(1, 1.06, 1, 48);
    disc.translate(0, 0.5, 0);
    const trunk = new CylinderGeometry(0.05, 0.09, 1, 6);
    trunk.translate(0, 0.5, 0);
    const ball = new SphereGeometry(1, 14, 9);
    const contact = new PlaneGeometry(1, 1);
    contact.rotateX(-Math.PI / 2);
    const bigBall = new SphereGeometry(1, 32, 16);
    const loop = new TorusGeometry(1, 0.11, 10, 40, Math.PI);
    const lowLoop = new TorusGeometry(1, 0.11, 6, 28, Math.PI);
    const sky = new SphereGeometry(900, 32, 20);
    return {
      terrain,
      frame,
      frameFlat,
      steleFlat,
      opening,
      hutShell,
      hutCap,
      steleBack,
      steleRing,
      trim,
      portal,
      leaf,
      leafPanel,
      disc,
      trunk,
      ball,
      contact,
      lowLoop,
      bigBall,
      loop,
      sky,
    } satisfies Record<string, BufferGeometry>;
  }, []);

  const mat = useMemo(() => {
    const lambert = (c: string, key: string, glsl = "", ao = "1.0") => sunlit(new MeshLambertMaterial({ color: c }), key, glsl, ao);
    const FRAME_AO = "smoothstep(-0.3, 1.1, vOb.y)";
    return {
      terrain: makeTerrainMaterial(),
      sky: makeSkyMaterial(),
      frames: FRAME_COLORS.map((c) => lambert(c, "frame", "", FRAME_AO)),
      huts: HUT_COLORS.map((c) => lambert(c, "hut", "", "smoothstep(-0.37, 0.2, vOb.y)")),
      interiors: DOORS.map((d) => makeInteriorMaterial(d.pal, d.R / d.scale)),
      stele: lambert("#ffab98", "frame", "", FRAME_AO),
      steleBack: lambert("#ffc4b0", "frame", "", FRAME_AO),
      trim: lambert("#fff6e6", "plain"),
      leaf: lambert("#5f96dc", "plain"),
      leafPanel: lambert("#86b6ec", "plain"),
      knob: lambert("#ffd98a", "plain"),
      plinth: lambert("#fff1df", "plinth", "", "smoothstep(0.64, 0.95, vOb.y)"),
      plinth2: lambert("#cdeedd", "plinth2", "", "smoothstep(0.8, 1.0, vOb.y)"),
      crown: lambert("#ffffff", "crown", PATTERNS.crown),
      dome: lambert("#ffffff", "dome", PATTERNS.dome, "smoothstep(0.1, 0.55, vOb.y)"),
      loop: Object.assign(lambert("#ffffff", "loop", PATTERNS.loop, "smoothstep(0.0, 0.4, vOb.y)"), { defines: { USE_UV: "" } }),
      stone: lambert("#ffffff", "stone", PATTERNS.stone),
      trunk: lambert("#f2d7c4", "trunk", "", "smoothstep(0.0, 0.3, vOb.y)"),
      cast: makeShadowMaterial("CAST"),
      flat: makeShadowMaterial("FLAT"),
      contact: makeShadowMaterial("CONTACT"),
      cloud: sunlit(new MeshLambertMaterial({ color: "#ffffff", emissive: "#8f96ad", fog: false }), "cloud"),
    };
  }, []);

  const shadows = useMemo(() => {
    const o = new Object3D();
    const doors = DOORS.map((d) => {
      o.position.set(d.x, ground(d.x, d.z), d.z);
      o.rotation.set(0, Math.atan2(d.fx, d.fz), 0);
      o.scale.setScalar(d.scale);
      o.updateMatrix();
      return shadowMatrix(d.x, d.z, new Matrix4()).multiply(o.matrix);
    });
    const stele = shadowMatrix(0, -9, new Matrix4()).multiply(new Matrix4().makeTranslation(0, HERO_Y + PLINTH, 0));
    return { doors, stele };
  }, []);

  const garden = useMemo(() => {
    const pathPts = cam.curve.getPoints(80);
    return createGarden({
      ground,
      clear: clearOf(pathPts),
      path: pathPts,
      rnd: mulberry32(4711),
      fogGlsl: FOG_GLSL,
      sun: SUN_DIR,
      shadowMaterial: (vs) => makeShadowMaterial("CAST", vs),
    });
  }, [cam]);
  useEffect(() => () => garden.dispose(), [garden]);

  // scattered, instanced dressing
  useLayoutEffect(() => {
    const rnd = mulberry32(20251);
    const o = new Object3D();
    const c = new Color();
    const sm = new Matrix4();
    const zero = new Matrix4().makeScale(0, 0, 0);
    const BS = blobShadows.current!;
    const TS = trunkShadows.current!;
    const LS = loopShadows.current!;
    const DS = domeShadows.current!;
    const CT = contacts.current!;
    const clear = clearOf(cam.curve.getPoints(80));
    // soft dark pools where things meet the ground: an ellipse rx by rz turned by yaw, laid on the dune
    const up = new Vector3(0, 1, 0);
    const tilt = new Quaternion();
    const yawQ = new Quaternion();
    let nc = 0;
    const contact = (x: number, z: number, rx: number, rz: number, yaw: number, strength: number) => {
      if (nc >= CT.count) return;
      tilt.setFromUnitVectors(up, groundNormal(x, z, _n));
      yawQ.setFromAxisAngle(up, yaw);
      o.position.set(x, ground(x, z) + 0.04, z);
      o.quaternion.copy(tilt).multiply(yawQ);
      o.scale.set(rx * 2, strength, rz * 2);
      o.updateMatrix();
      CT.setMatrixAt(nc++, o.matrix);
    };

    // lollipop trees
    const crownCols = ["#8fd8bd", "#b5e8cf", "#ffc2ad", "#ffdcc4", "#a9d3f5", "#fff0d6", "#6fc7b0"];
    const T = trunks.current!;
    const K = crowns.current!;
    let n = 0;
    while (n < T.count) {
      const a = rnd() * Math.PI * 2;
      const r = 10 + Math.pow(rnd(), 0.75) * 190;
      const x = Math.cos(a) * r;
      const z = 18 + Math.sin(a) * r;
      const hgt = (1.4 + rnd() * 3.2) * (1 + r / 160);
      const cr = hgt * (0.26 + rnd() * 0.16);
      const squash = 0.85 + rnd() * 0.5;
      const ci = Math.floor(rnd() * crownCols.length);
      if (!clear(x, z, 5 + cr)) continue;
      const y = ground(x, z);
      o.position.set(x, y - 0.1, z);
      o.rotation.set(0, 0, 0);
      o.scale.set(1 + hgt * 0.25, hgt, 1 + hgt * 0.25);
      o.updateMatrix();
      T.setMatrixAt(n, o.matrix);
      shadowMatrix(x, z, sm);
      TS.setMatrixAt(n, o.matrix.premultiply(sm));
      o.position.set(x, y + hgt + cr * squash * 0.55, z);
      o.scale.set(cr, cr * squash, cr);
      o.updateMatrix();
      K.setMatrixAt(n, o.matrix);
      K.setColorAt(n, c.set(crownCols[ci]!));
      BS.setMatrixAt(n, o.matrix.premultiply(sm));
      contact(x + SUN_DIR.x * -0.15, z - SUN_DIR.z * 0.15, 0.35 + hgt * 0.09, 0.35 + hgt * 0.09, 0, 0.8);
      n++;
    }
    // hut domes cast blobs too
    DOORS.forEach((d, i) => {
      const slot = T.count + i;
      if (!d.hut) return BS.setMatrixAt(slot, zero);
      const dw = D_A * d.scale;
      const l = Math.hypot(d.fx, d.fz);
      const hx = d.x - (d.fx / l) * dw * 2.05;
      const hz = d.z - (d.fz / l) * dw * 2.05;
      o.position.set(hx, ground(d.x, d.z) - 0.1, hz);
      o.rotation.set(0, 0, 0);
      o.scale.set(dw * 2.3, dw * 2.9, dw * 2.3);
      o.updateMatrix();
      BS.setMatrixAt(slot, o.matrix.premultiply(shadowMatrix(hx, hz, sm)));
      contact(hx, hz, dw * 2.75, dw * 2.75, 0, 0.75);
    });
    // every doorway darkens the sand along its foot, and the stele's plinth sits in a pool
    for (const d of DOORS) {
      const w = (D_A + 0.42) * d.scale;
      contact(d.x, d.z, w * 1.25, 0.9 * d.scale + 0.3, Math.atan2(d.fx, d.fz), 0.7);
    }
    contact(0, 0, 9.4, 9.4, 0, 0.75);
    BS.instanceMatrix.needsUpdate = true;
    TS.instanceMatrix.needsUpdate = true;
    T.instanceMatrix.needsUpdate = true;
    K.instanceMatrix.needsUpdate = true;
    if (K.instanceColor) K.instanceColor.needsUpdate = true;

    // big half-buried pavilion domes
    const domeCols = ["#fff3e0", "#ffd0ba", "#c4ecd9", "#bcdaf6", "#ffe3b8", "#f9c3cf"];
    const Dm = domes.current!;
    n = 0;
    while (n < Dm.count) {
      const a = rnd() * Math.PI * 2;
      const r = 62 + rnd() * 190;
      const x = Math.cos(a) * r;
      const z = 18 + Math.sin(a) * r;
      const s = 7 + rnd() * 16 + r * 0.03;
      const tall = 0.7 + rnd() * 0.9;
      const ci = Math.floor(rnd() * domeCols.length);
      if (!clear(x, z, s + 8)) continue;
      o.position.set(x, ground(x, z) - s * 0.25, z);
      o.rotation.set(0, rnd() * 6, 0);
      o.scale.set(s, s * tall, s);
      o.updateMatrix();
      Dm.setMatrixAt(n, o.matrix);
      Dm.setColorAt(n, c.set(domeCols[ci]!));
      DS.setMatrixAt(n, o.matrix.premultiply(shadowMatrix(x, z, sm)));
      contact(x, z, s * 1.22, s * 1.22, 0, 0.6);
      n++;
    }
    Dm.instanceMatrix.needsUpdate = true;
    DS.instanceMatrix.needsUpdate = true;
    if (Dm.instanceColor) Dm.instanceColor.needsUpdate = true;

    // bulbous hoops leaping over the dunes
    const loopCols = ["#ffffff", "#ffc9b3", "#bfe9d5", "#fff0d2", "#b9d8f6"];
    const L = loops.current!;
    n = 0;
    while (n < L.count) {
      const a = rnd() * Math.PI * 2;
      const r = 38 + rnd() * 170;
      const x = Math.cos(a) * r;
      const z = 18 + Math.sin(a) * r;
      const s = 5 + rnd() * 14 + r * 0.05;
      const rot = rnd() * Math.PI;
      const ci = Math.floor(rnd() * loopCols.length);
      const fat = 0.8 + rnd() * 1.6;
      if (!clear(x, z, s + 5)) continue;
      o.position.set(x, ground(x, z) - s * 0.12, z);
      o.rotation.set(0, rot, 0);
      o.scale.set(s, s * (0.8 + rnd() * 0.7), s * fat);
      o.updateMatrix();
      L.setMatrixAt(n, o.matrix);
      L.setColorAt(n, c.set(loopCols[ci]!));
      LS.setMatrixAt(n, o.matrix.premultiply(shadowMatrix(x, z, sm)));
      // both feet
      for (const side of [-1, 1]) contact(x + Math.cos(rot) * s * side, z - Math.sin(rot) * s * side, 0.5 * s * 0.22 * fat + 0.5, 0.5 * s * 0.22 * fat + 0.5, rot, 0.7);
      n++;
    }
    LS.instanceMatrix.needsUpdate = true;
    L.instanceMatrix.needsUpdate = true;
    if (L.instanceColor) L.instanceColor.needsUpdate = true;

    // pill clouds
    const Cl = clouds.current!;
    n = 0;
    while (n < Cl.count) {
      const a = rnd() * Math.PI * 2;
      const r = 380 + rnd() * 380;
      const y = 90 + rnd() * 170 + r * 0.1;
      const len = 34 + rnd() * 60;
      const puffs = Math.min(Cl.count - n, 2 + Math.floor(rnd() * 3));
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      for (let i = 0; i < puffs; i++) {
        const k = puffs === 1 ? 0 : i / (puffs - 1) - 0.5;
        const s = len * (0.32 + rnd() * 0.2) * (1 - Math.abs(k) * 0.5);
        // tangent to the sky so they read as long pills
        o.position.set(cx - Math.sin(a) * k * len, y + s * 0.18 * (1 - Math.abs(k) * 2), cz + Math.cos(a) * k * len);
        o.rotation.set(0, -a + Math.PI / 2, 0);
        o.scale.set(s * 1.5, s * 0.42, s * 0.8);
        o.updateMatrix();
        Cl.setMatrixAt(n, o.matrix);
        n++;
      }
    }
    Cl.instanceMatrix.needsUpdate = true;

    // stepping stones from the thin doorway to the stele, under the camera's path
    const St = stones.current!;
    for (let i = 0; i < St.count; i++) {
      // a winding line from the stele's plinth, through the thin doorway, and on behind it
      const z = i < 13 ? 9.6 + i * 1.42 : 32 + (i - 13) * 1.42;
      const x = Math.sin(z * 0.21 + 0.6) * 1.1 * smoothstep(3, 7, Math.abs(z - 30)) + (i % 2 ? 0.3 : -0.3);
      const s = 0.55 + rnd() * 0.3;
      o.position.set(x, ground(x, z) - 0.04, z);
      o.rotation.set(0, 0, 0);
      o.scale.set(s, 0.16, s);
      o.updateMatrix();
      St.setMatrixAt(i, o.matrix);
      St.setColorAt(i, c.set(i % 3 === 0 ? "#cdeedd" : i % 3 === 1 ? "#fff6e9" : "#ffd9c2"));
    }
    St.instanceMatrix.needsUpdate = true;
    if (St.instanceColor) St.instanceColor.needsUpdate = true;

    // the garden's flower drifts and pinwheel stalks
    for (const f of garden.drifts) contact(f.x - SUN_DIR.x * 0.3, f.z - SUN_DIR.z * 0.3, f.r * 1.1, f.r * 1.1, 0, 0.32);
    for (const p of garden.pinwheels) contact(p.x, p.z, 0.3 * p.size + 0.15, 0.3 * p.size + 0.15, 0, 0.8);
    for (let i = nc; i < CT.count; i++) CT.setMatrixAt(i, zero);
    CT.instanceMatrix.needsUpdate = true;
  }, [cam, garden]);

  useFrame(() => {
    const t = Math.min(25, Math.max(0, clock.t));
    garden.update(t);
    for (const m of mat.interiors) m.uniforms.uT!.value = t;
    cam.curve.getPointAt(Math.min(1, cam.ride.at(t) / cam.length), camera.position);
    // straight ahead while arriving, then the eye is drawn to the doorway, then on to the stele
    const free = smoothstep(RAIL.release, RAIL.release + 4.8, t);
    const s = smoothstep(10.8, 16.8, t);
    cam.look.lerpVectors(cam.lookA, cam.lookB, s).sub(camera.position).normalize();
    cam.look.lerp(LEAD_DIR, 1 - free).add(camera.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look);
    // a breath of roll while orbiting
    camera.rotateZ(Math.sin((t / 25) * Math.PI * 2) * 0.02 * free * (1 - smoothstep(20, RAIL.settle, t)));
    const fov = 50 + 8 * smoothstep(16, 23.5, t);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // double doors swing open towards us
    const k = smoothstep(13.2, 18.5, t);
    const open = k * 1.95;
    if (leafR.current) leafR.current.rotation.y = open;
    if (leafL.current) leafL.current.rotation.y = -open;
  });

  return (
    <>
      <color attach="background" args={[HORIZON]} />
      <fog attach="fog" args={[HORIZON, FOG_NEAR, FOG_FAR]} />

      <mesh geometry={geo.sky} material={mat.sky} frustumCulled={false} renderOrder={-10} />
      <mesh geometry={geo.terrain} material={mat.terrain} />

      {/* paper-thin doorways and tiny huts, all with a rotunda inside */}
      {DOORS.map((d, i) => {
        const y = ground(d.x, d.z);
        const ry = Math.atan2(d.fx, d.fz);
        const dw = D_A * d.scale;
        return (
          <group key={i} position={[d.x, y, d.z]} rotation={[0, ry, 0]}>
            {d.hut ? (
              <>
                {/* dome sits behind the little porch; far too small for what is inside */}
                <group position={[0, -0.1, -dw * 2.05]}>
                  <mesh geometry={geo.hutShell} material={mat.huts[d.frame]} scale={[dw * 2.3, dw * 2.9, dw * 2.3]} />
                  <mesh geometry={geo.hutCap} material={mat.frames[(d.frame + 1) % 4]} position={[0, dw * 2.9, 0]} scale={dw * 0.3} />
                </group>
                <mesh geometry={geo.frame} material={mat.frames[(d.frame + 1) % 4]} scale={[d.scale, d.scale, d.scale * 2.2]} />
              </>
            ) : (
              <>
                <mesh geometry={geo.frame} material={mat.frames[d.frame]} scale={d.scale} />
              </>
            )}
            <mesh geometry={geo.opening} material={mat.interiors[i]} scale={d.scale} position={[0, 0, d.hut ? 0.02 : 0]} />
          </group>
        );
      })}

      {DOORS.map((d, i) => (
        <mesh key={i} geometry={geo.frameFlat} material={mat.flat} matrix={shadows.doors[i]} matrixAutoUpdate={false} frustumCulled={false} />
      ))}
      <mesh geometry={geo.steleFlat} material={mat.flat} matrix={shadows.stele} matrixAutoUpdate={false} frustumCulled={false} />

      {/* the stele: the real way out */}
      <group position={[0, HERO_Y, 0]}>
        <mesh geometry={geo.disc} material={mat.plinth2} position={[0, -0.6, 0]} scale={[8.2, 0.72, 8.2]} />
        <mesh geometry={geo.disc} material={mat.plinth} position={[0, -0.6, 0]} scale={[6.4, 0.6 + PLINTH, 6.4]} />
        <group position={[0, PLINTH, 0]}>
          <mesh geometry={geo.steleBack} material={mat.steleBack} />
          <mesh geometry={geo.steleRing} material={mat.stele} />
          <mesh geometry={geo.trim} material={mat.trim} position={[0, 0, 0.14]} />
          <mesh geometry={geo.portal} material={portalMaterial} position={[0, 0, -0.02]} />
          <group ref={leafR} position={[P_A, 0, 0.1]}>
            <mesh geometry={geo.leaf} material={mat.leaf} />
            <mesh geometry={geo.leafPanel} material={mat.leafPanel} />
            <mesh geometry={geo.ball} material={mat.knob} position={[-P_A + 0.32, 2.3, 0.14]} scale={0.13} />
          </group>
          <group ref={leafL} position={[-P_A, 0, 0.1]}>
            <group scale={[-1, 1, 1]}>
              <mesh geometry={geo.leaf} material={mat.leaf} />
              <mesh geometry={geo.leafPanel} material={mat.leafPanel} />
              <mesh geometry={geo.ball} material={mat.knob} position={[-P_A + 0.32, 2.3, 0.14]} scale={0.13} />
            </group>
          </group>
        </group>
      </group>

      <instancedMesh ref={trunks} args={[geo.trunk, mat.trunk, TREES]} frustumCulled={false} />
      <instancedMesh ref={crowns} args={[geo.ball, mat.crown, TREES]} frustumCulled={false} />
      <instancedMesh ref={trunkShadows} args={[geo.trunk, mat.cast, TREES]} frustumCulled={false} />
      <instancedMesh ref={blobShadows} args={[geo.ball, mat.cast, TREES + DOORS.length]} frustumCulled={false} />
      <instancedMesh ref={loopShadows} args={[geo.lowLoop, mat.cast, 16]} frustumCulled={false} />
      <instancedMesh ref={domeShadows} args={[geo.ball, mat.cast, 22]} frustumCulled={false} />
      <instancedMesh ref={contacts} args={[geo.contact, mat.contact, CONTACTS]} frustumCulled={false} />
      <instancedMesh ref={domes} args={[geo.bigBall, mat.dome, 22]} frustumCulled={false} />
      <instancedMesh ref={loops} args={[geo.loop, mat.loop, 16]} frustumCulled={false} />
      <instancedMesh ref={clouds} args={[geo.ball, mat.cloud, 48]} frustumCulled={false} />
      <instancedMesh ref={stones} args={[geo.disc, mat.stone, 26]} frustumCulled={false} />
      <primitive object={garden.root} />
    </>
  );
}
