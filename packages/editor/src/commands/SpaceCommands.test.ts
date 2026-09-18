import { describe, expect, it } from "vitest";
import { createFloor, createSpace } from "@indoor/core";
import { AddSpaceCommand, DeleteSpaceCommand } from "./SpaceCommands.js";

describe("AddSpaceCommand", () => {
  it("appends the space on execute and removes it on undo", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    const command = new AddSpaceCommand(floor, space);

    command.execute();
    expect(floor.spaces).toEqual([space]);

    command.undo();
    expect(floor.spaces).toHaveLength(0);
  });

  it("supports redo (re-execute after undo)", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    const command = new AddSpaceCommand(floor, space);

    command.execute();
    command.undo();
    command.execute();

    expect(floor.spaces).toEqual([space]);
  });
});

describe("DeleteSpaceCommand", () => {
  it("removes the space on execute and restores it at its original index on undo", () => {
    const floor = createFloor("1F", 1);
    const first = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    const target = createSpace(floor.id, [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ]);
    const last = createSpace(floor.id, [
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
    ]);
    floor.spaces.push(first, target, last);

    const command = new DeleteSpaceCommand(floor, target.id);
    command.execute();

    expect(floor.spaces).toEqual([first, last]);

    command.undo();
    expect(floor.spaces).toEqual([first, target, last]); // restored at its original index (1)
  });

  it("preserves the exact prior space object (not a clone) through execute/undo", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
    space.type = "store";
    floor.spaces.push(space);

    const command = new DeleteSpaceCommand(floor, space.id);
    command.execute();
    command.undo();

    expect(floor.spaces[0]).toBe(space); // same reference, not a re-created copy
    expect(floor.spaces[0]?.type).toBe("store");
  });

  it("is a no-op when the space id does not exist", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    floor.spaces.push(space);

    const command = new DeleteSpaceCommand(floor, "missing-id");
    command.execute();
    expect(floor.spaces).toEqual([space]);

    command.undo();
    expect(floor.spaces).toEqual([space]);
  });
});
