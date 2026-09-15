import type { Floor, Space } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddSpaceCommand implements Command {
  readonly label = "Add Space";

  constructor(
    private readonly floor: Floor,
    private readonly space: Space,
  ) {}

  execute(): void {
    this.floor.spaces.push(this.space);
  }

  undo(): void {
    const index = this.floor.spaces.findIndex((s) => s.id === this.space.id);
    if (index !== -1) this.floor.spaces.splice(index, 1);
  }
}

export class DeleteSpaceCommand implements Command {
  readonly label = "Delete Space";

  private removedIndex = -1;
  private removedSpace: Space | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly spaceId: string,
  ) {}

  execute(): void {
    const index = this.floor.spaces.findIndex((s) => s.id === this.spaceId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedSpace = this.floor.spaces[index];
    this.floor.spaces.splice(index, 1);
  }

  undo(): void {
    if (this.removedSpace !== undefined && this.removedIndex !== -1) {
      this.floor.spaces.splice(this.removedIndex, 0, this.removedSpace);
    }
  }
}
