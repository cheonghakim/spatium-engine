import type { Entrance, Floor } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddEntranceCommand implements Command {
  readonly label = "Add Entrance";

  constructor(
    private readonly floor: Floor,
    private readonly entrance: Entrance,
  ) {}

  execute(): void {
    this.floor.entrances.push(this.entrance);
  }

  undo(): void {
    const index = this.floor.entrances.findIndex((e) => e.id === this.entrance.id);
    if (index !== -1) this.floor.entrances.splice(index, 1);
  }
}

export class DeleteEntranceCommand implements Command {
  readonly label = "Delete Entrance";

  private removedIndex = -1;
  private removedEntrance: Entrance | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly entranceId: string,
  ) {}

  execute(): void {
    const index = this.floor.entrances.findIndex((e) => e.id === this.entranceId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedEntrance = this.floor.entrances[index];
    this.floor.entrances.splice(index, 1);
  }

  undo(): void {
    if (this.removedEntrance !== undefined && this.removedIndex !== -1) {
      this.floor.entrances.splice(this.removedIndex, 0, this.removedEntrance);
    }
  }
}
