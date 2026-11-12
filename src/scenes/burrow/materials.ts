import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";
import { PROFILE, type Chamber } from "./build";

export const FOG_COLOR = new Color(0.085, 0.012, 0.075);
export const FOG_DENSITY = 0.03;

export interface Shared {
  uTime: { value: number };
  uFog: { value: Color };
  uFogD: { value: number };
}

export function createShared(): Shared {
  return { uTime: { value: 0 }, uFog: { value: FOG_COLOR }, uFogD: { value: FOG_DENSITY } };
}

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogD;
  float fogAmount(float d) { float x = d * uFogD; return 1.0 - exp(-x * x); }
`;

const WALL_VERT = /* glsl */ `
  attribute vec2 pat;
  attribute vec3 glow;
  attribute float hgt;      // height above the local floor: the tunnel climbs and dives
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vPat;
  varying vec3 vGlow;
  varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = mat3(modelMatrix) * normal;
    vPat = pat;
    vGlow = glow;
    vH = hgt;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const WALL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPatScale;   // world size of one pattern cell (x: across a ridge, y: whole v range)
  uniform float uSpotK;     // spot rows along pat.y
  uniform float uHTop;      // height at which the wall colour reaches its "ceiling" hue
  uniform float uRidgeAll;  // > 0 paints the whole surface in the ridge colour (trims)
  uniform float uSpotGain;
  uniform float uRidgeAmt;
  uniform float uFlutes;
  uniform vec2 uScales;     // scales per pattern cell (0 = smooth skin)
  ${FOG_GLSL}
  #if MODE == 1
    uniform vec4 uCh[3];
    uniform float uChY[3];
  #endif
  #if MODE == 2
    uniform vec2 uC;
    uniform float uBase;      // level of the chamber's floor
    uniform vec2 uDoorP[4];   // a point on each corridor's centreline, relative to uC
    uniform vec2 uDoorT[4];   // the way that corridor runs, out of the chamber
    uniform float uDoorK[4];  // the scale of that corridor's profile
    uniform int uDoorN;
  #endif
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vPat;
  varying vec3 vGlow;
  varying float vH;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    #if MODE == 1
      for (int i = 0; i < 3; i++) {
        vec2 dd = vW.xz - uCh[i].xy;
        float ey = (vW.y - uChY[i]) / uCh[i].w;
        if (dot(dd, dd) / (uCh[i].z * uCh[i].z) + ey * ey < 1.0) discard;
      }
    #endif
    #if MODE == 2
      vec2 rel = vW.xz - uC;
      for (int i = 0; i < 4; i++) {
        if (i >= uDoorN) break;
        vec2 dr = uDoorT[i];
        vec2 off = rel - uDoorP[i];
        // the corridor's outline, carried along the corridor through the near wall only
        if (dot(off, dr) > -3.0) {
          float K = 0.92 * uDoorK[i];
          float x = abs(dot(off, vec2(dr.y, -dr.x))) / (${PROFILE.a.toFixed(3)} * K);
          float Y = (vW.y - uBase - ${PROFILE.hc.toFixed(3)} * K) / K;
          float n = Y > 0.0 ? ${PROFILE.nUp.toFixed(3)} : ${PROFILE.nLo.toFixed(3)};
          float b = Y > 0.0 ? ${PROFILE.bUp.toFixed(3)} : ${PROFILE.bLo.toFixed(3)};
          if (pow(x, n) + pow(abs(Y) / b, n) < 1.0) discard;
          // and square down to the floor between the feet of the trim, as the corridor's own floor is there
          if (x < 0.74 && Y < 0.0 && vW.y > uBase - 0.3) discard;
        }
      }
    #endif

    vec3 V = cameraPosition - vW;
    float dist = length(V);
    V /= dist;
    vec3 n = normalize(vN);
    if (dot(n, V) < 0.0) n = -n;

    float q = fract(vPat.x) - 0.5;
    float ridge = max(exp(-q * q / 0.022), uRidgeAll);
    float groove = smoothstep(0.5, 0.2, abs(q));

    // albedo: plum floor, coral flanks, magenta vault, pale ribs
    float h = clamp(vH / uHTop, 0.0, 1.0);
    vec3 plum = vec3(0.09, 0.02, 0.11);
    vec3 coral = vec3(0.80, 0.15, 0.13);
    vec3 magenta = vec3(0.42, 0.03, 0.27);
    vec3 shell = vec3(0.95, 0.42, 0.33);
    vec3 albedo = mix(plum, coral, smoothstep(0.02, 0.33, h));
    albedo = mix(albedo, magenta, smoothstep(0.42, 1.0, h));
    albedo = mix(albedo, shell, ridge * uRidgeAmt);
    albedo *= 0.62 + 0.38 * groove;
    // fine flutes running along the ribs
    float flute = 0.5 + 0.5 * cos(vPat.y * uFlutes * 6.2831853);
    albedo *= 1.0 - 0.3 * flute * flute * (1.0 - ridge * 0.6);
    // the skin between the ribs is scaled like a lizard's; the scales dissolve with distance
    float wet = 0.0;
    if (uScales.x > 0.0) {
      vec2 sg = vPat * uScales;
      float sfade = 1.0 - smoothstep(0.12, 0.55, length(fwidth(sg)));
      sg.x += 0.5 * mod(floor(sg.y), 2.0);
      vec2 sf = fract(sg) - vec2(0.5, 0.0);
      float sd = length(sf * vec2(1.0, 1.1));
      float tone = hash(floor(sg) + 17.0);
      wet = smoothstep(0.5, 0.15, sd) * sfade * (1.0 - ridge);
      albedo *= 1.0 + sfade * (1.0 - ridge) * (0.3 * smoothstep(0.6, 0.15, sd) - 0.26 * smoothstep(0.4, 0.56, sd) + 0.16 * (tone - 0.5));
    }

    // light: dim ambient, the traveller's lantern, and light baked from the glowing things
    vec3 light = vec3(0.05, 0.018, 0.07) * (0.7 + 0.3 * n.y);
    float ndl = max(dot(n, V), 0.0);
    light += vec3(0.62, 0.34, 0.27) * (0.2 + 0.8 * ndl) / (1.0 + dist * dist / 36.0);
    light += vGlow * 0.5;
    vec3 col = albedo * light;
    // every scale is a little wet
    col += vec3(1.0, 0.7, 0.6) * wet * pow(ndl, 14.0) * 0.5 / (1.0 + dist * dist / 30.0);

    // velvet rim, picks up the haze
    float rim = pow(1.0 - ndl, 3.0);
    col += vec3(0.42, 0.05, 0.30) * rim * (0.05 + 0.16 * length(vGlow) + 0.2 / (1.0 + dist * dist / 60.0));

    // bioluminescent pores along the ribs; a slow wave of light runs ahead along the route
    float row = vPat.y * uSpotK;
    vec2 cell = vec2(floor(vPat.x), floor(row));
    float rnd = hash(cell);
    vec2 sp = vec2(q * uPatScale.x, (fract(row) - 0.5) * uPatScale.y / uSpotK);
    float r = length(sp);
    float on = step(0.48, rnd);
    float wave = 0.5 + 0.5 * sin(uTime * 1.9 - vPat.x * 0.75 + rnd * 2.0);
    float pulse = 0.25 + 0.75 * wave * wave;
    float core = smoothstep(0.06, 0.025, r);
    float halo = exp(-r * r / 0.02) * 0.22;
    vec3 spotCol = mix(vec3(0.08, 0.95, 0.62), vec3(1.0, 0.35, 0.55), step(0.9, rnd));
    col += spotCol * (core * 1.1 + halo) * on * pulse * uSpotGain;

    col = mix(col, uFog, fogAmount(dist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface WallOptions {
  patScale: [number, number];
  spotK: number;
  hTop: number;
  ridgeAll?: number;
  spotGain?: number;
  ridgeAmt?: number;
  flutes?: number;
  scales?: [number, number];
}

function wallUniforms(shared: Shared, o: WallOptions) {
  return {
    ...shared,
    uPatScale: { value: new Vector2(o.patScale[0], o.patScale[1]) },
    uSpotK: { value: o.spotK },
    uHTop: { value: o.hTop },
    uRidgeAll: { value: o.ridgeAll ?? 0 },
    uSpotGain: { value: o.spotGain ?? 1 },
    uRidgeAmt: { value: o.ridgeAmt ?? 0.7 },
    uFlutes: { value: o.flutes ?? 0 },
    uScales: { value: new Vector2(o.scales?.[0] ?? 0, o.scales?.[1] ?? 0) },
  };
}

/** plain surface (floors, trims) */
export function createTrimMaterial(shared: Shared, o: WallOptions) {
  return new ShaderMaterial({
    defines: { MODE: 0 },
    uniforms: wallUniforms(shared, o),
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: DoubleSide,
  });
}

/** corridor walls: cut away wherever they reach into a chamber */
export function createCorridorMaterial(shared: Shared, chambers: Chamber[]) {
  return new ShaderMaterial({
    defines: { MODE: 1 },
    uniforms: {
      ...wallUniforms(shared, { patScale: [2.1, 13.6], spotK: 13, hTop: 4.6, flutes: 26, scales: [9, 64] }),
      // A hair larger than the chamber, whose shell is the plain spheroid round every doorway
      // (build.ts): the corridor ends just outside the wall, under the doorway's trim.
      uCh: { value: chambers.map((c) => new Vector4(c.c.x, c.c.z, c.R * 1.012, c.H * 1.012)) },
      uChY: { value: chambers.map((c) => c.c.y + c.yc) },
    },
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: DoubleSide,
  });
}

/** chamber shell: doorway-shaped holes are cut where corridors arrive */
export function createChamberMaterial(shared: Shared, ch: Chamber) {
  const doors = [0, 1, 2, 3].map((i) => ch.doors[i]);
  const meridian = (ch.H * Math.PI) / 2 + ch.yc;
  return new ShaderMaterial({
    defines: { MODE: 2 },
    uniforms: {
      ...wallUniforms(shared, {
        patScale: [(Math.PI * 2 * ch.R * 0.8) / ch.ridges, meridian],
        spotK: Math.round(meridian / 1.1),
        hTop: ch.yc + ch.H,
        scales: [Math.round((Math.PI * 2 * ch.R * 0.8) / ch.ridges / 0.24), Math.round(meridian / 0.21)],
      }),
      uC: { value: new Vector2(ch.c.x, ch.c.z) },
      uBase: { value: ch.c.y },
      uDoorP: { value: doors.map((d) => (d ? new Vector2(d.p.x - ch.c.x, d.p.z - ch.c.z) : new Vector2())) },
      uDoorT: { value: doors.map((d) => (d ? new Vector2(d.t.x, d.t.z) : new Vector2(0, 1))) },
      uDoorK: { value: doors.map((d) => d?.k ?? 1) },
      uDoorN: { value: ch.doors.length },
    },
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: DoubleSide,
  });
}

/** self-lit things: fresnel blend from a core to a rim colour */
export function createGlowMaterial(shared: Shared, core: Vector3, rim: Vector3, pulse = 0) {
  return new ShaderMaterial({
    uniforms: {
      ...shared,
      uCore: { value: core },
      uRim: { value: rim },
      uPulse: { value: pulse },
    },
    vertexShader: /* glsl */ `
      attribute vec2 pat;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vPat;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = mat3(modelMatrix) * normal;
        vPat = pat;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCore;
      uniform vec3 uRim;
      uniform float uPulse;
      ${FOG_GLSL}
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vPat;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        float f = 1.0 - abs(dot(normalize(vN), V));
        vec3 col = mix(uCore, uRim, f * f);
        // optional bead of light running along the pattern coordinate
        float w = 0.5 + 0.5 * sin(vPat.y * uPulse - uTime * 2.4);
        col *= 1.0 + step(0.001, uPulse) * (pow(w, 6.0) * 2.2 - 0.25);
        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: DoubleSide,
  });
}

/** camera-facing soft glow; the mesh is a unit plane, its world scale is the halo size */
export function createHaloMaterial(shared: Shared, color: Vector3) {
  return new ShaderMaterial({
    uniforms: { ...shared, uColor: { value: color } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = position.xy * 2.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sx = length(modelMatrix[0].xyz);
        mv.xy += position.xy * sx;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      ${FOG_GLSL}
      varying vec2 vUv;
      varying float vDist;
      void main() {
        float r = length(vUv);
        float a = pow(max(0.0, 1.0 - r), 2.4);
        a *= 0.92 + 0.08 * sin(uTime * 2.1);
        gl_FragColor = vec4(uColor * a * (1.0 - fogAmount(vDist)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

export function createMoteMaterial(shared: Shared) {
  return new ShaderMaterial({
    uniforms: { ...shared, uViewH: { value: 720 } },
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime;
      uniform float uViewH;
      varying float vFade;
      varying float vHue;
      ${FOG_GLSL}
      void main() {
        vec3 p = position;
        float ph = seed.x;
        float sp = seed.y;
        p += vec3(sin(uTime * sp * 0.6 + ph), sin(uTime * sp * 0.43 + ph * 2.3), cos(uTime * sp * 0.52 + ph * 1.7)) * 0.35;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.05 * seed.z * projectionMatrix[1][1] * uViewH * 0.5 / max(d, 0.05), 0.0, 22.0);
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + sp) + ph * 5.0);
        vFade = (1.0 - fogAmount(d)) * tw * smoothstep(0.25, 1.4, d);
        vHue = seed.w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;
      varying float vHue;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - r), 2.0);
        vec3 col = mix(vec3(0.3, 1.0, 0.8), vec3(1.0, 0.6, 0.7), step(0.72, vHue));
        gl_FragColor = vec4(col * a * vFade * 1.4, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}
