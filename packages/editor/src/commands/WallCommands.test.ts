import { describe, expect, it } from "vitest";
import { createFloor, createWall } from "@indoor/core";
import { AddWallCommand, DeleteWallCommand, MoveWallCommand } from "./WallCommands.js";

describe("AddWallCommand", () => {
  it("appends the wall on execute and removes it on undo", () => {
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const command = new AddWallCommand(floor, wall);

    command.execute();
    expect(floor.walls).toEqual([wall]);

    command.undo();
    expect(floor.walls).toHaveLength(0);
  });
});

describe("DeleteWallCommand", () => {
  it("removes the wall on execute and restores it at its original index on undo", () => {
    const floor = createFloor("1F", 1);
    const first = createWall(floor.id, { x: 0, y: 0 }, { x: 1, y: 0 });
    const target = createWall(floor.id, { x: 1, y: 0 }, { x: 2, y: 0 });
    const last = createWall(floor.id, { x: 2, y: 0 }, { x: 3, y: 0 });
    floor.walls.push(first, target, last);

    const command = new DeleteWallCommand(floor, target.id);
    command.execute();

    expect(floor.walls).toEqual([first, last]);

    command.undo();
    expect(floor.walls).toEqual([first, target, last]); // restored at its original index (1)
  });

  it("is a no-op when the wall id does not exist", () => {
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 1, y: 0 });
    floor.walls.push(wall);

    const command = new DeleteWallCommand(floor, "missing-id");
    command.execute();
    expect(floor.walls).toEqual([wall]);

    command.undo();
    expect(floor.walls).toEqual([wall]);
  });
});

describe("MoveWallCommand", () => {
  it("moves the wall's endpoints on execute and restores the exact prior endpoints on undo", () => {
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const originalStart = { ...wall.start };
    const originalEnd = { ...wall.end };

    const command = new MoveWallCommand(wall, { x: 1, y: 1 }, { x: 5, y: 1 });
    command.execute();

    expect(wall.start).toEqual({ x: 1, y: 1 });
    expect(wall.end).toEqual({ x: 5, y: 1 });

    command.undo();
    expect(wall.start).toEqual(originalStart);
    expect(wall.end).toEqual(originalEnd);
  });

  it("captures the wall's prior state at construction time, not at execute time", () => {
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const command = new MoveWallCommand(wall, { x: 9, y: 9 }, { x: 10, y: 10 });

    // Mutate the wall after constructing the command but before executing it.
    wall.start = { x: 100, y: 100 };

    command.execute();
    command.undo();

    // Undo restores whatever the wall looked like when the command was
    // *built* ({0,0}), not whatever it looked like right before execute().
    expect(wall.start).toEqual({ x: 0, y: 0 });
  });
});
