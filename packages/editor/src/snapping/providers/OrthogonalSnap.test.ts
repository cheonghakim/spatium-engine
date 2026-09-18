import { createFloor } from "@indoor/core";
import { describe, expect, it } from "vitest";
import { OrthogonalSnap } from "./OrthogonalSnap.js";

describe("OrthogonalSnap", () => {
  it("returns null without a referencePoint", () => {
    const snap = new OrthogonalSnap();
    const floor = createFloor("1F", 1);
    expect(snap.getSnap({ x: 5, y: 5.1 }, { floor })).toBeNull();
  });

  it("aligns horizontally (keeps reference x) when x is within threshold and closer than y", () => {
    const snap = new OrthogonalSnap(0.15);
    const floor = createFloor("1F", 1);
    const result = snap.getSnap({ x: 0.1, y: 5 }, { floor, referencePoint: { x: 0, y: 0 } });
    expect(result).toEqual({ point: { x: 0, y: 5 }, type: "orthogonal" });
  });

  it("aligns vertically (keeps reference y) when y is within threshold and closer than x", () => {
    const snap = new OrthogonalSnap(0.15);
    const floor = createFloor("1F", 1);
    const result = snap.getSnap({ x: 5, y: 0.1 }, { floor, referencePoint: { x: 0, y: 0 } });
    expect(result).toEqual({ point: { x: 5, y: 0 }, type: "orthogonal" });
  });

  it("returns null when neither axis is within threshold", () => {
    const snap = new OrthogonalSnap(0.15);
    const floor = createFloor("1F", 1);
    expect(snap.getSnap({ x: 5, y: 5 }, { floor, referencePoint: { x: 0, y: 0 } })).toBeNull();
  });

  it("prefers the smaller deviation when both dx and dy are within threshold", () => {
    const snap = new OrthogonalSnap(0.2);
    const floor = createFloor("1F", 1);
    // dx = 0.05 (smaller) -> snaps to vertical alignment (keeps ref x)
    const result = snap.getSnap({ x: 0.05, y: 0.15 }, { floor, referencePoint: { x: 0, y: 0 } });
    expect(result).toEqual({ point: { x: 0, y: 0.15 }, type: "orthogonal" });
  });
});
