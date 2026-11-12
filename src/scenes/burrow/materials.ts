import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";
import { PROFILE, PROFILE_LEN, type Chamber } from "./build";

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
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vPat;
  varying vec3 vGlow;
  varying vec3 vSwell;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = mat3(modelMatrix) * normal;
    vPat = pat;
    vGlow = glow;
    // slow world-space swells of the skin (low frequency, so per-vertex is enough):
    // xy stretch the scale lattice so size and spacing drift, z sets how deep the scales are
    vec3 wp = w.xyz * vec3(0.9, 1.1, 0.9);
    vSwell = vec3(sin(wp.x * 1.3 + sin(wp.z * 0.9)) + sin(wp.y * 1.7 + wp.z * 0.6),
                  sin(wp.z * 1.2 + sin(wp.x * 0.8)) + sin(wp.y * 1.1 - wp.x * 0.7),
                  0.5 + 0.25 * (sin(wp.x * 0.7 + wp.z * 0.5) + sin(wp.z * 0.6 - wp.y * 0.9 + 1.3)));
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
  uniform vec2 uScales;     // scale cells per pattern unit (0 = smooth skin)
  uniform vec2 uPer;        // period of the scale lattice in cells (0 = none), so seams close
  ${FOG_GLSL}
  #if MODE == 1
    uniform vec4 uCh[3];
    uniform float uChY[3];
  #endif
  #if MODE == 2
    uniform vec2 uC;
    uniform vec2 uDoor[4];
    uniform int uDoorN;
  #endif
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vPat;
  varying vec3 vGlow;
  varying vec3 vSwell;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // pcg2d (Jarzynski & Olano): two well mixed random numbers per integer cell, cheaply
  vec2 hash22(vec2 p) {
    uvec2 v = uvec2(ivec2(p) + 4096);
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> 16u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> 16u;
    return vec2(v & 0xffffu) / 65535.0;
  }

  // packed cells: x = distance to the nearest centre, y = F2 - F1 (how far inside the cell edge),
  // z, w = two random numbers of the nearest cell
  vec4 cells(vec2 g) {
    // only the 2x2 block of cells nearest the point is searched; the jitter is kept small enough
    // that the two nearest centres almost always lie in it (the world-space warp adds the rest)
    vec2 id = floor(g - 0.5);
    vec2 f = g - id;
    if (uPer.x > 0.0) id.x = mod(id.x, uPer.x);
    if (uPer.y > 0.0) id.y = mod(id.y, uPer.y);
    float d1 = 9.0, d2 = 9.0;
    vec2 r1 = vec2(0.0);
    for (int j = 0; j <= 1; j++)
      for (int i = 0; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 c = id + o;
        if (uPer.x > 0.0 && c.x >= uPer.x) c.x -= uPer.x;
        if (uPer.y > 0.0 && c.y >= uPer.y) c.y -= uPer.y;
        vec2 h = hash22(c);
        vec2 dv = o + 0.22 + 0.56 * h - f;
        float d = dot(dv, dv);
        if (d < d1) { d2 = d1; d1 = d; r1 = fract(h * vec2(7.13, 13.7)); }
        else if (d < d2) { d2 = d; }
      }
    d1 = sqrt(d1);
    return vec4(d1, sqrt(d2) - d1, r1);
  }

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
        vec2 dr = uDoor[i];
        if (dot(rel, dr) > 0.0) {
          const float K = 0.92;
          float x = abs(dot(rel, vec2(dr.y, -dr.x))) / (${PROFILE.a.toFixed(3)} * K);
          float Y = (vW.y - ${PROFILE.hc.toFixed(3)} * K) / K;
          float n = Y > 0.0 ? ${PROFILE.nUp.toFixed(3)} : ${PROFILE.nLo.toFixed(3)};
          float b = Y > 0.0 ? ${PROFILE.bUp.toFixed(3)} : ${PROFILE.bLo.toFixed(3)};
          if (pow(x, n) + pow(abs(Y) / b, n) < 1.0) discard;
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
    float h = clamp(vW.y / uHTop, 0.0, 1.0);
    vec3 plum = vec3(0.09, 0.02, 0.11);
    vec3 coral = vec3(0.80, 0.15, 0.13);
    vec3 magenta = vec3(0.42, 0.03, 0.27);
    vec3 shell = vec3(0.95, 0.42, 0.33);
    vec3 albedo = mix(plum, coral, smoothstep(0.02, 0.33, h));
    albedo = mix(albedo, magenta, smoothstep(0.42, 1.0, h));
    albedo = mix(albedo, shell, ridge * uRidgeAmt * 0.75);
    albedo *= 0.66 + 0.34 * groove;

    // --- living skin: packed scales on the walls, pores on the floor ------------------------
    vec2 warp = vSwell.xy;
    float swell = vSwell.z;
    float fogK = fogAmount(dist);
    float floorK = 0.0;
    vec2 g;
    #if MODE == 3
      g = vW.xz / 0.24 + warp * 0.55;
      floorK = 1.0;
    #else
      g = vPat * uScales + warp * 0.8;
      floorK = 1.0 - smoothstep(0.08, 0.5, vW.y);
    #endif
    vec2 fwg = fwidth(g);
    float fw = max(fwg.x, fwg.y);
    float detail = (1.0 - smoothstep(0.16, 0.42, fw)) * step(0.001, uScales.x + floorK) * (1.0 - smoothstep(0.8, 0.9, fogK));
    float H = 0.0;          // height of the skin, in world units
    float edgeLit = 0.0;    // thin, light-bleeding rim of each scale
    float wet = 0.0;
    float pore = 0.0;
    float poreGlow = 0.0;
    if (detail > 0.0) {
      vec4 c = cells(g);
      float aa = max(fw, 0.015);
      float cr = c.z, cr2 = c.w;
      // scale pad: domed, rounded at its edge, deep groove in between
      float rim = 0.16 + 0.14 * cr2;
      float e = clamp(c.y / (rim + aa), 0.0, 1.0);
      float pad = 1.0 - (1.0 - e) * (1.0 - e);
      float dome = pad * (1.0 - 0.8 * c.x * c.x);
      float sH = dome * (0.35 + 0.65 * swell);
      // floor: flatter tissue with pits; a few pits hold a mint spark
      float pr = 0.12 + 0.12 * cr2;
      float pit = 0.0, fH = 0.0;
      if (floorK > 0.0) {
        pit = smoothstep(pr + aa, pr * 0.4, c.x);
        fH = 0.5 * smoothstep(0.0, 0.2 + aa, c.y) - pit;
      }
      H = mix(sH, fH, floorK) * 0.035 * detail;
      edgeLit = (1.0 - floorK) * smoothstep(0.0, 0.025 + aa, c.y) * (1.0 - smoothstep(0.02, 0.6 * rim + aa, c.y)) * detail;
      wet = mix(pad, 0.4 + 0.6 * (1.0 - pit), floorK) * detail;
      pore = floorK * pit * detail;
      poreGlow = pore * step(0.86, cr) * smoothstep(pr * 0.7, 0.0, c.x);
      // per-scale tint and the shadowed grooves
      vec3 tint = mix(vec3(1.08, 0.86, 0.95), vec3(0.95, 1.06, 1.0), cr2);
      float ao = mix(0.25, 1.0, pad);
      albedo *= mix(vec3(1.0), tint * (0.82 + 0.36 * cr) * ao * mix(1.0, 1.0 - 0.75 * pit, floorK), detail);
    }

    // bump normal from the skin height (surface gradient, no tangents needed)
    vec3 dpx = dFdx(vW), dpy = dFdy(vW);
    vec3 a1 = cross(dpy, n), a2 = cross(n, dpx);
    float det = dot(dpx, a1);
    vec3 sg = sign(det) * (dFdx(H) * a1 + dFdy(H) * a2);
    vec3 nb = normalize(abs(det) * n - sg);

    // light: dim ambient, the traveller's lantern (wrapped), and light baked from the glowing things
    float ndl = max(dot(nb, V), 0.0);
    float wrapL = (dot(nb, V) + 0.4) / 1.4;
    float lant = 1.0 / (1.0 + dist * dist / 36.0);
    vec3 light = vec3(0.05, 0.018, 0.07) * (0.7 + 0.3 * nb.y);
    light += vec3(0.62, 0.34, 0.27) * (0.15 + 0.85 * max(wrapL, 0.0)) * lant;
    light += vGlow * 0.5;
    vec3 col = albedo * light;

    // light bleeding through the thin scale edges: warm transmission, strongest at grazing view
    float thin = edgeLit * (0.55 + 0.45 * (1.0 - ndl));
    col += vec3(1.0, 0.24, 0.30) * thin * (0.45 * lant + 0.6 * length(vGlow) + 0.03) * (0.6 + 0.4 * h);

    // wet sheen: a tight lantern glint on every dome plus a fresnel film reflecting the haze
    float gloss = wet * (0.5 + 0.5 * swell);
    float n2 = ndl * ndl, n4 = n2 * n2, n8 = n4 * n4, n16 = n8 * n8;
    col += vec3(1.0, 0.78, 0.7) * gloss * n16 * n16 * n16 * 0.55 / (1.0 + dist * dist / 30.0);
    col += vec3(1.0, 0.6, 0.55) * gloss * n8 * ndl * 0.06 * lant;
    float fr = 1.0 - ndl, fr2 = fr * fr;
    float fres = fr2 * fr2;
    vec3 env = mix(vec3(0.30, 0.05, 0.22), vec3(0.15, 0.6, 0.45), clamp(length(vGlow) * 1.5, 0.0, 1.0) * 0.5);
    col += env * fres * gloss * 0.35 * (0.3 + 0.7 * lant);

    // velvet rim, picks up the haze
    float rimL = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += vec3(0.42, 0.05, 0.30) * rimL * (0.05 + 0.16 * length(vGlow) + 0.2 / (1.0 + dist * dist / 60.0));

    // mint sparks in a few floor pores
    float tw = 0.55 + 0.45 * sin(uTime * 1.3 + vW.x * 2.1 + vW.z * 1.7);
    col += vec3(0.1, 0.95, 0.62) * poreGlow * 0.6 * tw;

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

    col = mix(col, uFog, fogK);
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
  scales?: [number, number];
  per?: [number, number];
}

/** world size of one wall scale */
const SCALE = 0.23;

function wallUniforms(shared: Shared, o: WallOptions) {
  return {
    ...shared,
    uPatScale: { value: new Vector2(o.patScale[0], o.patScale[1]) },
    uSpotK: { value: o.spotK },
    uHTop: { value: o.hTop },
    uRidgeAll: { value: o.ridgeAll ?? 0 },
    uSpotGain: { value: o.spotGain ?? 1 },
    uRidgeAmt: { value: o.ridgeAmt ?? 0.7 },
    uScales: { value: new Vector2(o.scales?.[0] ?? 0, o.scales?.[1] ?? 0) },
    uPer: { value: new Vector2(o.per?.[0] ?? 0, o.per?.[1] ?? 0) },
  };
}

/** plain surface: a chamber floor (pored skin in world xz), or a trim when `ridgeAll` is set */
export function createTrimMaterial(shared: Shared, o: WallOptions) {
  return new ShaderMaterial({
    defines: { MODE: o.ridgeAll ? 0 : 3 },
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
      ...wallUniforms(shared, (() => {
        const around = Math.round(PROFILE_LEN / SCALE);
        return { patScale: [2.1, PROFILE_LEN], spotK: 13, hTop: 4.6, scales: [2.1 / SCALE, around], per: [0, around] } as WallOptions;
      })()),
      uCh: { value: chambers.map((c) => new Vector4(c.c.x, c.c.z, c.R, c.H)) },
      uChY: { value: chambers.map((c) => c.yc) },
    },
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: DoubleSide,
  });
}

/** chamber shell: doorway-shaped holes are cut where corridors arrive */
export function createChamberMaterial(shared: Shared, ch: Chamber) {
  const doors = [0, 1, 2, 3].map((i) => {
    const d = ch.doors[i];
    return d ? new Vector2(d.x, d.z) : new Vector2(0, 1);
  });
  const meridian = (ch.H * Math.PI) / 2 + ch.yc;
  return new ShaderMaterial({
    defines: { MODE: 2 },
    uniforms: {
      ...wallUniforms(shared, {
        patScale: [(Math.PI * 2 * ch.R * 0.8) / ch.ridges, meridian],
        spotK: Math.round(meridian / 1.1),
        hTop: ch.yc + ch.H,
        scales: [Math.round((Math.PI * 2 * ch.R * 0.8) / ch.ridges / SCALE), Math.round(meridian / SCALE)],
        per: [Math.round((Math.PI * 2 * ch.R * 0.8) / ch.ridges / SCALE) * ch.ridges, 0],
      }),
      uC: { value: new Vector2(ch.c.x, ch.c.z) },
      uDoor: { value: doors },
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
