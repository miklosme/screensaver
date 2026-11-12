import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2, Vector3, type Group, type Mesh } from "three";
import { TIMING, type SceneProps } from "./types";
import { createRide } from "./rail";
import { EYE, HOOP, buildWorld } from "./burrow/build";
import { buildCreatures } from "./burrow/creatures";
import {
  FOG_COLOR,
  createChamberMaterial,
  createCorridorMaterial,
  createGlowMaterial,
  createHaloMaterial,
  createMoteMaterial,
  createShared,
  createTrimMaterial,
} from "./burrow/materials";

/**
 * BURROW — the Win95 maze regrown without a single straight wall.
 *
 * A glowing thread leads the camera through ribbed, winding corridors and round junction chambers
 * whose other doorways curl away into coloured haze. The last chamber is a dead end holding only a
 * slowly revolving hoop, a band a hand's width thick: the way out.
 */

const FOV = 66;
const LOOK_AHEAD = 4.6;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export default function Burrow({ clock, camera, portalMaterial }: SceneProps) {
  const gl = useThree((s) => s.gl);
  const world = useMemo(buildWorld, []);

  const mats = useMemo(() => {
    const shared = createShared();
    return {
      shared,
      corridor: createCorridorMaterial(shared, world.chambers),
      shells: world.chambers.map((ch) => createChamberMaterial(shared, ch)),
      floor: createTrimMaterial(shared, { patScale: [1.6, 40], spotK: 36, hTop: 4.6, spotGain: 0.5, ridgeAmt: 0.22 }),
      frame: createTrimMaterial(shared, { patScale: [1.7, 11], spotK: 12, hTop: 4.6, ridgeAll: 0.85 }),
      thread: createGlowMaterial(shared, new Vector3(0.1, 0.95, 0.66), new Vector3(0.3, 1.2, 0.95), 75),
      knot: createGlowMaterial(shared, new Vector3(0.95, 0.16, 0.2), new Vector3(1.5, 0.95, 0.7)),
      moon: createGlowMaterial(shared, new Vector3(1.0, 0.36, 0.1), new Vector3(1.5, 1.05, 0.6)),
      oculus: createGlowMaterial(shared, new Vector3(1.9, 1.3, 1.6), new Vector3(1.9, 1.3, 1.6)),
      hoop: createGlowMaterial(shared, new Vector3(0.95, 0.5, 0.42), new Vector3(0.6, 2.0, 1.7), 60),
      gimbal: createGlowMaterial(shared, new Vector3(1.2, 0.4, 0.5), new Vector3(1.6, 1.2, 1.1)),
      haloWarm: createHaloMaterial(shared, new Vector3(0.75, 0.2, 0.22)),
      haloAmber: createHaloMaterial(shared, new Vector3(0.7, 0.3, 0.12)),
      haloPale: createHaloMaterial(shared, new Vector3(0.5, 0.25, 0.42)),
      motes: createMoteMaterial(shared),
    };
  }, [world]);
  const creatures = useMemo(() => buildCreatures(world, mats.shared), [world, mats]);

  useEffect(
    () => () => {
      creatures.dispose();
      for (const g of [...world.corridors, ...world.shells, ...world.floors, ...world.frames]) g.dispose();
      world.thread.dispose();
      world.hoop.dispose();
      world.motes.dispose();
      const { shared, shells, ...rest } = mats;
      for (const m of [...shells, ...Object.values(rest)]) m.dispose();
    },
    [world, mats, creatures],
  );

  const knot = useRef<Mesh>(null);
  const moons = useRef<Group>(null);
  const hoop = useRef<Group>(null);
  const gimbalA = useRef<Mesh>(null);
  const gimbalB = useRef<Mesh>(null);

  const tmp = useMemo(
    () => ({ look: new Vector3(), near: new Vector3(), far: new Vector3(), to: new Vector3(), size: new Vector2() }),
    [],
  );
  // one even cruise through the corridors, at whatever speed uses up the route exactly
  const ride = useMemo(() => createRide({ cruise: 5, length: world.sHoop - world.sStart, rampIn: 2, rampOut: 2.5 }), [world]);
  const sights = useMemo(
    () => [0, 1].map((i) => ({ p: new Vector3(world.chambers[i]!.c.x, 2.8, world.chambers[i]!.c.z), R: world.chambers[i]!.R })),
    [world],
  );

  useFrame(() => {
    const t = Math.min(TIMING.total, Math.max(0, clock.t));
    mats.shared.uTime.value = t;
    gl.getDrawingBufferSize(tmp.size);
    mats.motes.uniforms.uViewH!.value = tmp.size.y;

    // --- camera: a pure function of t ---------------------------------------------------------
    const s = world.sStart + ride.at(t);
    const pos = camera.position;
    world.table.at(s, pos);
    world.table.at(s + LOOK_AHEAD, tmp.look);
    world.table.at(s + 0.6, tmp.near);
    world.table.at(s + 7.5, tmp.far);

    // lean into the bends, gently
    const tx = tmp.near.x - pos.x;
    const tz = tmp.near.z - pos.z;
    const fx = tmp.far.x - pos.x;
    const fz = tmp.far.z - pos.z;
    const turn = (tx * fz - tz * fx) / (Math.hypot(tx, tz) * Math.hypot(fx, fz) + 1e-6);
    const roll = -0.085 * Math.tanh(turn * 2.2);

    // glance at whatever floats in the junction we are crossing
    for (const sight of sights) {
      tmp.to.copy(sight.p).sub(pos);
      tmp.to.y = 0;
      const d = tmp.to.length();
      const ahead = (tmp.to.x * tx + tmp.to.z * tz) / (Math.hypot(tx, tz) + 1e-6);
      const w = 0.22 * smooth(sight.R + 3, sight.R - 1.5, d) * smooth(-0.5, 3, ahead);
      tmp.look.x += (sight.p.x - tmp.look.x) * w;
      tmp.look.z += (sight.p.z - tmp.look.z) * w;
      tmp.look.y += (sight.p.y - EYE - tmp.look.y) * w * 0.6;
    }

    pos.y += EYE;
    tmp.look.y += EYE;
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp.look);
    camera.rotateZ(roll);
    if (camera.fov !== FOV) camera.fov = FOV;

    // --- things that move -----------------------------------------------------------------------
    if (knot.current) {
      knot.current.rotation.set(t * 0.23, t * 0.37, 0);
      knot.current.position.y = 2.7 + Math.sin(t * 0.9) * 0.12;
    }
    if (moons.current) {
      const ch = moons.current.children;
      for (let i = 0; i < ch.length; i++) ch[i]!.rotation.y = t * (0.5 + i * 0.17) + i * 2.1;
      moons.current.position.y = 3.3 + Math.sin(t * 0.8 + 1) * 0.1;
    }
    if (hoop.current) {
      // revolves like a coin on its edge, then settles square-on to the approaching camera
      const e = 1 - smooth(14.5, 22.8, t);
      hoop.current.rotation.y = world.hoopYaw + e * Math.PI * 1.1;
      hoop.current.position.y = HOOP.y;
    }
    const left = TIMING.total - t;
    if (gimbalA.current) gimbalA.current.rotation.y = left * 0.42;
    if (gimbalB.current) gimbalB.current.rotation.x = left * 0.3;
  });

  const [ch1, ch2, ch3] = world.chambers;
  const topOf = (ch: (typeof world.chambers)[number]) => ch.yc + ch.H * Math.sin(Math.acos(ch.oculus / ch.R));

  return (
    <>
      <color attach="background" args={[FOG_COLOR]} />
      <fogExp2 attach="fog" args={[FOG_COLOR, 0.03]} />

      {world.corridors.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.corridor} frustumCulled={false} />
      ))}
      {world.shells.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.shells[i]} />
      ))}
      {world.floors.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.floor} />
      ))}
      {world.frames.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.frame} />
      ))}
      <mesh geometry={world.thread} material={mats.thread} frustumCulled={false} />
      <points geometry={world.motes} material={mats.motes} frustumCulled={false} />
      <primitive object={creatures.eyes} />
      <primitive object={creatures.shrooms} />

      {/* skylights */}
      {world.chambers.map((ch, i) => (
        <group key={i} position={[ch.c.x, topOf(ch) - 0.02, ch.c.z]}>
          <mesh rotation-x={Math.PI / 2} material={mats.oculus}>
            <circleGeometry args={[ch.oculus * 1.12, 40]} />
          </mesh>
          <mesh position-y={-0.4} scale={ch.oculus * 9} material={mats.haloPale}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        </group>
      ))}

      {/* junction 1: a knot of light */}
      <mesh ref={knot} position={[ch1!.c.x, 2.7, ch1!.c.z]} material={mats.knot}>
        <torusKnotGeometry args={[0.72, 0.2, 160, 12, 2, 3]} />
      </mesh>
      <mesh position={[ch1!.c.x, 2.7, ch1!.c.z]} scale={8} material={mats.haloWarm}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* junction 2: a little orrery */}
      <group ref={moons} position={[ch2!.c.x, 2.9, ch2!.c.z]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation-z={0.5 + i * 0.9} rotation-x={i * 0.7}>
            <group>
              <mesh position={[0.85 + i * 0.2, 0, 0]} material={mats.moon}>
                <sphereGeometry args={[0.13 + i * 0.02, 20, 14]} />
              </mesh>
              <mesh position={[-0.85 - i * 0.2, 0, 0]} material={mats.moon}>
                <sphereGeometry args={[0.11, 16, 12]} />
              </mesh>
              <mesh rotation-x={Math.PI / 2} material={mats.gimbal}>
                <torusGeometry args={[0.85 + i * 0.2, 0.012, 6, 96]} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
      <mesh position={[ch2!.c.x, 3.3, ch2!.c.z]} material={mats.moon}>
        <sphereGeometry args={[0.3, 32, 20]} />
      </mesh>
      <mesh position={[ch2!.c.x, 3.3, ch2!.c.z]} scale={7} material={mats.haloAmber}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* the dead end: a hoop with another world in it */}
      <group ref={hoop} position={world.hoopPos}>
        <mesh material={portalMaterial} scale={[HOOP.rx, HOOP.ry, 1]}>
          <circleGeometry args={[1, 96]} />
        </mesh>
        <mesh geometry={world.hoop} material={mats.hoop} />
      </group>
      <group position={world.hoopPos} rotation-y={world.hoopYaw}>
        <mesh ref={gimbalA} material={mats.gimbal}>
          <torusGeometry args={[2.36, 0.028, 8, 128]} />
        </mesh>
        <mesh ref={gimbalB} material={mats.gimbal}>
          <torusGeometry args={[2.5, 0.028, 8, 128]} />
        </mesh>
      </group>
      {ch3 && null}
    </>
  );
}
