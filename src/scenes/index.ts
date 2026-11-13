import type { SceneDef } from "./types";
import Helix from "./helix";
import Burrow from "./burrow";
import Dollhouse from "./dollhouse";
import Orbit from "./orbit";
import Roost from "./roost";

/**
 * Played in this order, looping forever. A scene's place in this list is the `index` it is
 * mounted with, and `index % 4` is the season of the rail it rides (rail.ts): 0 spring, 1 summer,
 * 2 fall, 3 winter, 4 spring again.
 */
export const scenes: SceneDef[] = [
  { id: "helix", Component: Helix },
  { id: "burrow", Component: Burrow },
  { id: "dollhouse", Component: Dollhouse },
  { id: "orbit", Component: Orbit },
  { id: "roost", Component: Roost },
];
