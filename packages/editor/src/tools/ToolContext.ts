import type { Floor } from "@indoor/core";
import type { Command } from "../commands/Command.js";
import type { EditorCamera } from "../camera/EditorCamera.js";
import type { SelectionManager } from "../selection/SelectionManager.js";
import type { SnapManager } from "../snapping/SnapManager.js";

/**
 * What a tool is allowed to touch. Tools never reach into IndoorEditor
 * directly — they only see this narrow context, so new tools can't
 * accidentally depend on editor internals that aren't part of the contract.
 *
 * Tools mutate the project only via executeCommand — it runs the command
 * through history AND triggers a re-render, so a tool can never forget one
 * or the other. requestRender is for purely visual state (a draft polygon,
 * a camera pan) that isn't a domain change and has nothing to undo.
 */
export interface ToolContext {
  getActiveFloor(): Floor | undefined;
  readonly camera: EditorCamera;
  readonly selection: SelectionManager;
  readonly snapping: SnapManager;
  executeCommand(command: Command): void;
  requestRender(): void;
  /**
   * Every floor in the building that contains the navigation node with the
   * given id, or undefined if no such node exists anywhere in the project.
   * A cross-floor navigation link (see IndoorEditor.linkFloorNode) can store
   * its edge on either endpoint's floor, so cascading a node delete has to
   * search every floor of the owning building, not just the active one.
   */
  findNodeBuilding(nodeId: string): readonly Floor[] | undefined;
}
