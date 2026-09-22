import type { Point } from "./common.js";

export type FurnitureType =
  | "desk"
  | "chair"
  | "sofa"
  | "table"
  | "cabinet"
  | "bed"
  | "meeting-table"
  | "office-chair"
  | "bookshelf"
  | "filing-cabinet"
  | "partition"
  | "reception-desk"
  | "custom";

export interface Furniture {
  id: string;
  floorId: string;

  position: Point;

  spaceId?: string;

  type: FurnitureType;
  name?: string;

  /** Optional — unset dimensions fall back to FURNITURE_PRESETS[type]. Meters. */
  width?: number;
  depth?: number;
  height?: number;
  /** Counterclockwise degrees in the plan, matching Entrance.rotation. */
  rotation?: number;
  /** Embedded GLB; travels with project JSON without external file dependencies. */
  modelData?: string;
}

export interface FurniturePreset {
  label: string;
  width: number;
  depth: number;
  height: number;
}

/** Default footprint/height for each furniture type — the "기본 모델" a user drops onto the floor before adjusting it. */
export const FURNITURE_PRESETS: Record<FurnitureType, FurniturePreset> = {
  desk: { label: "책상", width: 1.2, depth: 0.6, height: 0.75 },
  chair: { label: "의자", width: 0.5, depth: 0.5, height: 0.85 },
  sofa: { label: "소파", width: 1.8, depth: 0.85, height: 0.8 },
  table: { label: "테이블", width: 1.4, depth: 0.8, height: 0.75 },
  cabinet: { label: "수납장", width: 0.9, depth: 0.45, height: 1.8 },
  bed: { label: "침대", width: 1.5, depth: 2.0, height: 0.5 },
  "meeting-table": { label: "회의 테이블", width: 2.4, depth: 1.0, height: 0.75 },
  "office-chair": { label: "사무용 의자", width: 0.55, depth: 0.55, height: 1.05 },
  bookshelf: { label: "책장", width: 0.9, depth: 0.35, height: 2.0 },
  "filing-cabinet": { label: "서류 캐비닛", width: 0.45, depth: 0.6, height: 1.3 },
  partition: { label: "파티션", width: 1.2, depth: 0.06, height: 1.5 },
  "reception-desk": { label: "안내 데스크", width: 1.6, depth: 0.7, height: 1.1 },
  custom: { label: "사용자 모델", width: 1, depth: 1, height: 1 },
};

export const MAX_MODEL_BYTES = 2 * 1024 * 1024;
export const MODEL_DATA_PREFIX = "data:model/gltf-binary;base64,";
export function isModelData(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(MODEL_DATA_PREFIX)) return false;
  const payload = value.slice(MODEL_DATA_PREFIX.length);
  return (
    payload.length > 0 &&
    payload.length <= Math.ceil(MAX_MODEL_BYTES / 3) * 4 &&
    payload.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  );
}
