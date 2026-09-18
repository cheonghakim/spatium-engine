import { describe, expect, it } from "vitest";
import {
  createEntrance,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSpace,
  createWall,
  type Floor,
} from "@indoor/core";
import { SelectTool } from "./SelectTool.js";
import type { ToolContext } from "./ToolContext.js";
import { EditorCamera } from "../camera/EditorCamera.js";
import { SelectionManager } from "../selection/SelectionManager.js";
import { SnapManager } from "../snapping/SnapManager.js";
import { HistoryManager } from "../history/HistoryManager.js";

/**
 * A minimal, real (not mocked-out) ToolContext: SelectTool only needs
 * genuine execute/undo semantics to prove the delete cascade actually works,
 * so this wires up the same small collaborators IndoorEditor would, plus a
 * `findNodeBuilding` that searches whatever floors the test hands it —
 * standing in for IndoorEditor's real building lookup.
 */
function createContext(activeFloor: Floor, allFloors: Floor[] = [activeFloor]) {
  const history = new HistoryManager();
  const context: ToolContext = {
    getActiveFloor: () => activeFloor,
    camera: new EditorCamera(),
    selection: new SelectionManager(() => {}),
    snapping: new SnapManager(),
    executeCommand: (command) => history.execute(command),
    requestRender: () => {},
    findNodeBuilding: (nodeId) =>
      allFloors.some((f) => f.navigation.nodes.some((n) => n.id === nodeId))
        ? allFloors
        : undefined,
  };
  return { context, history };
}

const down = (
  x: number,
  y: number,
  extra: Partial<{ shiftKey: boolean; button: number }> = {},
) => ({
  worldPoint: { x, y },
  screenPoint: { x, y },
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...extra,
});

const del = { key: "Delete", shiftKey: false, ctrlKey: false, altKey: false };

describe("SelectTool", () => {
  it("selects a space by clicking inside its polygon", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);
    const { context } = createContext(floor);
    const tool = new SelectTool(context);

    tool.onPointerDown(down(2, 2));

    expect(context.selection.current).toEqual([{ id: space.id }]);
  });

  it("clears the selection when clicking empty space without shift", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);
    const { context } = createContext(floor);
    const tool = new SelectTool(context);

    context.selection.select(space.id);
    tool.onPointerDown(down(100, 100));

    expect(context.selection.current).toHaveLength(0);
  });

  it("extends the selection with shift-click (multi-select)", () => {
    const floor = createFloor("1F", 1);
    const poiA = createPOI(floor.id, { x: 1, y: 1 });
    const poiB = createPOI(floor.id, { x: 5, y: 5 });
    floor.pois.push(poiA, poiB);
    const { context } = createContext(floor);
    const tool = new SelectTool(context);

    tool.onPointerDown(down(1, 1));
    expect(context.selection.current).toEqual([{ id: poiA.id }]);

    tool.onPointerDown(down(5, 5, { shiftKey: true }));
    expect(context.selection.current).toEqual([{ id: poiA.id }, { id: poiB.id }]);
  });

  it("does not clear an existing selection on an empty shift-click", () => {
    const floor = createFloor("1F", 1);
    const poi = createPOI(floor.id, { x: 1, y: 1 });
    floor.pois.push(poi);
    const { context } = createContext(floor);
    const tool = new SelectTool(context);

    context.selection.select(poi.id);
    tool.onPointerDown(down(100, 100, { shiftKey: true }));

    expect(context.selection.current).toEqual([{ id: poi.id }]);
  });

  describe("cascade delete", () => {
    it("deletes a selected Space and clears dangling Entrance/POI references, undoing as one step", () => {
      const floor = createFloor("1F", 1);
      const space = createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]);
      const entrance = createEntrance(floor.id, { x: 4, y: 2 }, "door");
      entrance.spaceA = space.id;
      const poi = createPOI(floor.id, { x: 2, y: 2 });
      poi.spaceId = space.id;
      floor.spaces.push(space);
      floor.entrances.push(entrance);
      floor.pois.push(poi);

      const { context, history } = createContext(floor);
      const tool = new SelectTool(context);
      context.selection.select(space.id);

      tool.onKeyDown(del);

      expect(floor.spaces).toHaveLength(0);
      expect(entrance.spaceA).toBeUndefined();
      expect(poi.spaceId).toBeUndefined();

      history.undo();
      expect(floor.spaces).toHaveLength(1);
      expect(entrance.spaceA).toBe(space.id);
      expect(poi.spaceId).toBe(space.id);
    });

    it("deletes a selected Wall and clears an Entrance's wallId without deleting the Entrance", () => {
      const floor = createFloor("1F", 1);
      const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
      const entrance = createEntrance(floor.id, { x: 2, y: 0 }, "door");
      entrance.wallId = wall.id;
      floor.walls.push(wall);
      floor.entrances.push(entrance);

      const { context, history } = createContext(floor);
      const tool = new SelectTool(context);
      context.selection.select(wall.id);

      tool.onKeyDown(del);

      expect(floor.walls).toHaveLength(0);
      expect(floor.entrances).toHaveLength(1);
      expect(entrance.wallId).toBeUndefined();

      history.undo();
      expect(floor.walls).toHaveLength(1);
      expect(entrance.wallId).toBe(wall.id);
    });

    it("deletes a same-floor NavigationNode and its referencing edges, undoing as one step", () => {
      const floor = createFloor("1F", 1);
      const nodeA = createNavigationNode(floor.id, { x: 0, y: 0 });
      const nodeB = createNavigationNode(floor.id, { x: 3, y: 0 });
      const edge = createNavigationEdge(nodeA.id, nodeB.id, 3);
      floor.navigation.nodes.push(nodeA, nodeB);
      floor.navigation.edges.push(edge);

      const { context, history } = createContext(floor);
      const tool = new SelectTool(context);
      context.selection.select(nodeA.id);

      tool.onKeyDown(del);

      expect(floor.navigation.nodes).toHaveLength(1);
      expect(floor.navigation.edges).toHaveLength(0);

      history.undo();
      expect(floor.navigation.nodes).toHaveLength(2);
      expect(floor.navigation.edges).toHaveLength(1);
      expect(floor.navigation.edges[0]?.id).toBe(edge.id);
    });

    it("F1: deletes a NavigationNode whose cross-floor edge is stored on the OTHER floor's array", () => {
      // Mirrors IndoorEditor.linkFloorNode, which can store the edge on
      // either endpoint's floor. nodeA is on floor1, nodeB on floor2, and the
      // edge is stored on floor1 (as if floor1's node were the "source").
      // Deleting nodeB (on floor2, the active floor) must still find and
      // remove that edge on floor1 — the bug only searched the active floor.
      const floor1 = createFloor("1F", 1);
      const floor2 = createFloor("2F", 2);
      const nodeA = createNavigationNode(floor1.id, { x: 0, y: 0 });
      const nodeB = createNavigationNode(floor2.id, { x: 0, y: 0 });
      const edge = createNavigationEdge(nodeA.id, nodeB.id, 10, "elevator");
      floor1.navigation.nodes.push(nodeA);
      floor1.navigation.edges.push(edge); // stored on the SOURCE (floor1), not the active floor
      floor2.navigation.nodes.push(nodeB);

      const { context, history } = createContext(floor2, [floor1, floor2]);
      const tool = new SelectTool(context);
      context.selection.select(nodeB.id);

      tool.onKeyDown(del);

      expect(floor2.navigation.nodes).toHaveLength(0);
      expect(floor1.navigation.edges).toHaveLength(0); // dangling edge on the OTHER floor is cleaned up

      history.undo();
      expect(floor2.navigation.nodes).toHaveLength(1);
      expect(floor2.navigation.nodes[0]?.id).toBe(nodeB.id);
      expect(floor1.navigation.edges).toHaveLength(1);
      expect(floor1.navigation.edges[0]).toMatchObject({
        id: edge.id,
        from: nodeA.id,
        to: nodeB.id,
      });
    });

    it("deletes a lone NavigationEdge without touching its endpoint nodes", () => {
      const floor = createFloor("1F", 1);
      const nodeA = createNavigationNode(floor.id, { x: 0, y: 0 });
      const nodeB = createNavigationNode(floor.id, { x: 3, y: 0 });
      const edge = createNavigationEdge(nodeA.id, nodeB.id, 3);
      floor.navigation.nodes.push(nodeA, nodeB);
      floor.navigation.edges.push(edge);

      const { context } = createContext(floor);
      const tool = new SelectTool(context);
      context.selection.select(edge.id);

      tool.onKeyDown(del);

      expect(floor.navigation.edges).toHaveLength(0);
      expect(floor.navigation.nodes).toHaveLength(2);
    });

    it("does nothing on Delete when there is no selection", () => {
      const floor = createFloor("1F", 1);
      const space = createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]);
      floor.spaces.push(space);
      const { context } = createContext(floor);
      const tool = new SelectTool(context);

      expect(() => tool.onKeyDown(del)).not.toThrow();
      expect(floor.spaces).toHaveLength(1);
    });

    it("deletes a selected vertex but leaves the delete key otherwise inert once the selection is cleared", () => {
      const floor = createFloor("1F", 1);
      const space = createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]);
      floor.spaces.push(space);
      const { context } = createContext(floor);
      const tool = new SelectTool(context);
      context.selection.select(space.id, 0);

      tool.onKeyDown(del);

      expect(space.polygon).toHaveLength(3);
      expect(context.selection.current).toEqual([{ id: space.id }]);
    });
  });

  it("Escape cancels an in-progress vertex drag without committing the move", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);
    const { context } = createContext(floor);
    const tool = new SelectTool(context);

    context.selection.select(space.id);
    tool.onPointerDown(down(0, 0)); // grabs the first vertex
    tool.onPointerMove(down(1, 1));
    expect(space.polygon[0]).toEqual({ x: 1, y: 1 });

    tool.onKeyDown({ key: "Escape", shiftKey: false, ctrlKey: false, altKey: false });

    expect(space.polygon[0]).toEqual({ x: 0, y: 0 });
  });
});
