import type {
  Entrance,
  Floor,
  Furniture,
  Group,
  NavigationEdge,
  NavigationNode,
  POI,
  Space,
  Wall,
} from "@indoor/core";
import type { Command } from "./Command.js";

/** Empties every space/wall/entrance/POI/furniture/group/navigation node/edge on a single floor, as one undoable step. */
export class ClearFloorCommand implements Command {
  readonly label = "Clear Floor";

  private removed:
    | {
        spaces: Space[];
        walls: Wall[];
        entrances: Entrance[];
        pois: POI[];
        furniture: Furniture[];
        groups: Group[];
        nodes: NavigationNode[];
        edges: NavigationEdge[];
      }
    | undefined;

  constructor(private readonly floor: Floor) {}

  execute(): void {
    this.removed = {
      spaces: this.floor.spaces.splice(0),
      walls: this.floor.walls.splice(0),
      entrances: this.floor.entrances.splice(0),
      pois: this.floor.pois.splice(0),
      furniture: this.floor.furniture.splice(0),
      groups: this.floor.groups.splice(0),
      nodes: this.floor.navigation.nodes.splice(0),
      edges: this.floor.navigation.edges.splice(0),
    };
  }

  undo(): void {
    if (!this.removed) return;
    this.floor.spaces.push(...this.removed.spaces);
    this.floor.walls.push(...this.removed.walls);
    this.floor.entrances.push(...this.removed.entrances);
    this.floor.pois.push(...this.removed.pois);
    this.floor.furniture.push(...this.removed.furniture);
    this.floor.groups.push(...this.removed.groups);
    this.floor.navigation.nodes.push(...this.removed.nodes);
    this.floor.navigation.edges.push(...this.removed.edges);
    this.removed = undefined;
  }
}
