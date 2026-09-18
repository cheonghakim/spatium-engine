import { describe, expect, it } from "vitest";
import {
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createSpace,
  createWall,
} from "../factories.js";
import { validateNavigation, validateSpaces, validateWalls } from "./rules.js";

describe("validateWalls", () => {
  it("returns no issues for a well-formed wall", () => {
    const floor = createFloor("1F", 1);
    floor.walls.push(createWall(floor.id, { x: 0, y: 0 }, { x: 5, y: 0 }));

    expect(validateWalls(floor)).toEqual([]);
  });

  it("flags a zero-length wall as an error", () => {
    const floor = createFloor("1F", 1);
    floor.walls.push(createWall(floor.id, { x: 2, y: 2 }, { x: 2, y: 2 }));

    const issues = validateWalls(floor);
    expect(issues.some((i) => i.type === "degenerate-wall" && i.severity === "error")).toBe(true);
  });

  it("flags a near-zero-length wall (below epsilon) as an error", () => {
    const floor = createFloor("1F", 1);
    floor.walls.push(createWall(floor.id, { x: 0, y: 0 }, { x: 0.001, y: 0 }));

    const issues = validateWalls(floor);
    expect(issues.some((i) => i.type === "degenerate-wall")).toBe(true);
  });

  it("does not flag a short but non-degenerate wall", () => {
    const floor = createFloor("1F", 1);
    floor.walls.push(createWall(floor.id, { x: 0, y: 0 }, { x: 0.5, y: 0 }));

    expect(validateWalls(floor).some((i) => i.type === "degenerate-wall")).toBe(false);
  });

  it("flags non-positive thickness as an error", () => {
    const floor = createFloor("1F", 1);
    floor.walls.push(createWall(floor.id, { x: 0, y: 0 }, { x: 5, y: 0 }, 0));
    floor.walls.push(createWall(floor.id, { x: 0, y: 1 }, { x: 5, y: 1 }, -0.1));

    const issues = validateWalls(floor);
    expect(
      issues.filter((i) => i.type === "invalid-wall-thickness" && i.severity === "error"),
    ).toHaveLength(2);
  });
});

describe("validateSpaces overlap detection", () => {
  it("does not flag two adjacent unit-square rooms that only share a wall edge", () => {
    const floor = createFloor("1F", 1);
    const roomA = createSpace(
      floor.id,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      "room",
    );
    const roomB = createSpace(
      floor.id,
      [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
      ],
      "room",
    );
    floor.spaces.push(roomA, roomB);

    expect(validateSpaces(floor).some((i) => i.type === "overlapping-spaces")).toBe(false);
  });

  it("flags two clearly overlapping rectangles", () => {
    const floor = createFloor("1F", 1);
    const roomA = createSpace(
      floor.id,
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
      "room",
    );
    const roomB = createSpace(
      floor.id,
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
        { x: 1, y: 3 },
      ],
      "room",
    );
    floor.spaces.push(roomA, roomB);

    const issues = validateSpaces(floor).filter((i) => i.type === "overlapping-spaces");
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.objectId).sort()).toEqual([roomA.id, roomB.id].sort());
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("flags one polygon fully containing another", () => {
    const floor = createFloor("1F", 1);
    const outer = createSpace(
      floor.id,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      "room",
    );
    const inner = createSpace(
      floor.id,
      [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 },
      ],
      "room",
    );
    floor.spaces.push(outer, inner);

    expect(validateSpaces(floor).filter((i) => i.type === "overlapping-spaces")).toHaveLength(2);
  });
});

describe("validateNavigation", () => {
  it("flags duplicate edges connecting the same pair of nodes", () => {
    const floor = createFloor("1F", 1);
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 1, y: 0 });
    floor.navigation.nodes.push(a, b);
    floor.navigation.edges.push(createNavigationEdge(a.id, b.id, 1));
    floor.navigation.edges.push(createNavigationEdge(b.id, a.id, 1));

    const issues = validateNavigation(floor);
    expect(
      issues.filter((i) => i.type === "duplicate-navigation-edge" && i.severity === "warning"),
    ).toHaveLength(2);
  });

  it("does not flag a single edge between two nodes as a duplicate", () => {
    const floor = createFloor("1F", 1);
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 1, y: 0 });
    floor.navigation.nodes.push(a, b);
    floor.navigation.edges.push(createNavigationEdge(a.id, b.id, 1));

    expect(validateNavigation(floor).some((i) => i.type === "duplicate-navigation-edge")).toBe(
      false,
    );
  });

  it("flags an edge whose stored distance diverges from the geometric distance", () => {
    const floor = createFloor("1F", 1);
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 10, y: 0 });
    floor.navigation.nodes.push(a, b);
    // Actual distance is 10; stored distance of 50 is wildly off.
    floor.navigation.edges.push(createNavigationEdge(a.id, b.id, 50));

    const issues = validateNavigation(floor);
    expect(
      issues.some((i) => i.type === "inaccurate-edge-distance" && i.severity === "warning"),
    ).toBe(true);
  });

  it("does not flag an edge distance within tolerance", () => {
    const floor = createFloor("1F", 1);
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 10, y: 0 });
    floor.navigation.nodes.push(a, b);
    // 10.5 vs actual 10 is well within the 20%/1m tolerance.
    floor.navigation.edges.push(createNavigationEdge(a.id, b.id, 10.5));

    expect(validateNavigation(floor).some((i) => i.type === "inaccurate-edge-distance")).toBe(
      false,
    );
  });

  it("skips the distance-sanity check for edges spanning two different floors", () => {
    const floorA = createFloor("1F", 1);
    const floorB = createFloor("2F", 2);
    const a = createNavigationNode(floorA.id, { x: 0, y: 0 });
    const b = createNavigationNode(floorB.id, { x: 0, y: 0 });
    floorA.navigation.nodes.push(a);
    floorB.navigation.nodes.push(b);
    // Stored distance (3m of stairs) has no relation to the flat-plan
    // distance between the two nodes (0m, since they're stacked) — this
    // must not be flagged since the nodes are on different floors.
    floorA.navigation.edges.push(createNavigationEdge(a.id, b.id, 3, "stairs"));

    const issues = validateNavigation(floorA, [a, b], floorA.navigation.edges);
    expect(issues.some((i) => i.type === "inaccurate-edge-distance")).toBe(false);
    expect(issues.some((i) => i.type === "broken-navigation-edge")).toBe(false);
  });
});
