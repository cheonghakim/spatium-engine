import { describe, expect, it } from "vitest";
import { matchesConditions } from "./conditions.js";

describe("matchesConditions", () => {
  it("returns true for an empty or missing condition list", () => {
    expect(matchesConditions(undefined, {})).toBe(true);
    expect(matchesConditions([], {})).toBe(true);
  });

  it("evaluates a dot-path field against the payload", () => {
    const payload = { poi: { type: "store", name: "Coffee" } };
    expect(matchesConditions([{ field: "poi.type", operator: "equals", value: "store" }], payload)).toBe(
      true,
    );
    expect(matchesConditions([{ field: "poi.type", operator: "equals", value: "restroom" }], payload)).toBe(
      false,
    );
  });

  it("requires every condition to match (AND)", () => {
    const payload = { poi: { type: "store", name: "Coffee" } };
    const conditions = [
      { field: "poi.type", operator: "equals" as const, value: "store" },
      { field: "poi.name", operator: "equals" as const, value: "Tea" },
    ];
    expect(matchesConditions(conditions, payload)).toBe(false);
  });

  it("supports notEquals, in, notIn, gt, lt", () => {
    const payload = { poi: { type: "store" }, distance: 12 };
    expect(matchesConditions([{ field: "poi.type", operator: "notEquals", value: "restroom" }], payload)).toBe(
      true,
    );
    expect(matchesConditions([{ field: "poi.type", operator: "in", value: ["store", "restroom"] }], payload)).toBe(
      true,
    );
    expect(matchesConditions([{ field: "poi.type", operator: "notIn", value: ["restroom"] }], payload)).toBe(
      true,
    );
    expect(matchesConditions([{ field: "distance", operator: "gt", value: 10 }], payload)).toBe(true);
    expect(matchesConditions([{ field: "distance", operator: "lt", value: 10 }], payload)).toBe(false);
  });

  it("returns false when the field path doesn't exist", () => {
    expect(matchesConditions([{ field: "poi.missing.deep", operator: "equals", value: "x" }], {})).toBe(
      false,
    );
  });
});
