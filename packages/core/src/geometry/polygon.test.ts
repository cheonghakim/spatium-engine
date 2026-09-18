import { describe, expect, it } from "vitest";
import {
  isPointInPolygon,
  isPolygonSelfIntersecting,
  nearestPointOnPolygon,
  polygonArea,
  polygonCentroid,
  polygonsOverlap,
  trianglesOverlap,
  triangulate,
  type Triangle,
} from "./polygon.js";

/** Sum of the (positive, unsigned) areas of a triangulation — used to check
 * that triangulate() partitions a polygon's full area with no gaps or
 * double-counted overlaps between triangles. */
function triangulatedArea(triangles: Triangle[]): number {
  return triangles.reduce((sum, [a, b, c]) => {
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    return sum + area;
  }, 0);
}

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

const bowtie = [
  { x: 0, y: 0 },
  { x: 4, y: 4 },
  { x: 4, y: 0 },
  { x: 0, y: 4 },
];

describe("polygonArea", () => {
  it("computes the area of a simple square", () => {
    expect(Math.abs(polygonArea(square))).toBe(16);
  });

  it("returns 0 for degenerate polygons", () => {
    expect(polygonArea([{ x: 0, y: 0 }])).toBe(0);
  });
});

describe("polygonCentroid", () => {
  it("computes the centroid of a square", () => {
    const centroid = polygonCentroid(square);
    expect(centroid.x).toBeCloseTo(2);
    expect(centroid.y).toBeCloseTo(2);
  });
});

describe("isPointInPolygon", () => {
  it("detects a point inside a square", () => {
    expect(isPointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
  });

  it("detects a point outside a square", () => {
    expect(isPointInPolygon({ x: 10, y: 10 }, square)).toBe(false);
  });
});

describe("isPolygonSelfIntersecting", () => {
  it("returns false for a simple square", () => {
    expect(isPolygonSelfIntersecting(square)).toBe(false);
  });

  it("returns true for a bowtie polygon", () => {
    expect(isPolygonSelfIntersecting(bowtie)).toBe(true);
  });
});

describe("nearestPointOnPolygon", () => {
  it("finds the nearest boundary point for a point outside the polygon", () => {
    const result = nearestPointOnPolygon({ x: 2, y: -3 }, square);
    expect(result.point).toEqual({ x: 2, y: 0 });
    expect(result.distance).toBeCloseTo(3);
  });

  it("returns zero distance for a point already on the boundary", () => {
    const result = nearestPointOnPolygon({ x: 4, y: 2 }, square);
    expect(result.distance).toBeCloseTo(0);
    expect(result.point).toEqual({ x: 4, y: 2 });
  });

  it("finds the nearest edge for a point inside the polygon", () => {
    const result = nearestPointOnPolygon({ x: 1, y: 2 }, square);
    expect(result.point).toEqual({ x: 0, y: 2 });
    expect(result.distance).toBeCloseTo(1);
  });

  it("handles a degenerate (single-point) polygon without throwing", () => {
    const result = nearestPointOnPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }]);
    expect(result.distance).toBeCloseTo(Math.sqrt(50));
  });
});

describe("polygonsOverlap", () => {
  it("does not flag two adjacent unit-square rooms sharing only a wall edge", () => {
    const roomA = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const roomB = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(polygonsOverlap(roomA, roomB)).toBe(false);
    expect(polygonsOverlap(roomB, roomA)).toBe(false);
  });

  it("does not flag two squares that only touch at a shared corner", () => {
    const roomA = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const roomB = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    expect(polygonsOverlap(roomA, roomB)).toBe(false);
  });

  it("flags two clearly overlapping rectangles", () => {
    const rectA = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const rectB = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    expect(polygonsOverlap(rectA, rectB)).toBe(true);
    expect(polygonsOverlap(rectB, rectA)).toBe(true);
  });

  it("flags a polygon fully containing another", () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const inner = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ];
    expect(polygonsOverlap(outer, inner)).toBe(true);
    expect(polygonsOverlap(inner, outer)).toBe(true);
  });

  it("returns false for polygons whose bounding boxes don't intersect", () => {
    const roomA = square;
    const roomFarAway = [
      { x: 100, y: 100 },
      { x: 104, y: 100 },
      { x: 104, y: 104 },
      { x: 100, y: 104 },
    ];
    expect(polygonsOverlap(roomA, roomFarAway)).toBe(false);
  });

  it("returns false for degenerate polygons with fewer than 3 vertices", () => {
    expect(polygonsOverlap([{ x: 0, y: 0 }], square)).toBe(false);
  });

  it("flags two rectangles that cross like a plus-sign, with no vertex of either inside the other", () => {
    // Horizontal bar and vertical bar crossing in the middle: all four
    // intersection points are mid-edge, not at any vertex, so this can only
    // be caught by the proper-edge-crossing check.
    const horizontalBar = [
      { x: 0, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ];
    const verticalBar = [
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 6 },
      { x: 2, y: 6 },
    ];
    expect(polygonsOverlap(horizontalBar, verticalBar)).toBe(true);
    expect(polygonsOverlap(verticalBar, horizontalBar)).toBe(true);
  });

  // U-shaped polygon, open at the top: a thin bottom bar (x:0-6, y:0-1) plus
  // two tall legs (x:0-2 and x:4-6, y:0-10) rising from it. Its concave
  // notch is x:2-4, y:1-10. Because the legs are much heavier than the bar,
  // the polygon's own centroid is pulled up into that notch (outside the
  // polygon's actual area) - the exact condition that made the old
  // centroid-based heuristic wrong.
  const uShape = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 10 },
    { x: 4, y: 10 },
    { x: 4, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 10 },
    { x: 0, y: 10 },
  ];

  it("sanity-checks that the U-shape's own centroid falls in its notch (outside its area)", () => {
    // This is what makes the U-shape a valid repro for the centroid bug:
    // the centroid must NOT be inside the polygon itself.
    const centroid = polygonCentroid(uShape);
    expect(centroid.x).toBeCloseTo(3);
    expect(isPointInPolygon(centroid, uShape)).toBe(false);
  });

  it("does not flag a small rectangle sitting in a U-shaped polygon's concave notch (regression: centroid-in-notch false positive)", () => {
    // Placed squarely around the U-shape's own centroid, deep inside the
    // notch and away from every edge - genuinely disjoint from the U's
    // occupied area.
    const rectInNotch = [
      { x: 2.5, y: 4.5 },
      { x: 3.5, y: 4.5 },
      { x: 3.5, y: 5.5 },
      { x: 2.5, y: 5.5 },
    ];
    expect(polygonsOverlap(uShape, rectInNotch)).toBe(false);
    expect(polygonsOverlap(rectInNotch, uShape)).toBe(false);
  });

  it("flags two concave (L-shaped) polygons that genuinely overlap", () => {
    // L-shape A: bottom bar (x:0-4, y:0-2) plus a left arm (x:0-2, y:2-4);
    // its notch (empty area) is x:2-4, y:2-4.
    const lShapeA = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    // L-shape B: a left bar (x:1-3, y:1-5) plus a bottom-right arm
    // (x:3-5, y:1-3); its notch is x:3-5, y:3-5. B's vertex (1,1) lands
    // squarely inside A's solid bottom bar.
    const lShapeB = [
      { x: 1, y: 1 },
      { x: 1, y: 5 },
      { x: 3, y: 5 },
      { x: 3, y: 3 },
      { x: 5, y: 3 },
      { x: 5, y: 1 },
    ];
    expect(polygonsOverlap(lShapeA, lShapeB)).toBe(true);
    expect(polygonsOverlap(lShapeB, lShapeA)).toBe(true);
  });

  // Regression coverage for a second round of bugs found in the
  // vertex+edge-crossing-only heuristic that replaced the original
  // centroid-containment approach (see the U-notch test above for that
  // original bug). Both of the following were previously missed because
  // pure boundary/vertex/edge sampling can't distinguish "boundaries
  // coincide because the shapes are identical/axis-aligned" from
  // "boundaries coincide but interiors don't overlap" — resolving that
  // requires at least one genuinely interior sample point, which is what
  // the guarded-centroid and edge-interior-sampling checks now provide.

  it("flags two fully identical (coincident) squares as overlapping (regression: coincident-boundary false negative)", () => {
    // Every vertex of one is exactly a vertex of the other (always ON the
    // other's boundary, never "strictly inside"), and every edge is exactly
    // collinear/coincident (excluded by the proper-crossing check by
    // design). Only a verified-interior sample point (here, the guarded
    // centroid) can catch this.
    const squareA = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const squareB = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(polygonsOverlap(squareA, squareB)).toBe(true);
    expect(polygonsOverlap(squareB, squareA)).toBe(true);
  });

  it("flags two same-height rectangles overlapping only partially along x (regression: axis-aligned partial overlap false negative)", () => {
    // A=(0,0)-(10,4), B=(8,0)-(20,4): genuinely overlapping over x:8-10,
    // y:0-4. B's corners (8,0)/(8,4) sit exactly on A's bottom/top edges
    // (never "strictly inside" A), and every edge pair between A and B is
    // either parallel (the vertical edges) or exactly collinear (the
    // horizontal edges, since both share y=0 and y=4) - so neither the
    // vertex check nor the proper-crossing check can see this overlap.
    // Only edge-interior sampling (e.g. B's left edge midpoint (8,2), which
    // is strictly interior to A) reveals it.
    const rectA = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 0, y: 4 },
    ];
    const rectB = [
      { x: 8, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 4 },
      { x: 8, y: 4 },
    ];
    expect(polygonsOverlap(rectA, rectB)).toBe(true);
    expect(polygonsOverlap(rectB, rectA)).toBe(true);
  });

  it("flags two same-width rectangles overlapping only partially along y (transpose of the same-height case, to rule out axis-specific bugs)", () => {
    // A=(0,0)-(4,10), B=(0,8)-(4,20): the vertical-strip mirror of the
    // same-height case above, overlapping over x:0-4, y:8-10.
    const rectA = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    const rectB = [
      { x: 0, y: 8 },
      { x: 4, y: 8 },
      { x: 4, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(polygonsOverlap(rectA, rectB)).toBe(true);
    expect(polygonsOverlap(rectB, rectA)).toBe(true);
  });

  it("flags a rectangle whose edges exactly bisect a wider rectangle, with no vertex strictly inside and no proper edge crossing", () => {
    // wideRect spans x:0-10, y:0-10. bisector is a vertical strip x:4-6
    // sharing wideRect's exact height (y:0-10): all 4 of bisector's vertices
    // sit exactly on wideRect's top/bottom boundary (never "strictly
    // inside"), and every edge pair only ever touches at those same
    // boundary points (t or u at an endpoint, i.e. 0 or 1) rather than
    // properly crossing - e.g. bisector's left edge (4,0)-(4,10) meets
    // wideRect's bottom edge at (4,0), which is an endpoint of the vertical
    // segment, not an interior crossing. Only a point partway along
    // bisector's left/right edges (e.g. (4,5)), strictly interior to
    // wideRect, reveals the overlap - directly exercising edge-interior
    // sampling in isolation from every other signal.
    const wideRect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const bisector = [
      { x: 4, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 10 },
      { x: 4, y: 10 },
    ];
    expect(polygonsOverlap(wideRect, bisector)).toBe(true);
    expect(polygonsOverlap(bisector, wideRect)).toBe(true);
  });

  // Round 3 regression: an external reviewer found that two IDENTICAL copies
  // of a CONCAVE U-shaped polygon were reported as non-overlapping by the
  // round-2 heuristic (guarded centroid + strict vertex containment + edge
  // interior sampling + proper edge crossing). Root cause: the shape is
  // concave, so guardedCentroid correctly returns null for both copies (the
  // centroid falls in the U's own notch) - that signal never fires here.
  // And because it's an exact duplicate, every vertex of one copy coincides
  // exactly with a vertex of the other (always ON the boundary, never
  // "strictly inside"), every edge is exactly collinear with the
  // corresponding edge of the other copy, and therefore every edge-interior
  // sample point also lands exactly ON the other polygon's boundary. No
  // heuristic signal fires, even though the two shapes plainly occupy
  // identical (fully overlapping) area. This is fixed by replacing the
  // sample-point heuristics with genuine triangulation + SAT area overlap,
  // which reasons about the full polygon area rather than finite samples.
  it("flags two identical copies of a concave U-shaped polygon as overlapping (regression: round-3 concave-coincident-boundary false negative)", () => {
    const uShapeA = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    const uShapeB = uShapeA.map((p) => ({ ...p }));

    // Sanity-check this really is a valid round-3 repro: the shape is
    // concave (its centroid must fall outside its own area), so the guarded
    // centroid signal that fixed round 2 cannot fire here.
    expect(isPointInPolygon(polygonCentroid(uShapeA), uShapeA)).toBe(false);

    expect(polygonsOverlap(uShapeA, uShapeB)).toBe(true);
    expect(polygonsOverlap(uShapeB, uShapeA)).toBe(true);
  });

  // Two new adversarial tests (round 3 follow-up), targeting the same class
  // of bug as above: identical or near-identical CONCAVE shapes, where every
  // vertex/edge of one coincides with the other's boundary and the centroid
  // signal is unavailable.

  it("flags two identical thin L-shaped (concave) polygons as overlapping", () => {
    // A thin-armed L (vertical arm x:0-1,y:0-6; horizontal arm x:0-6,y:0-1)
    // chosen so its own centroid falls outside its own area, same as the
    // U-shape repro above - this is what disqualifies the old guardedCentroid
    // signal and makes this a genuine round-3-class case (rather than one a
    // fatter L-shape's still-interior centroid would incidentally catch).
    const lShape = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 6 },
      { x: 0, y: 6 },
    ];
    const lShapeCopy = lShape.map((p) => ({ ...p }));

    expect(isPointInPolygon(polygonCentroid(lShape), lShape)).toBe(false);
    expect(polygonsOverlap(lShape, lShapeCopy)).toBe(true);
    expect(polygonsOverlap(lShapeCopy, lShape)).toBe(true);
  });

  it("flags a concave cross/plus polygon overlapping a mirrored copy of itself with opposite winding", () => {
    // A symmetric plus-sign polygon (concave at all 4 inner corners), mirrored
    // across its own vertical axis of symmetry (x=3) so the occupied area is
    // exactly unchanged. Mirroring a polygon's coordinates (without also
    // reversing its point order) flips its winding sign, so this exercises
    // triangulate()'s winding normalization (it must handle both CW and CCW
    // input consistently, since real-world input polygons aren't guaranteed
    // to share one winding convention).
    const plus = [
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 6 },
      { x: 2, y: 6 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ];
    const mirrored = plus.map((p) => ({ x: 6 - p.x, y: p.y }));

    expect(polygonArea(plus) * polygonArea(mirrored)).toBeLessThan(0); // opposite winding
    expect(isPointInPolygon(polygonCentroid(plus), plus)).toBe(true); // plus's centroid IS interior (its own center) - included for contrast with the U/L cases above, not a precondition of the bug
    expect(polygonsOverlap(plus, mirrored)).toBe(true);
    expect(polygonsOverlap(mirrored, plus)).toBe(true);
  });
});

describe("triangulate", () => {
  it("returns [] for degenerate input with fewer than 3 points", () => {
    expect(triangulate([])).toEqual([]);
    expect(triangulate([{ x: 0, y: 0 }])).toEqual([]);
    expect(
      triangulate([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([]);
  });

  it("triangulates a convex square into triangles whose areas sum to the square's area", () => {
    const result = triangulate(square);
    expect(result.length).toBe(2);
    expect(triangulatedArea(result)).toBeCloseTo(Math.abs(polygonArea(square)));
  });

  it("triangulates a concave U-shape into triangles whose areas sum to the U-shape's area, with none straying into the notch", () => {
    const uShape = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    const result = triangulate(uShape);
    // n-2 triangles for an n-gon.
    expect(result.length).toBe(uShape.length - 2);
    expect(triangulatedArea(result)).toBeCloseTo(Math.abs(polygonArea(uShape)));

    // The notch's center (3, 4) must not be covered by any triangle - every
    // ear must be a genuine subset of the polygon's actual (non-notch) area.
    const notchCenter = { x: 3, y: 4 };
    for (const [a, b, c] of result) {
      const d1 = (b.x - a.x) * (notchCenter.y - a.y) - (notchCenter.x - a.x) * (b.y - a.y);
      const d2 = (c.x - b.x) * (notchCenter.y - b.y) - (notchCenter.x - b.x) * (c.y - b.y);
      const d3 = (a.x - c.x) * (notchCenter.y - c.y) - (notchCenter.x - c.x) * (a.y - c.y);
      const allSameSign = (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
      expect(allSameSign).toBe(false);
    }
  });

  it("triangulates a clockwise-wound polygon identically in area to its counter-clockwise counterpart", () => {
    const ccw = square;
    const cw = [...square].reverse();
    expect(triangulatedArea(triangulate(ccw))).toBeCloseTo(Math.abs(polygonArea(square)));
    expect(triangulatedArea(triangulate(cw))).toBeCloseTo(Math.abs(polygonArea(square)));
  });

  it("does not blow up on a polygon with ~50 vertices (performance sanity check)", () => {
    // A "gear"/star-like polygon alternating outer and inner radius points,
    // giving it many reflex vertices - a reasonably adversarial shape for
    // naive O(n^2) ear clipping without being pathological.
    const n = 50;
    const points = Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * Math.PI * 2;
      const r = i % 2 === 0 ? 10 : 4;
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });

    const start = performance.now();
    const result = triangulate(points);
    const elapsedMs = performance.now() - start;

    expect(result.length).toBe(points.length - 2);
    expect(triangulatedArea(result)).toBeCloseTo(Math.abs(polygonArea(points)), 5);
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("trianglesOverlap", () => {
  it("reports overlapping triangles that genuinely interpenetrate", () => {
    const t1: Triangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ];
    const t2: Triangle = [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 1, y: 5 },
    ];
    expect(trianglesOverlap(t1, t2)).toBe(true);
  });

  it("does not report two triangles that only share an edge as overlapping", () => {
    const t1: Triangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ];
    // Mirrors t1 across the hypotenuse, sharing exactly the edge (4,0)-(0,4).
    const t2: Triangle = [
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(trianglesOverlap(t1, t2)).toBe(false);
    expect(trianglesOverlap(t2, t1)).toBe(false);
  });

  it("does not report two triangles that only share a single corner as overlapping", () => {
    const t1: Triangle = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    const t2: Triangle = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 2, y: 4 },
    ];
    expect(trianglesOverlap(t1, t2)).toBe(false);
  });

  it("does not report two clearly disjoint triangles as overlapping", () => {
    const t1: Triangle = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const t2: Triangle = [
      { x: 100, y: 100 },
      { x: 101, y: 100 },
      { x: 100, y: 101 },
    ];
    expect(trianglesOverlap(t1, t2)).toBe(false);
  });
});
