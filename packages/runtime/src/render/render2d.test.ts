import { describe, expect, it } from "vitest";
import { RuntimeCamera } from "../camera/RuntimeCamera.js";
import { render2d } from "./render2d.js";

function makeFakeContext() {
  const calls: { fillRect: string[] } = { fillRect: [] };
  const ctx = {
    canvas: { width: 100, height: 100 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    fillRect() {
      calls.fillRect.push(String(ctx.fillStyle));
    },
    fillText() {},
    set font(_: string) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("render2d theming", () => {
  it("uses the default background when no theme is provided", () => {
    const { ctx, calls } = makeFakeContext();
    const camera = new RuntimeCamera();
    camera.setViewportSize({ width: 100, height: 100 });

    render2d(ctx, { floor: undefined, camera, overlays: [], hoveredId: null, routePoints: [] });

    expect(calls.fillRect).toEqual(["#f5f5f7"]);
  });

  it("uses the theme's background override when provided", () => {
    const { ctx, calls } = makeFakeContext();
    const camera = new RuntimeCamera();
    camera.setViewportSize({ width: 100, height: 100 });

    render2d(ctx, {
      floor: undefined,
      camera,
      overlays: [],
      hoveredId: null,
      routePoints: [],
      theme: { background: "#000000" },
    });

    expect(calls.fillRect).toEqual(["#000000"]);
  });
});
