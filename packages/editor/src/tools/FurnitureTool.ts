import {
  createFurniture,
  isPointInPolygon,
  FURNITURE_PRESETS,
  isModelData,
  type Furniture,
} from "@indoor/core";
import { AddFurnitureCommand } from "../commands/FurnitureCommands.js";
import type { EditorTool, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

/** Reusable appearance only; placement always creates a fresh identity and space association. */
export type FurnitureTemplate = Pick<
  Furniture,
  "type" | "name" | "width" | "depth" | "height" | "rotation" | "modelData"
>;

export class FurnitureTool implements EditorTool {
  readonly id = "furniture";
  private template: FurnitureTemplate = { type: "desk" };

  getTemplate(): FurnitureTemplate {
    return { ...this.template };
  }

  setTemplate(template: FurnitureTemplate): void {
    if (!Object.hasOwn(FURNITURE_PRESETS, template.type)) throw new Error("Unknown furniture type");
    if (
      (template.type === "custom" || template.modelData !== undefined) &&
      !isModelData(template.modelData)
    )
      throw new Error("Invalid embedded GLB model");
    for (const key of ["width", "depth", "height", "rotation"] as const) {
      const value = template[key];
      if (value !== undefined && (!Number.isFinite(value) || (key !== "rotation" && value <= 0)))
        throw new Error(`Invalid furniture ${key}`);
    }
    const { type, name, width, depth, height, rotation, modelData } = template;
    this.template = {
      type,
      ...(name !== undefined ? { name } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(depth !== undefined ? { depth } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(modelData !== undefined ? { modelData } : {}),
    };
  }

  constructor(private readonly context: ToolContext) {}

  activate(): void {}
  deactivate(): void {}

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const point = this.context.snapping.resolve(event.worldPoint, { floor });
    const containingSpace = floor.spaces.find((space) => isPointInPolygon(point, space.polygon));

    const item = { ...createFurniture(floor.id, point, this.template.type), ...this.template };
    if (containingSpace) item.spaceId = containingSpace.id;

    this.context.executeCommand(new AddFurnitureCommand(floor, item));
    this.context.selection.select(item.id);
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
