import type { Building, Floor } from "@indoor/core";
import { connectorCleanupCommands } from "./ConnectorCommands.js";
import type { Command } from "./Command.js";
import { CompoundCommand } from "./CompoundCommand.js";
import { ChangePropertyCommand } from "./PropertyCommands.js";
import { DeleteSpaceCommand } from "./SpaceCommands.js";
import { DeleteEntranceCommand } from "./EntranceCommands.js";
import { DeletePOICommand } from "./POICommands.js";
import { DeleteFurnitureCommand } from "./FurnitureCommands.js";
import { DeleteGroupCommand } from "./GroupCommands.js";
import { DeleteWallCommand } from "./WallCommands.js";
import { DeleteNavigationNodeCommand, DeleteNavigationEdgeCommand } from "./NavigationCommands.js";
import { findObjectKind, type SelectableKind } from "../selection/findObjectKind.js";

/**
 * Deleting an object can leave dangling cross-references elsewhere (an
 * Entrance's spaceA/spaceB/wallId, a POI's spaceId, a NavigationEdge's
 * from/to) — bundle the primary delete with commands that clear/remove those
 * references so the whole thing undoes as one step.
 *
 * Entrance/POI/Wall references are only ever stored on the same floor as the
 * object they reference, so those cases only need to search `floor`'s own
 * arrays. A NavigationNode is different: IndoorEditor.linkFloorNode can store
 * a cross-floor edge on *either* endpoint's floor (whichever node was the
 * "source" when the link was created), so deleting a node has to search
 * every floor of the building that owns it via `findNodeBuilding`, not just
 * the active floor.
 *
 * Building connectors (elevators, stairs…) reference nodes and spaces by id
 * too; pass `findFloorBuilding` so their stops get cleaned up as well.
 *
 * Shared by SelectTool's Delete key and IndoorEditor.deleteSelection() (the
 * property panel's delete button) — one place decides what "delete X" means.
 */
export function buildDeleteCommand(
  floor: Floor,
  id: string,
  kind: SelectableKind,
  findNodeBuilding: (nodeId: string) => readonly Floor[] | undefined,
  findFloorBuilding?: (floorId: string) => Building | undefined,
): Command {
  const commands: Command[] = [];
  const building = findFloorBuilding?.(floor.id);

  if (kind === "space") {
    for (const entrance of floor.entrances) {
      if (entrance.spaceA === id)
        commands.push(
          new ChangePropertyCommand(entrance, "spaceA", undefined, "Clear Entrance Space"),
        );
      if (entrance.spaceB === id)
        commands.push(
          new ChangePropertyCommand(entrance, "spaceB", undefined, "Clear Entrance Space"),
        );
    }
    for (const poi of floor.pois) {
      if (poi.spaceId === id)
        commands.push(new ChangePropertyCommand(poi, "spaceId", undefined, "Clear POI Space"));
    }
    for (const item of floor.furniture) {
      if (item.spaceId === id)
        commands.push(
          new ChangePropertyCommand(item, "spaceId", undefined, "Clear Furniture Space"),
        );
    }
    commands.push(...connectorCleanupCommands(building, { spaceIds: new Set([id]) }));
    commands.push(new DeleteSpaceCommand(floor, id));
  } else if (kind === "wall") {
    for (const entrance of floor.entrances) {
      if (entrance.wallId === id)
        commands.push(
          new ChangePropertyCommand(entrance, "wallId", undefined, "Clear Entrance Wall"),
        );
    }
    commands.push(new DeleteWallCommand(floor, id));
  } else if (kind === "navigationNode") {
    const buildingFloors = findNodeBuilding(id) ?? [floor];
    for (const floorInBuilding of buildingFloors) {
      for (const edge of floorInBuilding.navigation.edges) {
        if (edge.from === id || edge.to === id)
          commands.push(new DeleteNavigationEdgeCommand(floorInBuilding, edge.id));
      }
    }
    commands.push(...connectorCleanupCommands(building, { nodeIds: new Set([id]) }));
    commands.push(new DeleteNavigationNodeCommand(floor, id));
  } else if (kind === "entrance") {
    commands.push(new DeleteEntranceCommand(floor, id));
  } else if (kind === "poi") {
    commands.push(new DeletePOICommand(floor, id));
  } else if (kind === "furniture") {
    commands.push(new DeleteFurnitureCommand(floor, id));
  } else if (kind === "group") {
    // Deleting a group deletes every member too (Figma/AutoCAD convention —
    // grouping doesn't protect from deletion; Ungroup is the separate action
    // that keeps members). Reusing buildDeleteCommand per member for free
    // picks up each member kind's own cross-reference cleanup; members are
    // never groups themselves (v1 groups don't nest), so this can't recurse.
    const group = floor.groups.find((g) => g.id === id);
    if (group) {
      for (const memberId of group.memberIds) {
        const memberKind = findObjectKind(floor, memberId);
        if (memberKind && memberKind !== "group") {
          commands.push(
            buildDeleteCommand(floor, memberId, memberKind, findNodeBuilding, findFloorBuilding),
          );
        }
      }
    }
    commands.push(new DeleteGroupCommand(floor, id));
  } else {
    commands.push(new DeleteNavigationEdgeCommand(floor, id));
  }

  return commands.length > 1 ? new CompoundCommand("Delete", commands) : commands[0]!;
}

/**
 * Strips `memberId` from every group that references it — used when a
 * single grouped object is deleted directly (not via deleting the whole
 * group, which handles its own members explicitly above). A group left with
 * ≤1 member afterward is dissolved outright rather than left as a
 * meaningless "group" of one.
 */
export function stripFromGroups(floor: Floor, memberId: string): Command[] {
  const commands: Command[] = [];
  for (const group of floor.groups) {
    if (!group.memberIds.includes(memberId)) continue;
    const remaining = group.memberIds.filter((m) => m !== memberId);
    if (remaining.length <= 1) {
      commands.push(new DeleteGroupCommand(floor, group.id));
    } else {
      commands.push(
        new ChangePropertyCommand(group, "memberIds", remaining, "Update Group Members"),
      );
    }
  }
  return commands;
}

/**
 * Deletes several objects as ONE undoable step (multi-selection Delete).
 *
 * Each object's delete is built lazily, only after the previous ones have
 * run: deleting a node already removes its edges, deleting a group already
 * removes its members, etc. Building every command up front against the
 * original state would make such overlaps delete the same object twice.
 * The first execute() records the concrete commands; redo replays them
 * against the identical state that undo restored.
 */
class DeleteManyCommand implements Command {
  readonly label = "Delete";
  private built: Command[] | null = null;

  constructor(
    private readonly floor: Floor,
    private readonly ids: readonly string[],
    private readonly findNodeBuilding: (nodeId: string) => readonly Floor[] | undefined,
    private readonly findFloorBuilding?: (floorId: string) => Building | undefined,
  ) {}

  execute(): void {
    if (this.built) {
      for (const command of this.built) command.execute();
      return;
    }
    this.built = [];
    for (const id of this.ids) {
      const kind = findObjectKind(this.floor, id);
      if (!kind) continue; // already removed by an earlier delete in this batch
      const commands = [
        buildDeleteCommand(this.floor, id, kind, this.findNodeBuilding, this.findFloorBuilding),
        ...(kind !== "group" ? stripFromGroups(this.floor, id) : []),
      ];
      for (const command of commands) {
        command.execute();
        this.built.push(command);
      }
    }
  }

  undo(): void {
    for (const command of [...(this.built ?? [])].reverse()) command.undo();
  }
}

/**
 * The single place that decides what Delete does for a selection (shared by
 * SelectTool's key handler and IndoorEditor.deleteSelection). Returns null
 * when nothing deletable is selected. Vertex entries are ignored here — a
 * lone selected vertex is handled by the callers' DeleteVertexCommand path.
 */
export function buildDeleteSelectionCommand(
  floor: Floor,
  ids: readonly string[],
  findNodeBuilding: (nodeId: string) => readonly Floor[] | undefined,
  findFloorBuilding?: (floorId: string) => Building | undefined,
): Command | null {
  const unique = [...new Set(ids)].filter((id) => findObjectKind(floor, id));
  if (unique.length === 0) return null;
  return new DeleteManyCommand(floor, unique, findNodeBuilding, findFloorBuilding);
}
