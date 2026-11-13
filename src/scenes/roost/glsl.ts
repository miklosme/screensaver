import { Vector3 } from "three";
import { CENTRE, COLUMN, CURTAIN_R, FLOOR_R, FLOOR_Y, UNDER_Y } from "./layout";

/**
 * What every roost shader shares: the palette, the clock, the hen's breath, the curtain all round
 * and the light the world is lit by. There are no three.js lights: every surface is shaded from
 * these closed-form functions, so a glazed thing reflects the very curtain the backdrop draws.
 *
 * The lighting, in one paragraph. Under the floor the light comes from above: the floor's matt
 * underside is a white ceiling, the lamp (the nest's bowl) glows, and the column of light falls
 * through the hole. Above it the light comes from below and from the horizon: the glaze is white,
 * the sky is dark, and the seam of gold under the curtain is a ring of footlights.
 */

export interface Shared {
  uT: { value: number };
  uHen: { value: Vector3 };
}

export const createShared = (hen: Vector3): Shared => ({ uT: { value: 0 }, uHen: { value: hen.clone() } });

const f = (x: number) => x.toFixed(3);

export const COMMON = /* glsl */ `
  #define FLOOR_Y ${f(FLOOR_Y)}
  #define UNDER_Y ${f(UNDER_Y)}
  #define FLOOR_R ${f(FLOOR_R)}
  #define CURTAIN_R ${f(CURTAIN_R)}
  uniform float uT;
  uniform vec3 uHen;
  const vec2 CENTRE = vec2(${f(CENTRE.x)}, ${f(CENTRE.z)});
  const vec3 COLUMN = vec3(${f(COLUMN.x)}, ${f(COLUMN.z)}, ${f(COLUMN.r)});

  // palette, linear
  const vec3 BONE = vec3(0.905, 0.862, 0.79);
  const vec3 CELADON = vec3(0.485, 0.61, 0.475);
  const vec3 COBALT = vec3(0.014, 0.05, 0.33);
  const vec3 MOSS = vec3(0.019, 0.03, 0.011);
  const vec3 MOSS_DEEP = vec3(0.0045, 0.007, 0.004);
  const vec3 GOLD = vec3(1.0, 0.69, 0.254);
  const vec3 PERSIMMON = vec3(0.76, 0.08, 0.023);

  /** the hen's breath, -1 .. 1 on a 5 s cycle: her body swells with it and the lamp glows with it */
  float breath() { return sin(6.2831853 * uT / 5.0); }
  float lampGlow() { return 1.0 + 0.16 * breath(); }

  /** half the height of the slit of light under the curtain: it is starting to go up */
  float seamGap() { return mix(1.6, 4.0, smoothstep(5.0, 25.0, uT)); }

  /** the curtain, h above the floor plane at azimuth az */
  vec3 curtain(float h, float az) {
    float g = seamGap() + 0.5 * abs(sin(az * 70.0));
    float ah = abs(h);
    float pleat = 0.5 + 0.5 * sin(az * 180.0 + 1.3 * sin(az * 23.0));
    vec3 velvet = mix(MOSS * 1.4, MOSS_DEEP, smoothstep(g, g + 60.0, ah)) * (0.45 + 0.9 * pleat);
    // the hem of the curtain catches the light that comes under it
    float lit = exp(-max(ah - g, 0.0) / 2.5);
    velvet += GOLD * (0.12 + 0.3 * pleat) * lit;
    float core = 1.0 - smoothstep(g - 0.7, g, ah);
    return mix(velvet, GOLD * mix(3.0, 5.5, 1.0 - ah / g), core);
  }

  /** where a ray from p along dir meets the curtain: height above the floor plane, azimuth */
  vec2 curtainHit(vec3 p, vec3 dir) {
    float hl = max(length(dir.xz), 1e-3);
    vec2 o = p.xz - CENTRE;
    vec2 d = dir.xz / hl;
    float b = dot(o, d);
    float s = -b + sqrt(max(b * b - dot(o, o) + CURTAIN_R * CURTAIN_R, 0.0));
    vec2 q = o + d * s;
    return vec2(p.y + dir.y / hl * s - FLOOR_Y, atan(q.x, q.y));
  }

  /** the far haze a ray from p along dir ends in: pale on the white side of the floor, moss on the dark, gold at the seam */
  vec3 haze(vec3 p, vec3 dir) {
    vec2 c = curtainHit(p, dir);
    bool under = p.y < FLOOR_Y;
    bool towardsFloor = under ? c.x > 0.0 : c.x < 0.0;
    vec3 pale = under ? vec3(0.4, 0.46, 0.37) : vec3(0.3, 0.33, 0.26);
    vec3 col = towardsFloor ? pale : MOSS * 1.6;
    float g = exp(-abs(c.x) / 14.0);
    return mix(col, GOLD * 0.75, g * g * 0.7);
  }
  float fogAmount(float d) { return 1.0 - exp(-d / 95.0); }

  /** what a glazed surface at p mirrors along dir */
  vec3 env(vec3 p, vec3 dir) {
    if (p.y < UNDER_Y && dir.y > 0.0) {
      float s = (UNDER_Y - p.y) / dir.y;
      vec2 q = p.xz + dir.xz * s - CENTRE;
      if (dot(q, q) < FLOOR_R * FLOOR_R) return mix(BONE * 0.7, haze(p, dir), fogAmount(s));
    }
    if (p.y > FLOOR_Y && dir.y < 0.0) {
      float s = (p.y - FLOOR_Y) / -dir.y;
      vec2 q = p.xz + dir.xz * s - CENTRE;
      if (dot(q, q) < FLOOR_R * FLOOR_R) return mix(BONE * 0.55, haze(p, dir), fogAmount(s));
    }
    vec2 c = curtainHit(p, dir);
    return curtain(c.x, c.y);
  }

  /** density of the column of light at p: soft across, strongest at the hole, fading down into the dark and up into the sky */
  float columnDensity(vec3 p) {
    vec2 q = p.xz - COLUMN.xy;
    float r2 = dot(q, q) / (COLUMN.z * COLUMN.z);
    float across = max(1.0 - r2, 0.0);
    across *= across;
    float y = p.y - FLOOR_Y;
    float along = y < 0.0 ? exp(y / 11.0) : exp(-y / 9.0) * 0.22;
    return across * along;
  }
  /** how deep p is in the column of light, 0 .. 1 */
  float inColumn(vec3 p) { return clamp(columnDensity(p) * 1.6, 0.0, 1.0); }

  /** the floor's mended cracks: distance to a sparse network of broken edges, both faces share it */
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float crackDist(vec2 xz) {
    // straight broken edges between cells, with a fine jag along them
    vec2 p = xz / 13.0;
    p += 0.006 * vec2(sin(xz.y * 7.1 + sin(xz.x * 3.3) * 2.0), sin(xz.x * 6.7 + sin(xz.y * 3.1) * 2.0));
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    vec2 c1 = vec2(0.0), c2 = vec2(0.0);
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 id = i + g;
        vec2 o = vec2(hash2(id), hash2(id + 17.3));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = id; }
        else if (d < d2) { d2 = d; c2 = id; }
      }
    // only some cells are broken apart
    float broken = step(hash2(c1 + c2 * 1.37), 0.38);
    float e = (d2 - d1) / (2.0 * length(c2 - c1 + vec2(hash2(c2), hash2(c2 + 17.3)) - vec2(hash2(c1), hash2(c1 + 17.3)))) * 13.0;
    return broken > 0.5 ? e : 99.0;
  }
  /** a gilt line along the cracks, crisp at 4K and faded where it is thinner than a pixel */
  float crackLine(vec2 xz, float width) {
    float d = crackDist(xz);
    float w = fwidth(xz.x) + fwidth(xz.y);
    float cover = min(1.0, width / max(w, 1e-4));
    return (1.0 - smoothstep(width, width + w, d)) * mix(0.35, 1.0, cover);
  }

  /**
   * Light on a glazed thing at p, normal n, seen along V (towards the eye). Returns the diffuse
   * light; the caller multiplies its colour and adds glaze().
   */
  vec3 lightAt(vec3 p, vec3 n) {
    bool under = p.y < FLOOR_Y - 0.05;
    float up = n.y * 0.5 + 0.5;
    vec3 L;
    if (under) {
      // a white ceiling above; below, the pale haze and the white eggs
      L = mix(vec3(0.46, 0.43, 0.36), vec3(0.8, 0.78, 0.72), up);
      // the lamp: the nest's glowing bowl hangs from the ceiling
      vec3 lamp = vec3(uHen.x, UNDER_Y - 5.0, uHen.z) - p;
      float dl = length(lamp);
      L += GOLD * (max(dot(n, lamp / dl), 0.0) * 0.7 + 0.15) * 120.0 / (60.0 + dl * dl) * lampGlow();
      // the column of light falling through the hole
      L += GOLD * inColumn(p) * (0.35 + 0.45 * up);
    } else {
      // the glaze below lights everything from underneath, the sky above is dark
      L = mix(vec3(0.42, 0.42, 0.38), MOSS * 3.0, up * up);
      // footlights: the gold seam all round, warmest from the south where the stage opens
      vec3 key = normalize(vec3(0.25, 0.2, 1.0));
      L += vec3(1.0, 0.82, 0.6) * (0.5 * max(dot(n, key) * 0.6 + 0.4, 0.0));
    }
    // the seam lights every flank from the horizon
    L += GOLD * 0.22 * pow(1.0 - abs(n.y), 2.0);
    return L;
  }

  /** the glaze: a fresnel mirror of the world round it */
  vec3 glaze(vec3 p, vec3 n, vec3 V, float k) {
    float ndv = max(dot(n, V), 0.0);
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    return env(p, reflect(-V, n)) * F * k;
  }

  /** white glaze stays under the bloom threshold */
  vec3 capWhite(vec3 c) { float m = max(c.r, max(c.g, c.b)); return m > 0.9 ? c * (0.9 / m) : c; }
`;

export const TONE = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
