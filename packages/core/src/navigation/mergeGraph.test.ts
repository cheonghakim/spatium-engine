import { describe, expect, it } from "vitest";
import { createBuilding, createEmptyProject, createFloor } from "../factories.js";
import { mergeProjectNavigationGraph } from "./mergeGraph.js";

describe("mergeProjectNavigationGraph", () => {
  it("combines nodes and edges from every floor of every building", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor1 = createFloor("1F", 1);
    const floor2 = createFloor("2F", 2);

    floor1.navigation.nodes.push({ id: "n1", floorId: floor1.id, position: { x: 0, y: 0 }, type: "normal" });
    floor1.navigation.edges.push({
      id: "e1",
      from: "n1",
      to: "n2",
      type: "stairs",
      distance: 3,
      accessible: false,
    });
    floor2.navigation.nodes.push({ id: "n2", floorId: floor2.id, position: { x: 0, y: 0 }, type: "normal" });

    building.floors.push(floor1, floor2);
    project.buildings.push(building);

    const merged = mergeProjectNavigationGraph(project);
    expect(merged.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(merged.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns an empty graph for a project with no navigation data", () => {
    const project = createEmptyProject("P");
    expect(mergeProjectNavigationGraph(project)).toEqual({ nodes: [], edges: [] });
  });
});
