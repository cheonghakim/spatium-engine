import type {
  EditorKeyboardEvent,
  EditorPointerEvent,
  EditorTool,
} from "./EditorTool.js";

export class ToolManager {
  private tools = new Map<string, EditorTool>();
  private activeTool: EditorTool | null = null;

  register(tool: EditorTool): void {
    this.tools.set(tool.id, tool);
  }

  setActive(id: string): void {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Unknown tool: "${id}"`);
    if (tool === this.activeTool) return;

    this.activeTool?.deactivate();
    this.activeTool = tool;
    tool.activate();
  }

  get active(): EditorTool | null {
    return this.activeTool;
  }

  dispatchPointerDown(event: EditorPointerEvent): void {
    this.activeTool?.onPointerDown(event);
  }

  dispatchPointerMove(event: EditorPointerEvent): void {
    this.activeTool?.onPointerMove(event);
  }

  dispatchPointerUp(event: EditorPointerEvent): void {
    this.activeTool?.onPointerUp(event);
  }

  dispatchKeyDown(event: EditorKeyboardEvent): void {
    this.activeTool?.onKeyDown?.(event);
  }
}
