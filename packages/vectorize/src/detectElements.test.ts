import { describe, expect, it } from "vitest";
import { detectElements } from "./detectElements.js";
import type { DraftWall } from "./vectorizeFloorPlan.js";

const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 0.2): DraftWall => ({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness });
describe("building element candidates", () => {
  it("proposes an unclassified gap instead of claiming to recognize a door", () => {
    const candidates = detectElements([wall(0, 0, 2, 0), wall(3, 0, 6, 0)]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: "opening", width: 1, position: { x: 2.5, y: 0 } });
    expect(candidates[0]?.supportWall).toMatchObject({ start: { x: 2, y: 0 }, end: { x: 3, y: 0 } });
  });
  it("does not bridge another wall, junction, tiny scan defect or a large gap", () => {
    expect(detectElements([wall(0,0,2,0),wall(3,0,6,0),wall(2.5,0,2.5,3)])).toEqual([]);
    expect(detectElements([wall(0,0,2,0),wall(2.1,0,6,0)])).toEqual([]);
    expect(detectElements([wall(0,0,2,0),wall(5,0,6,0)])).toEqual([]);
  });
  it("groups regularly spaced treads and identifies exactly the replaced wall strokes", () => {
    const strokes = Array.from({length: 8}, (_,i) => wall(0,i*0.28,1.2,i*0.28,0.04));
    const candidates = detectElements(strokes);
    const stairs = candidates.filter(c => c.type === "stairs");
    expect(stairs).toHaveLength(1);
    expect(stairs[0]).toMatchObject({ width: 1.2, stepCount: 8, rotation: 90, replacesWallIndices: [0,1,2,3,4,5,6,7] });
    expect(stairs[0]?.depth).toBeCloseTo(2.24);
    expect(stairs[0]?.height).toBeUndefined();
  });
  it("does not classify a few furniture lines as stairs", () => {
    expect(detectElements([wall(0,0,1,0,0.04),wall(0,0.3,1,0.3,0.04),wall(0,0.6,1,0.6,0.04)])).toEqual([]);
  });
});
