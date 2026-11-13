import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createEmptyProject,
  createEntrance,
  createFloor,
  createPOI,
  createNavigationEdge,
  createNavigationNode,
  createSpace,
  createWall,
} from "@indoor/core";
import { IndoorEditor } from "../IndoorEditor.js";
import { SelectTool } from "./SelectTool.js";
import { DraftReviewTool } from "./DraftReviewTool.js";

/** Default camera: origin-centred, 50 px per metre — screenPoint mirrors that so the marquee threshold behaves like the real canvas. */
const at = (
  x: number,
  y: number,
  extra: Partial<{ shiftKey: boolean; ctrlKey: boolean }> = {},
) => ({
  worldPoint: { x, y },
  screenPoint: { x: x * 50, y: y * 50 },
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...extra,
});
const key = (k: string) => ({ key: k, shiftKey: false, ctrlKey: false, altKey: false });

function drag(editor: IndoorEditor, from: [number, number], to: [number, number], extra = {}) {
  editor.handlePointerDown(at(from[0], from[1], extra));
  editor.handlePointerMove(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  editor.handlePointerMove(at(to[0], to[1], extra));
  editor.handlePointerUp(at(to[0], to[1], extra));
}

function setupFloor() {
  const project = createEmptyProject("Multi");
  const building = createBuilding("A"),
    floor = createFloor("1F", 1);
  building.floors.push(floor);
  project.buildings.push(building);
  const editor = new IndoorEditor({ project });
  editor.setTool("select");
  return { editor, floor };
}

describe("multi-selection (Select tool)", () => {
  it("Shift/Ctrl+click toggles, and Delete removes every selected object as one undo step", () => {
    const { editor, floor } = setupFloor();
    const a = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const b = createWall(floor.id, { x: 0, y: 2 }, { x: 4, y: 2 });
    const c = createWall(floor.id, { x: 0, y: 4 }, { x: 4, y: 4 });
    floor.walls.push(a, b, c);

    editor.handlePointerDown(at(2, 0));
    editor.handlePointerUp(at(2, 0));
    editor.handlePointerDown(at(2, 2, { shiftKey: true }));
    editor.handlePointerUp(at(2, 2));
    editor.handlePointerDown(at(2, 4, { ctrlKey: true }));
    editor.handlePointerUp(at(2, 4));
    editor.handlePointerDown(at(2, 4, { ctrlKey: true })); // toggles c back out
    editor.handlePointerUp(at(2, 4));
    expect(editor.selection.current.map((e) => e.id)).toEqual([a.id, b.id]);

    editor.handleKeyDown(key("Delete"));
    expect(floor.walls.map((w) => w.id)).toEqual([c.id]);
    expect(editor.selection.current).toHaveLength(0);

    editor.undo();
    expect(floor.walls.map((w) => w.id)).toEqual([a.id, b.id, c.id]);
    editor.redo();
    expect(floor.walls.map((w) => w.id)).toEqual([c.id]);
  });

  it("deletes a node together with its own edge without double-deleting (lazy batch)", () => {
    const { editor, floor } = setupFloor();
    const n1 = createNavigationNode(floor.id, { x: 0, y: 0 });
    const n2 = createNavigationNode(floor.id, { x: 5, y: 0 });
    floor.navigation.nodes.push(n1, n2);
    const edge = createNavigationEdge(n1.id, n2.id, 5);
    floor.navigation.edges.push(edge);

    editor.selection.setAll([{ id: n1.id }, { id: edge.id }, { id: n2.id }]);
    editor.deleteSelection();
    expect(floor.navigation.nodes).toHaveLength(0);
    expect(floor.navigation.edges).toHaveLength(0);

    editor.undo();
    expect(floor.navigation.nodes.map((n) => n.id)).toEqual([n1.id, n2.id]);
    expect(floor.navigation.edges.map((e) => e.id)).toEqual([edge.id]);
  });

  it("box-selects: left→right picks only fully enclosed objects, right→left anything touched", () => {
    const { editor, floor } = setupFloor();
    const room = createSpace(floor.id, [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ]);
    floor.spaces.push(room);
    const inside = createWall(floor.id, { x: 0, y: 0 }, { x: 2, y: 0 });
    const straddling = createWall(floor.id, { x: 2, y: 2 }, { x: 6, y: 2 });
    floor.walls.push(inside, straddling);

    // Press inside the room (rooms have no body-drag) → becomes a box.
    drag(editor, [-1, -1], [3, 3]);
    expect(editor.selection.current.map((e) => e.id)).toEqual([inside.id]);
    expect((editor.tools.active as SelectTool).getMarquee()).toBeNull();

    drag(editor, [3, 3], [-1, -1]);
    // Crossing doesn't grab the room that merely encloses the box.
    expect(editor.selection.current.map((e) => e.id)).toEqual([inside.id, straddling.id]);

    // A plain click inside the room (no travel) still just selects the room.
    editor.handlePointerDown(at(-5, -5));
    editor.handlePointerUp(at(-5, -5));
    expect(editor.selection.current.map((e) => e.id)).toEqual([room.id]);

    // Shift+box adds to the existing selection.
    drag(editor, [-1, -1], [3, 1], { shiftKey: true });
    expect(editor.selection.current.map((e) => e.id)).toEqual([room.id, inside.id]);
  });
});

describe("moving objects (Select tool)", () => {
  const square = (floorId: string, x: number, y: number, size: number) =>
    createSpace(floorId, [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ]);

  it("drags a whole multi-selection — walls, a room, a POI — as one undo step", () => {
    const { editor, floor } = setupFloor();
    const room = square(floor.id, 0, 0, 4);
    floor.spaces.push(room);
    const wall = createWall(floor.id, { x: 10, y: 0 }, { x: 14, y: 0 });
    floor.walls.push(wall);
    const poi = createPOI(floor.id, { x: 12, y: 3 });
    floor.pois.push(poi);
    editor.selection.setAll([{ id: room.id }, { id: wall.id }, { id: poi.id }]);

    // Grab the wall (already selected) and drag: everything selected moves.
    drag(editor, [12, 0], [13, 2]);
    expect(editor.selection.current).toHaveLength(3);
    expect(wall.start).toEqual({ x: 11, y: 2 });
    expect(room.polygon[0]).toEqual({ x: 1, y: 2 });
    expect(poi.position).toEqual({ x: 13, y: 5 });

    editor.undo();
    expect(wall.start).toEqual({ x: 10, y: 0 });
    expect(room.polygon[0]).toEqual({ x: 0, y: 0 });
    expect(poi.position).toEqual({ x: 12, y: 3 });
  });

  it("moves a room once it is selected; an unselected room starts a box instead", () => {
    const { editor, floor } = setupFloor();
    const room = square(floor.id, 0, 0, 4);
    floor.spaces.push(room);

    drag(editor, [1, 1], [3, 3]); // not selected yet → box, room stays put
    expect(room.polygon[0]).toEqual({ x: 0, y: 0 });

    editor.handlePointerDown(at(2, 2));
    editor.handlePointerUp(at(2, 2)); // click selects it
    drag(editor, [2, 2], [5, 2]);
    expect(room.polygon[0]).toEqual({ x: 3, y: 0 });
  });

  it("a click (no drag) never nudges, and narrows a multi-selection to the clicked object", () => {
    const { editor, floor } = setupFloor();
    const a = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const b = createWall(floor.id, { x: 0, y: 2 }, { x: 4, y: 2 });
    floor.walls.push(a, b);
    editor.selection.setAll([{ id: a.id }, { id: b.id }]);
    editor.handlePointerDown(at(2, 0));
    editor.handlePointerMove(at(2.02, 0)); // 1 px of jitter
    editor.handlePointerUp(at(2.02, 0));
    expect(a.start).toEqual({ x: 0, y: 0 });
    expect(editor.selection.current.map((e) => e.id)).toEqual([a.id]);
    expect(editor.history.canUndo).toBe(false);
  });

  it("carries the doors hosted on a moved wall", () => {
    const { editor, floor } = setupFloor();
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    floor.walls.push(wall);
    const door = createEntrance(floor.id, { x: 2, y: 0 }, "door");
    door.wallId = wall.id;
    floor.entrances.push(door);
    drag(editor, [1, 0], [1, 1]);
    expect(wall.start).toEqual({ x: 0, y: 1 });
    expect(door.position).toEqual({ x: 2, y: 1 });
  });

  it("Shift+drag starting on an object adds a box; Shift+click toggles", () => {
    const { editor, floor } = setupFloor();
    const a = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const b = createWall(floor.id, { x: 0, y: 2 }, { x: 4, y: 2 });
    floor.walls.push(a, b);
    // Press on wall a's end, drag a window box around both walls.
    drag(editor, [0, 0], [5, 3], { shiftKey: true });
    expect(a.start).toEqual({ x: 0, y: 0 }); // nothing moved
    expect(editor.selection.current.map((e) => e.id)).toEqual([a.id, b.id]);
    editor.handlePointerDown(at(2, 0, { shiftKey: true }));
    editor.handlePointerUp(at(2, 0, { shiftKey: true }));
    expect(editor.selection.current.map((e) => e.id)).toEqual([b.id]);
  });

  it("arrow keys nudge the selection, Ctrl+A selects all, Escape twice clears", () => {
    const { editor, floor } = setupFloor();
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    const poi = createPOI(floor.id, { x: 1, y: 1 });
    floor.walls.push(wall);
    floor.pois.push(poi);
    editor.handleKeyDown({ key: "a", shiftKey: false, ctrlKey: true, altKey: false });
    expect(editor.selection.current).toHaveLength(2);
    editor.handleKeyDown(key("ArrowRight"));
    editor.handleKeyDown({ key: "ArrowDown", shiftKey: true, ctrlKey: false, altKey: false });
    expect(wall.start.x).toBeCloseTo(0.1);
    expect(wall.start.y).toBeCloseTo(1);
    expect(poi.position.x).toBeCloseTo(1.1);
    editor.undo();
    expect(wall.start.y).toBeCloseTo(0);
    editor.handleKeyDown(key("Escape"));
    expect(editor.selection.current).toHaveLength(0);
  });
});

describe("multi-selection (vectorization draft review)", () => {
  function setupDraft() {
    const { editor, floor } = setupFloor();
    editor.draft.setDraft(
      [
        { start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2 },
        { start: { x: 0, y: 2 }, end: { x: 4, y: 2 }, thickness: 0.2 },
        { start: { x: 0, y: 4 }, end: { x: 4, y: 4 }, thickness: 0.2 },
      ],
      [],
      [],
      floor.id,
    );
    editor.setTool("draft-review");
    return { editor, walls: editor.draft.current!.walls };
  }

  it("Shift+click selects several walls and Delete excludes all of them in one undo step", () => {
    const { editor, walls } = setupDraft();
    editor.handlePointerDown(at(2, 0));
    editor.handlePointerUp(at(2, 0));
    editor.handlePointerDown(at(2, 2, { shiftKey: true }));
    editor.handlePointerUp(at(2, 2));
    expect(editor.draft.selectedIds).toEqual([walls[0]!.id, walls[1]!.id]);
    expect(editor.draft.selectedId).toBeNull();

    editor.handleKeyDown(key("Delete"));
    expect(editor.draft.current!.walls.map((w) => w.accepted)).toEqual([false, false, true]);
    editor.undo();
    expect(editor.draft.current!.walls.map((w) => w.accepted)).toEqual([true, true, true]);
  });

  it("box-selects draft walls from empty canvas; Escape clears the selection", () => {
    const { editor, walls } = setupDraft();
    drag(editor, [-1, -1], [5, 3]);
    expect(editor.draft.selectedIds).toEqual([walls[0]!.id, walls[1]!.id]);
    expect((editor.tools.active as DraftReviewTool).getMarquee()).toBeNull();

    drag(editor, [3, 3.5], [1, 1.5]); // crossing: touches only the middle wall
    expect(editor.draft.selectedIds).toEqual([walls[1]!.id]);

    editor.handleKeyDown(key("Escape"));
    expect(editor.draft.selectedIds).toEqual([]);
  });

  it("drags a multi-selection of draft walls together; joined walls stretch", () => {
    const { editor, walls } = setupDraft();
    // A vertical wall joining the top and middle walls at x=4.
    editor.draft.setDraft(
      [
        ...walls.map((w) => ({ start: w.start, end: w.end, thickness: w.thickness })),
        { start: { x: 4, y: 0 }, end: { x: 4, y: 2 }, thickness: 0.2 },
      ],
      [],
      [],
      editor.getActiveFloor()!.id,
    );
    const [top, middle, bottom, joint] = editor.draft.current!.walls;
    editor.draft.setSelection([top!.id, middle!.id]);
    drag(editor, [2, 0], [2, 1]);
    const after = editor.draft.current!.walls;
    expect(after[0]!.start).toEqual({ x: 0, y: 1 });
    expect(after[1]!.start).toEqual({ x: 0, y: 3 });
    expect(after[2]!.start).toEqual(bottom!.start); // not selected
    // The joining wall's ends followed both moved walls.
    expect(after[3]!.start).toEqual({ x: 4, y: 1 });
    expect(after[3]!.end).toEqual({ x: 4, y: 3 });
    expect(joint).toBeDefined();
    editor.undo();
    expect(editor.draft.current!.walls[0]!.start).toEqual({ x: 0, y: 0 });
  });

  it("Ctrl+A selects every draft entry and arrows nudge them", () => {
    const { editor } = setupDraft();
    editor.handleKeyDown({ key: "a", shiftKey: false, ctrlKey: true, altKey: false });
    expect(editor.draft.selectedIds).toHaveLength(3);
    editor.handleKeyDown(key("ArrowUp"));
    expect(editor.draft.current!.walls[0]!.start.y).toBeCloseTo(-0.1);
    editor.undo();
    expect(editor.draft.current!.walls[0]!.start.y).toBeCloseTo(0);
  });

  it("bulk include/exclude via setAccepted is a no-op (no history entry) when nothing changes", () => {
    const { editor, walls } = setupDraft();
    editor.draft.setAccepted([walls[0]!.id], true);
    expect(editor.draft.canUndo).toBe(false);
    editor.draft.setAccepted([walls[0]!.id, walls[2]!.id], false);
    expect(editor.draft.current!.walls.map((w) => w.accepted)).toEqual([false, true, false]);
  });
});
