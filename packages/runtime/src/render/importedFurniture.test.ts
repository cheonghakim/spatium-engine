import { expect, it } from "vitest";
import * as THREE from "three";
import { createFurniture } from "@indoor/core";
import { testGLB } from "./importedFurniture.fixture.js";
import {
  importFurnitureGLB,
  loadFurnitureGLB,
  instanceFurnitureGLB,
  disposeImportedModel,
  validateGLB,
} from "./importedFurniture.js";

it("embeds a GLB and restores its materials, exact size and grounded origin", async () => {
  const asset = await importFurnitureGLB(testGLB());
  expect(asset).toMatchObject({ width: 2, height: 3, depth: 1 });
  const source = await loadFurnitureGLB(asset.modelData!);
  const item = { ...createFurniture("f", { x: 0, y: 0 }, "custom"), width: 4, depth: 2, height: 6 };
  const instance = instanceFurnitureGLB(source, item);
  const bounds = new THREE.Box3().setFromObject(instance);
  expect(bounds.min.toArray()).toEqual([-2, 0, -1]);
  expect(bounds.max.toArray()).toEqual([2, 6, 1]);
  const sourceMesh = source.getObjectByProperty("isMesh", true) as THREE.Mesh;
  const instanceMesh = instance.getObjectByProperty("isMesh", true) as THREE.Mesh;
  expect(instanceMesh.geometry).not.toBe(sourceMesh.geometry);
  expect(instanceMesh.material).not.toBe(sourceMesh.material);
  expect((instanceMesh.material as THREE.MeshStandardMaterial).color.r).toBeCloseTo(0.9);
  disposeImportedModel(instance);
  disposeImportedModel(source);
});

it("rejects damaged, oversized and externally dependent files", () => {
  expect(() => validateGLB(new ArrayBuffer(5))).toThrow();
  expect(() => validateGLB(new ArrayBuffer(2 * 1024 * 1024 + 1))).toThrow(/2 MB/);
  expect(() => validateGLB(testGLB(true))).toThrow(/GLB/);
  const corrupt = testGLB();
  new DataView(corrupt).setUint32(8, 12, true);
  expect(() => validateGLB(corrupt)).toThrow();
});
