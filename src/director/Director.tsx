import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  WebGLRenderTarget,
  type ShaderMaterial,
} from "three";
import { scenes } from "../scenes";
import { TIMING, type SceneClock, type SceneDef } from "../scenes/types";
import { blackTexture, createPortalMaterial } from "./portalMaterial";

interface Slot {
  scene: Scene;
  camera: PerspectiveCamera;
  clock: SceneClock;
  portal: ShaderMaterial;
}

/** seconds at the very end of a scene during which the next scene is faded over any leftovers */
const SAFETY_FADE = 0.5;

// Debug only, there is no UI: ?scene=<id> starts there, ?t=<sec> freezes the scene clock, ?speed=<n>
const params = new URLSearchParams(location.search);
const startIndex = Math.max(0, scenes.findIndex((s) => s.id === params.get("scene")));
const frozenT = params.has("t") ? Number(params.get("t")) : null;
const speed = params.has("speed") ? Number(params.get("speed")) : 1;

function SceneSlot({ def, seq, slots }: { def: SceneDef; seq: number; slots: Map<number, Slot> }) {
  const slot = useMemo<Slot>(
    () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(60, 1, 0.1, 2000),
      clock: { t: 0 },
      portal: createPortalMaterial(),
    }),
    [],
  );
  useEffect(() => {
    slots.set(seq, slot);
    return () => {
      slots.delete(seq);
      slot.portal.dispose();
    };
  }, [seq, slot, slots]);
  const { Component } = def;
  return createPortal(
    <Component clock={slot.clock} camera={slot.camera} portalMaterial={slot.portal} />,
    slot.scene,
    { camera: slot.camera },
  );
}

export function Director() {
  const gl = useThree((s) => s.gl);
  const slots = useMemo(() => new Map<number, Slot>(), []);
  const [seq, setSeq] = useState(0);
  const live = useRef({ seq: 0, time: 0 });

  const target = useMemo(() => new WebGLRenderTarget(2, 2, { type: HalfFloatType, samples: 4 }), []);
  const overlay = useMemo(() => {
    const material = createPortalMaterial();
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    const scene = new Scene();
    scene.add(new Mesh(new PlaneGeometry(2, 2), material));
    return { scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), material };
  }, []);
  const size = useMemo(() => new Vector2(), []);
  useEffect(() => () => target.dispose(), [target]);

  // Advance the clocks before the scenes' own useFrame callbacks (priority 0) read them.
  useFrame((_, delta) => {
    const l = live.current;
    l.time += Math.min(delta, 0.1) * speed;
    let t = l.time - l.seq * TIMING.cycle + TIMING.arrival;
    if (frozenT !== null) t = frozenT;
    else if (t >= TIMING.total) {
      l.seq += 1;
      t -= TIMING.cycle;
      setSeq(l.seq);
    }
    const current = slots.get(l.seq);
    const next = slots.get(l.seq + 1);
    if (current) current.clock.t = t;
    if (next) next.clock.t = Math.max(0, t - TIMING.cycle);
  }, -1);

  // Taking a positive priority makes this the one and only render pass.
  useFrame(() => {
    const current = slots.get(live.current.seq);
    if (!current) return;
    const next = slots.get(live.current.seq + 1);
    const t = current.clock.t;

    gl.getDrawingBufferSize(size);
    if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
    const aspect = size.x / size.y;
    for (const slot of [current, next]) {
      if (!slot) continue;
      slot.portal.uniforms.resolution!.value.copy(size);
      if (slot.camera.aspect !== aspect) slot.camera.aspect = aspect;
      slot.camera.updateProjectionMatrix();
    }

    const portalLive = !!next && t >= TIMING.portalLive;
    if (portalLive) {
      next.portal.uniforms.map!.value = blackTexture;
      gl.setRenderTarget(target);
      gl.render(next.scene, next.camera);
      gl.setRenderTarget(null);
    }
    current.portal.uniforms.map!.value = portalLive ? target.texture : blackTexture;
    gl.render(current.scene, current.camera);

    const fade = (t - (TIMING.total - SAFETY_FADE)) / SAFETY_FADE;
    if (portalLive && fade > 0) {
      overlay.material.uniforms.map!.value = target.texture;
      overlay.material.uniforms.resolution!.value.copy(size);
      overlay.material.uniforms.opacity!.value = Math.min(1, fade * fade * (3 - 2 * fade));
      gl.autoClear = false;
      gl.render(overlay.scene, overlay.camera);
      gl.autoClear = true;
    }
  }, 1);

  const n = scenes.length;
  return (
    <>
      {[seq, seq + 1].map((s) => (
        <SceneSlot key={s} seq={s} def={scenes[(startIndex + s) % n]!} slots={slots} />
      ))}
    </>
  );
}
