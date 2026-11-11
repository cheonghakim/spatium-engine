import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createPOI,
  createSpace,
} from "../factories.js";
import { localizedName, searchProject } from "./search.js";

function project() {
  const p = createEmptyProject("Mall");
  const building = createBuilding("M");
  const f1 = createFloor("1F", 1);
  const f2 = createFloor("2F", 2);
  const star = createPOI(f1.id, { x: 1, y: 1 }, "store", "스타벅스 커피");
  star.names = { en: "Starbucks Coffee" };
  star.externalId = "T-0101";
  const restroom = createPOI(f2.id, { x: 0, y: 0 }, "restroom", "화장실");
  const room = createSpace(f2.id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]);
  room.properties = { name: "회의실 A", code: "201" };
  const unnamed = createSpace(f2.id, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]);
  f1.pois.push(star);
  f2.pois.push(restroom);
  f2.spaces.push(room, unnamed);
  building.floors.push(f1, f2);
  p.buildings.push(building);
  return { p, f1, f2, star, restroom, room };
}

describe("searchProject", () => {
  it("matches names in any locale, ignoring case and spaces", () => {
    const { p, star } = project();
    expect(searchProject(p, "starbucks")[0]?.id).toBe(star.id);
    expect(searchProject(p, "스타벅스커피")[0]?.score).toBe(100);
    expect(searchProject(p, "커피")[0]?.id).toBe(star.id);
  });

  it("matches Korean initials, external ids and space codes", () => {
    const { p, star, room } = project();
    expect(searchProject(p, "ㅅㅌㅂㅅ")[0]?.id).toBe(star.id);
    expect(searchProject(p, "t-0101")[0]?.id).toBe(star.id);
    expect(searchProject(p, "201")[0]?.id).toBe(room.id);
  });

  it("ranks exact over prefix over substring", () => {
    const { p } = project();
    const extra = createPOI(
      p.buildings[0]!.floors[0]!.id,
      { x: 0, y: 0 },
      "custom",
      "화장실 앞 ATM",
    );
    p.buildings[0]!.floors[0]!.pois.push(extra);
    expect(searchProject(p, "화장실").map((r) => r.name)).toEqual(["화장실", "화장실 앞 ATM"]);
  });

  it("filters by kind, floor and limit and localizes the display name", () => {
    const { p, f1, room } = project();
    expect(searchProject(p, "실", { kinds: ["space"] }).map((r) => r.id)).toEqual([room.id]);
    expect(searchProject(p, "화장실", { floorId: f1.id })).toEqual([]);
    expect(searchProject(p, "ㅎ", { limit: 1 })).toHaveLength(1);
    expect(searchProject(p, "스타", { locale: "en-US" })[0]?.name).toBe("Starbucks Coffee");
    expect(searchProject(p, "  ")).toEqual([]);
  });
});

describe("localizedName", () => {
  it("falls back from region to language to the default name", () => {
    const item = { name: "정문", names: { en: "Main Gate" } };
    expect(localizedName(item, "en-GB")).toBe("Main Gate");
    expect(localizedName(item, "ja")).toBe("정문");
    expect(localizedName(item)).toBe("정문");
  });
});
