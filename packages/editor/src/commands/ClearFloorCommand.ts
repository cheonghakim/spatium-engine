import type {
  Entrance,
  Floor,
  NavigationEdge,
  NavigationNode,
  POI,
  Space,
  Wall,
} from "@indoor/core";
import type { Command } from "./Command.js";

/** Empties every space/wall/entrance/POI/navigation node/edge on a single floor, as one undoable step. */
export class ClearFloorCommand implements Command {
  readonly label = "Clear Floor";

  private removed:
    | {
        spaces: Space[];
        walls: Wall[];
        entrances: Entrance[];
        pois: POI[];
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
    this.floor.navigation.nodes.push(...this.removed.nodes);
    this.floor.navigation.edges.push(...this.removed.edges);
    this.removed = undefined;
  }
}
