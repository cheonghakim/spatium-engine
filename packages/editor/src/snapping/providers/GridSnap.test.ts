import { createFloor } from "@indoor/core";
import { describe, expect, it } from "vitest";
import { GridSnap } from "./GridSnap.js";

describe("GridSnap", () => {
  const floor = createFloor("1F", 1);

  it("rounds a point far from any grid line, not just one that's already close", () => {
    const snap = new GridSnap(1);
    // Exactly halfway between grid lines on both axes — the old behavior
    // silently declined to snap anything more than ~0.15m from a grid point,
    // which meant most real clicks never snapped at all.
    const result = snap.getSnap({ x: 1.5, y: 2.5 }, { floor });
    expect(result).toEqual({ point: { x: 2, y: 3 }, type: "grid" });
  });

  it("rounds to the nearest intersection for an arbitrary point", () => {
    const snap = new GridSnap(1);
    const result = snap.getSnap({ x: 3.2, y: 7.8 }, { floor });
    expect(result).toEqual({ point: { x: 3, y: 8 }, type: "grid" });
  });

  it("respects a custom grid size", () => {
    const snap = new GridSnap(0.5);
    const result = snap.getSnap({ x: 1.3, y: 1.1 }, { floor });
    expect(result).toEqual({ point: { x: 1.5, y: 1 }, type: "grid" });
  });

  it("returns null while disabled", () => {
    const snap = new GridSnap(1);
    snap.setEnabled(false);
    expect(snap.getSnap({ x: 1.5, y: 2.5 }, { floor })).toBeNull();
    expect(snap.isEnabled()).toBe(false);
  });

  it("resumes snapping once re-enabled", () => {
    const snap = new GridSnap(1);
    snap.setEnabled(false);
    snap.setEnabled(true);
    expect(snap.getSnap({ x: 1.5, y: 2.5 }, { floor })).toEqual({
      point: { x: 2, y: 3 },
      type: "grid",
    });
  });
});
