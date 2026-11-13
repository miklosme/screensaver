import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CustomBlending,
  CylinderGeometry,
  DataTexture,
  DstColorFactor,
  ExtrudeGeometry,
  DoubleSide,
  FrontSide,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Path,
  Quaternion,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  ZeroFactor,
  type Group,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAIL, RAIL_LEAD_IN, RAIL_LEAD_OUT, createRide } from "./rail";
import type { SceneProps } from "./types";
import { createGarden, glScreen, onScreen } from "./dollhouse/garden";

/**
 * DOLLHOUSE — bigger on the inside.
 *
 * A soft daylight dune garden scattered with paper-thin free-standing doorways and tiny domed
 * huts. Seen from the front every one of them contains a vast room of its own (analytically
 * ray-traced in the fragment shader of a flat arch, so it has true parallax); seen from behind
 * they are just empty frames. The camera orbits one doorway front -> edge -> back, flies through
 * its empty frame, and commits to the big stele whose double doors swing open onto the next scene.
 */

// ───────────────────────────── palette ─────────────────────────────
// Every colour below is written as it should look on screen, after the director's tone curve, and
// solved back to linear light by onScreen() (see garden.ts): the curve greys bright pastels, so
// what goes in has to be a good deal more saturated than what comes out.
type RGB = [number, number, number];
const glv = (v: Vector3) => `vec3(${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`;
const gl3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(4)).join(",")})`;
const HORIZON = new Color().setRGB(...onScreen("#f6c9ae"));
// the haze starts well past the garden, so near props keep their full colour and only the far
// dunes fade to peach
const FOG_NEAR = 95;
const FOG_FAR = 430;
const SUN_DIR = new Vector3(0.45, 0.6, 0.75).normalize();

// One sun: a warm key, a cool lavender fill from the sky and a little warm bounce off the sand.
const KEY: RGB = [1.12, 0.93, 0.694];
const FILL: RGB = [0.276, 0.262, 0.437];
const BOUNCE: RGB = [0.1, 0.07, 0.055];
/** the light on a surface that is turned `w` (0 .. 1, wrapped) towards the sun and `up` (0 .. 1) towards the sky; the GLSL below is the same */
const sunlight = (w: number, up: number): RGB => [0, 1, 2].map((i) => FILL[i]! * (0.72 + 0.28 * up) + BOUNCE[i]! * (1 - up) + KEY[i]! * w * w) as RGB;
const GROUND_LIGHT = sunlight(SUN_DIR.y * 0.5 + 0.5, 1);
/** the albedo of sand that looks like `hex` lying flat in the sun */
const glSand = (hex: string) => gl3(onScreen(hex).map((v, i) => v / GROUND_LIGHT[i]!));

// A prop takes the same sun, but where the sun does not reach, the sky's light counts for more and
// falls on a paler version of the prop's colour. An albedo saturated enough to survive the tone curve
// in the sun would otherwise turn brick or bottle green in the shade; this way the side turned from
// the sun goes lavender.
const SHADE = 2.1;
const PALE = 0.45;
const LUMA: RGB = [0.3, 0.5, 0.2];
/** the albedo that looks like `hex` on the sunny side of a prop: propLight() below, solved for the albedo */
function paint(hex: string): RGB {
  const w = 0.9;
  const up = 0.7;
  const target = onScreen(hex);
  const shade = 1 - w * w;
  const pale = PALE * shade;
  const sky = FILL.map((f, i) => f * (0.72 + 0.28 * up) * (1 + (SHADE - 1) * shade) + BOUNCE[i]! * (1 - up));
  // target = albedo * d + u * dot(LUMA, albedo)
  const d = KEY.map((k, i) => k * w * w + (1 - pale) * sky[i]!);
  const u = sky.map((f) => pale * f);
  const dot = (v: number[]) => v.reduce((sum, x, i) => sum + (LUMA[i]! * x) / d[i]!, 0);
  const luma = dot(target) / (1 + dot(u));
  return target.map((v, i) => Math.max(0, (v - u[i]! * luma) / d[i]!)) as RGB;
}
const glPaint = (hex: string) => gl3(paint(hex));
const painted = (hex: string) => new Color().setRGB(...paint(hex));

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

/** `ground` in GLSL */
const GROUND_GLSL = /* glsl */ `
  float groundAt(vec2 p) {
    float d = length(p - vec2(0.0, 18.0));
    float m1 = smoothstep(26.0, 90.0, d);
    float m2 = smoothstep(90.0, 260.0, d);
    return m1 * (4.2 * sin(p.x * 0.035 + 1.3) * cos(p.y * 0.03 + 0.4) + 2.8 * sin((p.x + p.y) * 0.021 + 0.5) + 1.4 * sin(p.x * 0.08 - p.y * 0.06)) +
      m2 * (16.0 * sin(p.x * 0.012 + 2.0) * sin(p.y * 0.013 + 1.0) + 7.0);
  }
`;

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
}
const DOORS: DoorDef[] = [
  { x: D1.x, z: D1.z, fx: 0.0, fz: -1, scale: 1, pal: 0, frame: 0 },
  // seen behind D1 in the opening shot
  { x: -21, z: 50, fx: 0.75, fz: -1, scale: 1.25, pal: 1, frame: 2 },
  { x: 5, z: 58, fx: 0.15, fz: -1, scale: 0.34, pal: 3, frame: 1, hut: true },
  { x: -42, z: 78, fx: 0.7, fz: -1, scale: 1.7, pal: 2, frame: 3 },
  // seen across D1 while orbiting
  { x: -13, z: 33, fx: 1, fz: 0.25, scale: 0.36, pal: 2, frame: 2, hut: true },
  { x: -27, z: 22, fx: 1, fz: 0.35, scale: 1.1, pal: 3, frame: 1 },
  { x: -46, z: 40, fx: 1, fz: 0.0, scale: 0.5, pal: 1, frame: 3, hut: true },
  // behind / beside the hero stele, seen on the final approach
  { x: -15, z: -13, fx: 0.25, fz: 1, scale: 1.15, pal: 1, frame: 3 },
  { x: 17, z: -24, fx: -0.3, fz: 1, scale: 1.4, pal: 2, frame: 1 },
  { x: 10.5, z: -3, fx: -0.25, fz: 1, scale: 0.34, pal: 0, frame: 2, hut: true },
  { x: -9, z: 7, fx: 0.45, fz: 1, scale: 0.3, pal: 3, frame: 0, hut: true },
  { x: -34, z: -44, fx: 0.4, fz: 1, scale: 2.0, pal: 0, frame: 2 },
  { x: 40, z: -58, fx: -0.4, fz: 1, scale: 0.6, pal: 1, frame: 0, hut: true },
  { x: 30, z: 6, fx: -1, fz: 0.5, scale: 0.9, pal: 3, frame: 3 },
];

/** the stepping stones: a winding line from the stele's plinth, through the thin doorway, and on behind it */
const STONES = 26;
const stoneAt = (i: number) => {
  const z = i < 13 ? 9.6 + i * 1.42 : 32 + (i - 13) * 1.42;
  return { x: Math.sin(z * 0.21 + 0.6) * 1.1 * smoothstep(3, 7, Math.abs(z - 30)) + (i % 2 ? 0.3 : -0.3), z };
};

/** true where no flower may grow: on the stele's plinth, in a doorway's band or a hut, on a stepping stone */
const flowerBlocked = (x: number, z: number) => {
  if (Math.hypot(x, z) < 9.2) return true;
  for (const d of DOORS) {
    const l = Math.hypot(d.fx, d.fz);
    const along = ((x - d.x) * d.fz - (z - d.z) * d.fx) / l;
    const out = ((x - d.x) * d.fx + (z - d.z) * d.fz) / l;
    if (Math.abs(along) < (D_A + 0.7) * d.scale && Math.abs(out) < 0.6 * d.scale + 0.25) return true;
    if (d.hut && Math.hypot(out + D_A * d.scale * 2.05, along) < D_A * d.scale * 2.5) return true;
  }
  for (let i = 0; i < STONES; i++) {
    const s = stoneAt(i);
    if (Math.hypot(s.x - x, s.z - z) < 1.0) return true;
  }
  return false;
};

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
  const vec3 KEY = ${gl3(KEY)};
  const vec3 FILL = ${gl3(FILL)};
  const vec3 BOUNCE = ${gl3(BOUNCE)};
  /** lit: 1 in the sun, 0 in shadow */
  vec3 sunLight(vec3 n, float lit) {
    float w = clamp(dot(n, SUN) * 0.5 + 0.5, 0.0, 1.0);
    float up = n.y * 0.5 + 0.5;
    return FILL * (0.72 + 0.28 * up) + BOUNCE * (1.0 - up) + KEY * (w * w * lit);
  }
  /** a prop of albedo a, lit (see paint()) */
  vec3 propLight(vec3 a, vec3 n, float lit) {
    float w = clamp(dot(n, SUN) * 0.5 + 0.5, 0.0, 1.0);
    float up = n.y * 0.5 + 0.5;
    float sun = w * w * lit;
    float shade = 1.0 - sun;
    vec3 pale = mix(a, vec3(dot(a, ${gl3(LUMA)})), ${PALE.toFixed(2)} * shade);
    return a * KEY * sun + pale * (FILL * ((0.72 + 0.28 * up) * (1.0 + ${(SHADE - 1).toFixed(2)} * shade)) + BOUNCE * (1.0 - up));
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
          vSeed = fract(modelMatrix[3].x * 0.371 + modelMatrix[3].z * 0.713);
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
        /** the stripe on a candy: cream on a coloured one, peach on a cream one (the only warm colour whose green is close to its red) */
        float pHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float pNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + 1.0), f.x), f.y);
        }
        vec3 second(vec3 c) { return mix(${glPaint("#f5ecd9")}, ${glPaint("#f3a488")}, step(0.58, c.g / c.r) * step(c.g, c.r) * step(c.b, c.g)); }`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + glsl)
      .replace(
        "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
        /* glsl */ `vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
        float occ = clamp(${ao}, 0.0, 1.0);
        vec3 outgoingLight = propLight(diffuseColor.rgb, nW, occ) * mix(0.62, 1.0, occ) + totalEmissiveRadiance;`,
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
      diffuseColor.rgb = mix(diffuseColor.rgb, ${glPaint("#f5ecd9")}, rim);
      diffuseColor.rgb = mix(diffuseColor.rgb, ${glPaint("#3b3f8f")}, win);
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

/**
 * The thin doorways' bands are cut from patterned paper: in arch space (along the band, and across
 * it from the opening outwards) one of three prints chosen by the door's position, a pinstripe
 * border, fine fibres in the sheet, and a darker cut edge round the thin sides where the core of
 * the card shows.
 */
const PAPER = /* glsl */ `
  {
    const float A = ${D_A.toFixed(2)}, HS = ${D_HS.toFixed(2)}, B = 0.42;
    vec2 q = vOb.xy;
    float across, along;
    if (q.y < HS) {
      across = abs(q.x) - A;
      along = HS - q.y + (A + B * 0.5) * 1.5708;
    } else {
      vec2 dd = q - vec2(0.0, HS);
      across = length(dd) - A;
      along = (A + B * 0.5) * atan(abs(dd.x), dd.y);
    }
    vec3 base = diffuseColor.rgb;
    vec3 two = second(base);
    // 1 on the two flat faces, 0 on the cut edge round the thin sides
    float face = smoothstep(0.075, 0.115, abs(vOb.z));
    float kind = floor(fract(vSeed * 5.17) * 3.0);
    float m = 0.0;
    if (kind < 0.5) {
      // candy stripes slanting across the band, meeting in chevrons at the crown
      float st = (along + across * 0.9) / 0.36;
      float f = fwidth(st) * TAU + 1e-3;
      m = mix(0.5, smoothstep(-f, f, sin(st * TAU)), 1.0 - smoothstep(0.25, 0.7, fwidth(st)));
      m *= 0.85;
    } else if (kind < 1.5) {
      // scallops along the opening, a row of dots down the middle of the band
      float c = fract(along / 0.32) - 0.5;
      float sc = length(vec2(c * 0.32, across)) - 0.12;
      float w = fwidth(sc) + 1e-4;
      m = 1.0 - smoothstep(-w, w, sc);
      float dt = length(vec2((fract(along / 0.32 + 0.5) - 0.5) * 0.32, across - 0.27)) - 0.045;
      m = max(m, 1.0 - smoothstep(-w, w, dt));
    } else {
      // a zigzag ribbon down the middle of the band
      float zig = abs(fract(along / 0.26) - 0.5) * 0.12;
      float sd = abs(across - 0.21) - (0.045 + zig);
      float w = fwidth(sd) + 1e-4;
      m = 1.0 - smoothstep(-w, w, sd);
    }
    // a pinstripe border just inside both edges
    float pin = min(abs(across - 0.05), abs(across - 0.37)) - 0.011;
    float pw = fwidth(pin) + 1e-4;
    m = max(m, 0.9 * (1.0 - smoothstep(-pw, pw, pin)));
    vec3 col = mix(base, two, m * face);
    // the cut edge: the card's darker core, a fine lamination line in it
    vec3 core = mix(base, two, 0.35) * vec3(0.74, 0.68, 0.7);
    float lam = 1.0 - smoothstep(0.0, fwidth(vOb.z) * 1.5 + 1e-4, abs(abs(vOb.z) - 0.026) - 0.004);
    core *= 1.0 - 0.12 * lam;
    col = mix(core, col, face);
    // fibres in the sheet: long thin streaks laid in two directions, faded before they alias
    vec2 fq = vOb.xy * mat2(0.8, 0.6, -0.6, 0.8);
    vec2 g1 = fq * vec2(70.0, 7.0);
    vec2 g2 = vOb.yx * vec2(55.0, 6.0) + 11.0;
    float fib = pNoise(g1) + pNoise(g2) - 1.0;
    float fade = (1.0 - smoothstep(0.35, 0.9, max(fwidth(g1.x), fwidth(g2.x)))) * mix(0.35, 1.0, face);
    col *= 1.0 + 0.09 * fib * fade + 0.03 * (pNoise(vOb.xy * 9.0) - 0.5);
    diffuseColor.rgb = col;
  }`;

const WHITE = new Color(1, 1, 1);
const TREES = 220;
const CONTACTS = 640;
const TINTS = 160;
const FRAME_COLORS = ["#f4ead4", "#f6b598", "#a2dcbf", "#a6cbee"];
const HUT_COLORS = ["#f3e4c6", "#f4a98e", "#93d6b8", "#9cc3ec"];

// interior palettes: deep shade, lit surface, the room's far haze, its light, its accent. A room is
// in shade, so everything in it but its light is darker and more saturated than the sunlit garden:
// each doorway is a dark jewel set in pale sand.
const INTERIORS: [string, string, string, string, string][] = [
  ["#182060", "#4a6ccc", "#7c9ade", "#f6e8b6", "#f48e78"],
  ["#4c1846", "#b85084", "#d88aa8", "#f6e6bc", "#78dcc6"],
  ["#281c60", "#6e56c8", "#a08cde", "#f6dcbc", "#f4c460"],
  ["#0a3c46", "#2a8e86", "#74c0b0", "#f6ecb6", "#f48098"],
];

/** the kind of room behind each doorway (see makeInteriorMaterial), in the order of DOORS: no two neighbours alike */
const ROOMS = [0, 2, 3, 1, 1, 3, 2, 1, 0, 3, 2, 0, 1, 2];

/** the furthest the eye is taken to be from a doorway when its room is drawn, in door units (see makeInteriorMaterial) */
const EYE_FAR = 20;
/** the height in a doorway (which is 5.6 tall) at which its room's horizon is put */
const HORIZON_Y = 3.5;
/**
 * Where a doorway is mostly seen from, as the shear (sideways, upwards, per unit of depth) that
 * turns its room to face that way: the points of the camera's track in front of it, the near and
 * the square-on ones counting for most. It follows the track, whatever the track becomes.
 */
function aimOf(d: DoorDef, path: Vector3[]) {
  const ry = Math.atan2(d.fx, d.fz);
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const gy = ground(d.x, d.z);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sw = 0;
  for (const p of path) {
    const lx = (c * (p.x - d.x) - s * (p.z - d.z)) / d.scale;
    const lz = (s * (p.x - d.x) + c * (p.z - d.z)) / d.scale;
    const ly = (p.y - gy) / d.scale;
    if (lz < 1) continue;
    const dist2 = lx * lx + ly * ly + lz * lz;
    const w = (lz * lz) / dist2 / (Math.sqrt(dist2) + 15);
    sx += w * lx;
    sy += w * ly;
    sz += w * lz;
    sw += w;
  }
  if (sw === 0) return new Vector2(0, 0);
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v));
  return new Vector2(clamp(-sx / sz, 0.5), clamp((HORIZON_Y * sw - sy) / sz, 0.25));
}

// ───────────────────────────── shaders ─────────────────────────────
const FOG_GLSL = /* glsl */ `
  vec3 applyFog(vec3 c, float d) {
    float f = smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, d);
    return mix(c, ${gl3(HORIZON.toArray())}, f);
  }
`;

/**
 * The sand: its colour (contour bands, mint and teal up the dunes, richer and darker close by) and
 * its wind ripples at two scales, which only tilt the normal so that they read as lit and shaded
 * faces. Shared by the ground and by every shadow lying on it, so a shadow is exactly the sand
 * without the sun.
 */
const NOISE_GLSL = /* glsl */ `
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
`;
const SAND_GLSL = /* glsl */ `
  ${NOISE_GLSL}
  vec3 sandAlbedo(vec3 w, float d) {
    float hgt = w.y;
    // paler than anything that grows on it
    vec3 sand = ${glSand("#f1c8b6")};
    vec3 cream = ${glSand("#f4e3d0")};
    vec3 mint = ${glSand("#a8dcc0")};
    vec3 teal = ${glSand("#78c8b2")};
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
    return mix(col, mix(vec3(l), col, 1.1) * 0.9, near);
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

/**
 * What lies behind a doorway, ray-cast in the fragment shader of its flat opening from the view ray
 * in the door's own space, so that it has its own vanishing point and true parallax.
 *
 * Every room is built the same way, because that is what makes a hole in a sheet of paper read as a
 * vast space at any size: a dark reveal just inside the frame (a wall far thicker than the door),
 * then near surfaces in deep shade, a floor that runs away to the room's own horizon, air that
 * lightens and hazes with distance, and one small bright thing far inside. Value carries the depth:
 * nothing inside is as light as the sunlit garden except the far light.
 *
 * Four kinds of room, picked per door (ROOMS above):
 * 0 HALL: a nave between two rows of columns, lit pools under its skylights, a ball turning in the
 *   fourth pool, a far doorway onto daylight;
 * 1 ROTUNDA: a round hall ringed with dozens of small lit doors, an orb under the oculus;
 * 2 AVENUE: open air under the room's own dusk sky, striped hoops marching down a pale path to the
 *   horizon under a slowly turning ringed planet;
 * 3 FOREST: the hall again, lower and wider, four rows of columns.
 *
 * Two things are done to the ray before it enters the room, both of them linear (so the room stays
 * one solid thing with consistent parallax):
 * - the eye is never taken to be further than EYE_FAR from the door. From far away a doorway is a
 *   telephoto slot that would show only a sliver of floor; held at EYE_FAR it shows the whole
 *   composition, and the room dollies as the camera closes in;
 * - the room is sheared by `aim` so that its long axis and its horizon point at where the door is
 *   mostly seen from (aimOf), which puts the far light in the opening, not off behind the frame.
 *
 * No room has a loop except the avenue's hoops: the rows of columns are found in closed form (the
 * first column of a periodic row that a ray meets). Edges are antialiased by the width of a pixel
 * at the distance of the hit (px * t), and the floors by a box-filtered checker.
 */
function makeInteriorMaterial(pal: number, room: number, seed: number, aim: Vector2) {
  const p = INTERIORS[pal]!;
  return new ShaderMaterial({
    side: FrontSide,
    defines: { ROOM: room },
    uniforms: {
      uT: { value: 0 },
      uSeed: { value: seed },
      uAim: { value: aim },
      cLow: { value: new Color().setRGB(...onScreen(p[0])) },
      cHigh: { value: new Color().setRGB(...onScreen(p[1])) },
      cFog: { value: new Color().setRGB(...onScreen(p[2])) },
      cGlow: { value: new Color().setRGB(...onScreen(p[3])) },
      cOrb: { value: new Color().setRGB(...onScreen(p[4])) },
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
      uniform float uT;
      uniform float uSeed;
      uniform vec2 uAim;
      uniform vec3 cLow, cHigh, cFog, cGlow, cOrb;
      varying vec3 vP;
      varying vec3 vCam;
      const float TAU = 6.2831853;
      const float A = ${D_A.toFixed(2)}, HS = ${D_HS.toFixed(2)};
      /** depth of the reveal, and the furthest the eye is taken to be from the door */
      const float REVEAL = 0.4, EYE_FAR = ${EYE_FAR.toFixed(1)};

      float archSd(vec2 q, float a, float hs) { return q.y < hs ? abs(q.x) - a : length(q - vec2(0.0, hs)) - a; }
      mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
      /** a checker of unit cells, box-filtered over a footprint w (in cells): it fades to its mean where the cells are smaller than a pixel */
      float checker(vec2 p, vec2 w) {
        w = max(w, 1e-4);
        vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
        return 0.5 - 0.5 * i.x * i.y;
      }
      /** the footprint of a pixel on a level floor, along x and z */
      vec2 floorW(vec3 rd, float t, float px) {
        vec2 d = rd.xz / max(length(rd.xz), 1e-4);
        float across = px * t;
        float along = across / max(abs(rd.y), 0.03);
        return abs(d) * along + abs(d.yx) * across;
      }
      /** a ball: x = distance along the ray (1e9 if missed), y = coverage of the pixel */
      vec2 ball(vec3 ro, vec3 rd, vec3 c, float r, float px) {
        vec3 o = ro - c;
        float b = dot(o, rd);
        float d2 = max(dot(o, o) - b * b, 0.0);
        float cov = clamp((r - sqrt(d2)) / (px * max(-b, 1e-3)) + 0.5, 0.0, 1.0);
        float t = -b - sqrt(max(r * r - d2, 0.0));
        return vec2(cov > 0.0 && -b > 0.0 ? t : 1e9, cov);
      }
      /** a ball with stripes that turn about its vertical axis, lit from above */
      vec3 stripedBall(vec3 n, vec3 a, vec3 b, float spin) {
        float ang = atan(n.z, n.x) + spin;
        float s = sin(ang * 4.0 + n.y * 2.5);
        float m = smoothstep(-0.25, 0.25, s);
        float l = 0.55 + 0.45 * dot(n, normalize(vec3(0.3, 1.0, 0.45)));
        return mix(a, b, m) * (0.4 + 0.85 * l);
      }
      /** the room's own air: a surface t away fades into a lighter haze */
      vec3 air(vec3 c, float t, float len) { return mix(c, cFog, 0.86 * (1.0 - exp(-t / len))); }

      #if ROOM == 0 || ROOM == 3
      // ── the hall, and the forest of columns ──
      #if ROOM == 0
        const float H_W = 8.2, H_H = 8.8;
      #else
        const float H_W = 11.4, H_H = 7.0;
      #endif
      const float H_CX = 2.85, H_RC = 0.3, H_S = 5.6, H_L = 67.2, H_FOG = 42.0;
      /**
       * A row of round columns at x = xr, z = -(k + off) H_S for k = 0, 1 ..: the first one the ray
       * meets, found without a loop. The ray crosses the row's line at one place, and the columns it
       * can touch lie within rSel of there (stretched by the angle of the crossing); the first is the
       * nearest of them to the door. rgb: its colour, a: how much of the pixel it covers.
       */
      vec4 column(vec3 ro, vec3 rd, float px, float xr, float off, float rSel, out float tc) {
        tc = 1e9;
        float rx = abs(rd.x) < 1e-5 ? 1e-5 : rd.x;
        float z0 = ro.z + rd.z * (xr - ro.x) / rx;
        float dl2 = max(dot(rd.xz, rd.xz), 1e-8);
        float dl = sqrt(dl2);
        float k = max(0.0, ceil(-(z0 + rSel * dl / abs(rx)) / H_S - off));
        float zk = -(k + off) * H_S;
        vec2 oc = vec2(ro.x - xr, ro.z - zk);
        float qb = dot(oc, rd.xz);
        float tm = -qb / dl2;                                   // closest approach, in plan
        if (tm <= 0.0) return vec4(0.0);
        float dp = sqrt(max(dot(oc, oc) - qb * qb / dl2, 0.0));
        float y = ro.y + rd.y * tm;
        // a drum at the foot, a flare under the ceiling
        float r = H_RC * (1.0 + 0.6 * (1.0 - smoothstep(0.4, 0.5, y)) + 1.0 * smoothstep(H_H - 1.5, H_H - 0.1, y));
        float cov = clamp((r - dp) / (px * tm) + 0.5, 0.0, 1.0);
        if (cov <= 0.0) return vec4(0.0);
        tc = tm - sqrt(max(r * r - dp * dp, 0.0)) / dl;
        vec3 h = ro + rd * tc;
        vec2 n = normalize(vec2(h.x - xr, h.z - zk) + 1e-5);
        // lit from the nave and from the far end
        float lam = 0.5 + 0.5 * dot(n, normalize(vec2(-sign(xr), -0.9)));
        float deep = smoothstep(0.0, 20.0, -h.z);
        vec3 c = mix(cLow * 0.42, mix(cLow, cHigh, 0.92), lam * lam * (0.35 + 0.65 * deep));
        // it stands on the floor
        c *= 0.4 + 0.6 * smoothstep(0.0, 1.8, h.y);
        return vec4(air(c, tc, H_FOG), cov);
      }

      vec3 room(vec3 ro, vec3 rd, float px) {
        float sx = rd.x < 0.0 ? -1.0 : 1.0;
        float rx = abs(rd.x) < 1e-5 ? sx * 1e-5 : rd.x;
        float tW = (sx * H_W - ro.x) / rx;
        float tF = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
        float tC = rd.y > 0.0 ? (H_H - ro.y) / rd.y : 1e9;
        float tE = (-H_L - ro.z) / min(rd.z, -1e-5);
        float t = min(min(tW, tE), min(tF, tC));
        vec3 p = ro + rd * t;
        // the lights are over z = -m H_S, m = 1, 2 ..; the columns stand half way between them
        float m = floor(-p.z / H_S + 0.5);
        float zl = -m * H_S;
        float on = step(0.5, m);
        float zc = -(floor(-p.z / H_S) + 0.5) * H_S;
        float deep = smoothstep(0.0, 20.0, -p.z);               // the near end is the darkest
        // the ball, turning in the fourth pool of light
        vec3 bc = vec3(0.0, 2.2 + 0.3 * sin(uT * 0.9 + uSeed * 6.0), -4.0 * H_S);
        float br = 1.05;
        vec3 col;
        if (t == tF) {
          const float CELL = 1.425;
          float c = checker(p.xz / CELL, floorW(rd, t, px) / CELL);
          col = mix(cLow * 0.55, mix(cLow, cHigh, 0.5), c);
          vec2 dq = vec2(p.x, p.z - zl);
          float pool = on * (1.0 - smoothstep(0.7, 1.9, length(dq)));
          // light from the aisle windows lies across the aisle floor
          float win = on * exp(-pow((p.z - zl) / 1.1, 2.0)) * smoothstep(H_CX, H_W, abs(p.x));
          // and the far doorway lays a carpet of light down the nave
          float carpet = exp(-pow(p.x / 1.3, 2.0)) * pow(deep, 1.5) * smoothstep(0.0, H_L, -p.z);
          // contact: round every column's foot, along the walls, under the ball
          float ao = smoothstep(H_RC * 1.2, H_RC * 4.5, length(vec2(abs(p.x) - H_CX, p.z - zc)));
          #if ROOM == 3
            ao *= smoothstep(H_RC * 1.2, H_RC * 4.5, length(vec2(abs(p.x) - 7.1, p.z - zl)));
          #endif
          ao *= 0.5 + 0.5 * smoothstep(0.0, 1.6, H_W - abs(p.x));
          vec2 db = p.xz - bc.xz;
          ao *= 1.0 - 0.65 * exp(-dot(db, db) / (br * br * 1.4));
          col = col * (0.3 + 0.25 * deep + 0.75 * pool + 0.6 * win) * mix(0.35, 1.0, ao) + mix(cFog, cGlow, 0.5) * (0.14 * pool * ao) + cGlow * (0.3 * carpet);
        } else if (t == tC) {
          float w = px * t / max(rd.y, 0.05) + 1e-4;
          float d = length(vec2(p.x, p.z - zl));
          float sk = on * (1.0 - smoothstep(-w, w, d - 1.0));
          float beam = 1.0 - smoothstep(-w, w, abs(p.z - zc) - 0.45);
          col = cLow * (0.36 + 0.2 * deep) * (1.0 - 0.4 * beam);
          col += cGlow * 0.3 * on * exp(-d * d / 6.0);
          col = mix(col, cGlow * 2.2, sk);
        } else if (t == tE) {
          col = mix(cLow, cHigh, 0.6);
        } else {
          // the aisle wall: a tall lit window opposite every skylight
          float w = px * t * 1.5 + 1e-4;
          col = mix(cLow * 0.5, mix(cLow, cHigh, 0.4), 0.1 + 0.45 * deep) * (0.5 + 0.5 * smoothstep(0.0, 1.6, p.y));
          vec2 q = vec2(p.z - zl, p.y - 1.7);
          float sd = max(archSd(q, 0.95, 2.6), -q.y);
          float inside = on * (1.0 - smoothstep(-w, w, sd));
          float rim = on * (1.0 - smoothstep(-w, w, sd - 0.28));
          col = mix(col, mix(cLow, cHigh, 0.85), rim * 0.8);
          // a skirting, and a string course under the sills
          col *= 1.0 - 0.3 * (1.0 - smoothstep(-w, w, p.y - 0.4));
          col = mix(col, mix(cLow, cHigh, 0.8), 0.55 * (1.0 - smoothstep(-w, w, abs(p.y - 1.5) - 0.09)));
          // glazing bars
          float bars = 1.0 - smoothstep(-w, w, min(abs(q.x), abs(q.y - 2.6)) - 0.055);
          vec3 pane = mix(cGlow, cOrb, 0.25 + 0.2 * sin(uT * 0.6 + m * 1.7)) * (1.1 + 0.7 * smoothstep(1.7, 5.2, p.y));
          col = mix(col, mix(pane, cLow, 0.75 * bars), inside);
        }
        col = air(col, t, H_FOG);
        // the far end: a doorway like the one we look through, onto daylight, and its light in the hall's air
        if (t == tE) {
          float w = px * t * 1.5 + 1e-4;
          col = mix(col, cGlow * 3.4, 1.0 - smoothstep(-w, w, archSd(p.xy, 1.35, 2.5)));
        }
        float g = max(0.0, dot(rd, normalize(vec3(-ro.x, 2.2 - ro.y, -H_L))));
        col += cGlow * (0.4 * pow(g, 1400.0) + 0.1 * pow(g, 120.0));

        // the columns: the row on the side the ray leans to (the one further out too, in the forest)
        float tc, tc2;
        vec4 c1 = column(ro, rd, px, sx * H_CX, 0.5, H_RC, tc);
        if (tc > t) c1.a = 0.0;
        // the same row again with the widest radius, for a drum or a flare nearer than the shaft found above
        vec4 c0 = column(ro, rd, px, sx * H_CX, 0.5, H_RC * 2.0, tc2);
        if (tc2 > t || tc2 >= tc) c0.a = 0.0;
        #if ROOM == 3
          float tc3;
          vec4 c3 = column(ro, rd, px, sx * 7.1, 1.0, H_RC, tc3);
          if (tc3 < t) col = mix(col, c3.rgb, c3.a);
        #endif
        vec2 hb = ball(ro, rd, bc, br, px);
        vec3 bcol = vec3(0.0);
        if (hb.x < t) {
          vec3 n = normalize(ro + rd * hb.x - bc);
          bcol = stripedBall(n, cOrb, cGlow * 1.25, uT * 0.5) * 1.15;
          bcol = mix(bcol, cFog, 0.5 * (1.0 - exp(-hb.x / H_FOG)));
        } else hb.y = 0.0;
        if (hb.x > min(tc, tc2)) col = mix(col, bcol, hb.y);
        col = mix(col, c1.rgb, c1.a);
        col = mix(col, c0.rgb, c0.a);
        if (hb.x <= min(tc, tc2)) col = mix(col, bcol, hb.y);
        return col;
      }
      #endif

      #if ROOM == 1
      // ── the rotunda ──
      vec3 room(vec3 ro, vec3 rd, float px) {
        const float RR = 42.0, HSP = 12.0, FOGL = 100.0, N = 72.0;
        vec3 C = vec3(0.0, 0.0, -(RR - 0.6));                  // centre of the floor
        vec2 o = ro.xz - C.xz;
        float qa = max(dot(rd.xz, rd.xz), 1e-6), qb = dot(o, rd.xz), qc = dot(o, o) - RR * RR;
        float tS = (-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa;
        float tF = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
        float t = min(tS, tF);
        vec3 p = ro + rd * t;
        // the orb under the oculus
        vec3 oC = C + vec3(0.0, 3.4 + 0.5 * sin(uT * 0.8 + uSeed * 6.0), 0.0);
        float oR = 2.0;
        float deep = smoothstep(0.0, 34.0, -p.z);
        vec3 col;
        if (tF < tS) {
          vec2 q = p.xz - C.xz;
          float r = length(q);
          float ang = atan(q.x, q.y);
          const float RING = 2.0;
          vec2 fw = floorW(rd, t, px);
          float wm = max(fw.x, fw.y);
          float c = checker(vec2(r / RING, ang / TAU * N), vec2(wm / RING, wm * N / (TAU * max(r, 0.5))));
          c = mix(0.5, c, smoothstep(5.0, 7.0, r));
          col = mix(cLow * 0.55, mix(cLow, cHigh, 0.5), c);
          float pool = 1.0 - smoothstep(2.5, 6.0, r);
          // every little door lays its light on the floor before it
          float spill = exp(-(RR - r) / 2.2) * (0.35 + 0.65 * pow(0.5 + 0.5 * cos(ang * N), 3.0)) * smoothstep(4.0, 16.0, -p.z);
          float ao = 1.0 - 0.75 * exp(-r * r / (oR * oR * 1.3));
          ao *= 0.55 + 0.45 * smoothstep(0.0, 1.0, RR - r);
          col = col * (0.3 + 0.25 * deep + 0.9 * pool + 0.8 * spill) * ao + cGlow * (0.16 * pool * ao + 0.25 * spill);
        } else if (p.y < HSP) {
          vec2 q = p.xz - C.xz;
          float u = atan(q.x, q.y) / TAU * N;
          float cw = TAU * RR / N;
          float w = px * t * 1.5 + 1e-4;
          col = mix(cLow * 0.5, mix(cLow, cHigh, 0.55), 0.15 + 0.5 * deep) * (0.5 + 0.5 * smoothstep(0.0, 1.4, p.y));
          // a cornice over the doors, another under the dome
          float corn = (1.0 - smoothstep(-w, w, abs(p.y - 3.4) - 0.16)) + (1.0 - smoothstep(-w, w, abs(p.y - 7.6) - 0.16)) + (1.0 - smoothstep(-w, w, abs(p.y - HSP + 0.3) - 0.3));
          col = mix(col, mix(cLow, cHigh, 0.9), 0.6 * corn);
          // a ring of small doors, each lit from the room behind it
          float lx = (fract(u) - 0.5) * cw;
          float sd = archSd(vec2(lx, p.y), 0.75, 1.45);
          float lit = 0.75 + 0.25 * sin(uT * 0.9 - floor(u) * 0.8);
          col = mix(col, mix(cLow, cHigh, 0.9), 0.8 * (1.0 - smoothstep(-w, w, sd - 0.22)));
          col = mix(col, mix(cGlow, cOrb, 0.2 + 0.25 * sin(floor(u) * 2.4)) * (1.5 * lit), 1.0 - smoothstep(-w, w, sd));
          // round windows above them
          // two galleries of smaller windows above them
          float lx2 = (fract(u + 0.5) - 0.5) * cw;
          float sd2 = min(max(archSd(vec2(lx2, p.y - 4.5), 0.42, 1.0), 4.5 - p.y), max(archSd(vec2(lx, p.y - 8.6), 0.42, 0.9), 8.6 - p.y));
          col = mix(col, mix(cGlow, cOrb, 0.3) * (0.8 + 0.25 * sin(floor(u) * 5.1 + uT * 0.3)), 1.0 - smoothstep(-w, w, sd2));
        } else {
          // the dome: ribs running up to the oculus
          vec3 Cd = C + vec3(0.0, HSP, 0.0);
          vec3 od = ro - Cd;
          float b = dot(od, rd);
          t = -b + sqrt(max(b * b - (dot(od, od) - RR * RR), 0.0));
          p = ro + rd * t;
          vec3 n = (p - Cd) / RR;
          float u = atan(n.x, n.z) / TAU * N * 0.5;
          float w = px * t * 1.5 / RR * N * 0.08 / max(length(n.xz), 0.05) + 1e-4;
          float rib = 1.0 - smoothstep(0.06 - w, 0.06 + w, abs(fract(u) - 0.5));
          col = cLow * (0.38 + 0.3 * n.y);
          col = mix(col, mix(cLow, cHigh, 0.6), 0.5 * rib * (1.0 - smoothstep(0.7, 0.95, n.y)));
          col += cGlow * 0.5 * smoothstep(0.75, 0.97, n.y);
          col = mix(col, cGlow * 3.4, smoothstep(0.972, 0.978, n.y));
        }
        col = air(col, t, FOGL);
        // the shaft of light falling from the oculus
        float tm = -qb / qa;
        float dp2 = max(dot(o, o) - qb * qb / qa, 0.0);
        col += cGlow * 0.16 * exp(-dp2 / 12.0) * smoothstep(0.0, 4.0, tm) * (1.0 - smoothstep(t * 0.8, t, tm));
        vec2 hb = ball(ro, rd, oC, oR, px);
        if (hb.x < t) {
          vec3 n = normalize(ro + rd * hb.x - oC);
          vec3 c = stripedBall(n, cOrb, cGlow * 1.25, uT * 0.4) * 1.2;
          col = mix(col, mix(c, cFog, 0.45 * (1.0 - exp(-hb.x / FOGL))), hb.y);
        }
        return col;
      }
      #endif

      #if ROOM == 2
      // ── an avenue of hoops under the room's own dusk ──
      float hoopX(float k) { return sin(k * 0.9 + uSeed * 6.0) * 1.3 * smoothstep(0.0, 1.0, k); }
      vec3 room(vec3 ro, vec3 rd, float px) {
        const float S = 7.0, HA = 2.55, HH = 2.2, BAND = 0.44, FOGL = 110.0;
        const int NP = 7;
        // the sky: deep overhead, a band of light along the horizon, brightest straight ahead
        float h = max(rd.y, 0.0);
        float ahead = max(0.0, -rd.z / max(length(rd.xz), 1e-4));
        ahead *= ahead;
        vec3 hor = mix(cFog, cGlow, 0.15 + 0.55 * ahead) * (0.7 + 0.5 * ahead);
        vec3 sky = mix(mix(cLow, cHigh, 0.55), cLow * 0.55, smoothstep(0.0, 0.11, h));
        sky = mix(sky, hor, exp(-h * 70.0));
        // a ringed planet low over the end of the avenue, turning slowly
        vec3 P = normalize(vec3(-0.06 + 0.12 * uSeed, 0.085, -1.0));
        vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), P));
        vec3 ey = cross(P, ex);
        vec2 pp = vec2(dot(rd, ex), dot(rd, ey)) / 0.04;      // the planet's disc, radius 1
        float pw = px / 0.04 * 1.5 + 1e-4;
        float pd = length(pp);
        float disc = 1.0 - smoothstep(1.0 - pw, 1.0 + pw, pd);
        vec2 rq = rot(0.35) * pp;
        float ring = length(rq * vec2(1.0, 4.2));
        float ringM = (1.0 - smoothstep(1.85 - pw * 3.0, 1.85 + pw * 3.0, ring)) * smoothstep(1.4 - pw * 3.0, 1.4 + pw * 3.0, ring);
        float front = step(0.0, rq.y);                         // the near half of the ring passes in front
        vec3 pc = stripedBall(normalize(vec3(pp.x, pp.y, sqrt(max(0.0, 1.0 - pd * pd)))).xzy, cOrb * 1.3, cGlow * 1.7, uT * 0.12);
        sky += cGlow * 0.3 * exp(-pd * pd * 0.45) * step(0.0, rd.y);
        sky = mix(sky, cGlow * 1.5, ringM * (1.0 - front) * (1.0 - disc));
        sky = mix(sky, pc, disc);
        sky = mix(sky, cGlow * 1.7, ringM * front);
        // the plain
        float tf = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
        vec3 bg = sky;
        if (tf < 1e8) {
          vec3 g = ro + rd * tf;
          const float CELL = 1.6;
          vec2 fw = floorW(rd, tf, px);
          float c = checker(g.xz / CELL, fw / CELL);
          float deep = smoothstep(0.0, 24.0, -g.z);
          vec3 fl = mix(cLow * 0.55, mix(cLow, cHigh, 0.5), c) * (0.4 + 0.35 * deep);
          // the avenue's path, winding under the hoops
          float pathx = sin((-g.z / S - 1.0) * 0.9 + uSeed * 6.0) * 1.3 * smoothstep(S, 2.0 * S, -g.z);
          float path = 1.0 - smoothstep(0.85 - fw.x, 0.85 + fw.x, abs(g.x - pathx));
          fl = mix(fl, mix(cFog, cGlow, 0.6) * (0.3 + 0.7 * deep), 0.9 * path);
          // each hoop stands in a pool of shade, and throws its shadow back at us from the low light ahead
          float k = max(floor(-g.z / S), 0.0);
          float zk = -(k + 1.0) * S;
          float foot = abs(abs(g.x - hoopX(k)) - (HA + BAND * 0.5));
          float sh = (1.0 - smoothstep(BAND * 0.4, BAND * 0.9 + fw.x, foot)) * exp(-(g.z - zk) / 2.2);
          fl *= 1.0 - 0.7 * sh;
          bg = mix(fl, hor, 1.0 - exp(-tf / FOGL));
        }
        vec3 acc = vec3(0.0);
        float T = 1.0;
        for (int i = 0; i < NP; i++) {
          float k = float(i);
          float tz = (-S * (k + 1.0) - ro.z) / min(rd.z, -1e-5);
          if (tz > tf) break;
          vec3 p = ro + rd * tz;
          vec2 q = vec2(p.x - hoopX(k), p.y);
          float sdi = archSd(q, HA, HH);
          float sd = abs(sdi - BAND * 0.5) - BAND * 0.5;
          float w = px * tz * 1.2 + 1e-4;
          float cov = (1.0 - smoothstep(-w, w, sd)) * smoothstep(-w, w, p.y);
          if (cov <= 0.0) continue;
          // candy stripes round the band, like the hoops in the garden outside
          float along = q.y < HH ? q.y : HH + (HA + BAND * 0.5) * atan(abs(q.x), q.y - HH);
          float st = along / 0.62 + k * 0.37;
          float fine = w / 0.62 * 4.0;
          float stripe = mix(0.5, smoothstep(-fine, fine, sin(st * TAU)), 1.0 - smoothstep(0.25, 0.8, fine));
          vec3 c = mix(mix(cLow, cOrb, 0.75), mix(cHigh, cGlow, 0.6), stripe);
          // dark against the light ahead, a rim of it round the inside of the band
          float across = clamp(sdi / BAND, 0.0, 1.0);
          c *= (0.36 + 0.3 * smoothstep(0.0, 4.0, k)) * (1.25 - 0.5 * across) * (0.55 + 0.45 * smoothstep(0.0, 1.2, p.y));
          c = mix(c, hor, 1.0 - exp(-tz / FOGL));
          acc += T * cov * c;
          T *= 1.0 - cov;
          if (T < 0.01) break;
        }
        return acc + T * bg;
      }
      #endif

      void main() {
        vec3 ro = vP;
        vec3 rd = normalize(vP - vCam);
        // the reveal: the wall the door is cut through, far thicker than the door. A ray that leaves
        // the arch before it is REVEAL deep has struck it
        float t1 = REVEAL / max(-rd.z, 1e-4);
        float sd0 = min(archSd(ro.xy, A, HS), -1e-3);
        float sd1 = archSd(ro.xy + rd.xy * t1, A, HS);
        float f = clamp(sd0 / (sd0 - max(sd1, 1e-4)), 0.0, 1.0);
        float tJ = t1 * f;
        float tFl = rd.y < 0.0 ? max(ro.y, 0.0) / -rd.y : 1e9;
        float wj = fwidth(sd1) * 0.75 + 1e-4;
        float jamb = smoothstep(-wj, wj, sd1) * step(tJ, tFl);
        float yj = ro.y + rd.y * tJ;
        // daylight on its lip, dark within, a line of the room's light on its inner edge
        vec3 jc = cLow * (0.2 + 0.55 * exp(-f * 4.0)) * (0.55 + 0.45 * smoothstep(0.0, 1.4, yj));
        jc += mix(cLow, cHigh, 0.7) * 0.22 * smoothstep(0.86, 1.0, f);

        // the room, from an eye held within EYE_FAR of the door and through the room's own shear
        vec3 c0 = vec3(0.0, 2.8, 0.0);
        vec3 e = vCam - c0;
        vec3 rv = normalize(vP - (c0 + e * min(1.0, EYE_FAR / length(e))));
        rv.xy += uAim * rv.z;
        rv = normalize(rv);
        float px = length(fwidth(rv)) + 1e-5;
        vec3 col = room(vec3(ro.x, max(ro.y, 1e-3), 0.0), rv, px);
        // the floor just inside is in the shade of the reveal
        col *= 0.6 + 0.4 * smoothstep(0.0, 1.0, tFl * -rd.z / REVEAL - 0.2);
        col = mix(col, jc, jamb);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function makeTerrainMaterial(shadow: DataTexture) {
  return new ShaderMaterial({
    uniforms: { uShadow: { value: shadow } },
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
      uniform sampler2D uShadow;
      ${FOG_GLSL}
      ${SUN_GLSL}
      ${SAND_GLSL}
      ${SHADOW_MAP_GLSL}
      void main() {
        vec3 n = rippleNormal(normalize(vN), vW, vD);
        float shade = castShade(vW);
        vec3 col = sandAlbedo(vW, vD) * sunLight(n, 1.0 - shade);
        // a few grains catch the sun as the eye moves past
        vec2 g = vW.xz * 9.0;
        vec2 cell = floor(g);
        float h = hash12(cell);
        vec2 at = cell + 0.5 + (vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5) * 0.6;
        vec3 v = normalize(vW - cameraPosition);
        float glint = pow(max(0.0, sin(h * 91.0 + dot(v, vec3(23.0, 17.0, 29.0)))), 12.0);
        float dotm = 1.0 - smoothstep(0.06, 0.16, length(g - at));
        float spark = (1.0 - shade) * step(0.965, h) * glint * dotm * (1.0 - smoothstep(4.0, 16.0, vD)) * (1.0 - smoothstep(0.08, 0.16, fwidth(g.x)));
        col += vec3(1.0, 0.95, 0.85) * spark * 4.0 * max(0.0, dot(n, SUN));
        gl_FragColor = vec4(applyFog(col, vD), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Shadows lying on the sand (still things' shadows are baked instead, see bakeShadows). A shadow multiplies what is under it by how much darker the ground is
 * out of the sun than in it (fading out in the haze), so it costs almost nothing to draw. CAST:
 * geometry flattened onto the ground along the sun, its edge softened where the surface turns
 * side-on to the sun. FLAT: a flat silhouette flattened the same way, lighter towards its far end.
 * CONTACT: a round dark pool, its strength in the length of the instance's y axis.
 * TINT: not a shadow but the same trick: a round stain of the instance's colour, fallen petals under
 * a drift of flowers, which is what lets a drift read as a patch of colour from far away.
 */
const SHADOW_FRAG = /* glsl */ `
  varying vec3 vW;
  varying float vA;
  varying vec2 vQ;
  #ifdef TINT
    varying vec3 vTint;
  #endif
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
    #ifdef TINT
      a *= 1.0 - smoothstep(0.3, 1.0, length(vQ) * 2.0);
      k = vTint;
    #endif
    a *= 1.0 - smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, length(cameraPosition - vW));
    gl_FragColor = vec4(mix(vec3(1.0), k, a), 1.0);
    #include <colorspace_fragment>
  }
`;

function makeShadowMaterial(kind: "CAST" | "FLAT" | "CONTACT" | "TINT", vertexShader?: string) {
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
      #ifdef TINT
        varying vec3 vTint;
      #endif
      const vec3 SUN = ${glv(SUN_DIR)};
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz;
        vQ = position.xz;
        #if defined(TINT)
          vA = length(m[1].xyz);
          vTint = instanceColor;
        #elif defined(CONTACT)
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

// ───────────────────────────── baked shadows ─────────────────────────────
/**
 * Every still thing's shadow on the sand is baked once, at mount, into one terrain-space mask that
 * the sand shader reads. Each texel casts a ray from the dune towards the sun and asks how much of
 * it the trees, domes, hoops, doorways and the stele block, with a penumbra that widens with the
 * distance to the caster. So a shadow follows every curve of the ground it falls on, sharp at a
 * foot and soft at a crown's far edge, and costs one texture read.
 *
 * The mask is warped so that its texels crowd around the garden in the middle: about 6 cm apart
 * there, a couple of metres at the edge of the haze.
 */
const SH_N = 2048;
const SH_K = 60;
const SH_EXT = 360;
const SH_CZ = 18;
const SH_AMAX = SH_EXT / (SH_EXT + SH_K);
/** world offset from the mask's centre -> -1 .. 1 across it */
const shTo = (d: number) => d / (Math.abs(d) + SH_K) / SH_AMAX;
const shFrom = (a: number) => {
  const b = a * SH_AMAX;
  return (SH_K * b) / (1 - Math.abs(b));
};
const SHADOW_MAP_GLSL = /* glsl */ `
  /** 0 in the sun, 1 in full shadow */
  float castShade(vec3 w) {
    vec2 d = w.xz - vec2(0.0, ${SH_CZ.toFixed(1)});
    vec2 a = d / (abs(d) + ${SH_K.toFixed(1)}) / ${SH_AMAX.toFixed(6)};
    return texture2D(uShadow, a * 0.5 + 0.5).r;
  }
`;

/** a still thing, as far as its shadow goes: where on the ground it can fall, and how much of the sun it takes from a point */
interface Caster {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** 0 .. 1, for the ray from (px, py, pz) towards the sun; `texel` is the mask's spacing there */
  occ(px: number, py: number, pz: number, texel: number): number;
}
const PEN0 = 0.03;
const PEN1 = 0.035;
const penumbra = (t: number, texel: number) => PEN0 + PEN1 * t + 0.7 * texel;
/** 1 inside (sd < 0), 0 outside, a smooth ramp `w` either side of the edge */
const softIn = (sd: number, w: number) => 1 - smoothstep(-w, w, sd);

/** the ground under a box (x0..x1, y0..y1, z0..z1) that its shadow may reach */
function footprint(x0: number, x1: number, y1: number, z0: number, z1: number, base: number) {
  const L = (y1 - (base - 8)) / SUN_DIR.y;
  const sx = -SUN_DIR.x * L;
  const sz = -SUN_DIR.z * L;
  const pad = 1 + PEN1 * L;
  return {
    x0: Math.min(x0, x0 + sx) - pad,
    x1: Math.max(x1, x1 + sx) + pad,
    z0: Math.min(z0, z0 + sz) - pad,
    z1: Math.max(z1, z1 + sz) + pad,
  };
}

function ellipsoidCaster(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): Caster {
  const S = SUN_DIR;
  const dx = S.x / rx;
  const dy = S.y / ry;
  const dz = S.z / rz;
  const dl = Math.hypot(dx, dy, dz);
  const [ux, uy, uz] = [dx / dl, dy / dl, dz / dl];
  const rm = (rx + ry + rz) / 3;
  return {
    ...footprint(cx - rx, cx + rx, cy + ry, cz - rz, cz + rz, ground(cx, cz)),
    occ(px, py, pz, texel) {
      const qx = (px - cx) / rx;
      const qy = (py - cy) / ry;
      const qz = (pz - cz) / rz;
      const tq = -(qx * ux + qy * uy + qz * uz);
      if (tq < 0) return qx * qx + qy * qy + qz * qz < 1 ? 1 : 0;
      const d = Math.hypot(qx + ux * tq, qy + uy * tq, qz + uz * tq);
      return softIn(d - 1, penumbra(tq / dl, texel) / rm);
    },
  };
}

/** squared distance between the ray o + S t (t >= 0) and the segment a..b, and the t of the closest point */
function raySegment(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const wx = ox - ax;
  const wy = oy - ay;
  const wz = oz - az;
  const a = dx * dx + dy * dy + dz * dz;
  const b = dx * ex + dy * ey + dz * ez;
  const c = ex * ex + ey * ey + ez * ez;
  const d = dx * wx + dy * wy + dz * wz;
  const e = ex * wx + ey * wy + ez * wz;
  const den = a * c - b * b;
  let s = den > 1e-9 ? (a * e - b * d) / den : 0;
  s = Math.min(1, Math.max(0, s));
  let t = (b * s - d) / a;
  if (t < 0) {
    t = 0;
    s = Math.min(1, Math.max(0, e / c));
  }
  const qx = ox + dx * t - (ax + ex * s);
  const qy = oy + dy * t - (ay + ey * s);
  const qz = oz + dz * t - (az + ez * s);
  return { d2: qx * qx + qy * qy + qz * qz, t };
}

function capsuleCaster(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): Caster {
  const S = SUN_DIR;
  return {
    ...footprint(Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.min(az, bz) - r, Math.max(az, bz) + r, ground(ax, az)),
    occ(px, py, pz, texel) {
      const { d2, t } = raySegment(px, py, pz, S.x, S.y, S.z, ax, ay, az, bx, by, bz);
      return softIn(Math.sqrt(d2) - r, penumbra(t, texel));
    },
  };
}

/** a half torus (TorusGeometry(1, tube, .., PI)) placed at (x, y, z), turned by yaw, scaled by (sx, sy, sz) */
function hoopCaster(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tube: number): Caster {
  const S = SUN_DIR;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // into the hoop's own space: undo the yaw, then the scale
  const local = (vx: number, vy: number, vz: number): [number, number, number] => [(c * vx - s * vz) / sx, vy / sy, (s * vx + c * vz) / sz];
  const [dx, dy, dz] = local(S.x, S.y, S.z);
  const dl = Math.hypot(dx, dy, dz);
  const SEG = 12;
  const arc = Array.from({ length: SEG + 1 }, (_, i) => [Math.cos((Math.PI * i) / SEG), Math.sin((Math.PI * i) / SEG)] as const);
  const sm = (sx + sy + sz) / 3;
  const R = Math.max(sx, sz) * (1 + tube);
  return {
    ...footprint(x - R, x + R, y + sy * (1 + tube), z - R, z + R, ground(x, z)),
    occ(px, py, pz, texel) {
      const [ox, oy, oz] = local(px - x, py - y, pz - z);
      let best = Infinity;
      let bt = 0;
      for (let i = 0; i < SEG; i++) {
        const [a0, a1] = arc[i]!;
        const [b0, b1] = arc[i + 1]!;
        const { d2, t } = raySegment(ox, oy, oz, dx / dl, dy / dl, dz / dl, a0, a1, 0, b0, b1, 0);
        if (d2 < best) {
          best = d2;
          bt = t;
        }
      }
      return softIn(Math.sqrt(best) - tube, penumbra(bt / dl, texel) / sm);
    },
  };
}

/** signed distance to a round-headed arch of half width a and springline hs (open to y = -inf) */
const archSd = (x: number, y: number, a: number, hs: number) => (y < hs ? Math.abs(x) - a : Math.hypot(x, y - hs) - a);

/**
 * A flat upright shape: a doorway's band (inner > 0) or a filled arch (inner = 0), standing at
 * (x, y, z) facing yaw, scaled by `scale`.
 */
function archCaster(x: number, y: number, z: number, yaw: number, scale: number, a: number, hs: number, band: number): Caster {
  const S = SUN_DIR;
  const ex = [Math.cos(yaw), 0, -Math.sin(yaw)] as const;
  const nz = [Math.sin(yaw), 0, Math.cos(yaw)] as const;
  const dn = S.x * nz[0] + S.z * nz[2];
  const A = (a + band) * scale;
  const top = (hs + a + band) * scale;
  return {
    ...footprint(x - A, x + A, y + top, z - A, z + A, ground(x, z)),
    occ(px, py, pz, texel) {
      if (Math.abs(dn) < 1e-4) return 0;
      const t = ((x - px) * nz[0] + (z - pz) * nz[2]) / dn;
      if (t <= 0) return 0;
      const qx = px + S.x * t - x;
      const qy = py + S.y * t - y;
      const qz = pz + S.z * t - z;
      const lx = (qx * ex[0] + qz * ex[2]) / scale;
      const ly = qy / scale;
      let sd = archSd(lx, ly, a + band, hs);
      if (band > 0 && a > 0) sd = Math.max(sd, -archSd(lx, ly, a, hs));
      return softIn(sd * scale, penumbra(t, texel));
    },
  };
}

/** bakes the casters into the mask: 0 in the sun, 255 in full shadow */
function bakeShadows(casters: Caster[], out: Uint8Array) {
  const N = SH_N;
  const X = new Float64Array(N);
  const TX = new Float64Array(N);
  for (let i = 0; i < N; i++) X[i] = shFrom(((i + 0.5) / N) * 2 - 1);
  for (let i = 0; i < N; i++) TX[i] = Math.abs(X[Math.min(N - 1, i + 1)]! - X[Math.max(0, i - 1)]!) / 2;
  const index = (d: number) => Math.min(N - 1, Math.max(0, Math.floor((shTo(d) * 0.5 + 0.5) * N)));
  const vis = new Float32Array(N * N).fill(1);
  const gy = new Float32Array(N * N).fill(NaN);
  for (const c of casters) {
    const i0 = index(c.x0);
    const i1 = index(c.x1);
    const j0 = index(c.z0 - SH_CZ);
    const j1 = index(c.z1 - SH_CZ);
    for (let j = j0; j <= j1; j++) {
      const z = X[j]! + SH_CZ;
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        let g = gy[k]!;
        if (g !== g) g = gy[k] = ground(X[i]!, z);
        const o = c.occ(X[i]!, g + 0.02, z, Math.max(TX[i]!, TX[j]!));
        if (o > 0) vis[k] = vis[k]! * (1 - o);
      }
    }
  }
  for (let k = 0; k < N * N; k++) out[k] = Math.round((1 - vis[k]!) * 255);
}

// ───────────────────────────── the exit door ─────────────────────────────
/** the stele's outer outline: half width and springline */
const ST_A = P_A + 1.45;
const ST_HS = P_HS + 0.55;
/** where the leaves' hinges stand (the leaf groups' origin, at the middle of a leaf's thickness) */
const LEAF_Z = 0.1 + 0.025;
const DOOR_Y = HERO_Y + PLINTH;

/**
 * Shared by everything the door is made of: where the leaves are (from uOpen, their swing in
 * radians) and how much sun reaches a point past them, and past the stele behind the door.
 */
const DOOR_GLSL = /* glsl */ `
  uniform float uOpen;
  const float P_A = ${P_A.toFixed(4)};
  const float P_HS = ${P_HS.toFixed(4)};
  const float ST_A = ${ST_A.toFixed(4)};
  const float ST_HS = ${ST_HS.toFixed(4)};
  const float DOOR_Y = ${DOOR_Y.toFixed(4)};
  const float LEAF_Z = ${LEAF_Z.toFixed(4)};
  float sdBox(vec2 p, vec2 c, vec2 h) {
    vec2 d = abs(p - c) - h;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float archSd(vec2 q, float a, float hs) { return q.y < hs ? abs(q.x) - a : length(q - vec2(0.0, hs)) - a; }
  /** a leaf in its own plane: q.x from the hinge (0) to the meeting edge (P_A), q.y from its foot */
  float leafSd(vec2 q) {
    float body = sdBox(q, vec2(P_A * 0.5, (P_HS - 1.0) * 0.5), vec2(P_A * 0.5, (P_HS + 1.0) * 0.5));
    return min(body, max(length(q - vec2(P_A, P_HS)) - P_A, q.x - P_A));
  }
  float softIn(float sd, float w) { return 1.0 - smoothstep(-w, w, sd); }
  /** how much of the sun the leaf hinged at h (running along e, facing n) takes from p */
  float leafOcc(vec3 p, vec3 h, vec3 e, vec3 n) {
    float dn = dot(SUN, n);
    if (abs(dn) < 1e-3) return 0.0;
    float t = dot(h - p, n) / dn;
    if (t <= 0.0) return 0.0;
    vec3 q = p + SUN * t - h;
    return softIn(leafSd(vec2(dot(q, e), q.y)), 0.012 + 0.045 * t);
  }
  /** distance in plan from p to the segment a..b */
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float k = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - a - ab * k);
  }
  vec3 leafAxisR() { return vec3(-cos(uOpen), 0.0, sin(uOpen)); }
  vec3 leafAxisL() { return vec3(cos(uOpen), 0.0, sin(uOpen)); }
  /** how much sun reaches p past the two leaves, and with stele = true past the stele as well */
  float doorSun(vec3 p, bool stele) {
    vec3 hR = vec3(P_A, DOOR_Y, LEAF_Z);
    vec3 hL = vec3(-P_A, DOOR_Y, LEAF_Z);
    float v = (1.0 - leafOcc(p, hR, leafAxisR(), vec3(sin(uOpen), 0.0, cos(uOpen)))) *
      (1.0 - leafOcc(p, hL, leafAxisL(), vec3(-sin(uOpen), 0.0, cos(uOpen))));
    if (stele && p.z < 0.0) {
      float t = -p.z / SUN.z;
      vec3 q = p + SUN * t;
      v *= 1.0 - softIn(archSd(vec2(q.x, q.y - DOOR_Y), ST_A, ST_HS), 0.015 + 0.04 * t);
    }
    return v;
  }
  /**
   * The shade where the door meets the plinth. Each leaf, standing 5.6 tall, hides a good share of
   * the sky from the plinth beside it (an analytic wall occlusion that turns with the leaf), and
   * stands in a tight dark line of its own; the stele's foot does the same across its width.
   */
  float leafShade(vec2 q, vec2 h, vec2 e) {
    float d = max(segDist(q, h, h + e * P_A) - 0.03, 0.0);
    // the sky a wall takes from a point d away, its height cut down for its finite width
    float sky = 0.5 * (1.0 - d / sqrt(d * d + 2.4 * 2.4));
    float tight = 1.0 - smoothstep(0.0, 0.25, d);
    return (1.0 - 1.2 * sky) * (1.0 - 0.5 * tight);
  }
  float doorContact(vec3 p) {
    // the broad pool leans a little away from the sun, the way the light under a thing is skewed
    vec2 q = p.xz + normalize(SUN.xz) * 0.3;
    float d = length(vec2(max(abs(q.x) - ST_A, 0.0), max(abs(q.y) - 0.28, 0.0)));
    float ao = 1.0 - 0.55 * pow(1.0 - smoothstep(0.0, 1.6, d), 2.0);
    // and the stele's foot stands in a hard line of shade
    float d0 = length(vec2(max(abs(p.x) - ST_A + 0.04, 0.0), max(abs(p.z - 0.05) - 0.24, 0.0)));
    ao *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.12, d0));
    ao *= leafShade(p.xz, vec2(P_A, LEAF_Z), leafAxisR().xz);
    ao *= leafShade(p.xz, vec2(-P_A, LEAF_Z), leafAxisL().xz);
    return ao;
  }
`;

/**
 * The materials of the door: LEAF (panelled, its relief a height function shaded by the sun),
 * SURROUND (the moulded coral frame, painted wood with a little wear), PLINTH (inlaid rings, and
 * the door's shadows lying on it) and BRASS (hinges and knobs).
 */
function makeDoorMaterial(kind: "LEAF" | "SURROUND" | "PLINTH" | "BRASS", open: { value: number }) {
  return new ShaderMaterial({
    defines: { [kind]: "" },
    uniforms: { uOpen: open },
    side: kind === "PLINTH" ? DoubleSide : FrontSide,
    vertexShader: /* glsl */ `
      varying vec3 vOb;
      varying vec3 vNo;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vBx;
      varying vec3 vBy;
      varying vec3 vBz;
      #ifdef SURROUND
        attribute vec3 aProf;
        varying vec3 vProf;
      #endif
      void main() {
        vOb = position;
        vNo = normal;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        mat3 m = mat3(modelMatrix);
        vN = normalize(m * normal);
        vBx = normalize(m[0]);
        vBy = normalize(m[1]);
        vBz = normalize(m[2]);
        #ifdef SURROUND
          vProf = aProf;
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vOb;
      varying vec3 vNo;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vBx;
      varying vec3 vBy;
      varying vec3 vBz;
      #ifdef SURROUND
        varying vec3 vProf;
      #endif
      const float PI = 3.14159265;
      const float TAU = 6.2831853;
      ${FOG_GLSL}
      ${SUN_GLSL}
      ${NOISE_GLSL}
      ${DOOR_GLSL}
      #ifdef LEAF
        /** negative inside a panel: two inset panels and an arched one, framed by stiles and rails */
        float panelSd(vec2 p) {
          float lo = sdBox(p, vec2(-P_A * 0.5, 1.135), vec2(P_A * 0.5 - 0.27, 0.815));
          float up = sdBox(p, vec2(-P_A * 0.5, 2.85), vec2(P_A * 0.5 - 0.27, 0.37));
          float arch = max(length(p - vec2(-P_A, P_HS)) - (P_A - 0.27), max(P_HS + 0.3 - p.y, max(p.x + 0.27, -P_A + 0.27 - p.x)));
          return min(min(lo, up), arch);
        }
        /** the arched panels of the two leaves make one sunburst: its rays, 0 / 1 */
        float rays(vec2 p) {
          float ang = atan(p.y - P_HS, p.x + P_A) / (PI * 0.5) * 7.0;
          return smoothstep(-0.25, 0.25, sin(ang * PI));
        }
        float relief(vec2 p) {
          float s = -panelSd(p);
          // a bevel down into each panel, then its field raised again
          float h = -0.032 * smoothstep(0.0, 0.05, s) + 0.02 * smoothstep(0.09, 0.17, s);
          h += 0.007 * rays(p) * smoothstep(0.17, 0.2, s) * step(P_HS, p.y);
          // a bead along the lock rail
          float onRail = step(-P_A + 0.27, p.x) * step(p.x, -0.27);
          h += 0.014 * (1.0 - smoothstep(0.012, 0.04, abs(p.y - 2.215))) * onRail;
          // the edges are rounded off
          h -= 0.02 * (1.0 - smoothstep(0.0, 0.06, p.x + P_A));
          h -= 0.016 * (1.0 - smoothstep(0.0, 0.05, -p.x));
          return h;
        }
      #endif
      #ifdef PLINTH
        /** a rounded tile edge: 0 down in the joint, 1 on the glaze */
        float bevelH(float d) { return smoothstep(0.0, 0.06, d); }
        float diamond(vec2 q, vec2 hw) { return (1.0 - abs(q.x) / hw.x - abs(q.y) / hw.y) * min(hw.x, hw.y) * 0.85; }
        /**
         * The inlay round the door, in plan: rgb its colour, w how far p lies inside its tile (the
         * joint runs where w is near 0). Out from the threshold: a coral boss in a ring of peach
         * tiles, a sunburst of 24 blue and mint petals with peach lozenges between their tips, a
         * coral band of 40 tiles, a ring of blue and mint diamonds, a mint fillet and a cream border;
         * on the tier below, a ring of mint flags.
         */
        vec4 inlay(vec2 p) {
          vec3 cream = ${glPaint("#f3e6cc")};
          vec3 mint = ${glPaint("#a2dcbf")};
          vec3 coral = ${glPaint("#f3a488")};
          vec3 blue = ${glPaint("#a9c6ee")};
          vec3 peach = ${glPaint("#f7c4a2")};
          float r = length(p);
          float a = atan(p.y, p.x);
          if (r < 0.55) return vec4(coral, 0.55 - r);
          if (r < 0.95) {
            float w = TAU / 10.0;
            float la = (fract(a / w) - 0.5) * w;
            return vec4(peach, min(min(r - 0.55, 0.95 - r), (0.5 * w - abs(la)) * r));
          }
          if (r < 3.4) {
            float w = TAU / 24.0;
            float c = floor(a / w);
            float la = (fract(a / w) - 0.5) * w;
            float k = clamp((r - 0.95) / 2.45, 0.0, 1.0);
            float hw = 0.5 * w * r * 0.96 * pow(sin(3.14159 * k), 0.55);
            float pd = min(hw - abs(la) * r, min(r - 0.95, 3.4 - r) * 1.5);
            if (pd > 0.0) return vec4(mod(c, 2.0) < 0.5 ? blue : mint, pd);
            // between two tips, a peach lozenge
            float lb = (fract(a / w + 0.5) - 0.5) * w;
            float dd = diamond(vec2(lb * r, r - 3.0), vec2(0.5 * w * 3.0 * 0.62, 0.34));
            if (dd > 0.0) return vec4(peach, min(dd, -pd));
            return vec4(cream, min(-pd, -dd));
          }
          if (r < 3.52) return vec4(cream, min(r - 3.4, 3.52 - r));
          if (r < 4.22) {
            float w = TAU / 40.0;
            float la = (fract(a / w) - 0.5) * w;
            float c = floor(a / w);
            return vec4(coral * (mod(c, 2.0) < 0.5 ? 1.0 : 0.95), min(min(r - 3.52, 4.22 - r), (0.5 * w - abs(la)) * r));
          }
          if (r < 4.34) return vec4(cream, min(r - 4.22, 4.34 - r));
          if (r < 5.3) {
            float w = TAU / 36.0;
            float c = floor(a / w);
            float la = (fract(a / w) - 0.5) * w;
            float dd = diamond(vec2(la * r, r - 4.82), vec2(0.5 * w * 4.82 * 0.94, 0.44));
            if (dd > 0.0) return vec4(mod(c, 2.0) < 0.5 ? mint : blue, dd);
            // a coral dot where four diamonds' points meet
            float lb = (fract(a / w + 0.5) - 0.5) * w;
            float dot0 = 0.085 - length(vec2(lb * r, r - 4.82));
            if (dot0 > 0.0) return vec4(coral, dot0);
            return vec4(cream, min(min(-dd, -dot0), min(r - 4.34, 5.3 - r)));
          }
          if (r < 5.44) return vec4(mint, min(r - 5.3, 5.44 - r));
          if (r < 6.0) return vec4(cream, r - 5.44);
          float w = TAU / 64.0;
          float la = (fract(a / w) - 0.5) * w;
          float c = floor(a / w);
          return vec4(mint * (mod(c, 2.0) < 0.5 ? 1.0 : 0.94), min(min(r - 6.08, 7.8 - r), (0.5 * w - abs(la)) * r));
        }
      #endif
      void main() {
        vec3 n = normalize(vN);
        vec3 col;
        float sun = 1.0;
        float occ = 1.0;
        vec3 extra = vec3(0.0);
        #ifdef LEAF
          vec2 p = vOb.xy;
          // the two broad faces carry the relief; the leaf's thin edge does not
          float face = vNo.z > 0.5 ? 1.0 : vNo.z < -0.5 ? -1.0 : 0.0;
          float s = -panelSd(p);
          float fw = fwidth(s) + 1e-4;
          if (face != 0.0) {
            float e = 0.004;
            float h0 = relief(p);
            vec3 nO = normalize(vec3(-(relief(p + vec2(e, 0.0)) - h0) / e, -(relief(p + vec2(0.0, e)) - h0) / e, face));
            n = normalize(vBx * nO.x + vBy * nO.y + vBz * nO.z);
          }
          float f2 = face * face;
          col = ${glPaint("#4c84d8")};
          col = mix(col, ${glPaint("#6c9de6")}, smoothstep(0.15, 0.19, s) * f2);
          col = mix(col, ${glPaint("#8fb6ee")}, 0.6 * rays(p) * smoothstep(0.17, 0.21, s) * step(P_HS, p.y) * f2);
          // a cream pinstripe round every panel
          col = mix(col, ${glPaint("#f5ecd9")}, f2 * (1.0 - smoothstep(0.007, 0.007 + fw * 1.5, abs(s + 0.065))));
          col = mix(col, ${glPaint("#f5ecd9")}, f2 * (1.0 - smoothstep(0.005, 0.005 + fw * 1.5, abs(p.y - 2.215))) * step(-P_A + 0.27, p.x) * step(p.x, -0.27));
          // brushed paint over the grain of the wood
          col *= 0.965 + 0.06 * vnoise(vec2(p.x * 38.0, p.y * 1.6));
          // dark in the bottom of each groove
          occ = 1.0 - 0.4 * f2 * (smoothstep(-0.005, 0.02, s) - smoothstep(0.03, 0.09, s));
          occ *= mix(0.72, 1.0, smoothstep(0.0, 0.6, p.y));
        #endif
        #ifdef SURROUND
          float u = vProf.x;
          float wu = vProf.z - vProf.x;
          float along = vProf.y;
          col = mix(${glPaint("#f5ecd9")}, ${glPaint("#f49680")}, smoothstep(0.265, 0.285, u));
          // painted wood: brush strokes along the boards, and the grain under them
          float grain = sin(u * 150.0 + vnoise(vec2(along * 0.35, u * 3.0)) * 10.0);
          float gfade = 1.0 - smoothstep(0.3, 1.0, fwidth(u * 150.0));
          col *= 0.965 + 0.05 * vnoise(vec2(along * 0.9, u * 26.0)) + 0.018 * grain * gfade;
          // a little wear on the proud edges, where the paint has rubbed back to pale wood
          float ridge = max(1.0 - smoothstep(0.0, 0.045, wu), 1.0 - smoothstep(0.012, 0.04, abs(u - 0.12)));
          float rub = smoothstep(0.52, 0.78, vnoise(vec2(along * 2.2, u * 5.0 + 3.0)) * 0.7 + vnoise(vec2(along * 9.0, u * 20.0)) * 0.3);
          col = mix(col, ${glPaint("#f4dcc4")}, ridge * rub * 0.85);
          // the crease at the foot of each moulding
          occ = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.035, abs(u - 0.3))) - 0.25 * (1.0 - smoothstep(0.0, 0.03, abs(wu - 0.41)));
          occ *= smoothstep(-0.3, 1.1, vOb.y);
          // Voussoirs: eleven stones over the arch and four up each leg, each a touch different
          // in tone, their joints V-grooves bevelled into the field and the outer moulding.
          vec2 o = vOb.xy - vec2(0.0, P_HS);
          float jd;
          vec2 away;
          vec2 stone;
          if (o.y > 0.0) {
            float phi = atan(o.y, o.x);
            float w = PI / 11.0;
            float k = (phi - PI * 0.5) / w + 0.5;
            float lk = fract(k);
            jd = min(lk, 1.0 - lk) * w * length(o);
            away = vec2(-sin(phi), cos(phi)) * (lk < 0.5 ? 1.0 : -1.0);
            stone = vec2(floor(k), 0.0);
          } else {
            float k = -o.y / 1.05;
            float lk = fract(k);
            jd = min(lk, 1.0 - lk) * 1.05;
            away = vec2(0.0, lk < 0.5 ? -1.0 : 1.0);
            stone = vec2(floor(k), sign(o.x));
          }
          float onField = smoothstep(0.29, 0.33, u) * smoothstep(-0.2, 0.3, vNo.z);
          float fj = fwidth(jd) + 1e-4;
          float slope = 0.8 * (1.0 - smoothstep(0.0, 0.075, jd)) * onField * (1.0 - smoothstep(0.02, 0.05, fj));
          n = normalize(n - vec3(away * slope, 0.0));
          col *= 0.955 + 0.09 * hash12(stone + 7.3) * onField;
          float joint = (1.0 - smoothstep(0.006, 0.006 + fj * 1.5, jd)) * onField;
          occ *= 1.0 - 0.5 * joint;
          // the raised moulding round the outside: its crown a paler coral, its foot in shade
          float crown = 1.0 - smoothstep(0.03, 0.09, abs(wu - 0.14));
          col = mix(col, ${glPaint("#f7b39c")}, 0.75 * crown * step(0.33, u));
          occ *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.05, abs(wu - 0.45))) * step(0.33, u);
          sun = doorSun(vW, false);
          extra = KEY * col * 0.45 * slope * smoothstep(0.6, 0.95, dot(n, SUN));
        #endif
        #ifdef PLINTH
          if (dot(n, cameraPosition - vW) < 0.0) n = -n;
          float r = length(vW.xz);
          float y = vW.y - ${HERO_Y.toFixed(4)};
          // the inlay lies on the drum's top and on the tier's tread, not on the turned edges
          float top = smoothstep(0.96, 0.995, n.y) * (r < 5.9 ? step(0.295, y) : step(6.05, r) * step(r, 7.86));
          vec4 t0 = inlay(vW.xz);
          col = t0.rgb;
          // past a few pixels a joint is finer than the screen: it fades to the tile's own colour
          float fr = fwidth(r) + 1e-4;
          float near = (1.0 - smoothstep(0.008, 0.035, fr)) * top;
          float fw = fwidth(t0.w) + 1e-4;
          float grout = (1.0 - smoothstep(0.016 - fw, 0.016 + fw, t0.w)) * near;
          // each tile is glazed, its edges rounded down into the joint
          // (only near a joint: out on the glaze the tile is flat, and the two extra looks are saved)
          if (near > 0.0 && t0.w < 0.07) {
            float e = 0.008;
            float h0 = bevelH(t0.w);
            vec2 g = vec2(bevelH(inlay(vW.xz + vec2(e, 0.0)).w) - h0, bevelH(inlay(vW.xz + vec2(0.0, e)).w) - h0) / e;
            g = clamp(g, -1.6, 1.6) * near;
            n = normalize(n + vec3(-g.x, 0.0, -g.y) * 0.5 * top);
          }
          col = mix(col, ${glPaint("#dccab0")}, grout);
          // a little cloud in the glaze, and the odd speck
          col *= 0.975 + 0.05 * vnoise(vW.xz * 2.3) * top;
          if (top < 0.5) col = r < 6.05 ? ${glPaint("#f3e6cc")} : ${glPaint("#a2dcbf")};
          // shade in the quirk under each bull-nose and where the drum stands on the tier
          occ = 1.0;
          if (top < 0.5) {
            occ *= r < 6.05 ? mix(0.4, 1.0, smoothstep(0.115, 0.2, y)) : mix(0.5, 1.0, smoothstep(-0.2, 0.06, y));
            occ *= mix(0.6, 1.0, smoothstep(-0.25, 0.4, n.y + 0.2));
          } else if (r > 6.0) {
            occ *= mix(0.7, 1.0, smoothstep(0.0, 0.35, r - 6.05));
          }
          occ *= 1.0 - 0.35 * grout;
          occ *= doorContact(vW);
          sun = doorSun(vW, true);
          // the glaze catches the sun on the rounded edges of the tiles turned to us
          vec3 v = normalize(cameraPosition - vW);
          extra = KEY * 0.32 * pow(max(dot(n, normalize(v + SUN)), 0.0), 18.0) * near * (1.0 - grout);
        #endif
        #ifdef BRASS
          col = ${glPaint("#e8b84a")};
          vec3 v = normalize(cameraPosition - vW);
          extra = KEY * pow(max(dot(n, normalize(v + SUN)), 0.0), 60.0) * 1.6 + ${glScreen("#f4ead0")} * 0.25 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
        #endif
        vec3 lit = propLight(col, n, sun * occ) * mix(0.62, 1.0, occ) + extra * sun;
        gl_FragColor = vec4(applyFog(lit, length(cameraPosition - vW)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * The coral surround: a moulding profile swept along the opening's edge, up one leg, over the arch
 * and down the other. The profile runs from the inner reveal (a cream bead) across a flat field to
 * an ogee on the outer edge; the outer edge follows the stele's own outline, so the band is wider
 * over the top than at the sides. `aProf` is (distance from the opening, length along it, width).
 */
function surroundGeometry() {
  const outer = (phi: number) => {
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    if (Math.abs(c) > 1e-6) {
      const d = ST_A / Math.abs(c);
      if (P_HS + d * s <= ST_HS) return d;
    }
    const oy = P_HS - ST_HS;
    const b = oy * s;
    return -b + Math.sqrt(b * b - oy * oy + ST_A * ST_A);
  };
  const path: { x: number; y: number; nx: number; ny: number; w: number }[] = [];
  const LEG = 8;
  for (let i = 0; i < LEG; i++) path.push({ x: P_A, y: -1 + ((P_HS + 1) * i) / LEG, nx: 1, ny: 0, w: ST_A - P_A });
  const ARC = 120;
  for (let i = 0; i <= ARC; i++) {
    const phi = (Math.PI * i) / ARC;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    path.push({ x: P_A * c, y: P_HS + P_A * s, nx: c, ny: s, w: outer(phi) - P_A });
  }
  for (let i = LEG - 1; i >= 0; i--) path.push({ x: -P_A, y: -1 + ((P_HS + 1) * i) / LEG, nx: -1, ny: 0, w: ST_A - P_A });
  // (distance across, height in z, measured from the outer edge); repeated points make a crisp edge
  const PROF: [number, number, number][] = [
    [0, -0.09, 0], [0, 0.1, 0], [0, 0.1, 0],
    [0.02, 0.165, 0], [0.06, 0.205, 0], [0.12, 0.225, 0], [0.18, 0.212, 0], [0.225, 0.175, 0], [0.25, 0.13, 0], [0.25, 0.13, 0],
    [0.29, 0.12, 0], [0.31, 0.105, 0], [0.34, 0.08, 0], [0.39, 0.065, 0], [0.45, 0.06, 0],
    [0.48, 0.06, 1], [0.44, 0.07, 1], [0.42, 0.1, 1], [0.42, 0.1, 1], [0.4, 0.105, 1], [0.35, 0.125, 1], [0.3, 0.16, 1], [0.25, 0.2, 1],
    [0.2, 0.222, 1], [0.14, 0.235, 1], [0.08, 0.243, 1], [0.035, 0.24, 1], [0.01, 0.22, 1], [0, 0.18, 1], [0, 0.18, 1], [0, -0.09, 1],
  ];
  const pos: number[] = [];
  const prof: number[] = [];
  let along = 0;
  path.forEach((q, i) => {
    if (i > 0) along += Math.hypot(q.x - path[i - 1]!.x, q.y - path[i - 1]!.y);
    for (const [pu, pz, fromOuter] of PROF) {
      const u = fromOuter ? q.w - pu : pu;
      pos.push(q.x + q.nx * u, q.y + q.ny * u, pz);
      prof.push(u, along, q.w);
    }
  });
  const M = PROF.length;
  const index: number[] = [];
  for (let i = 0; i < path.length - 1; i++)
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j;
      const b = a + 1;
      const c = a + M;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aProf", new BufferAttribute(new Float32Array(prof), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * The plinth, turned: a cream drum whose edge is a bull-nose over a shadowed quirk, a narrow cream
 * step with a smaller bull-nose of its own, then a broad mint tier, rounded too, that sinks into
 * the sand. Points repeated at a quirk keep its crease crisp.
 */
function plinthGeometry() {
  const P: [number, number][] = [[0, 0.3]];
  const nose = (cx: number, cy: number, rad: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 - (Math.PI * i) / n;
      P.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
  };
  P.push([5.9, 0.3]);
  nose(5.9, 0.215, 0.085, 14);
  // the quirk under the nose, then the step: its tread sits under the drum's nose, in its shade
  P.push([5.855, 0.128], [5.855, 0.128], [5.855, 0.112], [5.855, 0.112], [6.0, 0.112]);
  nose(6.0, 0.08, 0.032, 8);
  P.push([6.0, 0.048], [5.985, 0.046], [5.985, 0.046], [5.985, 0.04], [5.985, 0.04], [6.08, 0.04]);
  // the tier
  P.push([7.8, 0.04]);
  nose(7.8, 0.0, 0.04, 8);
  P.push([7.8, -0.04], [7.95, -0.06], [8.25, -0.6]);
  return new LatheGeometry(P.map(([r, y]) => new Vector2(r, y)), 240);
}

/** the brass on one leaf (in its space: hinge at x = 0, the leaf towards -x): three hinges and a knob on each face */
function hardwareGeometry() {
  const parts: BufferGeometry[] = [];
  const FRONT = 0.07;
  const BACK = -0.02;
  const knob = [
    [0, 0], [0.1, 0], [0.1, 0.012], [0.088, 0.022], [0.035, 0.03], [0.024, 0.045], [0.024, 0.07], [0.045, 0.082],
    [0.08, 0.105], [0.092, 0.13], [0.086, 0.155], [0.065, 0.175], [0.035, 0.186], [0, 0.19],
  ].map(([r, y]) => new Vector2(r, y));
  for (const [z, turn] of [[FRONT, Math.PI / 2], [BACK, -Math.PI / 2]] as const) {
    const k = new LatheGeometry(knob, 28);
    k.rotateX(turn);
    k.translate(-P_A + 0.3, 2.215, z);
    parts.push(k);
    for (const y of [0.6, 1.75, 2.9]) {
      const strap = new BoxGeometry(0.62, 0.095, 0.014);
      strap.translate(-0.31, y, z + Math.sign(z - 0.025) * 0.007);
      const end = new CylinderGeometry(0.075, 0.075, 0.014, 24);
      end.rotateX(Math.PI / 2);
      end.translate(-0.62, y, z + Math.sign(z - 0.025) * 0.007);
      parts.push(strap, end);
    }
  }
  for (const y of [0.6, 1.75, 2.9]) {
    const barrel = new CylinderGeometry(0.048, 0.048, 0.34, 18);
    barrel.translate(0, y, 0.025);
    const cap = new SphereGeometry(0.05, 14, 8);
    cap.translate(0, y + 0.19, 0.025);
    parts.push(barrel, cap);
  }
  for (const p of parts) if (p.index === null) throw new Error("hardware parts must be indexed");
  // mergeGeometries needs the same attributes on every part
  const merged = mergeGeometries(parts.map((p) => {
    p.deleteAttribute("uv");
    return p;
  }));
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * The keystone over the arch, with relief: a raised, bevelled coral panel on its face, and on that
 * a turned cream boss. The panel is apart so that it can take its own paint.
 */
function keystoneGeometry() {
  const y0 = P_HS + P_A - 0.1;
  const y1 = ST_HS + ST_A - 0.08;
  // its sides run towards the arch's centre, as a real keystone's do
  const spread = (y: number) => 0.3 * ((y - P_HS) / (y0 - P_HS));
  const trapezoid = (ya: number, yb: number, k: number) => {
    const t = new Shape();
    t.moveTo(-spread(ya) * k, ya);
    t.lineTo(spread(ya) * k, ya);
    t.lineTo(spread(yb) * k, yb);
    t.lineTo(-spread(yb) * k, yb);
    t.lineTo(-spread(ya) * k, ya);
    return t;
  };
  const body = new ExtrudeGeometry(trapezoid(y0, y1, 1), { depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 });
  body.translate(0, 0, 0.04);
  const FACE = 0.04 + 0.16 + 0.06;
  const panel = new ExtrudeGeometry(trapezoid(y0 + 0.22, y1 - 0.24, 0.62), {
    depth: 0.03,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    bevelSegments: 3,
  });
  panel.translate(0, 0, FACE - 0.03);
  const boss = new LatheGeometry(
    [[0, 0.1], [0.05, 0.098], [0.1, 0.085], [0.135, 0.06], [0.15, 0.04], [0.16, 0.035], [0.18, 0.02], [0.19, 0.0]].map(([r, y]) => new Vector2(r, y)),
    32,
  ).toNonIndexed();
  boss.rotateX(Math.PI / 2);
  boss.translate(0, y0 + 0.78, FACE + 0.03);
  for (const p of [body, boss]) p.deleteAttribute("uv");
  const stone = mergeGeometries([body, boss]);
  body.dispose();
  boss.dispose();
  return { stone, panel };
}

function makeSkyMaterial() {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        // Blue and peach are opposites, and anywhere they are mixed is grey. So the sky goes from
        // one to the other by way of a bright cream and a pale aqua, as a real evening sky does.
        vec3 col = mix(${gl3(HORIZON.toArray())}, ${glScreen("#f8d7b8")}, smoothstep(0.0, 0.05, y));
        col = mix(col, ${glScreen("#f3e9d6")}, smoothstep(0.03, 0.09, y));
        col = mix(col, ${glScreen("#bfe1ef")}, smoothstep(0.07, 0.16, y));
        col = mix(col, ${glScreen("#84bff0")}, smoothstep(0.13, 0.32, y));
        col = mix(col, ${glScreen("#4a8fe4")}, smoothstep(0.28, 0.9, y));
        float s = max(dot(d, sun), 0.0);
        col += vec3(1.0, 0.86, 0.66) * (0.14 * pow(s, 8.0) + 0.4 * pow(s, 70.0));
        col = mix(col, vec3(8.0, 7.6, 6.4), smoothstep(0.9982, 0.9987, s));
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
  const contacts = useRef<InstancedMesh>(null);
  const tints = useRef<InstancedMesh>(null);

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
    const hutShell = new SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const hutCap = new SphereGeometry(1, 16, 10);

    // hero stele: a thin back, the moulded surround and its keystone, the portal and two leaves
    const steleBack = new ExtrudeGeometry(archPath(new Shape(), ST_A - 0.03, ST_HS, -1), {
      depth: 0.04,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 2,
      curveSegments: 36,
    });
    steleBack.translate(0, 0, -0.13);
    const surround = surroundGeometry();
    const { stone: keystone, panel: keyPanel } = keystoneGeometry();
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
      curveSegments: 40,
    });
    const hardware = hardwareGeometry();
    const plinth = plinthGeometry();

    const disc = new CylinderGeometry(1, 1.06, 1, 48);
    disc.translate(0, 0.5, 0);
    const trunk = new CylinderGeometry(0.05, 0.09, 1, 6);
    trunk.translate(0, 0.5, 0);
    const ball = new SphereGeometry(1, 14, 9);
    const contact = new PlaneGeometry(1, 1);
    contact.rotateX(-Math.PI / 2);
    const bigBall = new SphereGeometry(1, 32, 16);
    const loop = new TorusGeometry(1, 0.11, 10, 40, Math.PI);
    const sky = new SphereGeometry(900, 32, 20);
    return {
      terrain,
      frame,
      opening,
      hutShell,
      hutCap,
      steleBack,
      surround,
      keystone,
      keyPanel,
      portal,
      leaf,
      hardware,
      plinth,
      disc,
      trunk,
      ball,
      contact,
      bigBall,
      loop,
      sky,
    } satisfies Record<string, BufferGeometry>;
  }, []);

  // the still shadows on the sand, baked in the layout effect below
  const shadowMap = useMemo(() => {
    const tex = new DataTexture(new Uint8Array(SH_N * SH_N), SH_N, SH_N, RedFormat, UnsignedByteType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    return tex;
  }, []);
  useEffect(() => () => shadowMap.dispose(), [shadowMap]);

  const mat = useMemo(() => {
    const open = { value: 0 };
    const track = cam.curve.getSpacedPoints(240);
    /** `c` is the colour on screen of its sunny side; "#ffffff" leaves the albedo to the instance colours */
    const lambert = (c: string, key: string, glsl = "", ao = "1.0") =>
      sunlit(new MeshLambertMaterial({ color: c === "#ffffff" ? c : painted(c) }), key, glsl, ao);
    const FRAME_AO = "smoothstep(-0.3, 1.1, vOb.y)";
    return {
      terrain: makeTerrainMaterial(shadowMap),
      open,
      leaf: makeDoorMaterial("LEAF", open),
      surround: makeDoorMaterial("SURROUND", open),
      plinth: makeDoorMaterial("PLINTH", open),
      brass: makeDoorMaterial("BRASS", open),
      sky: makeSkyMaterial(),
      frames: FRAME_COLORS.map((c) => lambert(c, "frame", "", FRAME_AO)),
      paper: FRAME_COLORS.map((c) => lambert(c, "paper", PAPER, FRAME_AO)),
      huts: HUT_COLORS.map((c) => lambert(c, "hut", "", "smoothstep(-0.37, 0.2, vOb.y)")),
      interiors: DOORS.map((d, i) => makeInteriorMaterial(d.pal, ROOMS[i]!, mulberry32(907 + i * 31)(), aimOf(d, track))),
      steleBack: lambert("#f4b49c", "frame", "", FRAME_AO),
      trim: lambert("#f5e0cc", "plain"),
      keyPanel: lambert("#f5a68c", "plain"),
      // the underside of a crown is in its own shade
      crown: lambert("#ffffff", "crown", PATTERNS.crown, "smoothstep(-1.1, 0.15, vOb.y)"),
      dome: lambert("#ffffff", "dome", PATTERNS.dome, "smoothstep(0.1, 0.55, vOb.y)"),
      // a hoop is dark at its feet and all along its underside, the inner half of the tube
      loop: Object.assign(lambert("#ffffff", "loop", PATTERNS.loop, "smoothstep(0.0, 0.4, vOb.y) * smoothstep(0.93, 1.05, length(vOb.xy))"), {
        defines: { USE_UV: "" },
      }),
      stone: lambert("#ffffff", "stone", PATTERNS.stone),
      trunk: lambert("#b98a94", "trunk", "", "smoothstep(0.0, 0.3, vOb.y)"),
      contact: makeShadowMaterial("CONTACT"),
      tint: makeShadowMaterial("TINT"),
      cloud: sunlit(new MeshLambertMaterial({ color: "#ffffff", emissive: "#8f96ad", fog: false }), "cloud"),
    };
  }, [cam]);

  const garden = useMemo(() => {
    const pathPts = cam.curve.getPoints(80);
    return createGarden({
      ground,
      clear: clearOf(pathPts),
      path: pathPts,
      track: cam.curve.getSpacedPoints(300),
      blocked: flowerBlocked,
      rnd: mulberry32(4711),
      fogGlsl: FOG_GLSL,
      sun: SUN_DIR,
      groundGlsl: GROUND_GLSL,
      shadowMaterial: (vs) => makeShadowMaterial("CAST", vs),
      contactMaterial: (vs) => makeShadowMaterial("CONTACT", vs),
    });
  }, [cam]);
  useEffect(() => () => garden.dispose(), [garden]);

  // scattered, instanced dressing
  useLayoutEffect(() => {
    const rnd = mulberry32(20251);
    const o = new Object3D();
    const c = new Color();
    const zero = new Matrix4().makeScale(0, 0, 0);
    const casters: Caster[] = [];
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
    const crownCols = ["#7fd2b6", "#a6e0c4", "#f6ae90", "#f2a0b6", "#98c6f0", "#f3e4c4", "#b49eea"].map((h) => paint(h));
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
      casters.push(capsuleCaster(x, y - 0.1, z, x, y + hgt, z, 0.07 * (1 + hgt * 0.25)));
      o.position.set(x, y + hgt + cr * squash * 0.55, z);
      o.scale.set(cr, cr * squash, cr);
      o.updateMatrix();
      K.setMatrixAt(n, o.matrix);
      K.setColorAt(n, c.setRGB(...crownCols[ci]!));
      casters.push(ellipsoidCaster(x, y + hgt + cr * squash * 0.55, z, cr, cr * squash, cr));
      contact(x + SUN_DIR.x * -0.15, z - SUN_DIR.z * 0.15, 0.35 + hgt * 0.09, 0.35 + hgt * 0.09, 0, 0.8);
      n++;
    }
    // every doorway's band, and the domes of the huts
    for (const d of DOORS) {
      const gy = ground(d.x, d.z);
      casters.push(archCaster(d.x, gy, d.z, Math.atan2(d.fx, d.fz), d.scale, D_A, D_HS, 0.42));
      if (!d.hut) continue;
      const dw = D_A * d.scale;
      const l = Math.hypot(d.fx, d.fz);
      const hx = d.x - (d.fx / l) * dw * 2.05;
      const hz = d.z - (d.fz / l) * dw * 2.05;
      casters.push(ellipsoidCaster(hx, gy - 0.1, hz, dw * 2.3, dw * 2.9, dw * 2.3));
      casters.push(ellipsoidCaster(hx, gy - 0.1 + dw * 2.9, hz, dw * 0.3, dw * 0.3, dw * 0.3));
      contact(hx, hz, dw * 2.75, dw * 2.75, 0, 0.75);
    }
    // the stele, standing on its plinth
    casters.push(archCaster(0, DOOR_Y, 0, 0, 1, ST_A, ST_HS, 0));
    // every doorway darkens the sand along its foot, and the stele's plinth sits in a pool
    for (const d of DOORS) {
      const w = (D_A + 0.42) * d.scale;
      contact(d.x, d.z, w * 1.25, 0.9 * d.scale + 0.3, Math.atan2(d.fx, d.fz), 0.7);
    }
    contact(0, 0, 9.4, 9.4, 0, 0.75);
    T.instanceMatrix.needsUpdate = true;
    K.instanceMatrix.needsUpdate = true;
    if (K.instanceColor) K.instanceColor.needsUpdate = true;

    // big half-buried pavilion domes
    const domeCols = ["#f3e6cc", "#f6b598", "#a2dcbf", "#a6cbee", "#f3d27c", "#f0a2b8"].map((h) => paint(h));
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
      Dm.setColorAt(n, c.setRGB(...domeCols[ci]!));
      casters.push(ellipsoidCaster(x, ground(x, z) - s * 0.25, z, s, s * tall, s));
      contact(x, z, s * 1.22, s * 1.22, 0, 0.6);
      n++;
    }
    Dm.instanceMatrix.needsUpdate = true;
    if (Dm.instanceColor) Dm.instanceColor.needsUpdate = true;

    // bulbous hoops leaping over the dunes
    const loopCols = ["#f3e6cc", "#f6b598", "#a2dcbf", "#f3d27c", "#a6cbee"].map((h) => paint(h));
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
      const tall = 0.8 + rnd() * 0.7;
      o.scale.set(s, s * tall, s * fat);
      o.updateMatrix();
      L.setMatrixAt(n, o.matrix);
      L.setColorAt(n, c.setRGB(...loopCols[ci]!));
      casters.push(hoopCaster(x, ground(x, z) - s * 0.12, z, rot, s, s * tall, s * fat, 0.11));
      // both feet
      for (const side of [-1, 1]) contact(x + Math.cos(rot) * s * side, z - Math.sin(rot) * s * side, 0.5 * s * 0.22 * fat + 0.5, 0.5 * s * 0.22 * fat + 0.5, rot, 0.7);
      n++;
    }
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
    const stoneCols = ["#a2dcbf", "#f3e6cc", "#f6b598"].map((h) => paint(h));
    for (let i = 0; i < St.count; i++) {
      const { x, z } = stoneAt(i);
      const s = 0.55 + rnd() * 0.3;
      o.position.set(x, ground(x, z) - 0.04, z);
      o.rotation.set(0, 0, 0);
      o.scale.set(s, 0.16, s);
      o.updateMatrix();
      St.setMatrixAt(i, o.matrix);
      St.setColorAt(i, c.setRGB(...stoneCols[i % 3]!));
      // each disc sits in a soft pool, thrown a little away from the sun
      contact(x - SUN_DIR.x * 0.3 * s, z - SUN_DIR.z * 0.3 * s, s * 1.7, s * 1.7, 0, 1.0);
    }
    St.instanceMatrix.needsUpdate = true;
    if (St.instanceColor) St.instanceColor.needsUpdate = true;

    // the garden's flower drifts and pinwheel stalks
    const Tn = tints.current!;
    garden.drifts.slice(0, Tn.count).forEach((f, i) => {
      contact(f.x - SUN_DIR.x * 0.3, f.z - SUN_DIR.z * 0.3, f.r * 1.1, f.r * 1.1, 0, 0.2);
      // the sand under a drift is stained with its colour
      tilt.setFromUnitVectors(up, groundNormal(f.x, f.z, _n));
      o.position.set(f.x, ground(f.x, f.z) + 0.04, f.z);
      o.quaternion.copy(tilt);
      o.scale.set(f.r * 2.6, 0.3, f.r * 2.6);
      o.updateMatrix();
      Tn.setMatrixAt(i, o.matrix);
      const top = Math.max(...f.hue);
      Tn.setColorAt(i, c.setRGB(f.hue[0] / top, f.hue[1] / top, f.hue[2] / top).lerp(WHITE, 0.35));
    });
    for (let i = garden.drifts.length; i < Tn.count; i++) Tn.setMatrixAt(i, zero);
    Tn.instanceMatrix.needsUpdate = true;
    if (Tn.instanceColor) Tn.instanceColor.needsUpdate = true;
    for (const p of garden.pinwheels) {
      contact(p.x, p.z, 0.3 * p.size + 0.15, 0.3 * p.size + 0.15, 0, 0.8);
      casters.push(capsuleCaster(p.x, ground(p.x, p.z), p.z, p.x, p.top, p.z, 0.045 * p.size));
    }
    for (let i = nc; i < CT.count; i++) CT.setMatrixAt(i, zero);
    CT.instanceMatrix.needsUpdate = true;

    const t0 = performance.now();
    bakeShadows(casters, shadowMap.image.data as Uint8Array);
    shadowMap.needsUpdate = true;
    if (import.meta.env.DEV) console.debug(`dollhouse: baked ${casters.length} shadows in ${(performance.now() - t0).toFixed(0)} ms`);
  }, [cam, garden, shadowMap]);

  useFrame(() => {
    const t = Math.min(25, Math.max(0, clock.t));
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
    // once the camera is placed, rolled and zoomed: the flowers drawn are those in its picture
    garden.update(t, camera);
    // double doors swing open towards us
    const k = smoothstep(13.2, 18.5, t);
    const open = k * 1.95;
    mat.open.value = open;
    if (leafR.current) leafR.current.rotation.y = open;
    if (leafL.current) leafL.current.rotation.y = -open;
  });

  return (
    <>
      <color attach="background" args={[HORIZON]} />
      <fog attach="fog" args={[HORIZON, FOG_NEAR, FOG_FAR]} />

      <mesh geometry={geo.sky} material={mat.sky} frustumCulled={false} renderOrder={-10} />
      <mesh geometry={geo.terrain} material={mat.terrain} />

      {/* paper-thin doorways and tiny huts, each with a vast room inside */}
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
                <mesh geometry={geo.frame} material={mat.paper[(d.frame + 1) % 4]} scale={[d.scale, d.scale, d.scale * 2.2]} />
              </>
            ) : (
              <>
                <mesh geometry={geo.frame} material={mat.paper[d.frame]} scale={d.scale} />
              </>
            )}
            <mesh geometry={geo.opening} material={mat.interiors[i]} scale={d.scale} position={[0, 0, d.hut ? 0.02 : 0]} />
          </group>
        );
      })}


      {/* the stele: the real way out */}
      <group position={[0, HERO_Y, 0]}>
        <mesh geometry={geo.plinth} material={mat.plinth} />
        <group position={[0, PLINTH, 0]}>
          <mesh geometry={geo.steleBack} material={mat.steleBack} />
          <mesh geometry={geo.surround} material={mat.surround} />
          <mesh geometry={geo.keystone} material={mat.trim} />
          <mesh geometry={geo.keyPanel} material={mat.keyPanel} />
          <mesh geometry={geo.portal} material={portalMaterial} position={[0, 0, -0.02]} />
          <group ref={leafR} position={[P_A, 0, 0.1]}>
            <mesh geometry={geo.leaf} material={mat.leaf} />
            <mesh geometry={geo.hardware} material={mat.brass} />
          </group>
          <group ref={leafL} position={[-P_A, 0, 0.1]}>
            <group scale={[-1, 1, 1]}>
              <mesh geometry={geo.leaf} material={mat.leaf} />
              <mesh geometry={geo.hardware} material={mat.brass} />
            </group>
          </group>
        </group>
      </group>

      <instancedMesh ref={trunks} args={[geo.trunk, mat.trunk, TREES]} frustumCulled={false} />
      <instancedMesh ref={crowns} args={[geo.ball, mat.crown, TREES]} frustumCulled={false} />
      <instancedMesh ref={contacts} args={[geo.contact, mat.contact, CONTACTS]} frustumCulled={false} />
      <instancedMesh ref={tints} args={[geo.contact, mat.tint, TINTS]} frustumCulled={false} />
      <instancedMesh ref={domes} args={[geo.bigBall, mat.dome, 22]} frustumCulled={false} />
      <instancedMesh ref={loops} args={[geo.loop, mat.loop, 16]} frustumCulled={false} />
      <instancedMesh ref={clouds} args={[geo.ball, mat.cloud, 48]} frustumCulled={false} />
      <instancedMesh ref={stones} args={[geo.disc, mat.stone, STONES]} frustumCulled={false} />
      <primitive object={garden.root} />
    </>
  );
}
