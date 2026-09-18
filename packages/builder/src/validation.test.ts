import { describe, expect, it } from "vitest";
import type { BuilderConfig } from "./BuilderConfig.js";
import type { EventActionRule } from "./actions.js";
import { validateBuilderConfig } from "./validation.js";

function baseConfig(events: EventActionRule[]): BuilderConfig {
  return {
    camera: { mode: "2d", pan: true, zoom: true, rotate: true },
    controls: { floorSelector: true, cameraToggle: true },
    events,
  };
}

describe("validateBuilderConfig", () => {
  it("returns no issues for a fully valid config exercising every action type", () => {
    const config = baseConfig([
      {
        event: "poi.click",
        conditions: [{ field: "poi.type", operator: "equals", value: "store" }],
        actions: [
          { type: "poi.focus" },
          { type: "poi.focus", poiId: "poi-1" },
          { type: "space.highlight" },
          { type: "space.highlight", spaceId: "space-1" },
          { type: "popup.open", content: "Hello" },
          { type: "panel.open", panelId: "detail" },
          { type: "panel.close", panelId: "detail" },
          { type: "marker.add", markerId: "m1", floorId: "f1", x: 1, y: 2 },
          { type: "marker.remove", markerId: "m1" },
          { type: "floor.change", floorId: "f1" },
          { type: "camera.move", x: 1, y: 2 },
          { type: "camera.move", x: 1, y: 2, zoom: 100 },
          { type: "camera.setMode2d" },
          { type: "camera.setMode3d" },
          { type: "route.start", fromNodeId: "a", toNodeId: "b" },
          { type: "route.clear" },
          { type: "route.playAnimation" },
          {
            type: "route.playAnimation",
            animationType: "flythrough",
            cameraMode: "third",
            curve: "smooth",
            durationSeconds: 5,
          },
          { type: "route.stopAnimation" },
          { type: "url.open", url: "https://example.com" },
          { type: "event.emit", name: "custom" },
          { type: "event.emit", name: "custom", payload: { a: 1 } },
        ],
      },
    ]);

    expect(validateBuilderConfig(config)).toEqual([]);
  });

  it("returns no issues for an empty events list", () => {
    expect(validateBuilderConfig(baseConfig([]))).toEqual([]);
  });

  it("flags a missing required field on marker.add", () => {
    const config = baseConfig([
      {
        event: "map.loaded",
        actions: [{ type: "marker.add", markerId: "m1", floorId: "f1", x: 1 } as never],
      },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("marker.add") && i.includes('"y"'))).toBe(true);
  });

  it("flags a missing required field on route.start", () => {
    const config = baseConfig([
      { event: "map.loaded", actions: [{ type: "route.start", fromNodeId: "a" } as never] },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("route.start") && i.includes("toNodeId"))).toBe(true);
  });

  it("flags a missing required field on url.open", () => {
    const config = baseConfig([{ event: "map.loaded", actions: [{ type: "url.open" } as never] }]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("url.open") && i.includes("url"))).toBe(true);
  });

  it("flags a missing required field on marker.remove", () => {
    const config = baseConfig([
      { event: "map.loaded", actions: [{ type: "marker.remove" } as never] },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("marker.remove") && i.includes("markerId"))).toBe(true);
  });

  it("flags a missing required field on event.emit", () => {
    const config = baseConfig([
      { event: "map.loaded", actions: [{ type: "event.emit" } as never] },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("event.emit") && i.includes("name"))).toBe(true);
  });

  it("flags a wrong-typed field on camera.move", () => {
    const config = baseConfig([
      { event: "map.loaded", actions: [{ type: "camera.move", x: "1", y: 2 } as never] },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("camera.move") && i.includes('"x"'))).toBe(true);
  });

  it("flags an invalid enum value on route.playAnimation", () => {
    const config = baseConfig([
      { event: "map.loaded", actions: [{ type: "route.playAnimation", curve: "wiggly" } as never] },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes("route.playAnimation") && i.includes("curve"))).toBe(true);
  });

  it("flags an unrecognized action type", () => {
    const config = baseConfig([
      { event: "map.loaded", actions: [{ type: "marker.explode" } as never] },
    ]);

    const issues = validateBuilderConfig(config);

    expect(
      issues.some((i) => i.includes("unrecognized action type") && i.includes("marker.explode")),
    ).toBe(true);
  });

  it("flags an unrecognized condition operator", () => {
    const config = baseConfig([
      {
        event: "poi.click",
        conditions: [{ field: "poi.type", operator: "startsWith", value: "s" } as never],
        actions: [{ type: "poi.focus" }],
      },
    ]);

    const issues = validateBuilderConfig(config);

    expect(
      issues.some((i) => i.includes("unrecognized operator") && i.includes("startsWith")),
    ).toBe(true);
  });

  it("flags a condition missing a valid field", () => {
    const config = baseConfig([
      {
        event: "poi.click",
        conditions: [{ operator: "equals", value: "s" } as never],
        actions: [{ type: "poi.focus" }],
      },
    ]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes('"field"'))).toBe(true);
  });

  it("flags a rule missing a valid event string", () => {
    const config = baseConfig([{ actions: [{ type: "poi.focus" }] } as never]);

    const issues = validateBuilderConfig(config);

    expect(issues.some((i) => i.includes('"event"'))).toBe(true);
  });

  it("flags no issues for a rule using a recognized runtime event", () => {
    const config = baseConfig([{ event: "poi.click", actions: [{ type: "poi.focus" }] }]);

    const issues = validateBuilderConfig(config);

    expect(issues).toEqual([]);
  });

  it("flags a rule using an unrecognized/typo'd event name", () => {
    const config = baseConfig([{ event: "poi.slick", actions: [{ type: "poi.focus" }] }]);

    const issues = validateBuilderConfig(config);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"poi.slick"');
    expect(issues[0]).toContain("not a recognized runtime event");
  });

  it("does not throw and reports a clear issue when config.events is a non-array (malformed hand-edited JSON)", () => {
    const config = { ...baseConfig([]), events: {} } as unknown as BuilderConfig;

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues).toEqual(["config.events must be an array."]);
  });

  it("does not throw and reports a clear issue when rule.conditions is a non-array (malformed hand-edited JSON)", () => {
    const config = baseConfig([
      { event: "poi.click", conditions: "oops" as never, actions: [{ type: "poi.focus" }] },
    ]);

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues.some((i) => i.includes("rule.conditions must be an array"))).toBe(true);
  });

  it("does not throw and reports a clear issue when rule.actions is a non-array (malformed hand-edited JSON)", () => {
    const config = baseConfig([{ event: "poi.click", actions: "oops" as never }]);

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues.some((i) => i.includes("rule.actions must be an array"))).toBe(true);
  });

  it("does not throw and reports a clear issue when an events entry is null (malformed hand-edited JSON)", () => {
    const config = { ...baseConfig([]), events: [null] } as unknown as BuilderConfig;

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues).toEqual(["config.events[0] must be an object."]);
  });

  it("does not throw and reports a clear issue when an events entry is a non-object primitive (malformed hand-edited JSON)", () => {
    const config = { ...baseConfig([]), events: ["not an object"] } as unknown as BuilderConfig;

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues).toEqual(["config.events[0] must be an object."]);
  });

  it("does not throw and reports a clear issue when an events entry is an array (malformed hand-edited JSON)", () => {
    const config = { ...baseConfig([]), events: [["nope"]] } as unknown as BuilderConfig;

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues).toEqual(["config.events[0] must be an object."]);
  });

  it("does not throw and reports a clear issue when a rule.conditions entry is null (malformed hand-edited JSON)", () => {
    const config = baseConfig([
      { event: "poi.click", conditions: [null] as never, actions: [{ type: "poi.focus" }] },
    ]);

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues.some((i) => i.includes("rule.conditions[0] must be an object"))).toBe(true);
  });

  it("does not throw and reports a clear issue when a rule.actions entry is null (malformed hand-edited JSON)", () => {
    const config = baseConfig([{ event: "poi.click", actions: [null] as never }]);

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues.some((i) => i.includes("rule.actions[0] must be an object"))).toBe(true);
  });

  it("does not throw and reports a clear issue when a rule.actions entry is a non-object primitive (malformed hand-edited JSON)", () => {
    const config = baseConfig([{ event: "poi.click", actions: ["not an object"] as never }]);

    let issues: string[] = [];
    expect(() => {
      issues = validateBuilderConfig(config);
    }).not.toThrow();

    expect(issues.some((i) => i.includes("rule.actions[0] must be an object"))).toBe(true);
  });

  it("does not throw and reports a clear issue when the config itself is null or not an object (malformed hand-edited JSON)", () => {
    for (const bad of [null, undefined, "oops", 42, []] as unknown[]) {
      let issues: string[] = [];
      expect(() => {
        issues = validateBuilderConfig(bad as BuilderConfig);
      }).not.toThrow();

      expect(issues).toEqual(["config must be an object."]);
    }
  });
});
