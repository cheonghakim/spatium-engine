import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createEmptyProject,
  createEntrance,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSpace,
  createWall,
} from "../factories.js";
import {
  deserializeProject,
  InvalidProjectDataError,
  SchemaVersionMismatchError,
  serializeProject,
} from "./serialize.js";

describe("serializeProject / deserializeProject", () => {
  it("round-trips a project through JSON", () => {
    const project = createEmptyProject("Test Mall");
    const json = serializeProject(project);
    const restored = deserializeProject(json);
    expect(restored).toEqual(project);
  });

  it("round-trips a project with buildings, floors, and navigation data", () => {
    const project = createEmptyProject("Test Mall");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    building.floors.push(floor);
    project.buildings.push(building);

    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it("throws SchemaVersionMismatchError for an unknown schema version", () => {
    const project = { ...createEmptyProject("Old Mall"), schemaVersion: "0.0.1" };
    const json = JSON.stringify(project);
    expect(() => deserializeProject(json)).toThrow(SchemaVersionMismatchError);
  });

  it("throws a native SyntaxError for malformed JSON", () => {
    expect(() => deserializeProject("{ not valid json")).toThrow(SyntaxError);
  });

  it("throws InvalidProjectDataError when the parsed value isn't an object", () => {
    expect(() => deserializeProject("null")).toThrow(InvalidProjectDataError);
    expect(() => deserializeProject("42")).toThrow(InvalidProjectDataError);
    expect(() => deserializeProject('"just a string"')).toThrow(InvalidProjectDataError);
  });

  it("throws InvalidProjectDataError when buildings is missing", () => {
    const { buildings: _omit, ...withoutBuildings } = createEmptyProject("P");
    expect(() => deserializeProject(JSON.stringify(withoutBuildings))).toThrow(
      InvalidProjectDataError,
    );
  });

  it("throws InvalidProjectDataError when buildings is not an array", () => {
    const project = { ...createEmptyProject("P"), buildings: "not-an-array" };
    expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
  });

  it("throws InvalidProjectDataError when a floor is missing expected array fields", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    // A floor missing "walls"/"entrances"/"pois"/"navigation" entirely.
    (building.floors as unknown[]).push({
      id: "f1",
      name: "1F",
      level: 1,
      elevation: 0,
      spaces: [],
    });
    project.buildings.push(building);

    expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
  });

  it("throws InvalidProjectDataError when a building is missing an id/name", () => {
    const project = createEmptyProject("P");
    (project.buildings as unknown[]).push({ floors: [] });

    expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
  });

  it("round-trips a project with fully populated spaces, walls, entrances, pois, and navigation", () => {
    const project = createEmptyProject("Test Mall");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);

    const space = createSpace(
      floor.id,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      "room",
    );
    floor.spaces.push(space);
    floor.walls.push(createWall(floor.id, { x: 0, y: 0 }, { x: 10, y: 0 }));
    floor.entrances.push(createEntrance(floor.id, { x: 5, y: 0 }, "door"));
    floor.pois.push(createPOI(floor.id, { x: 5, y: 5 }, "store", "Test Store"));

    const nodeA = createNavigationNode(floor.id, { x: 1, y: 1 });
    const nodeB = createNavigationNode(floor.id, { x: 2, y: 2 });
    floor.navigation.nodes.push(nodeA, nodeB);
    floor.navigation.edges.push(createNavigationEdge(nodeA.id, nodeB.id, 1.41));

    building.floors.push(floor);
    project.buildings.push(building);

    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  describe("per-element shape validation (P2 regression: [null] elements must be rejected)", () => {
    function projectWithFloorOverrides(overrides: Record<string, unknown>) {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      Object.assign(floor, overrides);
      building.floors.push(floor);
      project.buildings.push(building);
      return { project, floorId: floor.id };
    }

    it("throws InvalidProjectDataError (not a downstream crash) for spaces: [null]", () => {
      const { project, floorId } = projectWithFloorOverrides({ spaces: [null] });

      let thrown: unknown;
      try {
        deserializeProject(JSON.stringify(project));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InvalidProjectDataError);
      expect((thrown as Error).message).toBe(
        `Space at index 0 on floor "${floorId}" must be an object with an "id" string.`,
      );
    });

    it("throws InvalidProjectDataError for walls: [null]", () => {
      const { project } = projectWithFloorOverrides({ walls: [null] });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(/Wall at index 0/);
    });

    it("throws InvalidProjectDataError for entrances: [null]", () => {
      const { project } = projectWithFloorOverrides({ entrances: [null] });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(/Entrance at index 0/);
    });

    it("throws InvalidProjectDataError for pois: [null]", () => {
      const { project } = projectWithFloorOverrides({ pois: [null] });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(/POI at index 0/);
    });

    it("throws InvalidProjectDataError for navigation.nodes: [{}] missing required fields", () => {
      const { project } = projectWithFloorOverrides({
        navigation: { nodes: [{}], edges: [] },
      });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(
        /Navigation node at index 0/,
      );
    });

    it("throws InvalidProjectDataError for a navigation node with a non-string name", () => {
      const { project } = projectWithFloorOverrides({
        navigation: {
          nodes: [{ id: "n1", position: { x: 0, y: 0 }, type: "normal", name: 42 }],
          edges: [],
        },
      });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(
        /must have a string "name"/,
      );
    });

    it("throws InvalidProjectDataError for navigation.edges: [null]", () => {
      const { project } = projectWithFloorOverrides({
        navigation: { nodes: [], edges: [null] },
      });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(
        /Navigation edge at index 0/,
      );
    });

    it("throws InvalidProjectDataError for a space missing a valid polygon array", () => {
      const { project } = projectWithFloorOverrides({
        spaces: [{ id: "s1", type: "room", height: 3, properties: {} }],
      });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(/"polygon" array/);
    });

    it("throws InvalidProjectDataError for a wall with non-point start/end", () => {
      const { project } = projectWithFloorOverrides({
        walls: [{ id: "w1", start: { x: 0 }, end: { x: 1, y: 1 }, thickness: 0.2 }],
      });
      expect(() => deserializeProject(JSON.stringify(project))).toThrow(InvalidProjectDataError);
    });

    it("does not throw for empty (zero-element) arrays", () => {
      const { project } = projectWithFloorOverrides({});
      expect(() => deserializeProject(JSON.stringify(project))).not.toThrow();
    });
  });

  describe("space polygon vertex / floorId / height / properties validation", () => {
    function projectWithFloorOverrides(overrides: Record<string, unknown>) {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      Object.assign(floor, overrides);
      building.floors.push(floor);
      project.buildings.push(building);
      return { project, floorId: floor.id };
    }

    it("throws InvalidProjectDataError (not a downstream crash) for a polygon of all-null vertices", () => {
      const { project, floorId } = projectWithFloorOverrides({
        spaces: [
          {
            id: "s1",
            floorId: "f1",
            type: "room",
            height: 3,
            properties: {},
            polygon: [null, null, null],
          },
        ],
      });

      let thrown: unknown;
      try {
        deserializeProject(JSON.stringify(project));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InvalidProjectDataError);
      expect((thrown as Error).message).toBe(
        `Space at index 0 on floor "${floorId}" has an invalid polygon vertex at index 0.`,
      );
    });

    it("checks every polygon vertex, not just the first, for a mix of valid and invalid vertices", () => {
      const { project, floorId } = projectWithFloorOverrides({
        spaces: [
          {
            id: "s1",
            floorId: "f1",
            type: "room",
            height: 3,
            properties: {},
            polygon: [{ x: 0, y: 0 }, null, { x: 1, y: 1 }],
          },
        ],
      });

      expect(() => deserializeProject(JSON.stringify(project))).toThrow(
        `Space at index 0 on floor "${floorId}" has an invalid polygon vertex at index 1.`,
      );
    });

    it("throws InvalidProjectDataError when a polygon vertex is missing x/y", () => {
      const { project } = projectWithFloorOverrides({
        spaces: [
          {
            id: "s1",
            floorId: "f1",
            type: "room",
            height: 3,
            properties: {},
            polygon: [{ x: 0, y: 0 }, { x: 1 }],
          },
        ],
      });

      expect(() => deserializeProject(JSON.stringify(project))).toThrow(
        /invalid polygon vertex at index 1/,
      );
    });

    it("throws InvalidProjectDataError when a space is missing a string floorId", () => {
      const { project } = projectWithFloorOverrides({
        spaces: [
          {
            id: "s1",
            type: "room",
            height: 3,
            properties: {},
            polygon: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        ],
      });

      expect(() => deserializeProject(JSON.stringify(project))).toThrow(/"floorId" string/);
    });

    it("throws InvalidProjectDataError when a space's height is missing, NaN, Infinity, or a string", () => {
      const basePolygon = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ];
      const badHeights: unknown[] = [undefined, NaN, Infinity, -Infinity, "3"];

      for (const height of badHeights) {
        const spaceRecord: Record<string, unknown> = {
          id: "s1",
          floorId: "f1",
          type: "room",
          properties: {},
          polygon: basePolygon,
        };
        if (height !== undefined) {
          spaceRecord.height = height;
        }
        const { project } = projectWithFloorOverrides({ spaces: [spaceRecord] });

        expect(() => deserializeProject(JSON.stringify(project))).toThrow(
          /finite numeric "height"/,
        );
      }
    });

    it("throws InvalidProjectDataError when a space's properties is missing or not an object", () => {
      const basePolygon = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ];

      const { project: missingProps } = projectWithFloorOverrides({
        spaces: [{ id: "s1", floorId: "f1", type: "room", height: 3, polygon: basePolygon }],
      });
      expect(() => deserializeProject(JSON.stringify(missingProps))).toThrow(/"properties" object/);

      const { project: arrayProps } = projectWithFloorOverrides({
        spaces: [
          {
            id: "s1",
            floorId: "f1",
            type: "room",
            height: 3,
            properties: [],
            polygon: basePolygon,
          },
        ],
      });
      expect(() => deserializeProject(JSON.stringify(arrayProps))).toThrow(/"properties" object/);
    });

    it("still round-trips a fully valid space created via createSpace", () => {
      const project = createEmptyProject("Test Mall");
      const building = createBuilding("B1");
      const floor = createFloor("1F", 1);
      const space = createSpace(
        floor.id,
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        "room",
      );
      floor.spaces.push(space);
      building.floors.push(floor);
      project.buildings.push(building);

      const restored = deserializeProject(serializeProject(project));
      expect(restored).toEqual(project);
    });
  });

  describe("finite-number validation (QA regression: Infinity/-Infinity numeric fields)", () => {
    const INF_SENTINEL = "__INF_SENTINEL__";
    const NEG_INF_SENTINEL = "__NEG_INF_SENTINEL__";

    /**
     * JSON.stringify(Infinity) produces the text "null", so a real repro of
     * the reported bug — a JSON *string* containing an overflowing numeric
     * literal like `1e400`, which JSON.parse silently turns into Infinity
     * per the IEEE 754 double spec — can't be built by assigning `Infinity`
     * to a field and calling JSON.stringify on it. Instead we stringify a
     * placeholder string sentinel and then substitute in the raw (unquoted)
     * numeric literal text, producing JSON text with a bare `1e400`/`-1e400`
     * token exactly like a hand-edited or corrupted project file would have.
     */
    function withRawLiteral(json: string, sentinel: string, rawLiteral: string): string {
      const quoted = `"${sentinel}"`;
      if (!json.includes(quoted)) {
        throw new Error(`sentinel ${quoted} not found in JSON`);
      }
      return json.replace(quoted, rawLiteral);
    }

    it("sanity check: 1e400 overflows to Infinity via JSON.parse (IEEE 754 double overflow)", () => {
      const json = withRawLiteral(JSON.stringify({ x: INF_SENTINEL }), INF_SENTINEL, "1e400");
      expect(json).toBe('{"x":1e400}');
      expect((JSON.parse(json) as { x: number }).x).toBe(Infinity);
    });

    it("throws InvalidProjectDataError for a wall start.x of 1e400 (Infinity)", () => {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 1, y: 1 });
      (wall.start as unknown as { x: string }).x = INF_SENTINEL;
      floor.walls.push(wall);
      building.floors.push(floor);
      project.buildings.push(building);

      const json = withRawLiteral(JSON.stringify(project), INF_SENTINEL, "1e400");

      expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(json)).toThrow(/must have "start" and "end" points/);
    });

    it("throws InvalidProjectDataError for a wall end.y of -1e400 (-Infinity)", () => {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 1, y: 1 });
      (wall.end as unknown as { y: string }).y = NEG_INF_SENTINEL;
      floor.walls.push(wall);
      building.floors.push(floor);
      project.buildings.push(building);

      const json = withRawLiteral(JSON.stringify(project), NEG_INF_SENTINEL, "-1e400");

      expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(json)).toThrow(/must have "start" and "end" points/);
    });

    it("throws InvalidProjectDataError for a space polygon vertex of 1e400 (Infinity)", () => {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      const space = createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]);
      (space.polygon[1] as unknown as { x: string }).x = INF_SENTINEL;
      floor.spaces.push(space);
      building.floors.push(floor);
      project.buildings.push(building);

      const json = withRawLiteral(JSON.stringify(project), INF_SENTINEL, "1e400");

      expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(json)).toThrow(/invalid polygon vertex at index 1/);
    });

    it("throws InvalidProjectDataError for a POI position.x of 1e400 (Infinity)", () => {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      const poi = createPOI(floor.id, { x: 0, y: 0 }, "store", "Test Store");
      (poi.position as unknown as { x: string }).x = INF_SENTINEL;
      floor.pois.push(poi);
      building.floors.push(floor);
      project.buildings.push(building);

      const json = withRawLiteral(JSON.stringify(project), INF_SENTINEL, "1e400");

      expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(json)).toThrow(/"position" with numeric x\/y/);
    });

    it("throws InvalidProjectDataError for wall.thickness of 1e400 (Infinity)", () => {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 1, y: 1 });
      (wall as unknown as { thickness: string }).thickness = INF_SENTINEL;
      floor.walls.push(wall);
      building.floors.push(floor);
      project.buildings.push(building);

      const json = withRawLiteral(JSON.stringify(project), INF_SENTINEL, "1e400");

      expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(json)).toThrow(/finite numeric "thickness"/);
    });

    it("throws InvalidProjectDataError for navigation edge.distance of 1e400 (Infinity)", () => {
      const project = createEmptyProject("P");
      const building = createBuilding("B1");
      const floor = createFloor("f1", 1);
      const nodeA = createNavigationNode(floor.id, { x: 0, y: 0 });
      const nodeB = createNavigationNode(floor.id, { x: 1, y: 1 });
      const edge = createNavigationEdge(nodeA.id, nodeB.id, 1.41);
      (edge as unknown as { distance: string }).distance = INF_SENTINEL;
      floor.navigation.nodes.push(nodeA, nodeB);
      floor.navigation.edges.push(edge);
      building.floors.push(floor);
      project.buildings.push(building);

      const json = withRawLiteral(JSON.stringify(project), INF_SENTINEL, "1e400");

      expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
      expect(() => deserializeProject(json)).toThrow(/finite numeric "distance"/);
    });

    it("still round-trips a fully valid project with finite numbers everywhere", () => {
      const project = createEmptyProject("Test Mall");
      const building = createBuilding("B1");
      const floor = createFloor("1F", 1);

      const space = createSpace(
        floor.id,
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        "room",
      );
      floor.spaces.push(space);
      floor.walls.push(createWall(floor.id, { x: 0, y: 0 }, { x: 10, y: 0 }));
      floor.entrances.push(createEntrance(floor.id, { x: 5, y: 0 }, "door"));
      floor.pois.push(createPOI(floor.id, { x: 5, y: 5 }, "store", "Test Store"));

      const nodeA = createNavigationNode(floor.id, { x: 1, y: 1 }, "normal", "정문");
      const nodeB = createNavigationNode(floor.id, { x: 2, y: 2 });
      floor.navigation.nodes.push(nodeA, nodeB);
      floor.navigation.edges.push(createNavigationEdge(nodeA.id, nodeB.id, 1.41));

      building.floors.push(floor);
      project.buildings.push(building);

      const restored = deserializeProject(serializeProject(project));
      expect(restored).toEqual(project);
    });
  });
});
