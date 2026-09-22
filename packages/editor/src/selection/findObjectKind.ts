import type { Floor } from "@indoor/core";

export type SelectableKind =
  | "space"
  | "wall"
  | "entrance"
  | "poi"
  | "furniture"
  | "group"
  | "navigationNode"
  | "navigationEdge";

/** Resolves which collection on the floor a selected id belongs to. */
export function findObjectKind(floor: Floor, id: string): SelectableKind | null {
  if (floor.spaces.some((s) => s.id === id)) return "space";
  if (floor.walls.some((w) => w.id === id)) return "wall";
  if (floor.entrances.some((e) => e.id === id)) return "entrance";
  if (floor.pois.some((p) => p.id === id)) return "poi";
  if (floor.furniture.some((f) => f.id === id)) return "furniture";
  if (floor.groups.some((g) => g.id === id)) return "group";
  if (floor.navigation.nodes.some((n) => n.id === id)) return "navigationNode";
  if (floor.navigation.edges.some((e) => e.id === id)) return "navigationEdge";
  return null;
}
