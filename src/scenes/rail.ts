import { TIMING } from "./types";

/**
 * THE RAIL — what makes four unrelated camera moves read as one continuous track.
 *
 * At a takeover the outgoing scene is at t = TIMING.total and the incoming one at t = TIMING.arrival.
 * The picture is identical on both sides of that cut, but the *motion* is only continuous if both
 * cameras are doing the same thing there. So every scene keeps the same "seam state" around both
 * of its seams:
 *
 *   - it travels in a straight line, along its own view axis,
 *   - it does not rotate (no yaw, pitch or roll rate),
 *   - at exactly RAIL.speed, without accelerating.
 *
 * A scene holds that state from t = 0 until RAIL.release and again from RAIL.settle until the end.
 * In between it is free, as long as it leaves and re-enters the state gradually: curvature has to
 * ramp like a railway transition curve, never switch on. `createRide` takes care of the speed
 * half of that; the track's shape is up to the scene.
 */
export const RAIL = {
  /** world units per second through every seam */
  speed: 3.4,
  /** local time until which an arriving scene holds the seam state */
  release: TIMING.arrival + 0.6,
  /** local time from which a leaving scene is back in the seam state */
  settle: TIMING.total - 1.4,
} as const;

/** length of straight track a scene needs at its start / before its portal */
export const RAIL_LEAD_IN = RAIL.speed * RAIL.release;
export const RAIL_LEAD_OUT = RAIL.speed * (TIMING.total - RAIL.settle);

const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export interface RideOptions {
  /**
   * Speed the scene would like mid-ride: a constant, or a function of local time for a ride that
   * e.g. starts brisk and winds down. Defaults to RAIL.speed (a perfectly even ride).
   */
  cruise?: number | ((t: number) => number);
  /** If given, the mid-ride speed is scaled so that exactly this much track is covered. */
  length?: number;
  /** seconds taken to get from RAIL.speed up to cruise after RAIL.release */
  rampIn?: number;
  /** seconds taken to get back down to RAIL.speed before RAIL.settle */
  rampOut?: number;
}

export interface Ride {
  /** track covered over the whole timeline */
  length: number;
  /** track covered at local time t; a pure function of t */
  at(t: number): number;
}

const STEP = 0.01;

/** A speed profile that obeys the seam state at both ends. Position along the track = start + at(t). */
export function createRide({ cruise = RAIL.speed, length, rampIn = 3, rampOut = 3 }: RideOptions = {}): Ride {
  const n = Math.round(TIMING.total / STEP);
  const want = typeof cruise === "number" ? () => cruise : cruise;
  // speed = RAIL.speed + k * extra(t), where extra vanishes around both seams
  const extra = (t: number) =>
    (want(t) - RAIL.speed) *
    smoothstep(RAIL.release, RAIL.release + rampIn, t) *
    (1 - smoothstep(RAIL.settle - rampOut, RAIL.settle, t));
  const bonus = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) bonus[i] = bonus[i - 1]! + extra((i - 0.5) * STEP) * STEP;
  const base = RAIL.speed * TIMING.total;
  const k = length === undefined || bonus[n] === 0 ? 1 : (length - base) / bonus[n]!;
  return {
    length: base + k * bonus[n]!,
    at(t) {
      const f = Math.min(n, Math.max(0, t / STEP));
      const i = Math.min(n - 1, Math.floor(f));
      return RAIL.speed * (f * STEP) + k * (bonus[i]! + (bonus[i + 1]! - bonus[i]!) * (f - i));
    },
  };
}
