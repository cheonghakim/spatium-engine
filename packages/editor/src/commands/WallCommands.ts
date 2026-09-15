import type { Floor, Wall, Point } from "@indoor/core";
import type { Command } from "./Command.js";

export class MoveWallCommand implements Command {
  readonly label = 'Move Wall';
  private readonly previousStart: Point;
  private readonly previousEnd: Point;
  constructor(private readonly wall: Wall, private readonly start: Point, private readonly end: Point) {
    this.previousStart = { ...wall.start }; this.previousEnd = { ...wall.end };
  }
  execute(): void { this.wall.start = { ...this.start }; this.wall.end = { ...this.end }; }
  undo(): void { this.wall.start = { ...this.previousStart }; this.wall.end = { ...this.previousEnd }; }
}

export class AddWallCommand implements Command {
  readonly label = "Add Wall";

  constructor(
    private readonly floor: Floor,
    private readonly wall: Wall,
  ) {}

  execute(): void {
    this.floor.walls.push(this.wall);
  }

  undo(): void {
    const index = this.floor.walls.findIndex((w) => w.id === this.wall.id);
    if (index !== -1) this.floor.walls.splice(index, 1);
  }
}

export class DeleteWallCommand implements Command {
  readonly label = "Delete Wall";

  private removedIndex = -1;
  private removedWall: Wall | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly wallId: string,
  ) {}

  execute(): void {
    const index = this.floor.walls.findIndex((w) => w.id === this.wallId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedWall = this.floor.walls[index];
    this.floor.walls.splice(index, 1);
  }

  undo(): void {
    if (this.removedWall !== undefined && this.removedIndex !== -1) {
      this.floor.walls.splice(this.removedIndex, 0, this.removedWall);
    }
  }
}
