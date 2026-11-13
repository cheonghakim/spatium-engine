import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
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

  it("bulk include/exclude via setAccepted is a no-op (no history entry) when nothing changes", () => {
    const { editor, walls } = setupDraft();
    editor.draft.setAccepted([walls[0]!.id], true);
    expect(editor.draft.canUndo).toBe(false);
    editor.draft.setAccepted([walls[0]!.id, walls[2]!.id], false);
    expect(editor.draft.current!.walls.map((w) => w.accepted)).toEqual([false, true, false]);
  });
});
