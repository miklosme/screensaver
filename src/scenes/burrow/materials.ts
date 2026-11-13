import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";
import { CORRIDOR_SCALES, PROFILE, chamberSkin, type Chamber } from "./build";

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
  attribute vec3 glow;      // light baked from the glowing things (build.ts)
  attribute vec2 ground;    // how open the surface is to light, under what stands on it; mint light pooled on it
  attribute float hgt;      // height above the local floor: the tunnel climbs and dives
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vPat;
  varying vec3 vGlow;
  varying vec2 vGround;
  varying float vH;
  #if SKIN
    attribute vec3 skin;    // where the scales lie: fraction round the ring, ring number, strength
    varying vec3 vSkin;
  #endif
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = mat3(modelMatrix) * normal;
    vPat = pat;
    vGlow = glow;
    vGround = ground;
    vH = hgt;
    #if SKIN
      vSkin = skin;
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/**
 * THE SKIN. Walls are covered in scales that overlap like a fish's: rings of them round the tunnel
 * (down the dome, in a chamber), each ring half a scale round from the last, every scale reaching
 * over the ring ahead of it. A scale is a height: a rounded mound tilted up towards its free
 * tip. The surface is the higher of the two scales that can reach a point, so the outlines are
 * where two heights cross: creases, never drawn lines. That height does three things: its slope
 * bends the normal (so the lantern models every scale, and a wet glint slides over it with the
 * view), the crease is shaded as the shadowed gap it is, and nothing else. The ribs' light and
 * colour go on top of all of it.
 *
 * Everything is evaluated in the scale's own coordinates with its slope known exactly, and fades
 * out by how many scales a pixel covers: it neither shimmers down the tunnel nor blurs at the lens,
 * where the growth rings each scale is laid down in come into view.
 */
const SKIN_GLSL = /* glsl */ `
  uniform vec3 uRing;       // scales round a ring; in a dome, the latitude of ring 0 and the step per ring

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  const float TILT = 0.85;  // how much higher a scale's tip is than its root, in scale heights per ring

  // The scale of ring 'row' that lies over ring fraction a, at t rings from where the ring starts.
  // Returns its height there. about: how far out from its crown the point is (0 on it, 1 about
  // its rim), the scale's own random number, and where the point is from the crown.
  float scale(float a, float N, float row, float t, out vec4 about) {
    float gx = a * N + 0.5 * row;
    float id = floor(gx);
    float rnd = hash12(vec2(mod(id, N), row));
    float r2 = fract(rnd * 7.13 + 0.37);
    float x = gx - id - 0.5 + (rnd - 0.5) * 0.14;
    float u = t - 0.72 - 0.12 * r2;
    float e = x * x * 2.9 + u * u * 1.2;
    about = vec4(e, rnd, x, u);
    return TILT * t + 1.0 - e * (0.3 + 0.7 * e) + 0.22 * (r2 - 0.5);
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
  #if POOL
    uniform vec3 uPool;     // the hoop's centre
    uniform vec2 uPoolN;    // the way its face looks, in plan
  #endif
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
  varying vec2 vGround;
  varying float vH;
  #if SKIN
    varying vec3 vSkin;
    ${SKIN_GLSL}
  #endif

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    float open = vGround.x;
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
          float e = pow(x, n) + pow(abs(Y) / b, n);
          if (e < 1.0) discard;
          // and square down to the floor between the feet of the trim, as the corridor's own floor is there
          if (x < 0.74 && Y < 0.0 && vW.y > uBase - 0.3) discard;
          // the trim is seated in the wall: the wall is in its shade for a hand's width all round it
          open *= 0.4 + 0.6 * (Y > 0.0 ? smoothstep(1.25, 2.2, e) : smoothstep(1.5, 3.9, e));
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

    // albedo: plum floor, coral flanks, magenta vault
    float h = clamp(vH / uHTop, 0.0, 1.0);
    vec3 plum = vec3(0.09, 0.02, 0.11);
    vec3 coral = vec3(0.80, 0.15, 0.13);
    vec3 magenta = vec3(0.42, 0.03, 0.27);
    vec3 shell = vec3(1.0, 0.30, 0.22);
    vec3 albedo = mix(plum, coral, smoothstep(0.02, 0.33, h));
    albedo = mix(albedo, magenta, smoothstep(0.42, 1.0, h));

    // --- the skin (see SKIN_GLSL) ---------------------------------------------------------------
    vec3 nb = n;
    float wet = 0.5;      // how much of a glint the point can give
    #if SKIN
      vec2 da = vec2(dFdx(vSkin.x), dFdy(vSkin.x));
      vec2 dr = vec2(dFdx(vSkin.y), dFdy(vSkin.y));
      float row = floor(vSkin.y);
      #if MODE == 2
        vec2 N = max(vec2(6.0), floor(uRing.x * cos(uRing.y + uRing.z * (row + vec2(-0.5, 0.5))) + 0.5));
      #else
        vec2 N = vec2(uRing.x);
      #endif
      // scales to the pixel: past a third of one, the pattern has to be gone
      float fw = max(N.y * max(abs(da.x), abs(da.y)), max(abs(dr.x), abs(dr.y)));
      float detail = 1.0 - smoothstep(0.13, 0.4, fw);
      float tone = 0.9;
      // (slopes of the surface are taken out here: inside a branch they are undefined along its edge)
      vec3 dpx = dFdx(vW), dpy = dFdy(vW);
      if (detail > 0.0) {
        float t = vSkin.y - row;
        vec4 aboutA, aboutB;
        float hA = scale(vSkin.x, N.x, row - 1.0, t + 1.0, aboutA);
        float hB = scale(vSkin.x, N.y, row, t, aboutB);
        float top = step(hB, hA);         // 1 on a scale reaching over from the ring behind
        vec4 about = mix(aboutB, aboutA, top);
        float e = about.x;
        // slope of the scale's height per unit of (ring fraction, ring): the tilt and the mound...
        vec2 de = vec2(5.8 * about.z * mix(N.y, N.x, top), 2.4 * about.w);
        vec2 g = vec2(0.0, TILT) - (0.3 + 1.4 * e) * de;
        // ...and, close to, the growth rings every scale is laid down in
        float fine = 1.0 - smoothstep(0.03, 0.1, fw);
        float grow = 13.0 * e + 6.2831853 * about.y;
        g += (0.045 * 13.0 * fine * cos(grow)) * de;
        // scales lie down on the rib crests, and stand out more or less from place to place
        float amp = detail * vSkin.z * (1.0 - 0.45 * ridge);
        vec2 dH = amp * (g.x * da + g.y * dr);

        // the gap between scales is in shade: a line round a free edge, a soft shadow on the scale
        // that comes out from under two others
        float under = 1.0 - top;
        float crease = 1.0 - smoothstep(0.0, 0.2 + 0.7 * under + 2.5 * fw, abs(hA - hB));
        float body = 1.0 - smoothstep(0.3, 1.3, e);
        wet = body * detail;
        tone = (1.0 - (0.2 + 0.3 * under) * crease) * (0.8 + 0.2 * body) * (0.9 + 0.2 * about.y) * (1.0 + 0.05 * fine * sin(grow));
        tone = mix(0.9, tone, amp);
        // one scale in a few is flushed a deeper red
        albedo = mix(albedo, albedo * vec3(0.92, 0.6, 1.25), amp * smoothstep(0.72, 0.9, about.y) * 0.6);

        // bend the normal by the slope of the skin
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        nb = normalize((abs(det) + 1e-9) * n - 0.03 * sign(det) * (dH.x * r1 + dH.y * r2));
      }
    #else
      float tone = 1.0;
    #endif

    // --- the ribs' light, on top: pale crests, and the skin between two ribs falls away to plum ----
    albedo = mix(albedo, shell, ridge * uRidgeAmt) * tone;
    albedo *= mix(vec3(0.32, 0.25, 0.52), vec3(1.0), groove);

    // light: dim ambient, the traveller's lantern, and light baked from the glowing things. The
    // lantern throws its light ahead: a wall right beside it is lit less than full, and keeps its red.
    float ndl = max(dot(nb, V), 0.0);
    float lantern = (0.66 + 0.34 * smoothstep(0.5, 4.5, dist)) / (1.0 + dist * dist / 36.0);
    vec3 light = vec3(0.05, 0.018, 0.07) * (0.7 + 0.3 * nb.y);
    light += vec3(0.62, 0.34, 0.27) * (0.2 + 0.8 * ndl) * lantern;
    light *= open;
    light += vGlow * (0.5 * (0.5 + 0.5 * open));
    vec3 col = albedo * light;
    // a wall in full light stays red: past this the tone curve would bleach it to pink
    col /= 1.0 + 1.3 * max(max(col.r, col.g) - 0.4, 0.0);

    // the mint of the mushrooms and the thread pools on the wet skin, whatever its own colour
    float graze = 1.0 - ndl;
    graze *= graze * graze;
    col = mix(col, vec3(0.08, 0.72, 0.5) * tone * open * (0.12 + 0.34 * ndl + 0.25 * graze), 0.62 * smoothstep(0.2, 1.1, vGround.y));

    // wet: a tight glint of the lantern on whatever faces the eye, and a broad coral one under it
    float s2 = ndl * ndl, s4 = s2 * s2, s8 = s4 * s4, s16 = s8 * s8, s32 = s16 * s16, s64 = s32 * s32;
    col += (vec3(1.0, 0.74, 0.64) * s64 * s64 * 0.45 + vec3(0.9, 0.2, 0.18) * s8 * 0.05) * wet * lantern * open;

    // and a film that carries the haze at a grazing angle. Right at the lens there is no haze to
    // carry, so a wall beside the camera keeps its red.
    float far = dist * dist / (dist * dist + 12.0);
    col += vec3(0.42, 0.05, 0.30) * graze * (0.05 + 0.16 * length(vGlow) + 0.2 * far / (1.0 + dist * dist / 60.0));

    // --- the floor under the hoop ---------------------------------------------------------------
    // The hoop hangs a hand's width above the floor and glows: its mint pools round it, the daylight
    // of the world inside it spills out of both faces and fans out, and the strip right under the band
    // is in its shade. The floor is wet, so all of it rides the ripples: the flank of a ripple that
    // faces the hoop carries a line of its light. Nothing of it reaches past the dome.
    #if POOL
      vec2 dp = vW.xz - uPool.xz;
      float d2 = dot(dp, dp);
      float reach = 1.0 - smoothstep(36.0, 72.0, d2);
      if (reach > 0.0) {
        float across = dot(dp, uPoolN);
        float along = dp.x * uPoolN.y - dp.y * uPoolN.x;
        float under = exp(-across * across / 0.08) * (1.0 - smoothstep(1.2, 2.1, abs(along)));
        float mint = 1.0 / (1.0 + d2 / 5.0);
        float x = abs(across);
        float fan = 1.15 + 0.55 * x;
        float day = x / (x + 0.45) * exp(-x / 2.3) * exp(-along * along / (fan * fan));
        // the ripples: lit on the flank towards the hoop, and a glint along it
        float flank = 1.0 - 4.5 * q * exp(-q * q / 0.04);
        float glint = exp(-(q + 0.085) * (q + 0.085) / 0.003);
        vec3 pool = vec3(0.0, 0.7, 0.47) * (mint * mint * 0.8) + vec3(1.3, 0.6, 0.2) * (day * 0.32);
        pool = pool * flank * (0.4 + 0.6 * groove) + vec3(0.1, 1.3, 0.95) * (glint * mint * mint * 0.3) + vec3(1.5, 0.9, 0.5) * (glint * day * 0.15);
        col *= 1.0 - 0.6 * under * reach;
        col += pool * ((1.0 - 0.85 * under) * open * reach);
      }
    #endif

    // bioluminescent pores along the ribs; a slow wave of light runs ahead along the route
    float row2 = vPat.y * uSpotK;
    vec2 cell = vec2(floor(vPat.x), floor(row2));
    float rnd = hash(cell);
    vec2 sp = vec2(q * uPatScale.x, (fract(row2) - 0.5) * uPatScale.y / uSpotK);
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
  /** scales round a ring; for a dome also the latitude of ring 0 and the step per ring */
  ring?: [number, number, number];
  /** the hoop's centre: the floor round it is lit by it (see "the floor under the hoop" in WALL_FRAG) */
  pool?: Vector3;
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
    uRing: { value: new Vector3(...(o.ring ?? [0, 0, 0])) },
  };
}

/**
 * plain surface (floors, trims). Given `pool`, it is the floor the hoop stands over: `uPoolN` is the
 * way the hoop's face looks in plan, which the scene writes every frame as the hoop turns.
 */
export function createTrimMaterial(shared: Shared, o: WallOptions) {
  return new ShaderMaterial({
    defines: { MODE: 0, SKIN: 0, POOL: o.pool ? 1 : 0 },
    uniforms: o.pool
      ? { ...wallUniforms(shared, o), uPool: { value: o.pool.clone() }, uPoolN: { value: new Vector2(0, 1) } }
      : wallUniforms(shared, o),
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: DoubleSide,
  });
}

/** corridor walls: cut away wherever they reach into a chamber */
export function createCorridorMaterial(shared: Shared, chambers: Chamber[]) {
  return new ShaderMaterial({
    defines: { MODE: 1, SKIN: 1, POOL: 0 },
    uniforms: {
      ...wallUniforms(shared, { patScale: [2.1, 13.6], spotK: 13, hTop: 4.6, ring: [CORRIDOR_SCALES, 0, 0] }),
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
  const skin = chamberSkin(ch);
  return new ShaderMaterial({
    defines: { MODE: 2, SKIN: 1, POOL: 0 },
    uniforms: {
      ...wallUniforms(shared, {
        patScale: [(Math.PI * 2 * ch.R * 0.8) / ch.ridges, meridian],
        spotK: Math.round(meridian / 1.1),
        hTop: ch.yc + ch.H,
        ring: [skin.round, skin.psi1, -(skin.psi1 - skin.psi0) / skin.rings],
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
