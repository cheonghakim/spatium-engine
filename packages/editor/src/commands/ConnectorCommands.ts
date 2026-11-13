import type { Building, Connector, ConnectorStop } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddConnectorCommand implements Command {
  readonly label = "Add Connector";
  private createdArray = false;

  constructor(
    private readonly building: Building,
    private readonly connector: Connector,
  ) {}

  execute(): void {
    if (!this.building.connectors) {
      this.building.connectors = [];
      this.createdArray = true;
    }
    this.building.connectors.push(this.connector);
  }

  undo(): void {
    const list = this.building.connectors;
    if (!list) return;
    const index = list.findIndex((c) => c.id === this.connector.id);
    if (index !== -1) list.splice(index, 1);
    if (this.createdArray && list.length === 0) delete this.building.connectors;
  }
}

export class DeleteConnectorCommand implements Command {
  readonly label = "Delete Connector";
  private removedIndex = -1;
  private removed: Connector | undefined;

  constructor(
    private readonly building: Building,
    private readonly connectorId: string,
  ) {}

  execute(): void {
    const list = this.building.connectors ?? [];
    const index = list.findIndex((c) => c.id === this.connectorId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removed = list[index];
    list.splice(index, 1);
  }

  undo(): void {
    if (this.removed && this.removedIndex !== -1) {
      (this.building.connectors ??= []).splice(this.removedIndex, 0, this.removed);
    }
  }
}

export interface ConnectorReferenceRemoval {
  /** Navigation nodes being deleted: their stops are dropped. */
  nodeIds?: ReadonlySet<string>;
  /** Spaces being deleted: stops keep their node but lose the spaceId. */
  spaceIds?: ReadonlySet<string>;
  /** Floors being emptied or removed: every stop on them is dropped. */
  floorIds?: ReadonlySet<string>;
}

/**
 * Drops (or detaches) connector stops that reference removed nodes, spaces or
 * floors. The new stops are computed from the connectors' state **when the
 * command runs**, not when it's built: a compound delete (a group holding a
 * stop's node and its shaft space) runs several of these in sequence, and each
 * must build on the previous one's result instead of overwriting it.
 */
export class RemoveConnectorReferencesCommand implements Command {
  readonly label = "Update Connector Stops";
  private previous: Array<{ connector: Connector; stops: ConnectorStop[] }> = [];

  constructor(
    private readonly building: Building,
    private readonly removal: ConnectorReferenceRemoval,
  ) {}

  execute(): void {
    this.previous = [];
    const { nodeIds, spaceIds, floorIds } = this.removal;
    for (const connector of this.building.connectors ?? []) {
      let changed = false;
      const stops: ConnectorStop[] = [];
      for (const stop of connector.stops) {
        if (nodeIds?.has(stop.nodeId) || floorIds?.has(stop.floorId)) {
          changed = true;
          continue;
        }
        if (stop.spaceId !== undefined && spaceIds?.has(stop.spaceId)) {
          changed = true;
          stops.push({ floorId: stop.floorId, nodeId: stop.nodeId });
          continue;
        }
        stops.push(stop);
      }
      if (changed) {
        this.previous.push({ connector, stops: connector.stops });
        connector.stops = stops;
      }
    }
  }

  undo(): void {
    for (const { connector, stops } of [...this.previous].reverse()) connector.stops = stops;
    this.previous = [];
  }
}

/**
 * Commands that keep a building's connectors consistent when nodes, spaces
 * or floors go away, so a delete never leaves a stop pointing at nothing.
 * A connector left with fewer than two stops is kept (it's still being set
 * up, or the user re-adds a stop); validateProject flags it.
 */
export function connectorCleanupCommands(
  building: Building | undefined,
  removal: ConnectorReferenceRemoval,
): Command[] {
  return building?.connectors?.length
    ? [new RemoveConnectorReferencesCommand(building, removal)]
    : [];
}
