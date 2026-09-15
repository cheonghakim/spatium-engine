import { createFloor, createPOI, createSpace } from "@indoor/core";
import { describe, expect, it } from "vitest";
import { hitTest } from "./hitTest.js";
import type { Overlay } from "./overlay.js";

describe("hitTest", () => {
  it("returns null when nothing is under the point", () => {
    const floor = createFloor("1F", 1);
    expect(hitTest({ x: 100, y: 100 }, floor, [])).toBeNull();
  });

  it("hits a space when the point is inside its polygon", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    const result = hitTest({ x: 2, y: 2 }, floor, []);
    expect(result).toEqual({ kind: "space", space });
  });

  it("prefers a POI over a space underneath it", () => {
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    const poi = createPOI(floor.id, { x: 2, y: 2 }, "store", "Coffee");
    floor.spaces.push(space);
    floor.pois.push(poi);

    const result = hitTest({ x: 2, y: 2 }, floor, []);
    expect(result).toEqual({ kind: "poi", poi });
  });

  it("prefers a marker overlay over a POI and a space", () => {
    const floor = createFloor("1F", 1);
    const poi = createPOI(floor.id, { x: 2, y: 2 }, "store", "Coffee");
    floor.pois.push(poi);
    const overlay: Overlay = { id: "m1", floorId: floor.id, type: "marker", position: { x: 2, y: 2 } };

    const result = hitTest({ x: 2, y: 2 }, floor, [overlay]);
    expect(result).toEqual({ kind: "marker", overlay });
  });

  it("ignores overlays on a different floor", () => {
    const floor = createFloor("1F", 1);
    const overlay: Overlay = { id: "m1", floorId: "other-floor", type: "marker", position: { x: 0, y: 0 } };
    expect(hitTest({ x: 0, y: 0 }, floor, [overlay])).toBeNull();
  });

  it("respects the hit radius for point features", () => {
    const floor = createFloor("1F", 1);
    const poi = createPOI(floor.id, { x: 0, y: 0 }, "store", "Coffee");
    floor.pois.push(poi);

    expect(hitTest({ x: 0.1, y: 0 }, floor, [], 0.05)).toBeNull();
    expect(hitTest({ x: 0.1, y: 0 }, floor, [], 0.5)).toEqual({ kind: "poi", poi });
  });
});
