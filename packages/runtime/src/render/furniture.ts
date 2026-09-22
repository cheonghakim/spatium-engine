import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FURNITURE_PRESETS, type Furniture } from "@indoor/core";

const positive = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

const WOOD = 0xb68b60;
const DARK_WOOD = 0x806047;
const FABRIC = 0x7893a0;
const CUSHION = 0x91aab5;
const LINEN = 0xeee9df;
const METAL = 0x454c53;

/** Detailed procedural furniture. All parts stay within the requested footprint and total height. */
export function buildFurnitureModel(item: Furniture): THREE.Group {
  const preset = FURNITURE_PRESETS[item.type];
  const w = positive(item.width, preset.width);
  const d = positive(item.depth, preset.depth);
  const h = positive(item.height, preset.height);
  const group = new THREE.Group();
  group.name = `furniture:${item.type}`;

  // Relative dimensions keep even very small or unusually proportioned items valid.
  const part = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    color: number,
    soft = false,
  ) => {
    const a = width * w,
      b = height * h,
      c = depth * d;
    const radius = Math.min(a, b, c) * (soft ? 0.22 : 0.08);
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(a, b, c, 2, radius),
      new THREE.MeshStandardMaterial({
        color,
        roughness: soft ? 0.95 : color === METAL ? 0.35 : 0.65,
        metalness: color === METAL ? 0.65 : 0,
      }),
    );
    mesh.name = name;
    mesh.position.set(x * w, y * h, z * d);
    group.add(mesh);
  };
  const feet = (height: number, color = METAL) => {
    for (const x of [-0.42, 0.42])
      for (const z of [-0.4, 0.4]) part("leg", 0.055, height, 0.065, x, height / 2, z, color);
  };

  switch (item.type) {
    case "custom":
      part("model-placeholder", 1, 1, 1, 0, 0.5, 0, 0x91aab5);
      break;
    case "desk":
    case "table":
    case "meeting-table": {
      feet(0.92);
      part("top", 1, 0.08, 1, 0, 0.96, 0, WOOD);
      for (const z of [-0.4, 0.4]) part("apron", 0.84, 0.09, 0.035, 0, 0.875, z, DARK_WOOD);
      if (item.type === "desk") {
        part("drawer-case", 0.3, 0.22, 0.78, 0.25, 0.81, 0, DARK_WOOD);
        part("drawer-front", 0.28, 0.18, 0.035, 0.25, 0.81, 0.405, WOOD);
        part("drawer-pull", 0.1, 0.025, 0.035, 0.25, 0.83, 0.44, METAL);
      }
      break;
    }
    case "chair":
      feet(0.47);
      part("seat-frame", 0.96, 0.05, 0.96, 0, 0.495, 0, DARK_WOOD);
      part("seat-cushion", 1, 0.08, 1, 0, 0.56, 0, CUSHION, true);
      for (const x of [-0.41, 0.41])
        part("back-support", 0.055, 0.43, 0.06, x, 0.735, -0.44, METAL);
      part("back-cushion", 0.94, 0.34, 0.13, 0, 0.83, -0.425, FABRIC, true);
      break;
    case "sofa":
      feet(0.13, DARK_WOOD);
      part("base", 0.98, 0.24, 0.96, 0, 0.25, 0, FABRIC, true);
      part("back", 1, 0.61, 0.18, 0, 0.695, -0.41, FABRIC, true);
      for (const x of [-0.445, 0.445]) part("arm", 0.11, 0.47, 0.98, x, 0.535, 0, FABRIC, true);
      for (const x of [-0.195, 0.195]) {
        part("seat-cushion", 0.375, 0.16, 0.76, x, 0.45, 0.08, CUSHION, true);
        part("back-cushion", 0.375, 0.38, 0.16, x, 0.73, -0.25, CUSHION, true);
      }
      break;
    case "cabinet":
      part("plinth", 0.9, 0.055, 0.85, 0, 0.0275, 0, DARK_WOOD);
      part("carcass", 1, 0.945, 0.9, 0, 0.5275, -0.05, DARK_WOOD);
      for (const x of [-0.247, 0.247]) {
        part("door", 0.482, 0.92, 0.06, x, 0.522, 0.43, WOOD);
        part("handle", 0.025, 0.1, 0.04, Math.sign(x) * 0.055, 0.52, 0.48, METAL);
      }
      break;
    case "bed":
      feet(0.12, DARK_WOOD);
      part("frame", 1, 0.28, 1, 0, 0.26, 0, DARK_WOOD);
      part("headboard", 1, 0.6, 0.055, 0, 0.7, -0.4725, WOOD);
      part("mattress", 0.94, 0.23, 0.91, 0, 0.515, 0.015, LINEN, true);
      part("duvet", 0.95, 0.09, 0.64, 0, 0.65, 0.155, FABRIC, true);
      part("fold", 0.95, 0.04, 0.12, 0, 0.715, -0.105, CUSHION, true);
      for (const x of [-0.235, 0.235]) part("pillow", 0.39, 0.12, 0.18, x, 0.69, -0.3, LINEN, true);
      break;
    case "office-chair":
      part("base-bar-x", 0.86, 0.04, 0.1, 0, 0.02, 0, METAL);
      part("base-bar-z", 0.1, 0.04, 0.86, 0, 0.02, 0, METAL);
      part("column", 0.08, 0.36, 0.08, 0, 0.22, 0, METAL);
      part("seat-frame", 0.86, 0.06, 0.86, 0, 0.43, 0, DARK_WOOD);
      part("seat-cushion", 1, 0.08, 0.9, 0, 0.5, 0, FABRIC, true);
      part("back-post", 0.05, 0.56, 0.05, 0, 0.72, -0.42, METAL);
      part("back-cushion", 0.8, 0.5, 0.1, 0, 0.75, -0.44, FABRIC, true);
      for (const x of [-0.42, 0.42]) part("armrest", 0.06, 0.05, 0.42, x, 0.56, 0.02, METAL);
      break;
    case "bookshelf":
      part("bottom", 0.96, 0.04, 0.96, 0, 0.02, 0, DARK_WOOD);
      part("top", 0.96, 0.04, 0.96, 0, 0.98, 0, DARK_WOOD);
      part("back-panel", 0.98, 0.92, 0.04, 0, 0.5, -0.47, DARK_WOOD);
      for (const x of [-0.48, 0.48]) part("side", 0.04, 0.92, 0.96, x, 0.5, 0, DARK_WOOD);
      for (const y of [0.26, 0.5, 0.74]) part("shelf", 0.88, 0.03, 0.88, 0, y, 0, WOOD);
      break;
    case "filing-cabinet": {
      part("base", 1, 0.06, 0.9, 0, 0.03, 0, DARK_WOOD);
      part("carcass", 1, 0.94, 0.9, 0, 0.53, 0, DARK_WOOD);
      for (const y of [0.2, 0.5, 0.8]) {
        part("drawer-front", 0.86, 0.26, 0.04, 0, y, 0.45, WOOD);
        part("handle", 0.3, 0.03, 0.02, 0, y, 0.47, METAL);
      }
      break;
    }
    case "partition":
      for (const x of [-0.48, 0.48]) part("frame-post", 0.04, 1, 1, x, 0.5, 0, METAL);
      part("frame-top", 0.96, 0.04, 1, 0, 0.98, 0, METAL);
      part("frame-bottom", 0.96, 0.04, 1, 0, 0.02, 0, METAL);
      part("panel", 0.9, 0.9, 0.6, 0, 0.5, 0, FABRIC, true);
      break;
    case "reception-desk":
      part("counter-front", 1, 1, 0.12, 0, 0.5, 0.44, DARK_WOOD);
      part("worktop", 0.98, 0.06, 0.9, 0, 0.63, -0.04, WOOD);
      for (const x of [-0.46, 0.46]) part("support", 0.06, 0.6, 0.86, x, 0.3, -0.04, DARK_WOOD);
      break;
  }
  return group;
}
