import { createBuilding, createEmptyProject, createFloor, type Point } from "@indoor/core";
import { describe, expect, it, vi } from "vitest";
import { IndoorEditor } from "./IndoorEditor.js";
import { ChangePropertyCommand } from "./commands/PropertyCommands.js";
import { AddFloorCommand } from "./commands/FloorCommands.js";
import { AddBuildingCommand } from "./commands/BuildingCommands.js";
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

function drawSquare(editor: IndoorEditor): void {
  editor.setTool("polygon");
  editor.handlePointerDown(click({ x: 0, y: 0 }));
  editor.handlePointerDown(click({ x: 4, y: 0 }));
  editor.handlePointerDown(click({ x: 4, y: 4 }));
  editor.handlePointerDown(click({ x: 0, y: 4 }));
  editor.handleKeyDown({ key: "Enter", shiftKey: false, ctrlKey: false, altKey: false });
}

function makeEditorWithFloor() {
  const project = createEmptyProject("Test Mall");
  const building = createBuilding("B1");
  const floor = createFloor("1F", 1);
  building.floors.push(floor);
  project.buildings.push(building);

  const editor = new IndoorEditor({ project });
  return { editor, building, floor };
}

describe("IndoorEditor", () => {
  it("discards unfinished geometry when switching floors", () => {
    const { editor, building } = makeEditorWithFloor();
    const next = createFloor('2F', 2);
    building.floors.push(next);
    editor.setTool('polygon');
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 0 }));
    editor.setFloor(next.id);
    editor.handlePointerDown(click({ x: 4, y: 4 }));
    editor.handleKeyDown({ key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false });
    expect(next.spaces).toHaveLength(0);
  });

  it("restores a valid editing floor after undoing an added floor", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const next = createFloor('2F', 2);
    editor.executeCommand(new AddFloorCommand(building, next));
    editor.setFloor(next.id);
    editor.undo();
    expect(editor.getActiveFloor()?.id).toBe(floor.id);
    drawSquare(editor);
    expect(floor.spaces).toHaveLength(1);
  });

  it("clears selection when undo removes its object", () => {
    const { editor } = makeEditorWithFloor();
    drawSquare(editor);
    editor.undo();
    expect(editor.selection.current).toHaveLength(0);
  });
  it("activates the select tool by default and exposes the first floor", () => {
    const { editor, floor } = makeEditorWithFloor();
    expect(editor.tools.active?.id).toBe("select");
    expect(editor.getActiveFloor()?.id).toBe(floor.id);
  });

  it("draws a polygon with the polygon tool and creates a Space via undoable command", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);

    expect(floor.spaces).toHaveLength(1);
    expect(floor.spaces[0]?.polygon).toHaveLength(4);
    expect(editor.selection.current).toEqual([{ id: floor.spaces[0]?.id }]);

    editor.undo();
    expect(floor.spaces).toHaveLength(0);

    editor.redo();
    expect(floor.spaces).toHaveLength(1);
  });

  it("cancels an in-progress polygon on Escape without creating a Space", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("polygon");

    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 0 }));
    editor.handleKeyDown({ key: "Escape", shiftKey: false, ctrlKey: false, altKey: false });

    expect(floor.spaces).toHaveLength(0);
  });

  it("selects a space by clicking inside it with the select tool", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);

    editor.setTool("select");
    editor.selection.clear();
    editor.handlePointerDown(click({ x: 2, y: 2 }));

    expect(editor.selection.current).toEqual([{ id: floor.spaces[0]?.id }]);
  });

  it("emits calibrationPointsPicked after two clicks with the calibrate tool", () => {
    const { editor } = makeEditorWithFloor();
    editor.setTool("calibrate");

    const handler = vi.fn();
    editor.on("calibrationPointsPicked", handler);

    editor.handlePointerDown(click({ x: 1, y: 1 }));
    expect(handler).not.toHaveBeenCalled();

    editor.handlePointerDown(click({ x: 5, y: 1 }));
    expect(handler).toHaveBeenCalledWith({ a: { x: 1, y: 1 }, b: { x: 5, y: 1 } });
  });

  it("supports setting and calibrating a reference image", () => {
    const { editor } = makeEditorWithFloor();
    editor.reference.setImage("blob://plan.png", 1000, 800);
    editor.reference.setOrigin({ x: 0, y: 0 });

    const pixelA = { x: 200, y: 200 };
    const pixelB = { x: 300, y: 200 };
    const worldA = editor.reference.imagePixelToWorld(pixelA);
    const worldB = editor.reference.imagePixelToWorld(pixelB);

    editor.reference.calibrate(worldA, worldB, 12);

    const newWorldB = editor.reference.imagePixelToWorld(pixelB);
    expect(Math.hypot(newWorldB.x - worldA.x, newWorldB.y - worldA.y)).toBeCloseTo(12);
  });

  it("changes a space property through executeCommand and supports undo", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);

    const space = floor.spaces[0];
    if (!space) throw new Error("expected space to exist");

    const projectChanged = vi.fn();
    editor.on("projectChanged", projectChanged);

    editor.executeCommand(new ChangePropertyCommand(space, "type", "store"));
    expect(space.type).toBe("store");
    expect(projectChanged).toHaveBeenCalled();

    editor.undo();
    expect(space.type).toBe("unknown");
  });

  it("exposes layer visibility toggles", () => {
    const { editor } = makeEditorWithFloor();
    expect(editor.layers.isVisible("pois")).toBe(true);
    editor.layers.setVisible("pois", false);
    expect(editor.layers.isVisible("pois")).toBe(false);
  });

  it("places a Door entrance and auto-links the nearest space", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);

    editor.setTool("door");
    // (4, 2) sits exactly on the square's right edge.
    editor.handlePointerDown(click({ x: 4, y: 2 }));

    expect(floor.entrances).toHaveLength(1);
    expect(floor.entrances[0]?.spaceA).toBe(floor.spaces[0]?.id);
    expect(floor.entrances[0]?.type).toBe("door");

    editor.undo();
    expect(floor.entrances).toHaveLength(0);
  });

  it("places a POI inside a Space and auto-links it", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);

    editor.setTool("poi");
    editor.handlePointerDown(click({ x: 2, y: 2 }));

    expect(floor.pois).toHaveLength(1);
    expect(floor.pois[0]?.spaceId).toBe(floor.spaces[0]?.id);
    expect(floor.pois[0]?.type).toBe("custom");
  });

  it("drags a POI with the select tool into an undoable Move command", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("poi");
    editor.handlePointerDown(click({ x: 2, y: 2 }));
    const poi = floor.pois[0];
    if (!poi) throw new Error("expected poi to exist");

    editor.setTool("select");
    editor.handlePointerDown(click({ x: 2, y: 2 }));
    editor.handlePointerMove(click({ x: 5, y: 5 }));
    expect(poi.position).toEqual({ x: 5, y: 5 });

    editor.handlePointerUp(click({ x: 5, y: 5 }));
    expect(poi.position).toEqual({ x: 5, y: 5 });

    editor.undo();
    expect(poi.position).toEqual({ x: 2, y: 2 });
  });

  it("deletes the selected space, entrance, or POI with the Delete key", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);

    editor.setTool("poi");
    editor.handlePointerDown(click({ x: 1, y: 1 }));

    editor.setTool("select");
    editor.handlePointerDown(click({ x: 1, y: 1 })); // selects the POI (hit-tested before spaces)
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(floor.pois).toHaveLength(0);

    editor.selection.select(floor.spaces[0]!.id);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(floor.spaces).toHaveLength(0);

    editor.undo();
    expect(floor.spaces).toHaveLength(1);
  });

  it("supports adding a floor and switching the active floor", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const secondFloor = createFloor("2F", 2);

    editor.executeCommand(new AddFloorCommand(building, secondFloor));
    expect(building.floors).toHaveLength(2);

    editor.setFloor(secondFloor.id);
    expect(editor.getActiveFloor()?.id).toBe(secondFloor.id);

    editor.setFloor(floor.id);
    expect(editor.getActiveFloor()?.id).toBe(floor.id);
  });

  it("places navigation nodes and connects them with an auto-computed distance", () => {
    const { editor, floor } = makeEditorWithFloor();

    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 3, y: 4 }));
    expect(floor.navigation.nodes).toHaveLength(2);

    const [nodeA, nodeB] = floor.navigation.nodes;

    editor.setTool("navigation-edge");
    editor.handlePointerDown(click(nodeA!.position));
    editor.handlePointerDown(click(nodeB!.position));

    expect(floor.navigation.edges).toHaveLength(1);
    expect(floor.navigation.edges[0]?.distance).toBeCloseTo(5); // 3-4-5 triangle
    expect(floor.navigation.edges[0]?.from).toBe(nodeA!.id);
    expect(floor.navigation.edges[0]?.to).toBe(nodeB!.id);
  });

  it("cancels a pending navigation edge connection on Escape", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 1, y: 1 }));

    editor.setTool("navigation-edge");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handleKeyDown({ key: "Escape", shiftKey: false, ctrlKey: false, altKey: false });
    editor.handlePointerDown(click({ x: 1, y: 1 }));

    expect(floor.navigation.edges).toHaveLength(0);
  });

  it("deletes a navigation node or edge with the Delete key", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 1, y: 0 }));
    const [nodeA, nodeB] = floor.navigation.nodes;

    editor.setTool("navigation-edge");
    editor.handlePointerDown(click(nodeA!.position));
    editor.handlePointerDown(click(nodeB!.position));
    const edgeId = floor.navigation.edges[0]!.id;

    editor.setTool("select");
    editor.selection.select(edgeId);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(floor.navigation.edges).toHaveLength(0);

    editor.selection.select(nodeA!.id);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(floor.navigation.nodes).toHaveLength(1);
  });

  it("computes a route preview using the merged project navigation graph", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 5, y: 0 }));
    const [nodeA, nodeB] = floor.navigation.nodes;

    editor.setTool("navigation-edge");
    editor.handlePointerDown(click(nodeA!.position));
    editor.handlePointerDown(click(nodeB!.position));

    editor.routePreview.compute(nodeA!.id, nodeB!.id);
    expect(editor.routePreview.current?.result?.nodeIds).toEqual([nodeA!.id, nodeB!.id]);
    expect(editor.routePreview.current?.result?.distance).toBeCloseTo(5);

    editor.routePreview.clear();
    expect(editor.routePreview.current).toBeNull();
  });

  it("focusObject switches floor, selects the object, and centers the camera on it", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const secondFloor = createFloor("2F", 2);
    editor.executeCommand(new AddFloorCommand(building, secondFloor));

    editor.setFloor(secondFloor.id);
    drawSquare(editor); // creates a 4x4 square on the *active* floor (2F)
    const space = secondFloor.spaces[0];
    if (!space) throw new Error("expected space to exist");

    editor.setFloor(floor.id); // move away so focusObject has to switch back
    editor.selection.clear();

    editor.focusObject(space.id);

    expect(editor.getActiveFloor()?.id).toBe(secondFloor.id);
    expect(editor.selection.current).toEqual([{ id: space.id }]);
    expect(editor.camera.getState().center).toEqual({ x: 2, y: 2 }); // centroid of the 4x4 square
  });

  it("places chained wall segments with the wall tool", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("wall");

    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 4 }));

    expect(floor.walls).toHaveLength(2);
    expect(floor.walls[0]?.start).toEqual({ x: 0, y: 0 });
    expect(floor.walls[0]?.end).toEqual({ x: 4, y: 0 });
    expect(floor.walls[1]?.start).toEqual({ x: 4, y: 0 });
    expect(floor.walls[1]?.end).toEqual({ x: 4, y: 4 });
  });

  it("cancels a pending wall chain on Escape", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("wall");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handleKeyDown({ key: "Escape", shiftKey: false, ctrlKey: false, altKey: false });
    editor.handlePointerDown(click({ x: 4, y: 0 }));

    expect(floor.walls).toHaveLength(0);
  });

  it("selects and deletes a wall with the Delete key", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("wall");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 0 }));
    const wallId = floor.walls[0]!.id;

    editor.setTool("select");
    editor.handlePointerDown(click({ x: 2, y: 0 })); // midpoint of the wall
    expect(editor.selection.current).toEqual([{ id: wallId }]);

    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(floor.walls).toHaveLength(0);

    editor.undo();
    expect(floor.walls).toHaveLength(1);
  });

  it("drags a vertex of the selected space and supports undo", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);
    const space = floor.spaces[0]!;

    editor.setTool("select");
    editor.selection.select(space.id); // select the space first, as a user would

    editor.handlePointerDown(click({ x: 0, y: 0 })); // grab the first vertex
    expect(editor.selection.current).toEqual([{ id: space.id, vertexIndex: 0 }]);

    editor.handlePointerMove(click({ x: 1, y: 1 }));
    expect(space.polygon[0]).toEqual({ x: 1, y: 1 });

    editor.handlePointerUp(click({ x: 1, y: 1 }));
    expect(space.polygon[0]).toEqual({ x: 1, y: 1 });

    editor.undo();
    expect(space.polygon[0]).toEqual({ x: 0, y: 0 });
  });

  it("inserts a vertex by clicking an edge of the already-selected space", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);
    const space = floor.spaces[0]!;
    expect(space.polygon).toHaveLength(4);

    editor.setTool("select");
    editor.selection.select(space.id);

    editor.handlePointerDown(click({ x: 4, y: 2 })); // midpoint of the right edge
    expect(space.polygon).toHaveLength(5);
    expect(space.polygon[2]).toEqual({ x: 4, y: 2 });
    expect(editor.selection.current).toEqual([{ id: space.id, vertexIndex: 2 }]);
  });

  it("deletes a vertex via the Delete key but refuses to drop below 3 vertices", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);
    const space = floor.spaces[0]!;

    editor.setTool("select");
    editor.selection.select(space.id, 0);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(space.polygon).toHaveLength(3);

    editor.selection.select(space.id, 0);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    editor.selection.select(space.id, 0);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });
    expect(space.polygon).toHaveLength(3); // refused once at the floor
  });

  it("AddBuildingCommand adds a new building to the project and supports undo", () => {
    const { editor, building } = makeEditorWithFloor();
    const secondBuilding = createBuilding("B2");

    editor.executeCommand(new AddBuildingCommand(editor.project, secondBuilding));
    expect(editor.project.buildings).toEqual([building, secondBuilding]);

    editor.undo();
    expect(editor.project.buildings).toEqual([building]);
  });
});
