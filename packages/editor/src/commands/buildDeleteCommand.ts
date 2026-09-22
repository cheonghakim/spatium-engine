import type { Floor } from "@indoor/core";
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
 * Shared by SelectTool's Delete key and IndoorEditor.deleteSelection() (the
 * property panel's delete button) — one place decides what "delete X" means.
 */
export function buildDeleteCommand(
  floor: Floor,
  id: string,
  kind: SelectableKind,
  findNodeBuilding: (nodeId: string) => readonly Floor[] | undefined,
): Command {
  const commands: Command[] = [];

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
          commands.push(buildDeleteCommand(floor, memberId, memberKind, findNodeBuilding));
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
