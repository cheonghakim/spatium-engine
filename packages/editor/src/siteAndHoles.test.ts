import {
  buildingToSite,
  createBuilding,
  createEmptyProject,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createSpace,
  type Point,
} from "@indoor/core";
import { describe, expect, it, vi } from "vitest";
import { IndoorEditor } from "./IndoorEditor.js";
import type { EditorPointerEvent } from "./tools/EditorTool.js";

function pointer(point: Point, shiftKey = false): EditorPointerEvent {
  return {
    screenPoint: point,
    worldPoint: point,
    button: 0,
    shiftKey,
    ctrlKey: false,
    altKey: false,
  };
}
const key = (k: string) => ({ key: k, shiftKey: false, ctrlKey: false, altKey: false });

function campus() {
  const project = createEmptyProject("Campus");
  const building = createBuilding("Main");
  const floor = createFloor("1F", 1);
  floor.spaces.push(
    createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]),
  );
  const entrance = createNavigationNode(floor.id, { x: 5, y: 0 }, "entrance");
  floor.navigation.nodes.push(entrance);
  building.floors.push(floor);
  project.buildings.push(building);
  const editor = new IndoorEditor({ project });
  return { editor, project, building, floor, entrance };
}

describe("site view", () => {
  it("edits the outdoor graph through the ordinary navigation tool", () => {
    const { editor, project } = campus();
    editor.enterSiteView();
    expect(editor.isSiteView()).toBe(true);
    expect(editor.getActiveFloor()?.id).toBe(project.site!.id);

    editor.setTool("navigation");
    editor.handlePointerDown(pointer({ x: -20, y: -5 }));
    editor.handlePointerDown(pointer({ x: -10, y: -5 }));
    expect(project.site!.navigation.nodes).toHaveLength(2);
    expect(project.site!.navigation.nodes.every((n) => n.floorId === project.site!.id)).toBe(true);
    expect(project.site!.navigation.edges).toHaveLength(1);
  });

  it("links an outdoor node to an entrance in site coordinates and cleans up on delete", () => {
    const { editor, project, building, floor, entrance } = campus();
    building.placement = { origin: { x: 100, y: 0 }, bearing: 0 };
    editor.enterSiteView();
    const gate = createNavigationNode(project.site!.id, { x: 105, y: -10 }, "entrance");
    project.site!.navigation.nodes.push(gate);

    editor.linkSiteNode(gate.id, entrance.id);
    const [link] = editor.siteLinksOf(gate.id);
    expect(link?.nodeId).toBe(entrance.id);
    expect(project.site!.navigation.edges[0]!.distance).toBeCloseTo(10);
    editor.linkSiteNode(gate.id, entrance.id); // no duplicate
    expect(project.site!.navigation.edges).toHaveLength(1);

    // Deleting the building node drops the outdoor link too.
    editor.setFloor(floor.id);
    editor.selection.select(entrance.id);
    editor.deleteSelection();
    expect(project.site!.navigation.edges).toHaveLength(0);
    editor.undo();
    expect(project.site!.navigation.edges).toHaveLength(1);
  });

  it("drags a building to move it and shift-drags to rotate it, each undoable", () => {
    const { editor, building } = campus();
    editor.enterSiteView();
    editor.handlePointerDown(pointer({ x: 5, y: 5 }));
    editor.handlePointerMove(pointer({ x: 25, y: 15 }));
    editor.handlePointerUp(pointer({ x: 25, y: 15 }));
    expect(building.placement).toEqual({ origin: { x: 20, y: 10 }, bearing: 0 });
    expect(editor.siteBuildingTool.getSelectedBuildingId()).toBe(building.id);

    // Rotate a quarter turn counter-clockwise around the centroid (25, 15).
    editor.handlePointerDown(pointer({ x: 29, y: 15 }, true));
    editor.handlePointerUp(pointer({ x: 25, y: 19 }, true));
    expect(building.placement!.bearing).toBeCloseTo(270);
    // The pivot (outline centroid, local (5,5)) stays put.
    const pivot = buildingToSite(building, { x: 5, y: 5 });
    expect(pivot.x).toBeCloseTo(25);
    expect(pivot.y).toBeCloseTo(15);
    editor.undo();
    expect(building.placement).toEqual({ origin: { x: 20, y: 10 }, bearing: 0 });
    editor.undo();
    expect(building.placement).toBeUndefined();
  });

  it("keeps outdoor link lengths in step with building moves, in one undo step", () => {
    const { editor, project, building, entrance } = campus();
    editor.enterSiteView();
    const gate = createNavigationNode(project.site!.id, { x: 5, y: -100 }, "entrance");
    project.site!.navigation.nodes.push(gate);
    editor.linkSiteNode(gate.id, entrance.id);
    const edge = project.site!.navigation.edges[0]!;
    expect(edge.distance).toBeCloseTo(100);

    // Drag the building 800 m north-away from the gate (entrance local (5,0) → site (5,800)).
    editor.handlePointerDown(pointer({ x: 5, y: 5 }));
    editor.handlePointerUp(pointer({ x: 5, y: 805 }));
    expect(building.placement).toEqual({ origin: { x: 0, y: 800 }, bearing: 0 });
    expect(edge.distance).toBeCloseTo(900);

    editor.undo();
    expect(building.placement).toBeUndefined();
    expect(edge.distance).toBeCloseTo(100);
    editor.redo();
    expect(edge.distance).toBeCloseTo(900);

    // The panel API path (SiteSettings) does the same, rotation included.
    editor.setBuildingPlacement(building.id, { origin: { x: 0, y: 0 }, bearing: 180 });
    const entranceSite = buildingToSite(building, entrance.position);
    expect(edge.distance).toBeCloseTo(Math.hypot(entranceSite.x - 5, entranceSite.y + 100));
  });

  it("finds outdoor objects for focusing", () => {
    const { editor, project } = campus();
    editor.enterSiteView();
    const gate = createNavigationNode(project.site!.id, { x: -3, y: 4 });
    project.site!.navigation.nodes.push(gate);
    editor.setFloor(project.buildings[0]!.floors[0]!.id);
    editor.focusObject(gate.id);
    expect(editor.isSiteView()).toBe(true);
  });
});

describe("hole tool", () => {
  it("cuts a hole into the space under the outline and rejects invalid ones", () => {
    const { editor, floor } = campus();
    const notices = vi.fn();
    editor.on("toolNotice", notices);
    const space = floor.spaces[0]!;
    editor.setTool("hole");
    for (const p of [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ])
      editor.handlePointerDown(pointer(p));
    editor.handleKeyDown(key("Enter"));
    expect(space.holes).toHaveLength(1);

    // Overlapping the first hole → rejected.
    for (const p of [
      { x: 5, y: 5 },
      { x: 7, y: 5 },
      { x: 7, y: 7 },
    ])
      editor.handlePointerDown(pointer(p));
    editor.handleKeyDown(key("Enter"));
    expect(space.holes).toHaveLength(1);
    expect(notices).toHaveBeenLastCalledWith("hole-invalid");

    editor.removeHole(space.id, 0);
    expect(space.holes).toBeUndefined();
    editor.undo();
    expect(space.holes).toHaveLength(1);
  });
});

describe("convertFloorLinksToConnectors", () => {
  it("replaces a hand-drawn stairs link with a connector in one undo step", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B");
    const f1 = createFloor("1F", 1, 0);
    const f2 = createFloor("2F", 2, 4);
    const a = createNavigationNode(f1.id, { x: 0, y: 0 }, "stairs");
    const b = createNavigationNode(f2.id, { x: 0, y: 0 }, "stairs");
    f1.navigation.nodes.push(a);
    f2.navigation.nodes.push(b);
    f1.navigation.edges.push(createNavigationEdge(a.id, b.id, 4, "stairs"));
    building.floors.push(f1, f2);
    project.buildings.push(building);
    const editor = new IndoorEditor({ project });

    expect(editor.convertFloorLinksToConnectors(a.id)).toEqual({
      created: 1,
      skipped: 0,
      reasons: [],
    });
    expect(f1.navigation.edges).toEqual([]);
    expect(building.connectors?.[0]?.stops.map((s) => s.nodeId)).toEqual([a.id, b.id]);
    expect(building.connectors?.[0]?.type).toBe("stairs");

    editor.undo();
    expect(f1.navigation.edges).toHaveLength(1);
    expect(building.connectors).toBeUndefined();
  });
});
