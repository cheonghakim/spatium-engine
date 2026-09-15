import { describe, expect, it, vi } from "vitest";
import { ReferenceManager } from "./ReferenceManager.js";

describe("ReferenceManager", () => {
  it("has no image until setImage is called", () => {
    const manager = new ReferenceManager(() => {});
    expect(manager.current).toBeNull();
  });

  it("sets a default centered placement and notifies on change", () => {
    const onChange = vi.fn();
    const manager = new ReferenceManager(onChange);

    manager.setImage("blob://plan.png", 1000, 800);

    expect(manager.current).not.toBeNull();
    expect(manager.current?.imageUrl).toBe("blob://plan.png");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("converts between world and image pixel coordinates", () => {
    const manager = new ReferenceManager(() => {});
    manager.setImage("blob://plan.png", 1000, 800);
    manager.setOrigin({ x: 0, y: 0 });

    const world = manager.imagePixelToWorld({ x: 100, y: 50 });
    const pixel = manager.worldToImagePixel(world);

    expect(pixel.x).toBeCloseTo(100);
    expect(pixel.y).toBeCloseTo(50);
  });

  it("calibrate rescales the image so the two picked pixels end up the requested distance apart, anchored at the first point", () => {
    const manager = new ReferenceManager(() => {});
    manager.setImage("blob://plan.png", 1000, 800);
    manager.setOrigin({ x: 0, y: 0 });

    const pixelA = { x: 200, y: 200 };
    const pixelB = { x: 300, y: 200 };
    const worldA = manager.imagePixelToWorld(pixelA);
    const worldB = manager.imagePixelToWorld(pixelB);

    manager.calibrate(worldA, worldB, 12);

    // Anchor: the pixel clicked as "A" must still land on the same world point.
    const pixelAAfter = manager.worldToImagePixel(worldA);
    expect(pixelAAfter.x).toBeCloseTo(pixelA.x);
    expect(pixelAAfter.y).toBeCloseTo(pixelA.y);

    // The same two image pixels are now exactly `realDistanceMeters` apart —
    // worldB itself moves, since only the anchor point is held fixed.
    const newWorldB = manager.imagePixelToWorld(pixelB);
    const newDistance = Math.hypot(newWorldB.x - worldA.x, newWorldB.y - worldA.y);
    expect(newDistance).toBeCloseTo(12);
  });

  it("clamps opacity to [0, 1] and clear() resets state", () => {
    const manager = new ReferenceManager(() => {});
    manager.setImage("blob://plan.png", 1000, 800);

    manager.setOpacity(5);
    expect(manager.current?.opacity).toBe(1);

    manager.setOpacity(-2);
    expect(manager.current?.opacity).toBe(0);

    manager.clear();
    expect(manager.current).toBeNull();
  });
});
