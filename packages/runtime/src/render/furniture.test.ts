import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFurniture, FURNITURE_PRESETS, type FurnitureType } from "@indoor/core";
import { buildFurnitureModel } from "./furniture.js";

for (const type of Object.keys(FURNITURE_PRESETS) as FurnitureType[]) {
  describe(type, () => {
    for (const dimensions of [
      FURNITURE_PRESETS[type],
      { width: 0.01, depth: 0.02, height: 0.03 },
      { width: 4, depth: 0.3, height: 2 },
    ]) {
      it(`respects the footprint and total height at ${JSON.stringify(dimensions)}`, () => {
        const model = buildFurnitureModel({
          ...createFurniture("f", { x: 0, y: 0 }, type),
          ...dimensions,
        });
        const bounds = new THREE.Box3().setFromObject(model);
        expect(bounds.min.y).toBeCloseTo(0, 5);
        expect(bounds.max.y).toBeCloseTo(dimensions.height, 5);
        expect(bounds.min.x).toBeGreaterThanOrEqual(-dimensions.width / 2 - 1e-6);
        expect(bounds.max.x).toBeLessThanOrEqual(dimensions.width / 2 + 1e-6);
        expect(bounds.min.z).toBeGreaterThanOrEqual(-dimensions.depth / 2 - 1e-6);
        expect(bounds.max.z).toBeLessThanOrEqual(dimensions.depth / 2 + 1e-6);
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const name of ["position", "normal", "uv"]) {
            expect(
              Array.from(object.geometry.getAttribute(name).array).every(Number.isFinite),
            ).toBe(true);
          }
          object.geometry.dispose();
          object.material.dispose();
        });
      });
    }
    it("falls back to presets for invalid numeric dimensions", () => {
      const model = buildFurnitureModel({
        ...createFurniture("f", { x: 0, y: 0 }, type),
        width: -1,
        depth: NaN,
        height: Infinity,
      });
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(FURNITURE_PRESETS[type].width);
      expect(size.y).toBeCloseTo(FURNITURE_PRESETS[type].height);
    });
  });
}
