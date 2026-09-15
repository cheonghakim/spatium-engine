import { describe, expect, it } from "vitest";
import { detectHorizontalSegments, detectVerticalSegments, mergeParallelSegments } from "./detectLines.js";
import { gridToBinary } from "./testUtils.js";

// A simple rectangular room outline, 10 wide x 4 tall.
const RECTANGLE = gridToBinary(["##########", "#........#", "#........#", "##########"]);

describe("detectHorizontalSegments / detectVerticalSegments", () => {
  it('bridges scan damage without closing a larger door opening', () => {
    const image = gridToBinary(['##########..##########......##########']);
    expect(detectHorizontalSegments(image, 8, 2).map(s => [s.start,s.end])).toEqual([[0,21],[28,37]]);
    expect(detectHorizontalSegments(image, 8, 0)).toHaveLength(3);
  });

  it('does not extend a line into trailing whitespace', () => {
    expect(detectHorizontalSegments(gridToBinary(['##########..']), 8, 3)[0]?.end).toBe(9);
  });
  it("finds the top and bottom edges as horizontal runs", () => {
    const segments = detectHorizontalSegments(RECTANGLE, 3);
    expect(segments).toEqual([
      { orientation: "horizontal", offset: 0, start: 0, end: 9 },
      { orientation: "horizontal", offset: 3, start: 0, end: 9 },
    ]);
  });

  it("finds the left and right edges as vertical runs", () => {
    const segments = detectVerticalSegments(RECTANGLE, 3);
    expect(segments).toEqual([
      { orientation: "vertical", offset: 0, start: 0, end: 3 },
      { orientation: "vertical", offset: 9, start: 0, end: 3 },
    ]);
  });

  it("ignores runs shorter than the minimum length", () => {
    const segments = detectHorizontalSegments(RECTANGLE, 20);
    expect(segments).toEqual([]);
  });
});

describe("mergeParallelSegments", () => {
  it('merges two thick walls interleaved on the same rows independently', () => {
    const image = gridToBinary(['##########.....##########','##########.....##########','##########.....##########']);
    const result = mergeParallelSegments(detectHorizontalSegments(image, 5), 2, 'horizontal');
    expect(result).toHaveLength(2);
    expect(result.map(s => s.thicknessPx)).toEqual([3,3]);
    expect(result.map(s => [s.start,s.end])).toEqual([[0,9],[15,24]]);
  });

  it('does not fuse unrelated strokes with only a tiny overlap', () => {
    expect(mergeParallelSegments([
      {orientation:'horizontal',offset:0,start:0,end:100},
      {orientation:'horizontal',offset:1,start:99,end:200},
    ], 2, 'horizontal')).toHaveLength(2);
  });
  it("merges adjacent parallel runs into one thicker centerline", () => {
    const segments = [
      { orientation: "horizontal" as const, offset: 10, start: 0, end: 20 },
      { orientation: "horizontal" as const, offset: 11, start: 0, end: 20 },
      { orientation: "horizontal" as const, offset: 12, start: 0, end: 20 },
    ];
    const merged = mergeParallelSegments(segments, 2, "horizontal");
    expect(merged).toEqual([
      { orientation: "horizontal", offset: 11, start: 0, end: 20, thicknessPx: 3 },
    ]);
  });

  it("keeps non-overlapping or far-apart runs separate", () => {
    const segments = [
      { orientation: "horizontal" as const, offset: 0, start: 0, end: 5 },
      { orientation: "horizontal" as const, offset: 0, start: 20, end: 25 }, // no overlap
      { orientation: "horizontal" as const, offset: 50, start: 0, end: 5 }, // far offset
    ];
    const merged = mergeParallelSegments(segments, 2, "horizontal");
    expect(merged).toHaveLength(3);
  });
});
