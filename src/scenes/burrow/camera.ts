import { Vector3 } from "three";
import { lookTowards, type RailFrame, type Stretch } from "../rail";
import { keyed } from "./build";

/**
 * Where the burrow's camera looks. Its position, heading, bank and speed are the rail's; all the
 * scene adds is a glance to one side, by rail distance, and only as far as `stretch.free(t)`
 * allows (not at all until t = 5.6 or from t = 20, where two cameras share the track).
 */

export const FOV = 66;

/** [rail distance, degrees the camera looks to the left of the rail's heading] */
const GLANCE = keyed([
  [24, 0],
  // crossing junction 1: past the way out, at the near wall and its eyes
  [33.5, -13],
  [40.5, 0],
  // into the long curl
  [47, 12],
  [62, 12],
  // junction 2: the orrery is dead ahead in the doorway, then the two mouths in the far wall
  [68.5, 2],
  [75.5, -7],
  [81, 0],
  // into the flick to the right
  [88, -8],
  [96, 0],
]);

const Y = new Vector3(0, 1, 0);
const target = new Vector3();

/** turns `pose` (the rail's, at local time t) to where the camera looks */
export function aim(stretch: Stretch, t: number, d: number, pose: RailFrame) {
  const free = stretch.free(t);
  const glance = GLANCE(d);
  if (free <= 0 || glance === 0) return pose.quaternion;
  target.copy(pose.tangent).applyAxisAngle(Y, (glance * Math.PI) / 180).multiplyScalar(20).add(pose.position);
  return lookTowards(pose, target, free);
}
