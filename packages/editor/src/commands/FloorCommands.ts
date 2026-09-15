import type { Building, Floor } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddFloorCommand implements Command {
  readonly label = "Add Floor";

  constructor(
    private readonly building: Building,
    private readonly floor: Floor,
  ) {}

  execute(): void {
    this.building.floors.push(this.floor);
  }

  undo(): void {
    const index = this.building.floors.findIndex((f) => f.id === this.floor.id);
    if (index !== -1) this.building.floors.splice(index, 1);
  }
}
