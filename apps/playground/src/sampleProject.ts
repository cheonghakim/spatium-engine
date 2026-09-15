import {
  createBuilding,
  createEmptyProject,
  createEntrance,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSpace,
} from "@indoor/core";

/** A small two-floor mall used to exercise the Runtime SDK end-to-end. */
export function createSampleProject() {
  const project = createEmptyProject("Playground Mall");
  const building = createBuilding("Main Building");

  const floor1 = createFloor("1F", 1);
  const lobby = createSpace(
    floor1.id,
    [
      { x: -6, y: -4 },
      { x: 6, y: -4 },
      { x: 6, y: 4 },
      { x: -6, y: 4 },
    ],
    "lobby",
  );
  lobby.properties.name = "Main Lobby";
  const store1 = createSpace(
    floor1.id,
    [
      { x: -6, y: 4 },
      { x: -1, y: 4 },
      { x: -1, y: 8 },
      { x: -6, y: 8 },
    ],
    "store",
  );
  store1.properties.name = "Coffee House";
  floor1.spaces.push(lobby, store1);

  const entrance1 = createEntrance(floor1.id, { x: 0, y: -4 }, "door");
  entrance1.spaceA = lobby.id;
  floor1.entrances.push(entrance1);

  const poi1 = createPOI(floor1.id, { x: -3, y: 6 }, "store", "Coffee House");
  poi1.spaceId = store1.id;
  const restroom1 = createPOI(floor1.id, { x: 5, y: 3 }, "restroom", "Restroom");
  floor1.pois.push(poi1, restroom1);

  const node1A = createNavigationNode(floor1.id, { x: 0, y: -3 }, "entrance");
  const node1B = createNavigationNode(floor1.id, { x: 0, y: 3 }, "junction");
  const node1Stairs = createNavigationNode(floor1.id, { x: 5, y: 4.5 }, "stairs");
  floor1.navigation.nodes.push(node1A, node1B, node1Stairs);
  floor1.navigation.edges.push(
    createNavigationEdge(node1A.id, node1B.id, 6, "walk"),
    createNavigationEdge(node1B.id, node1Stairs.id, 5.5, "walk"),
  );

  const floor2 = createFloor("2F", 2, 4);
  const foodCourt = createSpace(
    floor2.id,
    [
      { x: -6, y: -4 },
      { x: 6, y: -4 },
      { x: 6, y: 4 },
      { x: -6, y: 4 },
    ],
    "room",
  );
  foodCourt.properties.name = "Food Court";
  floor2.spaces.push(foodCourt);

  const poi2 = createPOI(floor2.id, { x: 0, y: 0 }, "information", "Info Desk");
  floor2.pois.push(poi2);

  const node2Stairs = createNavigationNode(floor2.id, { x: 5, y: 4.5 }, "stairs");
  const node2B = createNavigationNode(floor2.id, { x: 0, y: 0 }, "junction");
  floor2.navigation.nodes.push(node2Stairs, node2B);
  floor2.navigation.edges.push(createNavigationEdge(node2Stairs.id, node2B.id, 6, "walk"));

  // Cross-floor connection (stored on floor1's edge list, referencing a floor2 node).
  floor1.navigation.edges.push(createNavigationEdge(node1Stairs.id, node2Stairs.id, 4, "stairs"));

  building.floors.push(floor1, floor2);
  project.buildings.push(building);

  return {
    project,
    floor1,
    floor2,
    routeStartNodeId: node1A.id,
    routeEndNodeId: node2B.id,
  };
}
