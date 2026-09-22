import { it, expect } from "vitest";
import { createFloor } from "@indoor/core";
import { NavigationTool } from "./NavigationTool.js";
import { EditorCamera } from "../camera/EditorCamera.js";
import { SnapManager } from "../snapping/SnapManager.js";
import { SelectionManager } from "../selection/SelectionManager.js";
import { HistoryManager } from "../history/HistoryManager.js";
import type { EditorPointerEvent } from "./EditorTool.js";

function down(worldPoint: { x: number; y: number }, shiftKey = false): EditorPointerEvent {
  return {
    worldPoint,
    screenPoint: worldPoint,
    button: 0,
    shiftKey,
    ctrlKey: false,
    altKey: false,
  };
}

function makeTool() {
  const floor = createFloor("1F", 1);
  const history = new HistoryManager();
  const selection = new SelectionManager(() => {});
  const tool = new NavigationTool({
    getActiveFloor: () => floor,
    camera: new EditorCamera(),
    snapping: new SnapManager(),
    selection,
    executeCommand: (command) => history.execute(command),
    requestRender: () => {},
    findNodeBuilding: () => undefined,
  });
  return { floor, tool, history };
}

it("chains nodes and edges with repeated clicks", () => {
  const { floor, tool } = makeTool();
  tool.onPointerDown(down({ x: 0, y: 0 }));
  tool.onPointerDown(down({ x: 4, y: 0 }));
  tool.onPointerDown(down({ x: 4, y: 3 }));

  expect(floor.navigation.nodes).toHaveLength(3);
  expect(floor.navigation.edges).toHaveLength(2);
  expect(tool.getPendingNodeId()).toBe(floor.navigation.nodes[2]!.id);
});

it("constrains a new node horizontally or vertically to the pending node when Shift is held", () => {
  const { floor, tool } = makeTool();
  tool.onPointerDown(down({ x: 0, y: 0 }));

  // Mostly horizontal offset from the pending node -> locks to the same y.
  tool.onPointerDown(down({ x: 5, y: 1.2 }, true));
  expect(floor.navigation.nodes[1]!.position).toEqual({ x: 5, y: 0 });

  // Mostly vertical offset from the new pending node -> locks to the same x.
  tool.onPointerDown(down({ x: 5.8, y: 6 }, true));
  expect(floor.navigation.nodes[2]!.position).toEqual({ x: 5, y: 6 });

  expect(floor.navigation.edges).toHaveLength(2);
});

it("does not constrain the very first node (no pending node to lock to)", () => {
  const { floor, tool } = makeTool();
  tool.onPointerDown(down({ x: 1.4, y: 2.6 }, true));
  expect(floor.navigation.nodes[0]!.position).toEqual({ x: 1.4, y: 2.6 });
});

it("clicking an existing node sets it pending without moving it, even with Shift held", () => {
  const { floor, tool } = makeTool();
  tool.onPointerDown(down({ x: 0, y: 0 }));
  tool.onPointerDown(down({ x: 4, y: 0 }));
  const firstId = floor.navigation.nodes[0]!.id;

  tool.onPointerDown(down({ x: 0, y: 0 }, true));
  expect(tool.getPendingNodeId()).toBe(firstId);
  expect(floor.navigation.nodes).toHaveLength(2);
});
