import type { Floor, Furniture, Point } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddFurnitureCommand implements Command {
  readonly label = "Add Furniture";

  constructor(
    private readonly floor: Floor,
    private readonly item: Furniture,
  ) {}

  execute(): void {
    this.floor.furniture.push(this.item);
  }

  undo(): void {
    const index = this.floor.furniture.findIndex((f) => f.id === this.item.id);
    if (index !== -1) this.floor.furniture.splice(index, 1);
  }
}

export class DeleteFurnitureCommand implements Command {
  readonly label = "Delete Furniture";

  private removedIndex = -1;
  private removedItem: Furniture | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly furnitureId: string,
  ) {}

  execute(): void {
    const index = this.floor.furniture.findIndex((f) => f.id === this.furnitureId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedItem = this.floor.furniture[index];
    this.floor.furniture.splice(index, 1);
  }

  undo(): void {
    if (this.removedItem !== undefined && this.removedIndex !== -1) {
      this.floor.furniture.splice(this.removedIndex, 0, this.removedItem);
    }
  }
}

export class MoveFurnitureCommand implements Command {
  readonly label = "Move Furniture";

  private readonly previousPosition: Point;

  constructor(
    private readonly item: Furniture,
    private readonly newPosition: Point,
  ) {
    this.previousPosition = { ...item.position };
  }

  execute(): void {
    this.item.position = { ...this.newPosition };
  }

  undo(): void {
    this.item.position = { ...this.previousPosition };
  }
}
