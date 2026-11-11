import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createSpace,
  type Point,
} from "@indoor/core";
import { describe, expect, it } from "vitest";
import { IndoorEditor } from "./IndoorEditor.js";
import type { EditorPointerEvent } from "./tools/EditorTool.js";

function click(point: Point): EditorPointerEvent {
  return {
    screenPoint: point,
    worldPoint: point,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

function editorWithRoom(withRoom: boolean) {
  const project = createEmptyProject("P");
  const building = createBuilding("B");
  const floor = createFloor("1F", 1);
  if (withRoom) {
    floor.spaces.push(
      createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
        { x: 0, y: 6 },
      ]),
    );
  }
  building.floors.push(floor);
  project.buildings.push(building);
  return { editor: new IndoorEditor({ project }), floor };
}

describe("wall drawing with grid snap on", () => {
  it("keeps a chained wall on the grid when the click is almost horizontal", () => {
    const { editor, floor } = editorWithRoom(false);
    editor.setTool("wall");
    editor.handlePointerDown(click({ x: 0.1, y: -0.2 }));
    // Nearly level with the start: orthogonal snap locks y, and the grid must still round x.
    editor.handlePointerDown(click({ x: 3.3, y: 0.1 }));
    expect(floor.walls[0]).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 3, y: 0 } });
  });

  it("lands on grid points when drawing along a room's edge", () => {
    const { editor, floor } = editorWithRoom(true);
    editor.setTool("wall");
    editor.handlePointerDown(click({ x: 2.4, y: 0.08 }));
    editor.handlePointerDown(click({ x: 7.3, y: -0.1 }));
    expect(floor.walls[0]).toMatchObject({ start: { x: 2, y: 0 }, end: { x: 7, y: 0 } });
  });

  it("still follows the click freely when grid snap is off", () => {
    const { editor, floor } = editorWithRoom(true);
    editor.gridSnap.setEnabled(false);
    editor.setTool("wall");
    editor.handlePointerDown(click({ x: 2.4, y: 0.08 }));
    editor.handlePointerDown(click({ x: 7.3, y: -0.1 }));
    expect(floor.walls[0]!.start.x).toBeCloseTo(2.4);
    expect(floor.walls[0]!.end.x).toBeCloseTo(7.3);
    expect(floor.walls[0]!.end.y).toBeCloseTo(0);
  });
});
