import type { Point, Space } from "@indoor/core";
import type { Command } from "./Command.js";

export class MoveVertexCommand implements Command {
  readonly label = "Move Vertex";

  private readonly previousPoint: Point;

  constructor(
    private readonly space: Space,
    private readonly vertexIndex: number,
    private readonly newPoint: Point,
  ) {
    const current = space.polygon[vertexIndex];
    if (!current) throw new Error(`Vertex index ${vertexIndex} out of range`);
    this.previousPoint = { ...current };
  }

  execute(): void {
    this.space.polygon[this.vertexIndex] = { ...this.newPoint };
  }

  undo(): void {
    this.space.polygon[this.vertexIndex] = { ...this.previousPoint };
  }
}

export class AddVertexCommand implements Command {
  readonly label = "Add Vertex";

  constructor(
    private readonly space: Space,
    private readonly index: number,
    private readonly point: Point,
  ) {}

  execute(): void {
    this.space.polygon.splice(this.index, 0, { ...this.point });
  }

  undo(): void {
    this.space.polygon.splice(this.index, 1);
  }
}

export class DeleteVertexCommand implements Command {
  readonly label = "Delete Vertex";

  private removedPoint: Point | undefined;

  constructor(
    private readonly space: Space,
    private readonly index: number,
  ) {}

  execute(): void {
    const removed = this.space.polygon[this.index];
    if (!removed) return;
    this.removedPoint = { ...removed };
    this.space.polygon.splice(this.index, 1);
  }

  undo(): void {
    if (this.removedPoint) {
      this.space.polygon.splice(this.index, 0, this.removedPoint);
    }
  }
}
