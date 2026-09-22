import type { Floor, Group } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddGroupCommand implements Command {
  readonly label = "Add Group";

  constructor(
    private readonly floor: Floor,
    private readonly group: Group,
  ) {}

  execute(): void {
    this.floor.groups.push(this.group);
  }

  undo(): void {
    const index = this.floor.groups.findIndex((g) => g.id === this.group.id);
    if (index !== -1) this.floor.groups.splice(index, 1);
  }
}

export class DeleteGroupCommand implements Command {
  readonly label = "Delete Group";

  private removedIndex = -1;
  private removedGroup: Group | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly groupId: string,
  ) {}

  execute(): void {
    const index = this.floor.groups.findIndex((g) => g.id === this.groupId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedGroup = this.floor.groups[index];
    this.floor.groups.splice(index, 1);
  }

  undo(): void {
    if (this.removedGroup !== undefined && this.removedIndex !== -1) {
      this.floor.groups.splice(this.removedIndex, 0, this.removedGroup);
    }
  }
}
