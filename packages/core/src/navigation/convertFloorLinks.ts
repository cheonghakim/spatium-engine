import type { ConnectorStop, ConnectorType } from "../types/connector.js";
import type { NavigationEdge, NavigationEdgeType } from "../types/navigation.js";
import type { Building } from "../types/project.js";

/** One connector to create from a set of hand-drawn cross-floor edges. */
export interface FloorLinkConversion {
  type: ConnectorType;
  /** Ordered from the lowest floor up. */
  stops: ConnectorStop[];
  accessible: boolean;
  /** Escalator travel direction, kept from one-way edges. Absent = both ways. */
  direction?: "up" | "down";
  /** The cross-floor edges this connector replaces, with the floor storing each. */
  edges: Array<{ floorId: string; edgeId: string }>;
}

export interface FloorLinkConversionPlan {
  conversions: FloorLinkConversion[];
  /**
   * Groups left alone: two stops on one floor, or one-way edges that a
   * connector can't express (anything but an escalator all going one way).
   */
  skipped: Array<{ nodeIds: string[]; reason: "multiple-nodes-on-floor" | "one-way-ambiguous" }>;
}

const CONNECTOR_TYPE: Record<NavigationEdgeType, ConnectorType> = {
  elevator: "elevator",
  stairs: "stairs",
  escalator: "escalator",
  walk: "ramp",
};

/**
 * Plans turning schema-1.0.0 style cross-floor edges (a stairs/elevator link
 * stored as an edge between nodes on different floors) into connectors.
 *
 * Edges of the same type that share nodes form one group (a 1F–2F–3F stair
 * chain becomes one stairs connector with three stops). A group that has two
 * nodes on the same floor is skipped: which one is "the" stop is a human call.
 * Pass `onlyNodeId` to plan just the group containing that node.
 *
 * Accessibility comes from the edges (all accessible → accessible), except
 * stairs, which are never marked accessible.
 *
 * Direction: a group whose edges are all one-way escalator edges running the
 * same way (all upward or all downward) becomes an escalator with that
 * `direction`. Any other mix of one-way edges is skipped — converting it to a
 * two-way connector would silently open a route the data forbids.
 */
export function planFloorLinkConversion(
  building: Building,
  onlyNodeId?: string,
): FloorLinkConversionPlan {
  const floorOf = new Map<string, { floorId: string; level: number; elevation: number }>();
  for (const floor of building.floors) {
    for (const node of floor.navigation.nodes) {
      floorOf.set(node.id, { floorId: floor.id, level: floor.level, elevation: floor.elevation });
    }
  }

  const crossFloor: Array<{ floorId: string; edge: NavigationEdge }> = [];
  for (const floor of building.floors) {
    for (const edge of floor.navigation.edges) {
      const a = floorOf.get(edge.from);
      const b = floorOf.get(edge.to);
      if (a && b && a.floorId !== b.floorId) crossFloor.push({ floorId: floor.id, edge });
    }
  }

  // Union-find over nodes, separately per edge type.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const key = (type: NavigationEdgeType, nodeId: string) => `${type}\u0000${nodeId}`;
  for (const { edge } of crossFloor) {
    const a = key(edge.type, edge.from);
    const b = key(edge.type, edge.to);
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }

  const groups = new Map<string, { type: NavigationEdgeType; items: typeof crossFloor }>();
  for (const item of crossFloor) {
    const root = find(key(item.edge.type, item.edge.from));
    const group = groups.get(root) ?? { type: item.edge.type, items: [] };
    group.items.push(item);
    groups.set(root, group);
  }

  const plan: FloorLinkConversionPlan = { conversions: [], skipped: [] };
  for (const { type, items } of groups.values()) {
    const nodeIds = [...new Set(items.flatMap(({ edge }) => [edge.from, edge.to]))];
    if (onlyNodeId && !nodeIds.includes(onlyNodeId)) continue;

    const floors = nodeIds.map((id) => floorOf.get(id)!);
    if (new Set(floors.map((f) => f.floorId)).size !== nodeIds.length) {
      plan.skipped.push({ nodeIds, reason: "multiple-nodes-on-floor" });
      continue;
    }
    const stops = nodeIds
      .map((nodeId, i) => ({ nodeId, ...floors[i]! }))
      .sort((a, b) => a.elevation - b.elevation || a.level - b.level)
      .map(({ nodeId, floorId }) => ({ floorId, nodeId }));
    const connectorType = CONNECTOR_TYPE[type];
    let direction: "up" | "down" | undefined;
    if (items.some(({ edge }) => edge.oneWay)) {
      const rank = (nodeId: string) => {
        const f = floorOf.get(nodeId)!;
        return [f.elevation, f.level] as const;
      };
      const goesUp = ({ edge }: (typeof items)[number]) => {
        const [ea, la] = rank(edge.from);
        const [eb, lb] = rank(edge.to);
        return eb > ea || (eb === ea && lb > la);
      };
      const allOneWay = items.every(({ edge }) => edge.oneWay);
      const ups = items.filter(goesUp).length;
      if (connectorType !== "escalator" || !allOneWay || (ups !== 0 && ups !== items.length)) {
        plan.skipped.push({ nodeIds, reason: "one-way-ambiguous" });
        continue;
      }
      direction = ups === items.length ? "up" : "down";
    }
    plan.conversions.push({
      type: connectorType,
      stops,
      accessible: connectorType !== "stairs" && items.every(({ edge }) => edge.accessible),
      ...(direction ? { direction } : {}),
      edges: items.map(({ floorId, edge }) => ({ floorId, edgeId: edge.id })),
    });
  }
  return plan;
}
