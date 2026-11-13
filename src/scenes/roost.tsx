import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import { TIMING, type SceneProps } from "./types";
import { createFrame, season } from "./rail";
import { FOV, aim } from "./roost/camera";
import { buildEggs } from "./roost/eggs";
import { createShared } from "./roost/glsl";
import { buildHen } from "./roost/hen";
import { FLOOR_Y, HEM, createLayout } from "./roost/layout";
import { buildStacks } from "./roost/stacks";
import { buildWorld } from "./roost/world";

/**
 * ROOST — a giant porcelain hen dozes on a floor as thin as a plate, and a second place hangs upside
 * down from the underside of that same floor.
 *
 * The ride starts below, under a flat white ceiling over a moss-dark depth, a seam of gold light
 * round the horizon, crockery hanging from the ceiling and a glowing dome, the lamp, hanging among
 * it. The spring climb carries the camera round under the lamp and up through a missing shard of
 * the floor, and above it the lamp turns out to be the underside of a nest with a hen on it. She
 * is the lid of a covered dish: the gap under her as she floats up is the way out.
 *
 * Everything is placed round the rail (./roost/layout.ts) and moves from the clock alone.
 */

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** her lid rattles twice, clunk, clunk, then she floats up, leaning back */
const LIFT = { start: 20.9, end: 24.6, height: 3.6, lean: (4 * Math.PI) / 180 } as const;
const HOPS = [20.1, 20.6];

function hop(t: number) {
  let y = 0;
  let tilt = 0;
  HOPS.forEach((t0, i) => {
    const k = (t - t0) / 0.24;
    if (k > 0 && k < 1) {
      const s = Math.sin(Math.PI * k);
      y += 0.12 * s;
      tilt += (i % 2 ? -1 : 1) * 0.017 * s;
    }
  });
  return [y, tilt] as const;
}

/** the nod: her head sinks for five seconds, then jerks back up, four times in the 25 */
function nod(t: number) {
  const p = ((t % 6.25) + 6.25) % 6.25;
  if (p < 5) return -0.2 * smooth(0, 5, p);
  const k = (p - 5) / 1.25;
  return -0.2 * Math.exp(-k * 7) * Math.cos(k * 8);
}

/** pivot of her lean: the hem under her tail */
const PIVOT = -12.3;

export default function Roost({ index, clock, camera, portalMaterial }: SceneProps) {
  const stretch = useMemo(() => season(index), [index]);
  const layout = useMemo(() => createLayout(stretch), [stretch]);
  const shared = useMemo(() => createShared(layout.hen), [layout]);
  const world = useMemo(() => buildWorld(shared, layout.hen, portalMaterial), [shared, layout, portalMaterial]);
  const stacks = useMemo(() => buildStacks(shared, layout), [shared, layout]);
  const eggs = useMemo(() => buildEggs(shared, layout), [shared, layout]);
  const hen = useMemo(() => {
    const h = buildHen(shared);
    const pivot = new Group();
    pivot.add(h.group);
    h.group.position.set(-PIVOT, 0, 0);
    return { ...h, pivot };
  }, [shared]);

  useEffect(
    () => () => {
      world.dispose();
      stacks.dispose();
      eggs.dispose();
      hen.dispose();
    },
    [world, stacks, eggs, hen],
  );

  const tmp = useMemo(() => ({ pose: createFrame() }), []);

  useFrame(() => {
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    shared.uT.value = t;

    // --- camera: the rail's pose, a pure function of t ------------------------------------------
    const pose = stretch.pose(t, tmp.pose);
    camera.position.copy(pose.position);
    eggs.update(pose.position, pose.tangent);
    camera.quaternion.copy(aim(stretch, t, pose));
    if (camera.fov !== FOV || camera.near !== 0.05) {
      camera.fov = FOV;
      camera.near = 0.05;
      camera.far = 1000;
      camera.updateProjectionMatrix();
    }

    // --- the hen ----------------------------------------------------------------------------------
    const b = Math.sin((2 * Math.PI * t) / 5);
    hen.group.scale.set(1 + 0.007 * b, 1 + 0.015 * b, 1 + 0.007 * b);
    hen.material.uniforms.uNod!.value = nod(t);
    const [hy, htilt] = hop(t);
    const k = smooth(LIFT.start, LIFT.end, t);
    const lift = LIFT.height * k + hy;
    hen.pivot.position.set(layout.hen.x + PIVOT, FLOOR_Y + lift, layout.hen.z);
    hen.pivot.rotation.z = LIFT.lean * k + htilt;
    // the portal wall stands inside her skirt, as high as the gap needs
    world.portal.visible = lift > 0.004;
    world.portal.scale.y = HEM + lift + 2.3;
  });

  return (
    <>
      <color attach="background" args={["#0e140d"]} />
      {world.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={world.lip} />
      <primitive object={world.portal} />
      <primitive object={stacks.mesh} />
      <primitive object={stacks.shade} />
      <primitive object={eggs.mesh} />
      <primitive object={hen.pivot} />
    </>
  );
}

