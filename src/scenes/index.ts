import type { SceneDef } from "./types";
import Helix from "./helix";
import Burrow from "./burrow";
import Dollhouse from "./dollhouse";
import Orbit from "./orbit";

/** Played in this order, looping forever. */
export const scenes: SceneDef[] = [
  { id: "helix", Component: Helix },
  { id: "burrow", Component: Burrow },
  { id: "dollhouse", Component: Dollhouse },
  { id: "orbit", Component: Orbit },
];
