import { it, expect } from "vitest";
import { createFloor, createSpace } from "@indoor/core";
import { FurnitureTool } from "./FurnitureTool.js";
import { EditorCamera } from "../camera/EditorCamera.js";
import { SnapManager } from "../snapping/SnapManager.js";
import { SelectionManager } from "../selection/SelectionManager.js";
import { HistoryManager } from "../history/HistoryManager.js";

it("places independent copies of a template with new identities and undo/redo", () => {
  const floor = createFloor("1F", 1);
  const room = createSpace(floor.id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]);
  floor.spaces.push(room);
  const history = new HistoryManager();
  const selection = new SelectionManager(() => {});
  const tool = new FurnitureTool({
    getActiveFloor: () => floor,
    camera: new EditorCamera(),
    snapping: new SnapManager(),
    selection,
    executeCommand: (command) => history.execute(command),
    requestRender: () => {},
    findNodeBuilding: () => undefined,
  });
  const template = {
    type: "sofa" as const,
    name: "Lounge",
    width: 2.4,
    depth: 1,
    height: 0.9,
    rotation: 45,
  };
  tool.setTemplate(template);
  template.width = 10;
  for (const x of [2, 8])
    tool.onPointerDown({
      worldPoint: { x, y: 2 },
      screenPoint: { x, y: 2 },
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    });
  expect(floor.furniture).toHaveLength(2);
  expect(floor.furniture[0]).toMatchObject({
    type: "sofa",
    width: 2.4,
    rotation: 45,
    spaceId: room.id,
  });
  expect(floor.furniture[1]!.spaceId).toBeUndefined();
  expect(floor.furniture[0]!.id).not.toBe(floor.furniture[1]!.id);
  const id = floor.furniture[1]!.id;
  history.undo();
  expect(floor.furniture).toHaveLength(1);
  history.redo();
  expect(floor.furniture[1]!.id).toBe(id);
  tool.setTemplate({ type: "chair" });
  expect(tool.getTemplate()).toEqual({ type: "chair" });
});
