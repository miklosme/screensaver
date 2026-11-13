import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4, type DataTexture } from "three";
import { CORRIDOR_SCALES, PROFILE, SCALE_PITCH, SCALE_W, chamberSkin, type Chamber } from "./build";

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

/** how many mushrooms one cell of the floor's light grid can list (creatures.ts) */
export const SHROOM_SLOTS = 12;

/** the mushrooms' light on the floor: a grid in plan, SHROOM_SLOTS texels per cell (built in creatures.ts) */
export interface ShroomLight {
  tex: DataTexture;
  /** x and z of the grid's corner, cells per unit */
  grid: Vector4;
  /** cells across x and z */
  size: Vector2;
}

/** hand a floor material the mushrooms' light; until then (size 0) it reads none */
export function setShroomLight(mat: ShaderMaterial, light: ShroomLight) {
  mat.uniforms.uShroomTex!.value = light.tex;
  mat.uniforms.uShroomGrid!.value.copy(light.grid);
  mat.uniforms.uShroomSize!.value.copy(light.size);
}

const shroomUniforms = () => ({
  uShroomTex: { value: null as DataTexture | null },
  uShroomGrid: { value: new Vector4(0, 0, 0, 0) },
  uShroomSize: { value: new Vector2(0, 0) },
});

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
  #if FLOOR
    attribute vec4 lead;    // to the thread's nearest point in plan, how far along it that is, 1 short of its end (build.ts)
    attribute float foot;   // radius at which the wall meets this floor
    varying vec4 vLead;
    varying float vFoot;
  #endif
  #ifdef TRIM
    attribute vec4 rim;     // a doorway's bead: tube radius signed by the side the opening is on, how far along its loop, how far out through the wall, height over the floor (build.ts)
    attribute vec2 rimIn;   // the way into the chamber through its doorway, in plan
    varying vec4 vRim;
    varying float vRimSide; // how far the eye is on the chamber's side of this point
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
    #if FLOOR
      vLead = lead;
      vFoot = foot;
    #endif
    #ifdef TRIM
      vRim = rim;
      vRimSide = dot(cameraPosition.xz - w.xz, rimIn);
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

/**
 * THE FLOOR. A chamber's floor is the same creature's belly: under the light that pools on it, it is
 * a wet membrane. In plan, all of it a slope of a height that is never drawn, only lit:
 *  - the concentric swells it is laid in, low enough to walk on;
 *  - membrane wrinkles at two sizes, long folds and fine crinkle;
 *  - pores, each a small pit with a soft lip;
 *  - the wall's scales carried on down across it, ring after ring towards the middle, flatter and
 *    darker than on the wall and gone well before the middle;
 *  - runnels of wet draining to the thread, which lights the floor beside it.
 * Each term fades by how many of it fall in a pixel, so none shimmers far off; all are exact slopes,
 * so none blurs at the lens. Roughness varies with the wrinkles: the folds' crests are wetter.
 */
const FLOOR_GLSL = /* glsl */ `
  // value noise and its slope
  vec3 noised(vec2 x) {
    vec2 i = floor(x);
    vec2 f = x - i;
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
    return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * (vec2(k1, k2) + k4 * u.yx));
  }

  // a fold: ridged noise in a stretched, turned frame M. Returns the height (0..1) and its slope in plan.
  vec3 fold(vec2 P, mat2 M) {
    vec3 nz = noised(M * P);
    float v = 2.0 * nz.x - 1.0;
    float s = v / sqrt(v * v + 0.01);   // a rounded crest, not a crease
    return vec3(1.0 - abs(v), -s * 2.0 * (transpose(M) * nz.yz));
  }

  void floorSkin(vec3 n, float q, inout vec3 albedo, inout float tone, inout vec3 nb, inout float wet, out vec3 glow) {
    vec3 dpx = dFdx(vW), dpy = dFdy(vW);
    float pw = max(length(dpx), length(dpy));    // metres of floor in a pixel, at its longest
    vec2 P = vW.xz;
    vec2 grad = vec2(0.0);                        // slope of the height, per metre of plan
    float shade = 1.0;

    float r = max((vPat.x - 0.5) * 1.6, 1e-3);
    float th = vPat.y * 6.2831853;
    vec2 radial = vec2(sin(th), cos(th));
    vec2 around = vec2(cos(th), -sin(th));

    // the swells the floor is laid in
    grad += radial * (-0.02 * 6.2831853 / 1.6) * sin(6.2831853 * q) * (1.0 - smoothstep(0.2, 0.6, pw / 1.6));

    // membrane wrinkles: long soft folds, and a fine crinkle over them
    const mat2 M1 = mat2(1.9, 3.6, -4.4, 2.3);
    const mat2 M2 = mat2(-9.0, 12.5, -21.0, -15.0);
    float f1 = 1.0 - smoothstep(0.03, 0.09, pw);
    float f2 = 1.0 - smoothstep(0.008, 0.025, pw);
    vec3 w1 = fold(P, M1);
    vec3 w2 = fold(P + w1.x * 0.05, M2);
    grad += w1.yz * (0.017 * f1) + w2.yz * (0.0035 * f2);
    shade *= 1.0 - 0.12 * f1 * (1.0 - w1.x) * (1.0 - w1.x);
    // the folds' crests are wetter than their troughs
    float gloss = 0.6 + 0.8 * w1.x * f1 + 0.3 * (w2.x - 0.5) * f2;

    // pores: a small pit with a soft lip, one in about every other cell
    {
      const float CELL = 0.07;
      vec2 pc = P / CELL;
      vec2 pi = floor(pc);
      float rnd = hash12(pi + 17.0);
      vec2 off = vec2(hash12(pi + 3.1), hash12(pi + 7.7)) - 0.5;
      float prad = 0.0045 + 0.007 * fract(rnd * 9.7);
      vec2 pd = (pc - pi - 0.5 - off * 0.45) * CELL;
      float pr = length(pd) / prad;
      float on = step(0.45, rnd) * smoothstep(1.2, 2.6, prad / pw);
      float pit = exp(-pr * pr * 2.2);
      float lip = exp(-(pr - 1.35) * (pr - 1.35) * 4.0);
      float dh = 0.4 * (0.4 * -8.0 * (pr - 1.35) * lip + 4.4 * pr * pit);
      grad += (pd / (length(pd) + 1e-6)) * (dh * on);
      shade *= 1.0 - on * (0.55 * pit - 0.04 * lip);
      gloss *= 1.0 - 0.6 * on * pit;
    }

    // the wall's scales, carried on across the floor: rings of them running in to the middle
    {
      const float SW = ${SCALE_W.toFixed(4)}, PITCH = ${SCALE_PITCH.toFixed(4)};
      float fw = pw / PITCH;
      float amp = (1.0 - smoothstep(0.13, 0.4, fw)) * smoothstep(0.3, 0.85, r / vFoot);
      if (amp > 0.0) {
        float ring = (vFoot - r) / PITCH;
        float row = floor(ring);
        vec2 N = max(vec2(6.0), floor(6.2831853 * (vFoot - (row + vec2(-0.5, 0.5)) * PITCH) / SW + 0.5));
        float t = ring - row;
        vec4 aboutA, aboutB;
        float hA = scale(vPat.y, N.x, row - 1.0, t + 1.0, aboutA);
        float hB = scale(vPat.y, N.y, row, t, aboutB);
        float top = step(hB, hA);
        vec4 about = mix(aboutB, aboutA, top);
        float e = about.x;
        vec2 de = vec2(5.8 * about.z * mix(N.y, N.x, top), 2.4 * about.w);
        vec2 g = vec2(0.0, TILT) - (0.3 + 1.4 * e) * de;
        // lying flatter than on the wall: a scale here is a few millimetres proud
        float HS = 0.0025 * amp;
        grad += HS * (g.x / (6.2831853 * r) * around - g.y / PITCH * radial);
        float under = 1.0 - top;
        float crease = 1.0 - smoothstep(0.0, 0.2 + 0.7 * under + 2.5 * fw, abs(hA - hB));
        float body = 1.0 - smoothstep(0.3, 1.3, e);
        float st = (1.0 - (0.25 + 0.3 * under) * crease) * (0.85 + 0.15 * body) * (0.92 + 0.16 * about.y);
        shade *= mix(1.0, st, 0.55 * amp);
        gloss *= mix(1.0, 0.7 + 0.5 * body, amp);
      }
    }

    // runnels of wet, draining across to the thread
    vec2 toT = vLead.xy;
    float d = length(toT);
    vec2 dirT = toT / max(d, 1e-4);
    vec2 alongT = vec2(-dirT.y, dirT.x);
    float runnel = 0.0;
    {
      const float GAP = 0.12;
      float sc = vLead.z / GAP;
      float si = floor(sc);
      float r1 = hash12(vec2(si, 41.0));
      float r2 = hash12(vec2(si, 7.0));
      float hw = (0.007 + 0.014 * r2) * (1.0 - 0.5 * smoothstep(0.1, 1.2, d));   // half its width, narrowing as it reaches out
      float len = 0.3 + 1.0 * fract(r1 * 13.7);               // how far out from the thread it starts
      float wig = 0.006 * sin(d * 11.0 + r1 * 40.0) + 0.004 * sin(d * 27.0 + r2 * 20.0);
      float off = (sc - si - 0.5 - (r2 - 0.5) * 0.25) * GAP - wig;
      float x = abs(off) / hw;
      float prof = 1.0 - smoothstep(0.0, 1.0, x);
      float sres = max(fwidth(vLead.z), pw);
      float on = step(0.55, r1) * vLead.w * smoothstep(len, len * 0.35, d) * smoothstep(0.05, 0.13, d) * (1.0 - smoothstep(0.5 * hw, 1.5 * hw, sres));
      float streak = prof * prof * on;
      // a shallow channel: its banks tilt in towards its middle
      grad += alongT * (sign(off) * 0.12 * on * step(x, 1.0) * (1.0 - x));
      shade *= 1.0 - 0.5 * streak;
      gloss += 2.0 * streak;
      runnel = streak;
    }

    nb = normalize(n - vec3(grad.x, 0.0, grad.y));
    albedo *= shade;
    wet = 0.5 * gloss;

    // the thread's light on the floor beside it, on whatever of the skin is turned to it
    vec3 Lt = normalize(vec3(toT.x, 0.1, toT.y));
    float lam = max(dot(nb, Lt), 0.0);
    float near = 1.0 / (1.0 + d * d / 0.04);
    glow = vec3(0.06, 0.62, 0.44) * (near * (0.25 + 0.75 * lam) * 0.32 * (0.7 + 0.3 * min(gloss, 1.5)));
    // and runs up the runnels a little way, on their wet film
    glow += vec3(0.06, 0.62, 0.44) * (runnel * 0.16 / (1.0 + d * d / 0.1));
  }
`;

/**
 * THE TRIM. The bead round a doorway is a round tube (build.ts), and bare it reads as moulded. It is
 * the wall's own flesh, drawn up into a lip: round the tube from the wall to the opening,
 *  - a dark crease where it leaves the wall, and where its feet go into the floor;
 *  - the wall's scales and the wall's colour up the outer shoulder, lying down one by one towards
 *    the crest;
 *  - the lip, bare membrane: fine ridges running along it, flushed in slow blotches, with one soft
 *    coral sheen where it is turned to the lantern;
 *  - the thin inner edge, where light comes through hot red and the veins show.
 * As on the walls, all relief is a slope that is lit, never a drawn line, and fades by how much of
 * it falls in a pixel. It also lies down towards the tube's outline, so that stays one clean curve,
 * and the glints are taken off a calmer surface than the shading, so the highlight stays one band:
 * relief up to the outline and a highlight broken over every ridge are what made an earlier try at
 * this read as laminated. All of it is only for an eye inside the chamber: from the corridor the bead
 * is the plain dark arch round the chamber's sight, as the scene's first seconds need it.
 */
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
  #if SHROOM
    uniform sampler2D uShroomTex;
    uniform vec4 uShroomGrid;
    uniform vec2 uShroomSize;
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
  #endif
  #if SKIN || FLOOR || defined(TRIM)
    ${SKIN_GLSL}
  #endif
  #ifdef TRIM
    varying vec4 vRim;
    varying float vRimSide;
  #endif
  #if FLOOR
    varying vec4 vLead;
    varying float vFoot;
    ${FLOOR_GLSL}
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

    // --- a doorway's trim is grown out of the wall (see THE TRIM) ---------------------------------
    #ifdef TRIM
      // u: round the tube from its crest, which faces the chamber: + over the lip into the opening,
      // - down the outer shoulder to the wall. q jumps at the back of the tube, so slopes are taken
      // from vPat itself.
      float sgn = sign(vRim.x);
      float rho = abs(vRim.x);
      float u = 6.2831853 * q * sgn;
      float S = vRim.y;
      vec2 dU = (6.2831853 * sgn) * vec2(dFdx(vPat.x), dFdy(vPat.x));
      vec2 dS = vec2(dFdx(S), dFdy(S));
      // only what stands in the chamber, and only to an eye in the chamber: from the corridor, coming
      // in, the bead is the plain dark arch it was, round whatever hangs in the chamber beyond
      float front = (1.0 - smoothstep(0.02, 0.12, vRim.z)) * smoothstep(0.0, 0.6, vRimSide);
      // every relief lies down towards the outline, which stays the round tube's own
      float calm = smoothstep(0.06, 0.45, dot(n, V)) * front;
      float climb = smoothstep(-1.5, 0.2, u);      // 0 where the shoulder leaves the wall, 1 at the crest
      vec2 dH = vec2(0.0);                            // slope of the relief's height, in world units, per pixel
      float trimTone = 1.0;
      float scaly = 0.0;                              // how much of a scale stands here, and how wet it is
      float scaleWet = 0.0;

      // the wall's own scales, the wall's size, in rings along the loop with their tips up the
      // shoulder. They thin out as they climb: one by one they lie down, and the crest is bare.
      {
        float aN = S / ${SCALE_W.toFixed(3)};
        float rr = (u + 3.0) * rho / ${SCALE_PITCH.toFixed(3)};
        vec2 daN = dS / ${SCALE_W.toFixed(3)};
        vec2 drr = dU * (rho / ${SCALE_PITCH.toFixed(3)});
        float fw = max(max(abs(daN.x), abs(daN.y)), max(abs(drr.x), abs(drr.y)));
        float detail = (1.0 - smoothstep(0.13, 0.4, fw)) * (1.0 - smoothstep(0.1, 0.45, u)) * front;
        if (detail > 0.0) {
          float row = floor(rr);
          float t = rr - row;
          vec4 aboutA, aboutB;
          float hA = scale(aN / 1024.0, 1024.0, row - 1.0, t + 1.0, aboutA);
          float hB = scale(aN / 1024.0, 1024.0, row, t, aboutB);
          float top = step(hB, hA);
          vec4 about = mix(aboutB, aboutA, top);
          float e = about.x;
          vec2 de = vec2(5.8 * about.z, 2.4 * about.w);
          vec2 g = vec2(0.0, TILT) - (0.3 + 1.4 * e) * de;
          float amp = detail * (1.0 - smoothstep(0.0, 0.4, u + 0.8 - 0.8 * about.y));
          // (scales are the coarsest relief here, and lie down soonest towards the outline)
          float calmS = calm * smoothstep(0.22, 0.7, dot(n, V));
          dH += (0.03 * amp * calmS) * (g.x * daN + g.y * drr);
          float under = 1.0 - top;
          float crease = 1.0 - smoothstep(0.0, 0.2 + 0.7 * under + 2.5 * fw, abs(hA - hB));
          float body = 1.0 - smoothstep(0.3, 1.3, e);
          // The lantern is square on to most of the bead, where a tilted scale shades no differently from
          // a flat one: so each is also toned as it lies, dark at the root under its neighbours' tips
          // and light at its own, or the creases alone would be a net drawn on the tube.
          float lap = smoothstep(0.25, -0.75, about.w);
          float tn = (1.0 - (0.16 + 0.26 * under) * crease) * (0.84 + 0.16 * body) * (0.92 + 0.16 * about.y) * (1.06 - 0.24 * lap);
          trimTone = mix(1.0, tn, amp * calmS);
          scaly = amp * calmS;
          scaleWet = body;
          albedo = mix(albedo, albedo * vec3(0.92, 0.6, 1.25), amp * smoothstep(0.72, 0.9, about.y) * 0.6);
        }
      }

      // the lip, from the crest over into the opening: fine ridges that run along it, wander, and
      // come and go, at two sizes. Each fades by how much of it falls in a pixel.
      float lip = smoothstep(-0.6, 0.35, u) * (1.0 - smoothstep(2.3, 2.85, u));
      float a1 = S * 1.7 + 2.0 * u, a2 = S * 4.3 - 1.3 * u;
      float wander = 1.1 * sin(a1) + 0.6 * sin(a2);
      vec2 dW = 1.1 * cos(a1) * (1.7 * dS + 2.0 * dU) + 0.6 * cos(a2) * (4.3 * dS - 1.3 * dU);
      float p1 = 34.0 * u + wander;
      float p2 = 97.0 * u + 2.3 * wander + 1.7 * sin(S * 6.1);
      vec2 dp1 = 34.0 * dU + dW;
      vec2 dp2 = 97.0 * dU + 2.3 * dW + (10.4 * cos(S * 6.1)) * dS;
      float comb = lip * (0.55 + 0.45 * sin(S * 0.8 + 2.0 * sin(S * 0.31) + u));
      float r1f = comb * (1.0 - smoothstep(0.9, 2.2, max(abs(dp1.x), abs(dp1.y))));
      float r2f = comb * (1.0 - smoothstep(0.9, 2.2, max(abs(dp2.x), abs(dp2.y))));
      dH -= (rho * calm) * (0.0047 * r1f * sin(p1) * dp1 + 0.0013 * r2f * sin(p2) * dp2);
      float furrow = r1f * (0.5 - 0.5 * cos(p1));     // 1 down in a furrow between two ridges
      trimTone *= 1.0 - 0.12 * furrow * calm;
      // and it is flushed in slow blotches, as no moulded thing is
      float flush = sin(S * 1.3 + 1.5 * sin(u * 1.1 + S * 0.5)) * sin(S * 3.1 - 2.0 * u + 1.0);
      albedo *= 1.0 + front * flush * vec3(0.07, -0.05, 0.1);

      // veins under the membrane of the inner lip: each comes up from the thin edge, forks, and gives
      // out before the crest
      float vs = S * 3.2 + 0.5 * sin(u * 2.3 + S * 1.1) + 0.2 * sin(u * 6.1 - S * 2.9);
      float vi = floor(vs);
      float vr = hash12(vec2(vi, 7.0));
      float uEnd = 0.1 + 0.9 * vr;                    // where it gives out
      float uFork = uEnd + 1.0;
      float vx = abs(vs - vi - 0.5 - 0.3 * (vr - 0.5)) - 0.11 * smoothstep(uFork, uFork - 0.9, u);
      float vw = 0.05 + 0.04 * smoothstep(uEnd, 2.5, u);
      float vwide = max(vw, 1.2 * max(abs(dFdx(vs)), abs(dFdy(vs))));
      float vein = exp(-vx * vx / (vwide * vwide)) * (vw / vwide) * smoothstep(uEnd, uEnd + 0.9, u)
        * (1.0 - smoothstep(2.5, 2.9, u)) * step(0.25, vr) * front;

      // bend the normal by the slope of it all
      if (front > 0.0) {
        vec3 r1 = cross(dFdy(vW), n), r2 = cross(n, dFdx(vW));
        float det = dot(dFdx(vW), r1);
        nb = normalize((abs(det) + 1e-9) * n - sign(det) * (dH.x * r1 + dH.y * r2));
      }
      tone *= trimTone;
      // the wall's own colour runs up the shoulder with its scales; from the crest in it is the lip's
      // pale coral, with no stripe painted along it
      ridge = mix(ridge, mix(0.55, 0.9, climb), front);
      // the membrane is damp, not glazed, and damper in some places than others; a scale is as wet as the wall's
      wet = mix(wet, mix(0.2 + 0.08 * sin(S * 2.9 + 1.7 * sin(S * 1.1)), scaleWet, scaly), front);
    #endif

    // --- a chamber's floor is skin too (see FLOOR_GLSL) ------------------------------------------
    #if FLOOR
      vec3 threadGlow;
      floorSkin(n, q, albedo, tone, nb, wet, threadGlow);
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
    #ifdef TRIM
      // a trim's glints are taken off a calmer surface than its shading (but for its scales, which
      // glint as the wall's do): one band along the lip, not a patch on every ridge
      float sg = max(dot(normalize(mix(n, nb, 1.0 - 0.65 * front * (1.0 - scaly))), V), 0.0);
    #else
      float sg = ndl;
    #endif
    float s2 = sg * sg, s4 = s2 * s2, s8 = s4 * s4, s16 = s8 * s8, s32 = s16 * s16, s64 = s32 * s32;
    col += (vec3(1.0, 0.74, 0.64) * s64 * s64 * 0.45 + vec3(0.9, 0.2, 0.18) * s8 * 0.05) * wet * lantern * open;

    // and a film that carries the haze at a grazing angle. Right at the lens there is no haze to
    // carry, so a wall beside the camera keeps its red.
    float far = dist * dist / (dist * dist + 12.0);
    col += vec3(0.42, 0.05, 0.30) * graze * (0.05 + 0.16 * length(vGlow) + 0.2 * far / (1.0 + dist * dist / 60.0));

    #ifdef TRIM
      {
        // the veins are a deeper red
        col *= 1.0 - 0.2 * vein * vec3(0.2, 0.9, 0.6);
        // the membrane's sheen: one soft band along the lip where it is turned to the lantern, which
        // slides round the tube with the view. Coral-pink and never pale; the ridges comb it.
        float band = 0.5 * s8 + 0.5 * s32;
        col += vec3(1.0, 0.33, 0.31) * (band * 0.2 * lantern * open * front * (0.45 + 0.55 * lip) * (1.0 - 0.4 * furrow));
        // light through the thin inner edge: it goes a hot red there, not a pale one, most where it
        // is seen edge-on, and the veins stand dark in it
        float thin = smoothstep(0.7, 2.0, u) * (1.0 - smoothstep(2.5, 2.9, u)) * front
          * (0.35 + 0.65 * graze) * min(0.5 + 0.5 * lantern + 0.6 * length(vGlow), 1.5) * (0.6 + 0.4 * open) * (1.0 - 0.6 * vein);
        col = col * (1.0 - thin * vec3(0.0, 0.38, 0.5)) + vec3(0.32, 0.03, 0.0) * thin;
        // the creases: where the shoulder goes into the wall, and where the feet go into the floor
        float seat = smoothstep(-0.9, -1.5, u) * smoothstep(-0.17, 0.0, vRim.z);
        float foot = 1.0 - smoothstep(0.0, 0.5 * rho / 0.27, vRim.w);
        col *= 1.0 - 0.72 * clamp(seat * seat + foot * foot * (3.0 - 2.0 * foot), 0.0, 1.0) * front;
      }
    #endif

    #if FLOOR
      // the wet floor gives back the coral of the walls round it, low and only where it is turned to
      // catch them, and the thread lights the floor either side of it
      vec3 Rf = reflect(-V, nb);
      float fres = graze * graze;
      vec3 env = vec3(0.55, 0.13, 0.14) * smoothstep(-0.02, 0.25, Rf.y) * (1.0 - 0.6 * smoothstep(0.25, 0.8, Rf.y));
      col += env * fres * wet * 0.1 * open * (1.0 - far * 0.6);
      col += threadGlow * open;
    #endif

    // --- what each mushroom does to the floor it stands on ----------------------------------------
    // Its foot presses a small dark dot into the floor, the cap shades a wider ring round that, and
    // the glowing gills throw a pool of its own colour round it, lit as a lamp hung under the cap
    // would light it: brightest straight below, falling off with the square of the distance and the
    // slant. The pools add up but saturate, so a whole grove glows and none outshines the hoop.
    #if SHROOM
      {
        vec2 gc = (vW.xz - uShroomGrid.xy) * uShroomGrid.z;
        // nothing reaches higher than the tallest's pool: walls and vaults skip the lookup
        if (vH < 1.8 && gc.x >= 0.0 && gc.y >= 0.0 && gc.x < uShroomSize.x && gc.y < uShroomSize.y) {
          ivec2 ci = ivec2(gc);
          vec3 pool = vec3(0.0);
          float shade = 1.0;
          for (int k = 0; k < ${SHROOM_SLOTS}; k++) {
            vec4 m = texelFetch(uShroomTex, ivec2(ci.x * ${SHROOM_SLOTS} + k, ci.y), 0);
            if (m.w <= 0.0) break;
            float hue = floor(m.w) - 1.0;
            float h = fract(m.w) * 4.0;
            vec3 rel = vW - m.xyz;
            float R = 0.2 + 0.6 * h;
            float d2 = dot(rel, rel);
            if (d2 > R * R) continue;
            float win = 1.0 - smoothstep(0.3 * R * R, R * R, d2);
            float flat2 = dot(rel.xz, rel.xz);
            float level = 1.0 - smoothstep(0.08 + 0.1 * h, 0.25 + 0.3 * h, abs(rel.y));
            // the foot and the cap's shade
            float foot = 0.065 * h + 0.025;
            shade *= 1.0 - level * (0.7 * exp(-flat2 / (foot * foot)) + 0.22 * exp(-flat2 / (0.09 * h * h)));
            // the gills' light
            vec3 L = vec3(0.0, 0.8 * h, 0.0) - rel;
            float l2 = dot(L, L);
            float e = max(dot(nb, L), 0.0) * inversesqrt(l2) * (0.5 * h * h) / l2;
            vec3 c = hue < 0.5 ? vec3(0.1, 1.0, 0.72) : hue < 1.5 ? vec3(0.75, 0.45, 1.0) : hue < 2.5 ? vec3(1.0, 0.62, 0.2) : vec3(1.0, 0.35, 0.55);
            pool += c * (e * win);
          }
          col *= shade;
          pool /= 1.0 + 1.6 * max(max(pool.r, pool.g), pool.b);
          col += pool * 0.2 * (0.55 + 0.45 * shade) * (0.6 + 0.4 * groove);
        }
      }
    #endif

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
  /** the mushrooms light it (see SHROOM in WALL_FRAG; the light itself comes later, from setShroomLight) */
  shrooms?: boolean;
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
 * way the hoop's face looks in plan, which the scene writes every frame as the hoop turns. Without
 * one it is a doorway's trim (THE TRIM), whose geometry carries `rim` and `rimIn` (build.ts).
 */
export function createTrimMaterial(shared: Shared, o: WallOptions) {
  return new ShaderMaterial({
    // the trim that the hoop's pool falls on is the chambers' floor, which is skin of its own (FLOOR_GLSL)
    defines: { MODE: 0, SKIN: 0, FLOOR: o.pool ? 1 : 0, POOL: o.pool ? 1 : 0, SHROOM: o.shrooms ? 1 : 0, ...(o.pool ? {} : { TRIM: 1 }) },
    uniforms: {
      ...wallUniforms(shared, o),
      ...(o.pool ? { uPool: { value: o.pool.clone() }, uPoolN: { value: new Vector2(0, 1) } } : {}),
      ...(o.shrooms ? shroomUniforms() : {}),
    },
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: DoubleSide,
  });
}

/** corridor walls: cut away wherever they reach into a chamber */
export function createCorridorMaterial(shared: Shared, chambers: Chamber[]) {
  return new ShaderMaterial({
    defines: { MODE: 1, SKIN: 1, FLOOR: 0, POOL: 0, SHROOM: 1 },
    uniforms: {
      ...shroomUniforms(),
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
    defines: { MODE: 2, SKIN: 1, FLOOR: 0, POOL: 0, SHROOM: 0 },
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
