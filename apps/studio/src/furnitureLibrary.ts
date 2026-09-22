import { FURNITURE_PRESETS, isModelData, type Furniture, type FurnitureType } from "@indoor/core";
import type { FurnitureTemplate } from "@indoor/editor";

export const FURNITURE_LIBRARY_KEY = "spatium-studio:furniture-library:v1";
export interface SavedFurniture {
  id: string;
  label: string;
  template: FurnitureTemplate;
}

export function snapshotFurniture(item: Furniture, label: string): FurnitureTemplate {
  const preset = FURNITURE_PRESETS[item.type];
  return {
    type: item.type,
    name: label,
    width: item.width ?? preset.width,
    depth: item.depth ?? preset.depth,
    height: item.height ?? preset.height,
    rotation: item.rotation ?? 0,
    ...(item.modelData ? { modelData: item.modelData } : {}),
  };
}

export function readFurnitureLibrary(): SavedFurniture[] {
  const raw: unknown = JSON.parse(localStorage.getItem(FURNITURE_LIBRARY_KEY) ?? "[]");
  if (!Array.isArray(raw)) throw new Error("Invalid furniture library");
  const ids = new Set<string>();
  return raw
    .filter((entry): entry is SavedFurniture => {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        ids.has(entry.id) ||
        typeof entry.label !== "string" ||
        !entry.label.trim()
      )
        return false;
      const t = entry.template;
      if (!t || typeof t.type !== "string" || !Object.hasOwn(FURNITURE_PRESETS, t.type))
        return false;
      if (
        ["width", "height", "depth"].some(
          (key) => typeof t[key] !== "number" || !Number.isFinite(t[key]) || t[key] <= 0,
        )
      )
        return false;
      if (typeof t.rotation !== "number" || !Number.isFinite(t.rotation)) return false;
      if ((t.type === "custom" || t.modelData !== undefined) && !isModelData(t.modelData))
        return false;
      ids.add(entry.id);
      return true;
    })
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      template: {
        type: entry.template.type as FurnitureType,
        name: entry.label,
        width: entry.template.width!,
        depth: entry.template.depth!,
        height: entry.template.height!,
        rotation: entry.template.rotation!,
        ...(entry.template.modelData ? { modelData: entry.template.modelData } : {}),
      },
    }));
}

export function writeFurnitureLibrary(items: SavedFurniture[]): void {
  localStorage.setItem(FURNITURE_LIBRARY_KEY, JSON.stringify(items));
}
