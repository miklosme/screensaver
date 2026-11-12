import { useEffect, useMemo, useRef } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  HalfFloatType,
  Mesh,
  type Object3D,
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
let frozenT = params.has("t") ? Number(params.get("t")) : null;
const speed = params.has("speed") ? Number(params.get("speed")) : 1;

function SceneSlot({ def, slot }: { def: SceneDef; slot: Slot }) {
  const { Component } = def;
  return createPortal(
    <Component clock={slot.clock} camera={slot.camera} portalMaterial={slot.portal} />,
    slot.scene,
    { camera: slot.camera },
  );
}

/** Two scenes are on screen at most, but a one-scene list still needs a second copy to fly into. */
const SLOTS = Math.max(2, scenes.length);

export function Director() {
  const gl = useThree((s) => s.gl);
  const advance = useThree((s) => s.advance);
  // Every scene is mounted once, up front, and stays mounted. Building a world and compiling its
  // shaders costs tens to hundreds of milliseconds: paid at start-up nobody sees it, paid in
  // flight it is a dropped frame at every portal.
  const slots = useMemo(
    () =>
      Array.from({ length: SLOTS }, (): Slot => ({
        scene: new Scene(),
        camera: new PerspectiveCamera(60, 1, 0.1, 2000),
        clock: { t: 0 },
        portal: createPortalMaterial(),
      })),
    [],
  );
  useEffect(() => () => slots.forEach((slot) => slot.portal.dispose()), [slots]);
  /** slot i holds scene startIndex + i, so the show starts on slot 0 whatever ?scene= says */
  const slotAt = (seq: number) => slots[seq % SLOTS]!;
  const live = useRef({ seq: 0, time: 0 });
  /** what the render target holds while the next scene is still waiting on its first frame */
  const still = useRef<{ slot: Slot | null; width: number; height: number }>({ slot: null, width: 0, height: 0 });
  const warmed = useRef(false);

  // Dev only: a handle for sampling and profiling from the console or a headless browser.
  //   __screensaver.freeze(t)    freeze the scene clock at t (null lets it run again)
  //   __screensaver.advance(ms)  render one frame now, without waiting for the browser
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handle = { gl, slots, live: live.current, advance, freeze: (t: number | null) => void (frozenT = t) };
    (window as unknown as { __screensaver: typeof handle }).__screensaver = handle;
  }, [gl, slots, advance]);

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
    }
    slotAt(l.seq).clock.t = t;
    slotAt(l.seq + 1).clock.t = Math.max(0, t - TIMING.cycle);
  }, -1);

  // Taking a positive priority makes this the one and only render pass.
  useFrame(() => {
    const current = slotAt(live.current.seq);
    const next = slotAt(live.current.seq + 1);
    const t = current.clock.t;

    gl.getDrawingBufferSize(size);
    if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
    const aspect = size.x / size.y;
    for (const slot of slots) {
      slot.portal.uniforms.resolution!.value.copy(size);
      if (slot.camera.aspect !== aspect) slot.camera.aspect = aspect;
      slot.camera.updateProjectionMatrix();
    }

    // The very first frame draws every scene once, unculled, both into the target and onto the
    // canvas (three compiles a different program for each): that compiles every program and
    // uploads every buffer and texture before the show starts.
    if (!warmed.current) {
      warmed.current = true;
      for (const slot of slots) {
        const culled: Object3D[] = [];
        slot.scene.traverse((o) => {
          if (o.frustumCulled) culled.push(o);
          o.frustumCulled = false;
        });
        slot.portal.uniforms.map!.value = blackTexture;
        gl.setRenderTarget(target);
        gl.render(slot.scene, slot.camera);
        gl.setRenderTarget(null);
        gl.render(slot.scene, slot.camera);
        for (const o of culled) o.frustumCulled = true;
      }
    }

    const portalLive = t >= TIMING.portalLive;
    if (portalLive) {
      // Until the takeover the next scene holds its first frame, so one render of it lasts until
      // it starts to move (or the canvas is resized). That is 8 of every 20 seconds drawn once.
      const s = still.current;
      const moving = next.clock.t > 0;
      if (moving || s.slot !== next || s.width !== size.x || s.height !== size.y) {
        next.portal.uniforms.map!.value = blackTexture;
        gl.setRenderTarget(target);
        gl.render(next.scene, next.camera);
        gl.setRenderTarget(null);
        s.slot = moving ? null : next;
        s.width = size.x;
        s.height = size.y;
      }
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

  return (
    <>
      {slots.map((slot, i) => (
        <SceneSlot key={i} def={scenes[(startIndex + i) % scenes.length]!} slot={slot} />
      ))}
    </>
  );
}
