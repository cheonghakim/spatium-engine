import { createBuilding, createEmptyProject, createFloor, createPOI, createSpace } from "@indoor/core";

/** A tiny single-floor mall used to demonstrate the Builder's Event -> Condition -> Action system. */
export function createSampleProject() {
  const project = createEmptyProject("Builder Demo Mall");
  const building = createBuilding("Main Building");
  const floor = createFloor("1F", 1);

  const lobby = createSpace(
    floor.id,
    [
      { x: -8, y: -6 },
      { x: 8, y: -6 },
      { x: 8, y: 6 },
      { x: -8, y: 6 },
    ],
    "lobby",
  );
  lobby.properties.name = "Main Lobby";
  floor.spaces.push(lobby);

  const store = createPOI(floor.id, { x: -4, y: 2 }, "store", "Coffee House");
  const restroom = createPOI(floor.id, { x: 4, y: -2 }, "restroom", "Restroom");
  const info = createPOI(floor.id, { x: 0, y: 4 }, "information", "Info Desk");
  floor.pois.push(store, restroom, info);

  building.floors.push(floor);
  project.buildings.push(building);

  return { project, floor, store, restroom, info };
}
