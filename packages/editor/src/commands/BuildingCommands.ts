import type { Building, IndoorProject } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddBuildingCommand implements Command {
  readonly label = "Add Building";

  constructor(
    private readonly project: IndoorProject,
    private readonly building: Building,
  ) {}

  execute(): void {
    this.project.buildings.push(this.building);
  }

  undo(): void {
    const index = this.project.buildings.findIndex((b) => b.id === this.building.id);
    if (index !== -1) this.project.buildings.splice(index, 1);
  }
}
