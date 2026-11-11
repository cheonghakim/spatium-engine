import {
  createBuilding,
  createGroup,
  createEmptyProject,
  createFloor,
  createNavigationNode,
  createSpace,
} from "@indoor/core";
import { describe, expect, it } from "vitest";
import { IndoorEditor } from "./IndoorEditor.js";

function tower() {
  const project = createEmptyProject("Tower");
  const building = createBuilding("T");
  const f1 = createFloor("1F", 1, 0);
  const f2 = createFloor("2F", 2, 4);
  const shaft = createSpace(
    f1.id,
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    "elevator",
  );
  f1.spaces.push(shaft);
  const a = createNavigationNode(f1.id, { x: 1, y: 1 }, "elevator");
  const b = createNavigationNode(f2.id, { x: 1, y: 1 }, "elevator");
  const b2 = createNavigationNode(f2.id, { x: 5, y: 5 }, "elevator");
  f1.navigation.nodes.push(a);
  f2.navigation.nodes.push(b, b2);
  building.floors.push(f1, f2);
  project.buildings.push(building);
  const editor = new IndoorEditor({ project });
  return { editor, building, f1, f2, shaft, a, b, b2 };
}

describe("IndoorEditor connectors", () => {
  it("creates a connector at a node, recording the shaft space, and undoes it", () => {
    const { editor, building, f1, shaft, a } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator", "E1")!;
    expect(building.connectors).toEqual([lift]);
    expect(lift.stops).toEqual([{ floorId: f1.id, nodeId: a.id, spaceId: shaft.id }]);
    expect(lift.accessible).toBe(true);
    expect(editor.connectorsAtNode(a.id).map((c) => c.connector.id)).toEqual([lift.id]);

    editor.undo();
    expect(building.connectors).toBeUndefined();
  });

  it("adds one stop per floor, replacing an existing stop on that floor", () => {
    const { editor, f2, a, b, b2 } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator")!;
    editor.addConnectorStop(lift.id, b.id);
    expect(lift.stops.map((s) => s.nodeId)).toEqual([a.id, b.id]);
    editor.addConnectorStop(lift.id, b2.id);
    expect(lift.stops.map((s) => s.nodeId)).toEqual([a.id, b2.id]);
    expect(lift.stops[1]!.floorId).toBe(f2.id);

    editor.undo();
    expect(lift.stops.map((s) => s.nodeId)).toEqual([a.id, b.id]);
    editor.removeConnectorStop(lift.id, b.id);
    expect(lift.stops.map((s) => s.nodeId)).toEqual([a.id]);
  });

  it("edits fields and deletes with undo", () => {
    const { editor, building, a } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator")!;
    editor.updateConnector(lift.id, "spec", { speed: 2.5, averageWait: 20 });
    expect(lift.spec).toEqual({ speed: 2.5, averageWait: 20 });
    editor.deleteConnector(lift.id);
    expect(building.connectors).toEqual([]);
    editor.undo();
    expect(building.connectors).toEqual([lift]);
  });

  it("deleting a node drops its stops; deleting a space clears spaceId; undo restores", () => {
    const { editor, f1, f2, shaft, a, b } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator")!;
    editor.addConnectorStop(lift.id, b.id);

    editor.setFloor(f2.id);
    editor.selection.select(b.id);
    editor.deleteSelection();
    expect(lift.stops.map((s) => s.nodeId)).toEqual([a.id]);
    editor.undo();
    expect(lift.stops.map((s) => s.nodeId)).toEqual([a.id, b.id]);

    editor.setFloor(f1.id);
    editor.selection.select(shaft.id);
    editor.deleteSelection();
    expect(lift.stops[0]).toEqual({ floorId: f1.id, nodeId: a.id });
    editor.undo();
    expect(lift.stops[0]!.spaceId).toBe(shaft.id);
  });

  it("deleting a group holding a stop's node and its shaft space drops the stop", () => {
    const { editor, f1, shaft, a, b } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator")!;
    editor.addConnectorStop(lift.id, b.id);
    expect(lift.stops[0]).toEqual({ floorId: f1.id, nodeId: a.id, spaceId: shaft.id });

    const group = createGroup(f1.id, "Core", [a.id, shaft.id]);
    f1.groups.push(group);
    editor.setFloor(f1.id);
    editor.selection.select(group.id);
    editor.deleteSelection();
    // Both the node and the space are gone, so the stop must be gone too —
    // not resurrected by the space cleanup computed from the old stops.
    expect(lift.stops.map((s) => s.nodeId)).toEqual([b.id]);

    editor.undo();
    expect(lift.stops[0]).toEqual({ floorId: f1.id, nodeId: a.id, spaceId: shaft.id });
    editor.redo();
    expect(lift.stops.map((s) => s.nodeId)).toEqual([b.id]);
  });

  it("focusing a connector (e.g. from a validation issue) selects one of its stop nodes", () => {
    const { editor, f2, a, b } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator")!;
    editor.addConnectorStop(lift.id, b.id);
    // The first stop's node disappears outside the editor (stale data).
    editor.project.buildings[0]!.floors[0]!.navigation.nodes.length = 0;
    editor.focusObject(lift.id);
    expect(editor.getActiveFloor()?.id).toBe(f2.id);
    expect(editor.selection.current[0]?.id).toBe(b.id);
  });

  it("clearing a floor drops every stop on it", () => {
    const { editor, f1, a, b } = tower();
    const lift = editor.createConnectorAtNode(a.id, "elevator")!;
    editor.addConnectorStop(lift.id, b.id);
    editor.clearFloor(f1.id);
    expect(lift.stops.map((s) => s.nodeId)).toEqual([b.id]);
    editor.undo();
    expect(lift.stops).toHaveLength(2);
  });
});
