import type { Point } from "@indoor/core";

/** Normalized pointer input — tools never see raw DOM PointerEvent. */
export interface EditorPointerEvent {
  screenPoint: Point;
  worldPoint: Point;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface EditorKeyboardEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface EditorTool {
  readonly id: string;

  onPointerDown(event: EditorPointerEvent): void;
  onPointerMove(event: EditorPointerEvent): void;
  onPointerUp(event: EditorPointerEvent): void;

  onKeyDown?(event: EditorKeyboardEvent): void;

  activate(): void;
  deactivate(): void;
}
