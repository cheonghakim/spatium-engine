import { describe, expect, it, vi } from "vitest";
import { LayerVisibilityManager } from "./LayerVisibilityManager.js";

describe("LayerVisibilityManager", () => {
  it("defaults every layer to visible", () => {
    const manager = new LayerVisibilityManager(() => {});
    expect(manager.isVisible("reference")).toBe(true);
    expect(manager.isVisible("spaces")).toBe(true);
    expect(manager.isVisible("entrances")).toBe(true);
    expect(manager.isVisible("pois")).toBe(true);
  });

  it("setVisible toggles a single layer and notifies once", () => {
    const onChange = vi.fn();
    const manager = new LayerVisibilityManager(onChange);

    manager.setVisible("pois", false);

    expect(manager.isVisible("pois")).toBe(false);
    expect(manager.isVisible("spaces")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("skips notification when the value doesn't change", () => {
    const onChange = vi.fn();
    const manager = new LayerVisibilityManager(onChange);

    manager.setVisible("spaces", true);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggle flips the current value", () => {
    const manager = new LayerVisibilityManager(() => {});
    manager.toggle("reference");
    expect(manager.isVisible("reference")).toBe(false);
    manager.toggle("reference");
    expect(manager.isVisible("reference")).toBe(true);
  });
});
