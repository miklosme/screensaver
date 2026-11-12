import { useEffect, useMemo, useRef } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  HalfFloatType,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderTarget,
  type ShaderMaterial,
} from "three";
import { scenes } from "../scenes";
import { TIMING, type SceneClock, type SceneDef } from "../scenes/types";
import { createLook, lookAt, looks } from "./looks";
import { blackTexture, createPortalMaterial } from "./portalMaterial";
import { createPost } from "./post";

interface Slot {
  /** id of the scene mounted in this slot */
  id: string;
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

/** Linear HDR, multisampled. Nothing reads its depth afterwards, so only colour is resolved. */
const createTarget = () => new WebGLRenderTarget(2, 2, { type: HalfFloatType, samples: 4, resolveDepthBuffer: false });

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
      Array.from({ length: SLOTS }, (_, i): Slot => ({
        id: scenes[(startIndex + i) % scenes.length]!.id,
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
  /** what `ahead` holds while the next scene is still waiting on its first frame */
  const still = useRef<{ slot: Slot | null; width: number; height: number }>({ slot: null, width: 0, height: 0 });
  const warmed = useRef(false);
  // A restored GL context comes back empty: three rebuilds each program, buffer, texture and target
  // the next time it is used, which without this would be in flight, one portal at a time.
  useEffect(() => {
    const canvas = gl.domElement;
    const rewarm = () => void (warmed.current = false);
    canvas.addEventListener("webglcontextrestored", rewarm);
    return () => canvas.removeEventListener("webglcontextrestored", rewarm);
  }, [gl]);

  // Dev only: a handle for sampling and profiling from the console or a headless browser.
  //   __screensaver.freeze(t)    freeze the scene clock at t (null lets it run again)
  //   __screensaver.advance(ms)  render one frame now, without waiting for the browser
  //   __screensaver.looks        the per-scene look numbers, live: edit one and the next frame has it
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handle = { gl, slots, live: live.current, advance, freeze: (t: number | null) => void (frozenT = t), looks };
    (window as unknown as { __screensaver: typeof handle }).__screensaver = handle;
  }, [gl, slots, advance]);

  // One colour pipeline. Every scene is drawn into a linear HDR target, never onto the canvas:
  // `ahead` takes the next scene, which the current scene's portal samples, and `frame` takes the
  // current scene. `post` then turns `frame` into the picture. A scene therefore gets the same
  // tone curve, the same blending and the same anti-aliasing whether it is seen through a portal
  // or owns the screen, and a takeover has nothing left to pop.
  const frame = useMemo(createTarget, []);
  const ahead = useMemo(createTarget, []);
  const post = useMemo(createPost, []);
  const look = useMemo(createLook, []);
  const size = useMemo(() => new Vector2(), []);
  useEffect(
    () => () => {
      frame.dispose();
      ahead.dispose();
      post.dispose();
    },
    [frame, ahead, post],
  );

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
    if (frame.width !== size.x || frame.height !== size.y) {
      frame.setSize(size.x, size.y);
      ahead.setSize(size.x, size.y);
      post.setSize(size.x, size.y);
    }
    const aspect = size.x / size.y;
    for (const slot of slots) {
      slot.portal.uniforms.resolution!.value.copy(size);
      if (slot.camera.aspect !== aspect) slot.camera.aspect = aspect;
      slot.camera.updateProjectionMatrix();
    }

    // The very first frame draws every scene once, unculled, and runs the whole post chain: that
    // compiles every program, uploads every buffer and texture and allocates every target before
    // the show starts. Both targets are the same kind, so a scene needs one program per material,
    // whichever of them it is drawn into.
    if (!warmed.current) {
      warmed.current = true;
      still.current.slot = null;
      for (const slot of slots) {
        const culled: Object3D[] = [];
        slot.scene.traverse((o) => {
          if (o.frustumCulled) culled.push(o);
          o.frustumCulled = false;
        });
        slot.portal.uniforms.map!.value = blackTexture;
        gl.setRenderTarget(slot === slots[0] ? ahead : frame);
        gl.render(slot.scene, slot.camera);
        for (const o of culled) o.frustumCulled = true;
      }
      post.render(gl, frame.texture, { ...look, bloom: 1 }, ahead.texture, 0.5);
    }

    const portalLive = t >= TIMING.portalLive;
    if (portalLive) {
      // Until the takeover the next scene holds its first frame, so one render of it lasts until
      // it starts to move (or the canvas is resized). That is 8 of every 20 seconds drawn once.
      const s = still.current;
      const moving = next.clock.t > 0;
      if (moving || s.slot !== next || s.width !== size.x || s.height !== size.y) {
        next.portal.uniforms.map!.value = blackTexture;
        gl.setRenderTarget(ahead);
        gl.render(next.scene, next.camera);
        s.slot = moving ? null : next;
        s.width = size.x;
        s.height = size.y;
      }
    }
    current.portal.uniforms.map!.value = portalLive ? ahead.texture : blackTexture;
    gl.setRenderTarget(frame);
    gl.render(current.scene, current.camera);

    // In the last half second the next scene is faded over any leftovers of the current one, so
    // that at t = TIMING.total the frame is the next scene's picture and nothing else.
    const x = portalLive ? Math.min(1, Math.max(0, (t - (TIMING.total - SAFETY_FADE)) / SAFETY_FADE)) : 0;
    post.render(gl, frame.texture, lookAt(look, current.id, next.id, t), ahead.texture, x * x * (3 - 2 * x));
  }, 1);

  return (
    <>
      {slots.map((slot, i) => (
        <SceneSlot key={i} def={scenes[(startIndex + i) % scenes.length]!} slot={slot} />
      ))}
    </>
  );
}
