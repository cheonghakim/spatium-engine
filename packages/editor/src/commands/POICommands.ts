import type { Floor, Point, POI } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddPOICommand implements Command {
  readonly label = "Add POI";

  constructor(
    private readonly floor: Floor,
    private readonly poi: POI,
  ) {}

  execute(): void {
    this.floor.pois.push(this.poi);
  }

  undo(): void {
    const index = this.floor.pois.findIndex((p) => p.id === this.poi.id);
    if (index !== -1) this.floor.pois.splice(index, 1);
  }
}

export class DeletePOICommand implements Command {
  readonly label = "Delete POI";

  private removedIndex = -1;
  private removedPoi: POI | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly poiId: string,
  ) {}

  execute(): void {
    const index = this.floor.pois.findIndex((p) => p.id === this.poiId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedPoi = this.floor.pois[index];
    this.floor.pois.splice(index, 1);
  }

  undo(): void {
    if (this.removedPoi !== undefined && this.removedIndex !== -1) {
      this.floor.pois.splice(this.removedIndex, 0, this.removedPoi);
    }
  }
}

export class MovePOICommand implements Command {
  readonly label = "Move POI";

  private readonly previousPosition: Point;

  constructor(
    private readonly poi: POI,
    private readonly newPosition: Point,
  ) {
    this.previousPosition = { ...poi.position };
  }

  execute(): void {
    this.poi.position = { ...this.newPosition };
  }

  undo(): void {
    this.poi.position = { ...this.previousPosition };
  }
}
