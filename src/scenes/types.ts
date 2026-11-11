import type { FC } from "react";
import type { Material, PerspectiveCamera } from "three";

/**
 * Every scene lives on the same 25 second local timeline (seconds in `clock.t`):
 *
 *   0 ..  5  ARRIVAL   the scene is only visible *through the previous scene's exit portal*,
 *                      which grows until it fills the screen at t = 5.
 *   5 .. 20  SOLO      the scene owns the screen.
 *  12 .. 25  PORTAL    `portalMaterial` shows the next scene (a still frame of it until t = 20,
 *                      live after). Before t = 12 the material is plain black.
 *  20 .. 25  EXIT      the camera must travel into the portal so that it fills the screen at t = 25.
 */
export const TIMING = {
  /** seconds between two takeovers */
  cycle: 20,
  /** seconds a scene is previewed through the previous scene's portal */
  arrival: 5,
  /** arrival + cycle: total length of a scene's local timeline */
  total: 25,
  /** local time from which portalMaterial shows the next scene */
  portalLive: 12,
} as const;

export interface SceneClock {
  /** local scene time in seconds, 0 .. TIMING.total. Written by the director every frame. */
  t: number;
}

export interface SceneProps {
  /** Read `clock.t` inside useFrame. Drive ALL animation from it (never from wall clock / delta). */
  clock: SceneClock;
  /** This scene's own camera. Position / rotate / change fov freely inside useFrame. */
  camera: PerspectiveCamera;
  /** Put this on the mesh(es) that form the exit portal. It is a window into the next scene. */
  portalMaterial: Material;
}

export interface SceneDef {
  id: string;
  Component: FC<SceneProps>;
}
