import { Vector3 } from "three";
import { lookTowards, type RailFrame, type Stretch } from "../rail";

/**
 * Where the roost's camera looks. Position, heading, bank and speed are the rail's (spring); the
 * scene only turns the view a little, by rail distance, as far as `stretch.free(t)` allows:
 * right to hold the lamp as the turn begins, up and left to the hole as the turn reveals it,
 * and left into the bend for the hen when the eye comes up through the floor.
 */

export const FOV = 58;

/** [rail distance, degrees to the left of the heading, degrees up] */
const KEYS: [number, number, number][] = [
  [22, 0, 0],
  [28, -8, 0], // t 7.4: the lamp, ahead and to the right of the turn
  [35, -8, 2],
  [43, 0, 4],
  [50, 12, 9], // t 11.5: the hole, up and to the left
  [59, 12, 9],
  [67, 4, 3],
  [75, 0, 0], // t 16: square through the shard
  [81, 18, -2], // t 17: the reveal, left into the bend
  [88, 20, -3],
  [96, 0, 0],
];

const smooth = (x: number) => x * x * (3 - 2 * x);

function keyed(d: number): [number, number] {
  if (d <= KEYS[0]![0]) return [KEYS[0]![1], KEYS[0]![2]];
  for (let i = 1; i < KEYS.length; i++) {
    const [d1, y1, p1] = KEYS[i]!;
    if (d <= d1) {
      const [d0, y0, p0] = KEYS[i - 1]!;
      const k = smooth((d - d0) / (d1 - d0));
      return [y0 + (y1 - y0) * k, p0 + (p1 - p0) * k];
    }
  }
  const last = KEYS[KEYS.length - 1]!;
  return [last[1], last[2]];
}

const Y = new Vector3(0, 1, 0);
const dir = new Vector3();
const target = new Vector3();

export function aim(stretch: Stretch, t: number, pose: RailFrame) {
  const free = stretch.free(t);
  if (free <= 0) return pose.quaternion;
  const [yaw, pitch] = keyed(stretch.distance(t));
  if (yaw === 0 && pitch === 0) return pose.quaternion;
  dir.copy(pose.tangent).applyAxisAngle(Y, (yaw * Math.PI) / 180);
  dir.y += Math.tan((pitch * Math.PI) / 180) * Math.hypot(dir.x, dir.z);
  target.copy(pose.position).addScaledVector(dir.normalize(), 20);
  return lookTowards(pose, target, free);
}
