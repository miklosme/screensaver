import { TIMING } from "../scenes/types";

type RGB = [number, number, number];

/**
 * The screen-space treatment of one scene. It is applied by the director's final pass to the whole
 * frame, portal included, never by the scene itself: that is what lets two scenes with different
 * numbers meet at a takeover without a pop (see `lookAt`).
 */
export interface Look {
  /** how much of the blurred highlights is added back onto the picture; 0 turns bloom off */
  bloom: number;
  /** linear brightness (the largest of r, g, b, each times its `counts`) above which a pixel blooms */
  threshold: number;
  /** width of the soft shoulder below the threshold, in the same units; 0 is a hard cut */
  knee: number;
  /**
   * How much each channel counts towards that brightness. [1, 1, 1] treats all colours alike;
   * lowering one keeps surfaces of that colour out of the bloom, so the lights of another can have it.
   */
  counts: RGB;
  /** 0 .. 1: weight of each wider blur octave relative to the one before. Low is a tight glint, high a wide haze. */
  spread: number;
  /** grade, on linear light before the tone curve: `pow(colour * gain + lift, 1 / gamma)` per channel */
  lift: RGB;
  gamma: RGB;
  gain: RGB;
  /** 0 .. 1: how much light the corners of the screen lose */
  vignette: number;
}

const neutral: Look = {
  bloom: 0,
  threshold: 1,
  knee: 0.5,
  spread: 0.7,
  counts: [1, 1, 1],
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  vignette: 0,
};

/**
 * Keyed by scene id. A scene without an entry gets the neutral look. Grades are neutral for now.
 *
 * The scenes were lit for an 8-bit canvas, so their lights are only a little brighter than their
 * lit surfaces (a lamp is 1.3 to 1.6 in linear light, a sunlit wall up to 0.8) and the thresholds
 * sit just above the surfaces. A light that is raised well above 1 can take a higher threshold
 * and will glow without anything else joining in.
 */
export const looks: Record<string, Look> = {
  // amber lamps at 1.35, arcade orbs and koi near 0.6; the ivory treads reach 0.6 in the lamplight
  helix: { ...neutral, bloom: 1.5, threshold: 0.6, knee: 0.2, spread: 0.75, vignette: 0.3 },
  // mint spores, cap spots and the path are green and white; the coral walls next to the camera are
  // as bright but red, so red counts for less here and the walls stay out of it
  burrow: { ...neutral, bloom: 2, threshold: 0.5, knee: 0.2, spread: 0.75, counts: [0.45, 1, 1], vignette: 0.34 },
  // daylight: sunlit sand and the pale band of the sky reach 2 in their strongest channel, and anything
  // lower than this veils the whole scene. Only the sun, the sparkles and the lights indoors are above it.
  dollhouse: { ...neutral, bloom: 0.25, threshold: 2.6, knee: 0.3, spread: 0.6, vignette: 0.2 },
  // lamps at 1.6, the moon at 0.9, windows at 0.55, against towers at 0.1
  orbit: { ...neutral, bloom: 1.8, threshold: 0.45, knee: 0.2, spread: 0.75, vignette: 0.32 },
};

const lookOf = (id: string) => looks[id] ?? neutral;

/**
 * The look of the frame when scene `current` is at local time `t` and `next` waits behind its
 * portal: the current scene's numbers, cross-faded into the next one's over the exit.
 *
 * At a takeover the outgoing scene is at TIMING.total and has fully become `next`; the incoming
 * one is at TIMING.arrival, where nothing has been faded yet. So the numbers are the same on both
 * sides of every cut, however different two neighbours are. Like everything else it is a pure
 * function of the scene clock.
 */
export function lookAt(out: Look, current: string, next: string, t: number): Look {
  const a = lookOf(current);
  const b = lookOf(next);
  const x = Math.min(1, Math.max(0, (t - TIMING.cycle) / (TIMING.total - TIMING.cycle)));
  const k = x * x * (3 - 2 * x);
  const mix = (p: number, q: number) => p + (q - p) * k;
  out.bloom = mix(a.bloom, b.bloom);
  out.threshold = mix(a.threshold, b.threshold);
  out.knee = mix(a.knee, b.knee);
  out.spread = mix(a.spread, b.spread);
  out.vignette = mix(a.vignette, b.vignette);
  for (let i = 0; i < 3; i++) {
    out.counts[i] = mix(a.counts[i]!, b.counts[i]!);
    out.lift[i] = mix(a.lift[i]!, b.lift[i]!);
    out.gamma[i] = mix(a.gamma[i]!, b.gamma[i]!);
    out.gain[i] = mix(a.gain[i]!, b.gain[i]!);
  }
  return out;
}

export const createLook = (): Look => ({ ...neutral, counts: [1, 1, 1], lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] });
