import { describe, expect, it } from "vitest";
import { buildingToSite, lngLatToSite, siteToBuilding, siteToLngLat } from "./georeference.js";

const SEOUL = { geoAnchor: { longitude: 126.978, latitude: 37.5665 } };

describe("buildingToSite / siteToBuilding", () => {
  it("is the identity without a placement", () => {
    expect(buildingToSite({}, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(siteToBuilding({}, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("rotates clockwise by bearing: local +Y points east at 90°", () => {
    const building = { placement: { origin: { x: 100, y: 50 }, bearing: 90 } };
    const p = buildingToSite(building, { x: 0, y: 10 });
    expect(p.x).toBeCloseTo(110);
    expect(p.y).toBeCloseTo(50);
    const q = buildingToSite(building, { x: 10, y: 0 }); // local +X → south
    expect(q.x).toBeCloseTo(100);
    expect(q.y).toBeCloseTo(40);
  });

  it("round-trips", () => {
    const building = { placement: { origin: { x: -20, y: 7 }, bearing: 33.3 } };
    const back = siteToBuilding(building, buildingToSite(building, { x: 12.5, y: -4 }));
    expect(back.x).toBeCloseTo(12.5, 9);
    expect(back.y).toBeCloseTo(-4, 9);
  });
});

describe("siteToLngLat / lngLatToSite", () => {
  it("maps the origin to the anchor", () => {
    expect(siteToLngLat(SEOUL, { x: 0, y: 0 })).toEqual([126.978, 37.5665]);
  });

  it("moves about 1° of latitude per ~111 km and stays consistent both ways", () => {
    const [, lat] = siteToLngLat(SEOUL, { x: 0, y: 111_000 });
    expect(lat - 37.5665).toBeCloseTo(1, 1);

    const lngLat = siteToLngLat(SEOUL, { x: 1234.5, y: -678.9 });
    const back = lngLatToSite(SEOUL, lngLat);
    expect(back.x).toBeCloseTo(1234.5, 6);
    expect(back.y).toBeCloseTo(-678.9, 6);
  });

  it("matches the WGS84 length of a degree of longitude at the anchor latitude", () => {
    // ~88.2 km per degree of longitude at 37.5665° N.
    const [lng] = siteToLngLat(SEOUL, { x: 88_200, y: 0 });
    expect(lng - 126.978).toBeCloseTo(1, 2);
  });

  it("throws without a geoAnchor", () => {
    expect(() => siteToLngLat({}, { x: 0, y: 0 })).toThrow(/geoAnchor/);
  });
});
