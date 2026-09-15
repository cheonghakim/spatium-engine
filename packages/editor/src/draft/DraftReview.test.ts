import { describe, expect, it } from 'vitest';
import { createBuilding, createEmptyProject, createFloor } from '@indoor/core';
import { IndoorEditor } from '../IndoorEditor.js';

const pointer = (x:number,y:number, extra = {}) => ({ worldPoint:{x,y},screenPoint:{x,y},button:0,shiftKey:false,ctrlKey:false,altKey:false,...extra });
function setup() {
  const project = createEmptyProject('Review');
  const building = createBuilding('A'), floor = createFloor('1F',1);
  building.floors.push(floor); project.buildings.push(building);
  const editor = new IndoorEditor({project});
  editor.draft.setDraft([
    {start:{x:0,y:0},end:{x:4,y:0},thickness:0.2},
    {start:{x:4,y:0},end:{x:4,y:4},thickness:0.2},
  ],[{polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]}],[],floor.id);
  editor.setTool('draft-review');
  return { editor, floor, building };
}
describe('vectorization review workflow', () => {
  it('previews accepted draft geometry without confirming or changing history', () => {
    const {editor,floor} = setup();
    editor.draft.toggleWall(editor.draft.current!.walls[1]!.id);
    const preview = editor.getPreviewProject().buildings[0]!.floors[0]!;
    expect(preview.walls).toHaveLength(1);
    expect(preview.spaces).toHaveLength(1);
    expect(floor.walls).toHaveLength(0);
    expect(floor.spaces).toHaveLength(0);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.draft.hasDraft).toBe(true);
    preview.walls[0]!.start.x = 99;
    expect(editor.draft.current!.walls[0]!.start.x).toBe(0);
  });
  it('keeps a draft on its original floor in the preview', () => {
    const {editor,building} = setup();
    const second = createFloor('2F',2); building.floors.push(second); editor.setFloor(second.id);
    const preview = editor.getPreviewProject().buildings[0]!;
    expect(preview.floors[0]!.walls).toHaveLength(2);
    expect(preview.floors[1]!.walls).toHaveLength(0);
  });
  it('prefers the selected wall handle at a shared corner', () => {
    const {editor,floor} = setup();
    editor.draft.select(editor.draft.current!.walls[1]!.id);
    editor.handlePointerDown(pointer(4,0)); editor.handlePointerMove(pointer(5,0)); editor.handlePointerUp(pointer(5,0));
    expect(editor.draft.current?.walls[1]?.start).toEqual({x:5,y:0});
    expect(editor.draft.current?.walls[0]?.end).toEqual({x:4,y:0});
    editor.undo(); editor.confirmDraft();
    editor.selection.select(floor.walls[1]!.id);
    editor.handlePointerDown(pointer(4,0)); editor.handlePointerMove(pointer(5,0,{altKey:true})); editor.handlePointerUp(pointer(5,0));
    expect(floor.walls[1]?.start).toEqual({x:5,y:0});
    expect(floor.walls[0]?.end).toEqual({x:4,y:0});
  });
  it('edits a draft room vertex and restores it with undo', () => {
    const {editor} = setup();
    editor.draft.select(editor.draft.current!.spaces[0]!.id);
    editor.handlePointerDown(pointer(0,0)); editor.handlePointerMove(pointer(-1,0)); editor.handlePointerUp(pointer(-1,0));
    expect(editor.draft.current?.spaces[0]?.polygon[0]).toEqual({x:-1,y:0});
    editor.undo(); expect(editor.draft.current?.spaces[0]?.polygon[0]).toEqual({x:0,y:0});
  });
  it('snaps an endpoint to nearby draft geometry, with Alt to bypass', () => {
    const {editor} = setup();
    editor.handlePointerDown(pointer(0,0)); editor.handlePointerMove(pointer(4.1,3.9)); editor.handlePointerUp(pointer(4.1,3.9));
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:4,y:4});
    editor.undo();
    editor.handlePointerDown(pointer(0,0)); editor.handlePointerMove(pointer(4.1,3.9,{altKey:true})); editor.handlePointerUp(pointer(4.1,3.9));
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:4.1,y:3.9});
  });
  it('moves a draft endpoint, excludes stale rooms, and supports undo/redo', () => {
    const {editor} = setup();
    editor.handlePointerDown(pointer(0,0));
    editor.handlePointerMove(pointer(1,0));
    editor.handlePointerUp(pointer(1,0));
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:1,y:0});
    expect(editor.draft.current?.spaces[0]?.accepted).toBe(false);
    editor.undo();
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:0,y:0});
    expect(editor.draft.current?.spaces[0]?.accepted).toBe(true);
    editor.redo();
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:1,y:0});
  });
  it('moves an entire draft wall without changing its length', () => {
    const {editor} = setup();
    editor.handlePointerDown(pointer(2,0)); editor.handlePointerMove(pointer(3,2)); editor.handlePointerUp(pointer(3,2));
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:1,y:2});
    expect(editor.draft.current?.walls[0]?.end).toEqual({x:5,y:2});
  });
  it('cancels a drag on Escape without adding undo history', () => {
    const {editor} = setup();
    editor.handlePointerDown(pointer(0,0)); editor.handlePointerMove(pointer(1,1));
    editor.handleKeyDown({key:'Escape',shiftKey:false,ctrlKey:false,altKey:false});
    editor.handlePointerUp(pointer(1,1));
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:0,y:0});
    expect(editor.draft.canUndo).toBe(false);
  });
  it('excludes by clicking the canvas and pressing Delete, and restores via undo', () => {
    const {editor} = setup();
    editor.handlePointerDown(pointer(2,0)); editor.handlePointerUp(pointer(2,0));
    editor.handleKeyDown({key:'Delete',shiftKey:false,ctrlKey:false,altKey:false});
    expect(editor.draft.current?.walls[0]?.accepted).toBe(false);
    editor.undo(); expect(editor.draft.current?.walls[0]?.accepted).toBe(true);
  });
  it('confirms the whole result as one undoable operation', () => {
    const {editor,floor} = setup();
    editor.confirmDraft();
    expect(floor.walls).toHaveLength(2); expect(floor.spaces).toHaveLength(1);
    expect(editor.tools.active?.id).toBe('select');
    editor.undo(); expect(floor.walls).toHaveLength(0); expect(floor.spaces).toHaveLength(0);
    editor.redo(); expect(floor.walls).toHaveLength(2); expect(floor.spaces).toHaveLength(1);
  });
  it('prevents draft editing and confirmation on another floor', () => {
    const {editor,building,floor} = setup();
    const second = createFloor('2F',2); building.floors.push(second); editor.setFloor(second.id);
    editor.handlePointerDown(pointer(0,0)); editor.handlePointerMove(pointer(1,1)); editor.handlePointerUp(pointer(1,1)); editor.confirmDraft();
    expect(second.walls).toHaveLength(0); expect(floor.walls).toHaveLength(0);
    expect(editor.draft.current?.walls[0]?.start).toEqual({x:0,y:0});
  });
  it('allows confirmed walls to be dragged and undone', () => {
    const {editor,floor} = setup(); editor.confirmDraft();
    editor.handlePointerDown(pointer(2,0)); editor.handlePointerMove(pointer(2,1)); editor.handlePointerUp(pointer(2,1));
    expect(floor.walls[0]?.start).toEqual({x:0,y:1});
    editor.undo(); expect(floor.walls[0]?.start).toEqual({x:0,y:0});
  });
});
