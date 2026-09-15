import type { CameraMode, RuntimeTheme } from "@indoor/runtime";
import type { EventActionRule } from "./actions.js";

export interface BuilderCameraConfig {
  mode: CameraMode;
  pan: boolean;
  zoom: boolean;
  rotate: boolean;
  initialCenter?: { x: number; y: number };
  initialZoom?: number;
}

export interface BuilderControlsConfig {
  floorSelector: boolean;
  cameraToggle: boolean;
}

/** Serializable output of the Interactive Builder (spec §29). Runtime consumes this as-is. */
export interface BuilderConfig {
  camera: BuilderCameraConfig;
  controls: BuilderControlsConfig;
  events: EventActionRule[];
  theme?: RuntimeTheme;
}
