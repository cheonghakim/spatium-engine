import {
  createBuilding,
  createEmptyProject,
  createEntrance,
  createFloor,
  createFurniture,
  createPOI,
  type Point,
} from "@indoor/core";
import { describe, expect, it, vi } from "vitest";
import { IndoorEditor } from "./IndoorEditor.js";
import { ChangePropertyCommand } from "./commands/PropertyCommands.js";
import { AddEntranceCommand } from "./commands/EntranceCommands.js";
import { AddFloorCommand } from "./commands/FloorCommands.js";
import { AddBuildingCommand } from "./commands/BuildingCommands.js";
import { AddPOICommand } from "./commands/POICommands.js";
import { AddFurnitureCommand } from "./commands/FurnitureCommands.js";
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
    const next = createFloor("2F", 2);
    building.floors.push(next);
    editor.setTool("polygon");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 0 }));
    editor.setFloor(next.id);
    editor.handlePointerDown(click({ x: 4, y: 4 }));
    editor.handleKeyDown({ key: "Enter", shiftKey: false, ctrlKey: false, altKey: false });
    expect(next.spaces).toHaveLength(0);
  });

  it("restores a valid editing floor after undoing an added floor", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const next = createFloor("2F", 2);
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
    // Each node gets a distinct default name (not just a type + random id) so
    // it's recognizable anywhere it's listed (route start/end pickers,
    // cross-floor link pickers) without requiring the user to rename it first.
    expect(nodeA!.name).toBe("노드 1");
    expect(nodeB!.name).toBe("노드 2");

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

  it("cascades a Space delete to clear dangling Entrance and POI references, and undoes as one step", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);
    const space = floor.spaces[0]!;

    editor.setTool("door");
    editor.handlePointerDown(click({ x: 4, y: 2 })); // sits exactly on the square's right edge
    const entrance = floor.entrances[0]!;
    expect(entrance.spaceA).toBe(space.id);

    editor.setTool("poi");
    editor.handlePointerDown(click({ x: 2, y: 2 }));
    const poi = floor.pois[0]!;
    expect(poi.spaceId).toBe(space.id);

    editor.setTool("select");
    editor.selection.select(space.id);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });

    expect(floor.spaces).toHaveLength(0);
    expect(entrance.spaceA).toBeUndefined();
    expect(poi.spaceId).toBeUndefined();

    editor.undo();
    expect(floor.spaces).toHaveLength(1);
    expect(entrance.spaceA).toBe(space.id);
    expect(poi.spaceId).toBe(space.id);
  });

  it("cascades a NavigationNode delete to remove edges referencing it, and undoes as one step", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 3, y: 0 }));
    editor.handlePointerDown(click({ x: 0, y: 3 }));
    const [nodeA, nodeB, nodeC] = floor.navigation.nodes;

    editor.setTool("navigation-edge");
    editor.handlePointerDown(click(nodeA!.position));
    editor.handlePointerDown(click(nodeB!.position));
    editor.handlePointerDown(click(nodeA!.position));
    editor.handlePointerDown(click(nodeC!.position));
    expect(floor.navigation.edges).toHaveLength(2);

    editor.setTool("select");
    editor.selection.select(nodeA!.id);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });

    expect(floor.navigation.nodes).toHaveLength(2);
    expect(floor.navigation.edges).toHaveLength(0);

    editor.undo();
    expect(floor.navigation.nodes).toHaveLength(3);
    expect(floor.navigation.edges).toHaveLength(2);
  });

  it("cascades a Wall delete to clear an Entrance's wallId without deleting the Entrance", () => {
    const { editor, floor } = makeEditorWithFloor();
    editor.setTool("wall");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    editor.handlePointerDown(click({ x: 4, y: 0 }));
    const wall = floor.walls[0]!;

    const entrance = createEntrance(floor.id, { x: 2, y: 0 }, "door");
    entrance.wallId = wall.id;
    editor.executeCommand(new AddEntranceCommand(floor, entrance));

    editor.setTool("select");
    editor.selection.select(wall.id);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });

    expect(floor.walls).toHaveLength(0);
    expect(floor.entrances).toHaveLength(1);
    expect(entrance.wallId).toBeUndefined();

    editor.undo();
    expect(floor.walls).toHaveLength(1);
    expect(entrance.wallId).toBe(wall.id);
  });

  it("linkFloorNode connects nodes on different floors, replaces the old link on re-link, and unlinks with null", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const second = createFloor("2F", 2);
    editor.executeCommand(new AddFloorCommand(building, second));

    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    const nodeA = floor.navigation.nodes[0]!;

    editor.setFloor(second.id);
    editor.handlePointerDown(click({ x: 3, y: 4 }));
    editor.handlePointerDown(click({ x: 10, y: 10 }));
    const [nodeB, nodeC] = second.navigation.nodes;

    editor.linkFloorNode(nodeA.id, nodeB!.id, "elevator");
    expect(floor.navigation.edges).toHaveLength(1);
    expect(floor.navigation.edges[0]).toMatchObject({
      from: nodeA.id,
      to: nodeB!.id,
      type: "elevator",
    });
    expect(floor.navigation.edges[0]?.distance).toBeCloseTo(5); // 3-4-5 triangle from (0,0) to (3,4)

    editor.linkFloorNode(nodeA.id, nodeC!.id, "stairs");
    expect(floor.navigation.edges).toHaveLength(1); // old link replaced, not accumulated
    expect(floor.navigation.edges[0]).toMatchObject({
      from: nodeA.id,
      to: nodeC!.id,
      type: "stairs",
    });

    editor.linkFloorNode(nodeA.id, null, "walk");
    expect(floor.navigation.edges).toHaveLength(0);
  });

  it("undoes linkFloorNode as a single step, restoring the previous cross-floor edge", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const second = createFloor("2F", 2);
    editor.executeCommand(new AddFloorCommand(building, second));

    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    const nodeA = floor.navigation.nodes[0]!;

    editor.setFloor(second.id);
    editor.handlePointerDown(click({ x: 3, y: 4 }));
    editor.handlePointerDown(click({ x: 10, y: 10 }));
    const [nodeB, nodeC] = second.navigation.nodes;

    editor.linkFloorNode(nodeA.id, nodeB!.id, "elevator");
    editor.linkFloorNode(nodeA.id, nodeC!.id, "stairs");

    editor.undo();
    expect(floor.navigation.edges).toHaveLength(1);
    expect(floor.navigation.edges[0]).toMatchObject({
      from: nodeA.id,
      to: nodeB!.id,
      type: "elevator",
    });

    editor.undo();
    expect(floor.navigation.edges).toHaveLength(0);
  });

  it("linkFloorNode enforces at-most-one-cross-floor-edge from the TARGET side too, not just the source", () => {
    // Reproduces the reported bug: linking A (floor1) to B (floor2) creates
    // A-B. Separately linking C (floor3) to that SAME node B must replace
    // the stale A-B edge, not leave B with two simultaneous cross-floor
    // edges — even though B is the *target*, not the *source*, of either
    // call, and the exclusivity check historically only looked at the
    // source side.
    const { editor, building, floor } = makeEditorWithFloor();
    const second = createFloor("2F", 2);
    const third = createFloor("3F", 3);
    editor.executeCommand(new AddFloorCommand(building, second));
    editor.executeCommand(new AddFloorCommand(building, third));

    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    const nodeA = floor.navigation.nodes[0]!;

    editor.setFloor(second.id);
    editor.handlePointerDown(click({ x: 3, y: 4 }));
    const nodeB = second.navigation.nodes[0]!;

    editor.setFloor(third.id);
    editor.handlePointerDown(click({ x: 10, y: 10 }));
    const nodeC = third.navigation.nodes[0]!;

    const edgesTouching = (nodeId: string) =>
      building.floors
        .flatMap((f) => f.navigation.edges)
        .filter((e) => e.from === nodeId || e.to === nodeId);

    editor.linkFloorNode(nodeA.id, nodeB.id, "stairs"); // A - B
    expect(edgesTouching(nodeB.id)).toHaveLength(1);

    editor.linkFloorNode(nodeC.id, nodeB.id, "stairs"); // C - B, called with B as the TARGET this time
    const bEdges = edgesTouching(nodeB.id);
    expect(bEdges).toHaveLength(1); // exactly one cross-floor edge touches B, never two
    expect(bEdges[0]).toMatchObject({ from: nodeC.id, to: nodeB.id, type: "stairs" }); // most recent link wins
    expect(edgesTouching(nodeA.id)).toHaveLength(0); // the stale A-B edge is gone

    editor.linkFloorNode(nodeB.id, null, "stairs"); // unlink B
    expect(edgesTouching(nodeB.id)).toHaveLength(0);
    expect(edgesTouching(nodeA.id)).toHaveLength(0);
    expect(edgesTouching(nodeC.id)).toHaveLength(0); // nothing dangling on any of the three nodes
  });

  it("undoes the target-side exclusivity replacement (spanning two floors' edge arrays) as one atomic step", () => {
    const { editor, building, floor } = makeEditorWithFloor();
    const second = createFloor("2F", 2);
    const third = createFloor("3F", 3);
    editor.executeCommand(new AddFloorCommand(building, second));
    editor.executeCommand(new AddFloorCommand(building, third));

    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    const nodeA = floor.navigation.nodes[0]!;

    editor.setFloor(second.id);
    editor.handlePointerDown(click({ x: 3, y: 4 }));
    const nodeB = second.navigation.nodes[0]!;

    editor.setFloor(third.id);
    editor.handlePointerDown(click({ x: 10, y: 10 }));
    const nodeC = third.navigation.nodes[0]!;

    const edgesTouching = (nodeId: string) =>
      building.floors
        .flatMap((f) => f.navigation.edges)
        .filter((e) => e.from === nodeId || e.to === nodeId);

    editor.linkFloorNode(nodeA.id, nodeB.id, "stairs"); // A - B, stored on floor 1's (source's) edges array
    editor.linkFloorNode(nodeC.id, nodeB.id, "stairs"); // one compound command: delete A-B (floor1 array) + add C-B (floor3 array)

    expect(edgesTouching(nodeB.id)).toHaveLength(1);
    expect(edgesTouching(nodeB.id)[0]).toMatchObject({ from: nodeC.id });

    editor.undo(); // a single undo must revert the whole compound step
    expect(edgesTouching(nodeC.id)).toHaveLength(0); // C-B removed
    const restored = edgesTouching(nodeA.id);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ from: nodeA.id, to: nodeB.id, type: "stairs" }); // A-B restored
    expect(edgesTouching(nodeB.id)).toHaveLength(1);
  });

  it("cascades a NavigationNode delete to a cross-floor edge stored on the OTHER floor (F1)", () => {
    // linkFloorNode stores the new edge on the SOURCE node's floor (see its
    // docstring). Here nodeA (floor 1) is the source and nodeB (floor 2) is
    // the target, so the edge lives on floor 1's array. Deleting nodeB while
    // floor 2 is active must still find and clean up that edge on floor 1 —
    // the bug this reproduces only scanned the active floor's own edges.
    const { editor, building, floor } = makeEditorWithFloor();
    const second = createFloor("2F", 2);
    editor.executeCommand(new AddFloorCommand(building, second));

    editor.setTool("navigation-node");
    editor.handlePointerDown(click({ x: 0, y: 0 }));
    const nodeA = floor.navigation.nodes[0]!;

    editor.setFloor(second.id);
    editor.handlePointerDown(click({ x: 3, y: 4 }));
    const nodeB = second.navigation.nodes[0]!;

    editor.linkFloorNode(nodeA.id, nodeB.id, "elevator");
    expect(floor.navigation.edges).toHaveLength(1); // stored on the source's (floor 1) array
    const edgeId = floor.navigation.edges[0]!.id;

    editor.setTool("select"); // active floor is still floor 2 (second)
    editor.selection.select(nodeB.id);
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });

    expect(second.navigation.nodes).toHaveLength(0);
    expect(floor.navigation.edges).toHaveLength(0); // dangling cross-floor edge cleaned up

    editor.undo();
    expect(second.navigation.nodes).toHaveLength(1);
    expect(second.navigation.nodes[0]?.id).toBe(nodeB.id);
    expect(floor.navigation.edges).toHaveLength(1);
    expect(floor.navigation.edges[0]).toMatchObject({
      id: edgeId,
      from: nodeA.id,
      to: nodeB.id,
      type: "elevator",
    });
  });

  describe("clearFloor", () => {
    it("empties every space, wall, entrance, POI, and navigation node/edge on the active floor as one undoable step", () => {
      const { editor, floor } = makeEditorWithFloor();
      drawSquare(editor);
      editor.setTool("wall");
      editor.handlePointerDown(click({ x: 0, y: 0 }));
      editor.handlePointerDown(click({ x: 4, y: 0 }));
      editor.setTool("door");
      editor.handlePointerDown(click({ x: 4, y: 2 }));
      editor.setTool("poi");
      editor.handlePointerDown(click({ x: 2, y: 2 }));
      editor.setTool("navigation-node");
      editor.handlePointerDown(click({ x: 1, y: 1 }));
      editor.handlePointerDown(click({ x: 3, y: 3 }));
      editor.setTool("navigation-edge");
      editor.handlePointerDown(click({ x: 1, y: 1 }));
      editor.handlePointerDown(click({ x: 3, y: 3 }));

      expect(floor.spaces).toHaveLength(1);
      expect(floor.walls.length).toBeGreaterThan(0);
      expect(floor.entrances).toHaveLength(1);
      expect(floor.pois).toHaveLength(1);
      expect(floor.navigation.nodes).toHaveLength(2);
      expect(floor.navigation.edges).toHaveLength(1);

      editor.setTool("select");
      editor.clearFloor();

      expect(floor.spaces).toHaveLength(0);
      expect(floor.walls).toHaveLength(0);
      expect(floor.entrances).toHaveLength(0);
      expect(floor.pois).toHaveLength(0);
      expect(floor.navigation.nodes).toHaveLength(0);
      expect(floor.navigation.edges).toHaveLength(0);

      editor.undo();
      expect(floor.spaces).toHaveLength(1);
      expect(floor.walls.length).toBeGreaterThan(0);
      expect(floor.entrances).toHaveLength(1);
      expect(floor.pois).toHaveLength(1);
      expect(floor.navigation.nodes).toHaveLength(2);
      expect(floor.navigation.edges).toHaveLength(1);
    });

    it("also removes a cross-floor navigation edge stored on another floor, and restores it on undo", () => {
      const { editor, building, floor } = makeEditorWithFloor();
      const second = createFloor("2F", 2);
      editor.executeCommand(new AddFloorCommand(building, second));

      editor.setTool("navigation-node");
      editor.handlePointerDown(click({ x: 0, y: 0 }));
      const nodeA = floor.navigation.nodes[0]!;

      editor.setFloor(second.id);
      editor.handlePointerDown(click({ x: 3, y: 4 }));
      const nodeB = second.navigation.nodes[0]!;

      editor.linkFloorNode(nodeA.id, nodeB.id, "elevator");
      expect(floor.navigation.edges).toHaveLength(1); // stored on floor 1 (the source)

      editor.setFloor(floor.id);
      editor.clearFloor(); // clears floor 1, where nodeA and the cross-floor edge live

      expect(floor.navigation.nodes).toHaveLength(0);
      expect(floor.navigation.edges).toHaveLength(0);
      expect(second.navigation.nodes).toHaveLength(1); // floor 2 untouched

      editor.undo();
      expect(floor.navigation.nodes).toHaveLength(1);
      expect(floor.navigation.edges).toHaveLength(1);
      expect(floor.navigation.edges[0]).toMatchObject({ from: nodeA.id, to: nodeB.id });
    });

    it("does nothing when the floor has no content", () => {
      const { editor, floor } = makeEditorWithFloor();
      editor.clearFloor();
      expect(editor.history.canUndo).toBe(false);
      expect(floor.spaces).toHaveLength(0);
    });
  });

  it("routes undo to main history after a normal edit follows a draft edit, even with the draft still pending (F2)", () => {
    const { editor, floor } = makeEditorWithFloor();

    editor.draft.setDraft(
      [{ start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2 }],
      [],
      [],
      floor.id,
    );
    editor.setTool("draft-review");
    editor.handlePointerDown(click({ x: 2, y: 0 })); // grabs the wall body (midpoint)
    editor.handlePointerMove(click({ x: 3, y: 2 }));
    editor.handlePointerUp(click({ x: 3, y: 2 }));
    expect(editor.draft.canUndo).toBe(true);
    expect(editor.draft.current?.walls[0]?.start).toEqual({ x: 1, y: 2 });

    // Switch to an unrelated tool and perform a normal, main-history edit
    // while the draft is still pending/unconfirmed.
    drawSquare(editor);
    expect(floor.spaces).toHaveLength(1);

    editor.undo();

    // The most recently touched stack was main history (the square), so undo
    // should undo THAT, leaving the draft's own pending edit untouched.
    expect(floor.spaces).toHaveLength(0);
    expect(editor.draft.current?.walls[0]?.start).toEqual({ x: 1, y: 2 });
  });

  it("loadProject swaps the project and resets history, selection, draft, and floor", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor);
    editor.selection.select(floor.spaces[0]!.id);
    editor.draft.setDraft(
      [{ start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, thickness: 0.2 }],
      [],
      [],
      floor.id,
    );
    expect(editor.history.canUndo).toBe(true);

    const nextProject = createEmptyProject("Other Mall");
    const nextBuilding = createBuilding("B2");
    const nextFloor = createFloor("G", 0);
    nextBuilding.floors.push(nextFloor);
    nextProject.buildings.push(nextBuilding);

    const handler = vi.fn();
    editor.on("projectLoaded", handler);

    editor.loadProject(nextProject);

    expect(editor.project).toBe(nextProject);
    expect(editor.getActiveFloor()?.id).toBe(nextFloor.id);
    expect(editor.selection.current).toHaveLength(0);
    expect(editor.draft.hasDraft).toBe(false);
    expect(editor.history.canUndo).toBe(false);
    editor.undo(); // should be a no-op now that history was reset
    expect(editor.history.canUndo).toBe(false);
    expect(handler).toHaveBeenCalledWith(nextProject);
  });

  it("loadProject sets the active floor to null when the new project has no floors", () => {
    const { editor } = makeEditorWithFloor();
    editor.loadProject(createEmptyProject("Empty"));
    expect(editor.getActiveFloor()).toBeUndefined();
  });

  it("loadProject resets the camera to its default pan/zoom state", () => {
    const { editor } = makeEditorWithFloor();
    const defaultState = editor.camera.getState();

    editor.camera.panByScreenDelta({ x: 500, y: -300 });
    editor.camera.zoomBy(4);
    expect(editor.camera.getState()).not.toEqual(defaultState);

    editor.loadProject(createEmptyProject("Other Mall"));

    expect(editor.camera.getState()).toEqual(defaultState);
  });

  it("routes undo to the draft stack whenever a draft is pending, even after switching tools", () => {
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor); // records a command in the main history stack

    editor.draft.setDraft(
      [{ start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2 }],
      [],
      [],
      floor.id,
    );
    editor.setTool("draft-review");
    editor.handlePointerDown(click({ x: 2, y: 0 })); // grabs the wall body (midpoint)
    editor.handlePointerMove(click({ x: 3, y: 2 }));
    editor.handlePointerUp(click({ x: 3, y: 2 }));
    expect(editor.draft.canUndo).toBe(true);
    expect(editor.draft.current?.walls[0]?.start).toEqual({ x: 1, y: 2 });

    editor.setTool("select"); // switch away from draft-review while the draft is still pending
    editor.undo();

    expect(editor.draft.current?.walls[0]?.start).toEqual({ x: 0, y: 0 });
    expect(floor.spaces).toHaveLength(1); // drawSquare's Space is on the main history stack, untouched
  });

  it("falls through to main history when a freshly opened draft has nothing of its own to undo", () => {
    // Regression test: setDraft() resets the draft's own past/future to
    // empty, so right after opening a fresh draft (e.g. re-running
    // auto-vectorization) there is nothing undoable in the draft yet, even
    // though it becomes the most recently loaded/changed thing. undo() must
    // not silently no-op by unconditionally routing into the empty draft
    // stack — it must fall through to main history instead.
    const { editor, floor } = makeEditorWithFloor();
    drawSquare(editor); // records a command in the main history stack
    expect(floor.spaces).toHaveLength(1);

    editor.draft.setDraft(
      [{ start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2 }],
      [],
      [],
      floor.id,
    );
    expect(editor.draft.hasDraft).toBe(true);
    expect(editor.draft.canUndo).toBe(false); // nothing has been done to the draft yet

    editor.undo();

    expect(floor.spaces).toHaveLength(0); // the main-history edit was undone, not silently swallowed
  });
});

describe("IndoorEditor grouping", () => {
  it("groups a multi-object selection as a unit, and ungroup restores individual selection", () => {
    const { editor, floor } = makeEditorWithFloor();
    const poi = createPOI(floor.id, { x: 0, y: 0 });
    const item = createFurniture(floor.id, { x: 1, y: 1 });
    editor.executeCommand(new AddPOICommand(floor, poi));
    editor.executeCommand(new AddFurnitureCommand(floor, item));

    editor.selection.select(poi.id);
    editor.selection.add(item.id);
    editor.groupSelection("책상 세트");

    expect(floor.groups).toHaveLength(1);
    const group = floor.groups[0]!;
    expect([...group.memberIds].sort()).toEqual([item.id, poi.id].sort());
    expect(editor.selection.current).toEqual([{ id: group.id }]);

    editor.ungroupSelection();
    expect(floor.groups).toHaveLength(0);
    expect(editor.selection.current.map((e) => e.id).sort()).toEqual([item.id, poi.id].sort());
  });

  it("does not create a group from fewer than 2 selected objects", () => {
    const { editor, floor } = makeEditorWithFloor();
    const poi = createPOI(floor.id, { x: 0, y: 0 });
    editor.executeCommand(new AddPOICommand(floor, poi));

    editor.selection.select(poi.id);
    editor.groupSelection();

    expect(floor.groups).toHaveLength(0);
  });

  it("undoes group creation as a single step", () => {
    const { editor, floor } = makeEditorWithFloor();
    const poi = createPOI(floor.id, { x: 0, y: 0 });
    const item = createFurniture(floor.id, { x: 1, y: 1 });
    editor.executeCommand(new AddPOICommand(floor, poi));
    editor.executeCommand(new AddFurnitureCommand(floor, item));
    editor.selection.select(poi.id);
    editor.selection.add(item.id);
    editor.groupSelection();
    expect(floor.groups).toHaveLength(1);

    editor.undo();
    expect(floor.groups).toHaveLength(0);
  });

  it("deleting a group (via Delete on the select tool) removes the group and every member in one undo step", () => {
    const { editor, floor } = makeEditorWithFloor();
    const poi = createPOI(floor.id, { x: 0, y: 0 });
    const item = createFurniture(floor.id, { x: 1, y: 1 });
    editor.executeCommand(new AddPOICommand(floor, poi));
    editor.executeCommand(new AddFurnitureCommand(floor, item));
    editor.selection.select(poi.id);
    editor.selection.add(item.id);
    editor.groupSelection();
    const groupId = floor.groups[0]!.id;

    editor.setTool("select");
    editor.handleKeyDown({ key: "Delete", shiftKey: false, ctrlKey: false, altKey: false });

    expect(floor.groups).toHaveLength(0);
    expect(floor.pois).toHaveLength(0);
    expect(floor.furniture).toHaveLength(0);

    editor.undo();
    expect(floor.groups.map((g) => g.id)).toEqual([groupId]);
    expect(floor.pois).toHaveLength(1);
    expect(floor.furniture).toHaveLength(1);
  });

  it("clicking any member selects the whole group, and dragging moves every member together", () => {
    const { editor, floor } = makeEditorWithFloor();
    const poi = createPOI(floor.id, { x: 0, y: 0 });
    const item = createFurniture(floor.id, { x: 4, y: 0 });
    editor.executeCommand(new AddPOICommand(floor, poi));
    editor.executeCommand(new AddFurnitureCommand(floor, item));
    editor.selection.select(poi.id);
    editor.selection.add(item.id);
    editor.groupSelection();
    const groupId = floor.groups[0]!.id;

    editor.setTool("select");
    editor.selection.clear();
    editor.handlePointerDown(click({ x: 0, y: 0 })); // clicks the POI directly
    expect(editor.selection.current).toEqual([{ id: groupId }]);

    editor.handlePointerMove(click({ x: 2, y: 1 }));
    editor.handlePointerUp(click({ x: 2, y: 1 }));

    expect(poi.position).toEqual({ x: 2, y: 1 });
    expect(item.position).toEqual({ x: 6, y: 1 });

    editor.undo();
    expect(poi.position).toEqual({ x: 0, y: 0 });
    expect(item.position).toEqual({ x: 4, y: 0 });
  });
});
