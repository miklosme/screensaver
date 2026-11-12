import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { Look } from "./looks";
import { blackTexture } from "./portalMaterial";

/**
 * The one place where a frame becomes a picture: bloom, grade, vignette, tone curve, sRGB encode
 * and dither, applied to the finished linear HDR frame (current scene, portal and all).
 *
 * Bloom is a mip chain. The frame is thresholded and halved again and again, then the levels are
 * added back together from the smallest up, each one blurred a little more by the upsample. All
 * targets and programs are built here, at mount, and nothing reads a previous frame.
 */

/** blur octaves, each twice as wide as the one before; the widest spreads a light over about a tenth of the screen's height */
const OCTAVES = 6;
/** The chain starts from a picture about this tall, whatever the screen: bloom looks the same at 1080p and at 4K. */
const BASE_HEIGHT = 1080;
/** plain halvings available to get a large drawing buffer down to BASE_HEIGHT (two cover 8K) */
const MAX_HALVINGS = 2;

const VERTEX = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * How every pass that reads the frame itself reads it: with the next scene's picture faded over it
 * by uFade. Mixing here, after the multisamples are resolved, gives exactly what blending a
 * full-screen quad into the frame would (both are linear) without touching every sample of it.
 */
const SOURCE = /* glsl */ `
  uniform sampler2D tSource;
  uniform sampler2D tOver;
  uniform float uFade;
  vec3 source(vec2 uv) {
    vec3 c = texture2D(tSource, uv).rgb;
    if (uFade > 0.0) c = mix(c, texture2D(tOver, uv).rgb, uFade);
    return c;
  }
`;

/** One bilinear tap in the middle of four texels: their average. */
const HALVE = /* glsl */ `
  ${SOURCE}
  uniform vec2 uSize;
  void main() {
    gl_FragColor = vec4(source(gl_FragCoord.xy / uSize), 1.0);
  }
`;

/** 13 taps, 4 of them on texel corners: a 2x reduction that does not shimmer when the picture moves */
const DOWN = /* glsl */ `
  ${SOURCE}
  uniform vec2 uTexel;
  uniform vec2 uSize;
  #ifdef PREFILTER
    uniform vec3 uCurve;
    uniform vec3 uCount;
    float weigh(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
  #endif
  vec3 tap(vec2 uv, float x, float y) { return source(uv + vec2(x, y) * uTexel); }
  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    vec3 a = tap(uv, -2.0, -2.0), b = tap(uv, 0.0, -2.0), c = tap(uv, 2.0, -2.0);
    vec3 d = tap(uv, -2.0, 0.0), e = tap(uv, 0.0, 0.0), f = tap(uv, 2.0, 0.0);
    vec3 g = tap(uv, -2.0, 2.0), h = tap(uv, 0.0, 2.0), i = tap(uv, 2.0, 2.0);
    vec3 j = tap(uv, -1.0, -1.0), k = tap(uv, 1.0, -1.0), l = tap(uv, -1.0, 1.0), m = tap(uv, 1.0, 1.0);
    #ifdef PREFILTER
      // Five overlapping boxes, each weighed down by its own brightness: one very bright pixel
      // cannot own the average, so a small light does not flicker as it crosses pixel boundaries.
      vec3 g0 = min((j + k + l + m) * 0.25, 64.0);
      vec3 g1 = min((a + b + d + e) * 0.25, 64.0), g2 = min((b + c + e + f) * 0.25, 64.0);
      vec3 g3 = min((d + e + g + h) * 0.25, 64.0), g4 = min((e + f + h + i) * 0.25, 64.0);
      float w0 = 0.5 * weigh(g0), w1 = 0.125 * weigh(g1), w2 = 0.125 * weigh(g2), w3 = 0.125 * weigh(g3), w4 = 0.125 * weigh(g4);
      vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
      // soft-knee threshold: uCurve = (threshold, threshold - knee, 0.25 / knee)
      vec3 counted = col * uCount;
      float br = max(counted.r, max(counted.g, counted.b));
      float soft = clamp(br - uCurve.y, 0.0, 2.0 * (uCurve.x - uCurve.y));
      col *= max(soft * soft * uCurve.z, br - uCurve.x) / max(br, 1e-4);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    #else
      gl_FragColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
    #endif
  }
`;

/** 3x3 tent. Blended as `source * uWeights.x + destination * uWeights.y`, so each level keeps its own share. */
const UP = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uTexel;
  uniform vec2 uSize;
  uniform vec2 uWeights;
  vec3 tap(vec2 uv, float x, float y) { return texture2D(tSource, uv + vec2(x, y) * uTexel).rgb; }
  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    vec3 col = tap(uv, 0.0, 0.0) * 4.0
      + (tap(uv, -1.0, 0.0) + tap(uv, 1.0, 0.0) + tap(uv, 0.0, -1.0) + tap(uv, 0.0, 1.0)) * 2.0
      + tap(uv, -1.0, -1.0) + tap(uv, 1.0, -1.0) + tap(uv, -1.0, 1.0) + tap(uv, 1.0, 1.0);
    gl_FragColor = vec4(col * (uWeights.x / 16.0), uWeights.y);
  }
`;

const FINAL = /* glsl */ `
  ${SOURCE}
  uniform sampler2D tBloom;
  uniform vec2 uSize;
  uniform float uBloom;
  uniform vec3 uLift;
  uniform vec3 uInvGamma;
  uniform vec3 uGain;
  uniform float uVignette;
  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    vec3 col = source(uv) + texture2D(tBloom, uv).rgb * uBloom;
    col = pow(max(col * uGain + uLift, 0.0), uInvGamma);
    // 0 in the middle of the screen, 1 in its corners, whatever the aspect
    vec2 q = uv * 2.0 - 1.0;
    float r2 = dot(q, q) * 0.5;
    col *= 1.0 - uVignette * r2 * (0.4 + 0.6 * r2);
    // the renderer's own tone curve and exposure, then its output encoding
    #ifdef TONE_MAPPING
      col = toneMapping(col);
    #endif
    gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
    // A fixed pattern, one 8-bit step wide: it breaks up banding in fog and night skies, and
    // because it never changes a frozen frame stays reproducible.
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb += (noise - 0.5) / 255.0;
  }
`;

function pass(fragmentShader: string, uniforms: ShaderMaterial["uniforms"], defines: Record<string, string> = {}) {
  return new ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, fog: false });
}

export interface Post {
  /** call when the drawing buffer changes size */
  setSize(width: number, height: number): void;
  /**
   * `frame` (linear HDR, the drawing buffer's size) through the whole chain onto the canvas.
   * `over` is a second picture of the same size, laid over the frame with opacity `fade`.
   */
  render(gl: WebGLRenderer, frame: Texture, look: Look, over?: Texture, fade?: number): void;
  dispose(): void;
}

export function createPost(): Post {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const sizeOf = () => ({
    tSource: { value: null as Texture | null },
    tOver: { value: blackTexture as Texture },
    uFade: { value: 0 },
    uTexel: { value: new Vector2() },
    uSize: { value: new Vector2() },
  });
  const halve = pass(HALVE, sizeOf());
  const prefilter = pass(DOWN, { ...sizeOf(), uCurve: { value: new Vector3() }, uCount: { value: new Vector3(1, 1, 1) } }, { PREFILTER: "" });
  const down = pass(DOWN, sizeOf());
  const up = pass(UP, { ...sizeOf(), uWeights: { value: new Vector2() } });
  up.blending = CustomBlending;
  up.blendSrc = OneFactor;
  up.blendDst = SrcAlphaFactor;
  const final = pass(FINAL, {
    ...sizeOf(),
    tBloom: { value: null as Texture | null },
    uBloom: { value: 0 },
    uLift: { value: new Vector3() },
    uInvGamma: { value: new Vector3(1, 1, 1) },
    uGain: { value: new Vector3(1, 1, 1) },
    uVignette: { value: 0 },
  });
  const materials = [halve, prefilter, down, up, final];

  const mesh = new Mesh(geometry, final);
  mesh.frustumCulled = false;

  const target = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const halvings = Array.from({ length: MAX_HALVINGS }, target);
  const levels = Array.from({ length: OCTAVES }, target);
  /** how many of each are in use at the current size */
  let halved = 0;
  let count = 0;
  const full = new Vector2(1, 1);

  const draw = (gl: WebGLRenderer, material: ShaderMaterial, source: Texture, sw: number, sh: number, target: WebGLRenderTarget | null) => {
    const u = material.uniforms;
    u.tSource!.value = source;
    u.uTexel!.value.set(1 / sw, 1 / sh);
    if (target) u.uSize!.value.set(target.width, target.height);
    else u.uSize!.value.copy(full);
    mesh.material = material;
    gl.setRenderTarget(target);
    gl.render(mesh, camera);
  };
  /** the fade belongs to whichever pass reads the frame itself; every later pass gets a picture that already has it */
  const fadeIn = (material: ShaderMaterial, over: Texture, fade: number) => {
    material.uniforms.tOver!.value = fade > 0 ? over : blackTexture;
    material.uniforms.uFade!.value = fade;
  };

  return {
    setSize(width, height) {
      full.set(width, height);
      // A large drawing buffer is first halved, cheaply, to about BASE_HEIGHT. From there the chain
      // is the same at every resolution, in cost as well as in looks.
      halved = Math.min(MAX_HALVINGS, Math.max(0, Math.round(Math.log2(height / BASE_HEIGHT))));
      let w = width;
      let h = height;
      for (let i = 0; i < halved; i++) halvings[i]!.setSize((w = Math.max(1, Math.round(w / 2))), (h = Math.max(1, Math.round(h / 2))));
      count = 0;
      for (let i = 0; i < OCTAVES && w >= 4 && h >= 4; i++) {
        levels[i]!.setSize((w = Math.round(w / 2)), (h = Math.round(h / 2)));
        count = i + 1;
      }
    },

    render(gl, frame, look, over = blackTexture, fade = 0) {
      const autoClear = gl.autoClear;
      gl.autoClear = false;
      const bloom = look.bloom > 0 && count > 1;
      if (bloom) {
        let source = frame;
        let sw = full.x;
        let sh = full.y;
        for (let i = 0; i < halved; i++) {
          const to = halvings[i]!;
          fadeIn(halve, over, i === 0 ? fade : 0);
          draw(gl, halve, source, sw, sh, to);
          source = to.texture;
          sw = to.width;
          sh = to.height;
        }
        const knee = Math.max(look.knee, 1e-4);
        prefilter.uniforms.uCurve!.value.set(look.threshold, look.threshold - knee, 0.25 / knee);
        prefilter.uniforms.uCount!.value.fromArray(look.counts);
        fadeIn(prefilter, over, halved === 0 ? fade : 0);
        draw(gl, prefilter, source, sw, sh, levels[0]!);
        for (let i = 1; i < count; i++) draw(gl, down, levels[i - 1]!.texture, levels[i - 1]!.width, levels[i - 1]!.height, levels[i]!);

        // weight of octave i is spread^i, normalised so that they sum to 1
        let sum = 0;
        for (let i = 0; i < count; i++) sum += look.spread ** i;
        const weight = (i: number) => look.spread ** i / sum;
        for (let i = count - 2; i >= 0; i--) {
          up.uniforms.uWeights!.value.set(i === count - 2 ? weight(count - 1) : 1, weight(i));
          draw(gl, up, levels[i + 1]!.texture, levels[i + 1]!.width, levels[i + 1]!.height, levels[i]!);
        }
      }
      const u = final.uniforms;
      u.tBloom!.value = levels[0]!.texture;
      u.uBloom!.value = bloom ? look.bloom : 0;
      u.uLift!.value.fromArray(look.lift);
      u.uInvGamma!.value.set(1 / look.gamma[0], 1 / look.gamma[1], 1 / look.gamma[2]);
      u.uGain!.value.fromArray(look.gain);
      u.uVignette!.value = look.vignette;
      fadeIn(final, over, fade);
      draw(gl, final, frame, full.x, full.y, null);
      gl.autoClear = autoClear;
    },

    dispose() {
      geometry.dispose();
      for (const m of materials) m.dispose();
      for (const l of [...halvings, ...levels]) l.dispose();
    },
  };
}
