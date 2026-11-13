import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, ShaderMaterial, Vector2, Vector3, type Group, type Mesh } from "three";
import { TIMING, type SceneProps } from "./types";
import { createFrame, season } from "./rail";
import { HOOP, buildWorld } from "./burrow/build";
import { FOV, aim } from "./burrow/camera";
import { buildCreatures } from "./burrow/creatures";
import {
  FOG_COLOR,
  createChamberMaterial,
  createCorridorMaterial,
  createGlowMaterial,
  createHaloMaterial,
  createMoteMaterial,
  createShared,
  createTrimMaterial,
  type Shared,
} from "./burrow/materials";

/**
 * BURROW — the Win95 maze regrown without a single straight wall.
 *
 * A glowing thread leads the camera through ribbed, winding corridors and round junction chambers
 * whose other doorways curl away into coloured haze. The last chamber is a dead end holding only a
 * slowly revolving hoop, a band a hand's width thick: the way out.
 *
 * The camera is the rail's (./rail.ts). The world is placed round what that camera sees
 * (./burrow/build.ts), and all the scene adds to the ride is a glance to one side while the camera
 * has the track to itself (./burrow/camera.ts).
 */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// the hoop
// ---------------------------------------------------------------------------------------------
//
// A pearl band, lit from inside: seen square-on its middle is pale and both its edges run hot mint,
// which is what makes it a rounded thing. A row of mint bulbs is set in each face and a wave of light
// travels round them. It turns on two pins inside a pair of gold gimbal rings, each with a thread
// of light let into its broad faces, that turn against each other and settle into the hoop's plane as
// the camera arrives. Deep it is not: a hand's width, far too little to hold anything.

const TAU = Math.PI * 2;

/** the band's section: half its width in the hoop's plane, half its depth */
const BAND = { a: 0.115, b: 0.075 } as const;
/** the ellipse the band's middle runs on; its inner edge just covers the rim of the picture */
const BAND_RX = HOOP.rx + BAND.a - 0.012;
const BAND_RY = HOOP.ry + BAND.a - 0.012;
/** bulbs in each face */
const BULBS = 36;
const BULB_R = 0.056;
/** gimbal rings: radius, and a section that is a slim band standing on its edge */
const GIMBAL = { inner: 2.4, outer: 2.53, a: 0.04, b: 0.095 } as const;

/**
 * A closed band: a section (half-width `a` in the ring's plane, half-depth `b`; exponent 1 is an
 * ellipse, lower is squarer) swept round the ellipse (ax, ay) in the XY plane. `pat` is the way
 * round the ring and the way round the section from its outer edge, both 0 .. 1.
 */
function ringBand(ax: number, ay: number, a: number, b: number, e: number, cols: number, rows: number): BufferGeometry {
  const n = (cols + 1) * (rows + 1);
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const pat = new Float32Array(n * 2);
  let o = 0;
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const c = Math.cos(u * TAU);
    const s = Math.sin(u * TAU);
    const nl = Math.hypot(ay * c, ax * s);
    const nx = (ay * c) / nl;
    const ny = (ax * s) / nl;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const ct = Math.cos(v * TAU);
      const st = Math.sin(v * TAU);
      const x = a * Math.sign(ct) * Math.abs(ct) ** e;
      const z = b * Math.sign(st) * Math.abs(st) ** e;
      const mx = b * ct * Math.abs(ct) ** (1 - e);
      const mz = a * st * Math.abs(st) ** (1 - e);
      const ml = Math.hypot(mx, mz);
      position.set([ax * c + nx * x, ay * s + ny * x, z], o * 3);
      normal.set([(nx * mx) / ml, (ny * mx) / ml, mz / ml], o * 3);
      pat.set([u, v], o * 2);
      o++;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const p = i * (rows + 1) + j;
      const r = p + rows + 1;
      index.push(p, r, p + 1, r, r + 1, p + 1);
    }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setIndex(index);
  return geo;
}

/** the bulbs: a row of little domes in each face of the band, evenly spaced along it. pat.x is the way round. */
function bulbRow(): BufferGeometry {
  // angles at equal steps of arc round the ellipse
  const steps = 1440;
  const arc = [0];
  for (let i = 1; i <= steps; i++) {
    const a0 = ((i - 1) / steps) * TAU;
    const a1 = (i / steps) * TAU;
    arc.push(arc[i - 1]! + Math.hypot(BAND_RX * (Math.cos(a1) - Math.cos(a0)), BAND_RY * (Math.sin(a1) - Math.sin(a0))));
  }
  const lat = 8;
  const lon = 18;
  const position: number[] = [];
  const normal: number[] = [];
  const pat: number[] = [];
  const index: number[] = [];
  let at = 0;
  for (let k = 0; k < BULBS; k++) {
    const want = ((k + 0.5) / BULBS) * arc[steps]!;
    while (arc[at + 1]! < want) at++;
    const ang = ((at + (want - arc[at]!) / (arc[at + 1]! - arc[at]!)) / steps) * TAU;
    for (const face of [1, -1]) {
      const base = position.length / 3;
      // the upper part of a ball, seated in the face
      for (let i = 0; i <= lat; i++) {
        const v = (i / lat) * Math.PI * 0.62;
        for (let j = 0; j <= lon; j++) {
          const w = (j / lon) * TAU * face;
          const nx = Math.sin(v) * Math.cos(w);
          const ny = Math.sin(v) * Math.sin(w);
          const nz = Math.cos(v) * face;
          position.push(BAND_RX * Math.cos(ang) + nx * BULB_R, BAND_RY * Math.sin(ang) + ny * BULB_R, face * (BAND.b - 0.4 * BULB_R) + nz * BULB_R);
          normal.push(nx, ny, nz);
          pat.push((k + 0.5) / BULBS, 0);
        }
      }
      for (let i = 0; i < lat; i++)
        for (let j = 0; j < lon; j++) {
          const p = base + i * (lon + 1) + j;
          const r = p + lon + 1;
          index.push(p, r, p + 1, r, r + 1, p + 1);
        }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(normal), 3));
  geo.setAttribute("pat", new BufferAttribute(new Float32Array(pat), 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Shared by everything on the hoop. `vSec` is where a point is round a band's section (x: 1 on the
 * outer edge, -1 on the inner; y: 1 and -1 on the two faces), and `vWave` is the light that travels
 * round the hoop at that point of it: three arcs, once round in eight seconds.
 */
const HOOP_VERT = /* glsl */ `
  attribute vec2 pat;
  uniform float uTime;
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vPat;
  varying vec2 vSec;
  varying float vWave;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = mat3(modelMatrix) * normal;
    vPat = pat;
    vSec = vec2(cos(6.2831853 * pat.y), sin(6.2831853 * pat.y));
    float wave = 0.5 + 0.5 * sin(pat.x * 18.849556 - uTime * 2.4);
    vWave = wave * wave * wave;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const HOOP_FOG = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogD;
  float fogAmount(float d) { float x = d * uFogD; return 1.0 - exp(-x * x); }
`;

/**
 * The band. Pearl that is lit from inside: pale where it faces the eye, hot mint where it turns away,
 * with a soap film's rose and mint sliding over it in between. A thread of light is let into its
 * outer edge, and a fine line is engraved either side of the bulbs.
 */
function createBandMaterial(shared: Shared) {
  return new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: HOOP_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${HOOP_FOG}
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vPat;
      varying vec2 vSec;
      varying float vWave;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        float ndv = abs(dot(n, V));
        float f = 1.0 - ndv;
        float far = smoothstep(3.0, 9.0, dist);
        float ct = vSec.x;
        float st = vSec.y;

        // rose pearl, and the film on it
        float film = 0.5 + 0.5 * cos(6.2831853 * (1.15 * f + 2.0 * vPat.x) + 0.6 * uTime);
        vec3 col = vec3(0.84, 0.6, 0.68);
        col = mix(col, mix(vec3(1.25, 0.55, 0.85), vec3(0.4, 1.25, 1.0), film), 0.5 * smoothstep(0.05, 0.6, f));
        // the bulbs sit in a shallow channel of mint glass between two engraved lines; the wave of
        // light that travels round them runs through it
        float aa = fwidth(ct);
        float face = step(0.3, abs(st));
        float chan = (1.0 - smoothstep(0.5, 0.5 + aa + 0.03, abs(ct))) * face;
        float line = (1.0 - smoothstep(0.03, 0.03 + aa + 0.02, abs(abs(ct) - 0.56))) * face;
        col = mix(col, vec3(0.02, 0.38, 0.28) * (0.75 + 0.9 * vWave) * (0.6 + 0.4 * ndv), 0.9 * chan);
        col *= 1.0 - 0.55 * line;
        // the lantern's glint on the part that faces it
        float s2 = ndv * ndv, s8 = s2 * s2 * s2 * s2, s32 = s8 * s8 * s8 * s8;
        col += vec3(1.0, 0.85, 0.9) * s32 * s32 * 0.35;
        // From across the dome it is a light, and everything on it is over-bright; at the lens the
        // eye has adjusted to it, and it keeps its colours.
        col *= 1.0 + 1.5 * far;
        // lit from inside: the edges of the band, where it turns from the eye, run hot
        col = mix(col, vec3(0.8, 3.8, 2.9) * (0.55 + 0.45 * far), f * f);
        // a thread of light let into the outer edge, and the daylight that catches the inner one
        col = mix(col, vec3(0.5, 4.2, 3.0) * (0.45 + 0.55 * far), smoothstep(0.95, 0.985, ct));
        col += vec3(1.2, 0.9, 0.6) * smoothstep(-0.75, -1.0, ct) * 0.5;

        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * The bulbs: beads of mint glass lit from inside, brightest where they face the eye, and brighter as
 * the travelling light passes through them.
 */
function createBulbMaterial(shared: Shared) {
  return new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: HOOP_VERT,
    fragmentShader: /* glsl */ `
      ${HOOP_FOG}
      varying vec3 vW;
      varying vec3 vN;
      varying float vWave;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        float ndv = abs(dot(normalize(vN), V));
        float lit = 0.6 + 1.3 * vWave;
        float s2 = ndv * ndv, s8 = s2 * s2 * s2 * s2;
        vec3 col = mix(vec3(0.02, 0.5, 0.36), vec3(0.4, 1.3, 1.0), s2) + vec3(0.9, 1.0, 1.0) * s8 * s8 * 0.4;
        col *= lit * (1.0 + 1.8 * smoothstep(3.0, 9.0, dist));
        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * The hoop's light in the dome's haze: a flat ring in the hoop's plane, from the middle of the band
 * outwards (`pat.y` is 0 there and 1 at its outer edge). It is added to the picture, and turns with
 * the hoop, so edge-on there is none of it. `uAura` is how much haze there is to light between the
 * eye and the hoop: the scene sets it from the camera's distance, and stops drawing the ring at none.
 */
function createAuraMaterial(shared: Shared) {
  return new ShaderMaterial({
    uniforms: { ...shared, uAura: { value: 0 } },
    vertexShader: HOOP_VERT,
    fragmentShader: /* glsl */ `
      uniform float uAura;
      ${HOOP_FOG}
      varying vec3 vW;
      varying vec2 vPat;
      void main() {
        float d = vPat.y;
        float a = (1.0 - d) * (1.0 - d);
        a = a * a * 0.8 + a * 0.2;
        vec3 col = vec3(0.1, 0.95, 0.68) * (a * uAura);
        gl_FragColor = vec4(col * (1.0 - fogAmount(length(cameraPosition - vW))), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** the aura's ring: from the ellipse (ax, ay) out by `reach` */
function auraRing(ax: number, ay: number, reach: number, cols: number): BufferGeometry {
  const position = new Float32Array((cols + 1) * 6);
  const pat = new Float32Array((cols + 1) * 4);
  const index: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const c = Math.cos(u * TAU);
    const s = Math.sin(u * TAU);
    const nl = Math.hypot(ay * c, ax * s);
    position.set([ax * c, ay * s, 0, ax * c + ((ay * c) / nl) * reach, ay * s + ((ax * s) / nl) * reach, 0], i * 6);
    pat.set([u, 0, u, 1], i * 4);
    if (i < cols) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array((cols + 1) * 6), 3));
  geo.setAttribute("pat", new BufferAttribute(pat, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * The gimbal rings: polished gold, lit by the lantern, by the sky hole and, on the side that
 * faces it, by the hoop, whose mint also slides over them as a reflection. A thread of light is let
 * into the middle of both broad faces.
 */
function createGimbalMaterial(shared: Shared, hoop: Vector3) {
  return new ShaderMaterial({
    uniforms: { ...shared, uHoop: { value: hoop.clone() } },
    vertexShader: HOOP_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uHoop;
      ${HOOP_FOG}
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vSec;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        float ndv = max(dot(n, V), 0.0);
        vec3 L = normalize(uHoop - vW);
        float lantern = 1.0 / (1.0 + dist * dist / 60.0);

        float far = smoothstep(3.0, 9.0, dist);
        vec3 light = vec3(0.14, 0.07, 0.1);
        light += vec3(0.85, 0.66, 0.5) * (0.3 + 0.7 * ndv) * lantern;
        light += vec3(0.9, 0.6, 0.8) * max(n.y, 0.0) * 0.3;
        light += vec3(0.6, 1.0, 0.8) * max(dot(n, L), 0.0) * 0.4;
        vec3 col = vec3(1.0, 0.52, 0.16) * light * (1.0 + 0.6 * far);

        // polished: the lantern's glint, the hoop's reflection, the haze at a grazing angle
        float s2 = ndv * ndv, s8 = s2 * s2 * s2 * s2, s32 = s8 * s8 * s8 * s8;
        col += vec3(1.2, 0.9, 0.55) * s32 * s32 * 0.4 * lantern;
        float r = max(dot(reflect(-V, n), L), 0.0);
        float r4 = r * r * r * r;
        col += vec3(0.3, 1.2, 0.9) * r4 * r4 * r4 * 0.35;
        float f = 1.0 - ndv;
        col += vec3(1.0, 0.4, 0.3) * f * f * f * 0.3;

        // the thread of light
        float st = abs(vSec.y);
        float aa = fwidth(st);
        col = mix(col, vec3(0.3, 1.5, 1.1) * (0.6 + 0.9 * far), 1.0 - smoothstep(0.12, 0.12 + aa + 0.03, st));

        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * How far a gimbal ring stands out of the hoop's plane, `left` seconds before the end. Over the last
 * three and a half seconds it closes from `open` radians to none, and is clear of the picture in the
 * hoop throughout; before that it is still tumbling.
 */
const settle = (left: number, open: number, tumble: number) =>
  open * (1 - Math.exp(-left / 1.2)) + tumble * Math.max(0, left - 3.5) ** 1.5;

export default function Burrow({ index, clock, camera, portalMaterial }: SceneProps) {
  const gl = useThree((s) => s.gl);
  const stretch = useMemo(() => season(index), [index]);
  const world = useMemo(() => buildWorld(stretch), [stretch]);

  const mats = useMemo(() => {
    const shared = createShared();
    return {
      shared,
      corridor: createCorridorMaterial(shared, world.chambers),
      shells: world.chambers.map((ch) => createChamberMaterial(shared, ch)),
      floor: createTrimMaterial(shared, { patScale: [1.6, 40], spotK: 36, hTop: 4.6, spotGain: 0.5, ridgeAmt: 0.22, pool: world.hoopPos }),
      frame: createTrimMaterial(shared, { patScale: [1.7, 11], spotK: 12, hTop: 4.6, ridgeAll: 0.85 }),
      thread: createGlowMaterial(shared, new Vector3(0.1, 0.95, 0.66), new Vector3(0.3, 1.2, 0.95), 75),
      knot: createGlowMaterial(shared, new Vector3(0.95, 0.16, 0.2), new Vector3(1.5, 0.95, 0.7)),
      moon: createGlowMaterial(shared, new Vector3(1.0, 0.36, 0.1), new Vector3(1.5, 1.05, 0.6)),
      oculus: createGlowMaterial(shared, new Vector3(1.9, 1.3, 1.6), new Vector3(1.9, 1.3, 1.6)),
      hoop: createBandMaterial(shared),
      aura: createAuraMaterial(shared),
      bulbs: createBulbMaterial(shared),
      gimbal: createGlowMaterial(shared, new Vector3(1.2, 0.4, 0.5), new Vector3(1.6, 1.2, 1.1)),
      ring: createGimbalMaterial(shared, world.hoopPos),
      pin: createGlowMaterial(shared, new Vector3(0.5, 2.4, 1.8), new Vector3(1.2, 2.6, 2.2)),
      haloWarm: createHaloMaterial(shared, new Vector3(0.75, 0.2, 0.22)),
      haloAmber: createHaloMaterial(shared, new Vector3(0.7, 0.3, 0.12)),
      haloPale: createHaloMaterial(shared, new Vector3(0.5, 0.25, 0.42)),
      motes: createMoteMaterial(shared),
    };
  }, [world]);
  const creatures = useMemo(() => buildCreatures(world, mats.shared), [world, mats]);
  const parts = useMemo(
    () => ({
      band: ringBand(BAND_RX, BAND_RY, BAND.a, BAND.b, 1, 288, 24),
      bulbs: bulbRow(),
      aura: auraRing(BAND_RX, BAND_RY, 1.3, 128),
      inner: ringBand(GIMBAL.inner, GIMBAL.inner, GIMBAL.a, GIMBAL.b, 0.75, 256, 16),
      outer: ringBand(GIMBAL.outer, GIMBAL.outer, GIMBAL.a, GIMBAL.b, 0.75, 256, 16),
    }),
    [],
  );

  useEffect(
    () => () => {
      creatures.dispose();
      for (const g of [...world.corridors, ...world.shells, ...world.floors, ...world.frames]) g.dispose();
      world.thread.dispose();
      world.hoop.dispose();
      world.motes.dispose();
      for (const g of Object.values(parts)) g.dispose();
      const { shared, shells, ...rest } = mats;
      for (const m of [...shells, ...Object.values(rest)]) m.dispose();
    },
    [world, mats, creatures, parts],
  );

  const knot = useRef<Mesh>(null);
  const moons = useRef<Group>(null);
  const hoop = useRef<Group>(null);
  const aura = useRef<Mesh>(null);
  const gimbalA = useRef<Mesh>(null);
  const gimbalB = useRef<Mesh>(null);

  const tmp = useMemo(() => ({ pose: createFrame(), size: new Vector2() }), []);

  useFrame(() => {
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    mats.shared.uTime.value = t;
    gl.getDrawingBufferSize(tmp.size);
    mats.motes.uniforms.uViewH!.value = tmp.size.y;

    // --- camera: the rail's pose, a pure function of t --------------------------------------------
    const pose = stretch.pose(t, tmp.pose);
    camera.position.copy(pose.position);
    camera.quaternion.copy(aim(stretch, t, stretch.distance(t), pose));
    if (camera.fov !== FOV) camera.fov = FOV;

    // --- things that move -----------------------------------------------------------------------
    if (knot.current) {
      knot.current.rotation.set(t * 0.23, t * 0.37, 0);
      knot.current.position.y = world.sights[0]!.y + Math.sin(t * 0.9) * 0.12;
    }
    if (moons.current) {
      const ch = moons.current.children;
      for (let i = 0; i < ch.length; i++) ch[i]!.rotation.y = t * (0.5 + i * 0.17) + i * 2.1;
      moons.current.position.y = world.sights[1]!.y + 0.4 + Math.sin(t * 0.8 + 1) * 0.1;
    }
    if (hoop.current) {
      // revolves like a coin on its edge, then settles square-on to the approaching camera
      const e = 1 - smooth(14.5, 22.8, t);
      const yaw = world.hoopYaw + e * Math.PI * 1.1;
      hoop.current.rotation.y = yaw;
      // the floor under it is lit out of its faces
      mats.floor.uniforms.uPoolN!.value.set(Math.sin(yaw), Math.cos(yaw));
    }
    if (aura.current) {
      const glow = 0.45 * smooth(3.2, 9, camera.position.distanceTo(world.hoopPos));
      mats.aura.uniforms.uAura!.value = glow;
      aura.current.visible = glow > 0;
    }
    // The gimbals turn against each other, the inner one against the hoop as well, and come to rest
    // in its plane only as the camera passes through.
    const left = TIMING.total - t;
    if (gimbalA.current) gimbalA.current.rotation.y = -settle(left, 0.62, 0.4);
    if (gimbalB.current) gimbalB.current.rotation.x = settle(left, 0.42, 0.3);
  });

  const topOf = (ch: (typeof world.chambers)[number]) => ch.c.y + ch.yc + ch.H * Math.sin(Math.acos(ch.oculus / ch.R));
  const [knotAt, orreryAt] = world.sights as [Vector3, Vector3];

  return (
    <>
      <color attach="background" args={[FOG_COLOR]} />
      <fogExp2 attach="fog" args={[FOG_COLOR, 0.03]} />

      {world.corridors.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.corridor} frustumCulled={false} />
      ))}
      {world.shells.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.shells[i]} />
      ))}
      {world.floors.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.floor} />
      ))}
      {world.frames.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.frame} />
      ))}
      <mesh geometry={world.thread} material={mats.thread} frustumCulled={false} />
      <points geometry={world.motes} material={mats.motes} frustumCulled={false} />
      <primitive object={creatures.eyes} />
      <primitive object={creatures.shrooms} />

      {/* skylights */}
      {world.chambers.map((ch, i) => (
        <group key={i} position={[ch.c.x, topOf(ch) - 0.02, ch.c.z]}>
          <mesh rotation-x={Math.PI / 2} material={mats.oculus}>
            <circleGeometry args={[ch.oculus * 1.12, 40]} />
          </mesh>
          <mesh position-y={-0.4} scale={ch.oculus * 9} material={mats.haloPale}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        </group>
      ))}

      {/* junction 1: a knot of light */}
      <mesh ref={knot} position={knotAt} material={mats.knot}>
        <torusKnotGeometry args={[0.72, 0.2, 160, 12, 2, 3]} />
      </mesh>
      <mesh position={knotAt} scale={8} material={mats.haloWarm}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* junction 2: a little orrery */}
      <group ref={moons} position={orreryAt}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation-z={0.5 + i * 0.9} rotation-x={i * 0.7}>
            <group>
              <mesh position={[0.85 + i * 0.2, 0, 0]} material={mats.moon}>
                <sphereGeometry args={[0.13 + i * 0.02, 20, 14]} />
              </mesh>
              <mesh position={[-0.85 - i * 0.2, 0, 0]} material={mats.moon}>
                <sphereGeometry args={[0.11, 16, 12]} />
              </mesh>
              <mesh rotation-x={Math.PI / 2} material={mats.gimbal}>
                <torusGeometry args={[0.85 + i * 0.2, 0.012, 6, 96]} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
      <mesh position={[orreryAt.x, orreryAt.y + 0.4, orreryAt.z]} material={mats.moon}>
        <sphereGeometry args={[0.3, 32, 20]} />
      </mesh>
      <mesh position={[orreryAt.x, orreryAt.y + 0.4, orreryAt.z]} scale={7} material={mats.haloAmber}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* the dead end: a hoop with another world in it */}
      <group ref={hoop} position={world.hoopPos}>
        <mesh material={portalMaterial} scale={[HOOP.rx, HOOP.ry, 1]}>
          <circleGeometry args={[1, 96]} />
        </mesh>
        <mesh geometry={parts.band} material={mats.hoop} />
        <mesh geometry={parts.bulbs} material={mats.bulbs} />
        <mesh ref={aura} geometry={parts.aura} material={mats.aura} />
      </group>
      <group position={world.hoopPos} rotation-y={world.hoopYaw}>
        <mesh ref={gimbalA} geometry={parts.inner} material={mats.ring} />
        <mesh ref={gimbalB} geometry={parts.outer} material={mats.ring} />
        {/* the pins the hoop and the inner ring turn on, and the ones the outer ring does */}
        {[1, -1].map((s) => (
          <mesh key={s} position-y={s * (GIMBAL.inner - 0.045)} scale={[1, 1.5, 1]} material={mats.pin}>
            <sphereGeometry args={[0.05, 16, 12]} />
          </mesh>
        ))}
        {[1, -1].map((s) => (
          <mesh key={s} position-x={s * GIMBAL.outer} material={mats.pin}>
            <sphereGeometry args={[0.075, 16, 12]} />
          </mesh>
        ))}
      </group>
    </>
  );
}
