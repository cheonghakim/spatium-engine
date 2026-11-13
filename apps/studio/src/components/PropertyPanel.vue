<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  DEFAULT_CONNECTOR_TIMING,
  FURNITURE_PRESETS,
  polygonArea,
  spaceArea,
  validateProject,
  type Building,
  type Connector,
  type ConnectorSpec,
  type ConnectorType,
  type Entrance,
  type EntranceType,
  type Furniture,
  type FurnitureType,
  type Group,
  type NavigationEdge,
  type NavigationEdgeType,
  type NavigationNode,
  type NavigationNodeType,
  type POI,
  type POIType,
  type Space,
  type SpaceType,
  type Wall,
} from "@indoor/core";
import { ChangePropertyCommand, findObjectKind, type IndoorEditor } from "@indoor/editor";
import {
  mdiCircleMedium,
  mdiClockOutline,
  mdiDoorOpen,
  mdiFloorPlan,
  mdiMapMarkerOutline,
  mdiShieldAlertOutline,
  mdiShieldCheckOutline,
  mdiSofaOutline,
  mdiTrashCanOutline,
  mdiUngroup,
  mdiVectorCombine,
  mdiVectorLine,
  mdiVectorPoint,
  mdiVectorSquare,
  mdiWall,
} from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";
import NumberField from "./NumberField.vue";
import PropertyGroup from "./PropertyGroup.vue";
import SiteSettings from "./SiteSettings.vue";

const props = defineProps<{ editor: IndoorEditor; lastSavedAt?: number | null }>();

const revision = ref(0);
const now = ref(Date.now());
let unsubscribers: Array<() => void> = [];
let clock: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  unsubscribers = [
    props.editor.on("selectionChanged", () => revision.value++),
    props.editor.on("projectChanged", () => revision.value++),
    props.editor.on("floorChanged", () => revision.value++),
  ];
  clock = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
  if (clock !== null) clearInterval(clock);
});

const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  room: "방",
  store: "매장",
  corridor: "복도",
  lobby: "로비",
  stairs: "계단",
  elevator: "엘리베이터",
  restricted: "제한 구역",
  unknown: "미지정",
};
const SPACE_TYPES: SpaceType[] = [
  "room",
  "store",
  "corridor",
  "lobby",
  "stairs",
  "elevator",
  "restricted",
  "unknown",
];
const ENTRANCE_TYPES: EntranceType[] = [
  "door",
  "window",
  "opening",
  "stairs",
  "elevator",
  "escalator",
];
const ELEMENT_LABELS: Record<EntranceType, string> = {
  door: "문",
  window: "창문",
  opening: "개방 통로",
  stairs: "계단",
  elevator: "엘리베이터",
  escalator: "에스컬레이터",
};
const walls = computed(() => {
  revision.value;
  return props.editor.getActiveFloor()?.walls ?? [];
});
type DimensionKey =
  | "width"
  | "height"
  | "sillHeight"
  | "rotation"
  | "depth"
  | "stepCount"
  | "landingDepth"
  | "doorOpenAngle";
const dimensionFields = computed(() => {
  if (selected.value?.kind !== "entrance") return [];
  const type = selected.value.entrance.type;
  const stair = type === "stairs" || type === "escalator";
  const fields: Array<{
    key: DimensionKey;
    label: string;
    unit: string;
    default: number;
    min: number;
    max?: number;
    step: number;
  }> = [
    {
      key: "width",
      label: "폭",
      unit: "m",
      default: type === "door" || type === "opening" ? 0.9 : 1.2,
      min: 0.1,
      step: 0.1,
    },
    {
      key: "height",
      label: stair ? "오르는 높이" : "높이",
      unit: "m",
      default: stair ? 3 : type === "window" ? 1.2 : 2.1,
      min: 0.1,
      step: 0.1,
    },
    {
      key: "rotation",
      label: stair ? "오르는 방향" : "방향",
      unit: "°",
      default: 0,
      min: -360,
      step: 15,
    },
  ];
  if (type === "window")
    fields.push({
      key: "sillHeight",
      label: "창문 하단 높이",
      unit: "m",
      default: 0.9,
      min: 0,
      step: 0.1,
    });
  if (type === "door")
    fields.push({
      key: "doorOpenAngle",
      label: "문 열림 각도",
      unit: "°",
      default: 35,
      min: -180,
      max: 180,
      step: 5,
    });
  if (stair || type === "elevator")
    fields.push({ key: "depth", label: "깊이", unit: "m", default: 4, min: 0.1, step: 0.1 });
  if (stair)
    fields.push(
      {
        key: "stepCount",
        label: "계단 단수",
        unit: "단",
        default: Math.ceil((selected.value.entrance.height ?? 3) / 0.18),
        min: 2,
        max: 200,
        step: 1,
      },
      {
        key: "landingDepth",
        label: "상부 계단참 깊이",
        unit: "m",
        default: 0.8,
        min: 0,
        step: 0.1,
      },
    );
  return fields;
});
function onDimension(key: DimensionKey, value: number): void {
  if (selected.value?.kind !== "entrance") return;
  const finalValue = key === "stepCount" ? Math.round(value) : value;
  commitField(selected.value.entrance, key, finalValue);
}
function onWallHeight(value: number): void {
  if (selected.value?.kind === "wall") commitField(selected.value.wall, "height", value);
}
function onStairSpace(key: "stairDirection" | "stairSteps", value: number): void {
  if (selected.value?.kind !== "space") return;
  commitField(selected.value.space, key, key === "stairSteps" ? Math.round(value) : value);
}
function onHostWall(event: Event): void {
  if (selected.value?.kind !== "entrance") return;
  commitField(
    selected.value.entrance,
    "wallId",
    (event.target as HTMLSelectElement).value || undefined,
  );
}
function onElementPosition(axis: "x" | "y", value: number): void {
  if (selected.value?.kind !== "entrance") return;
  commitField(selected.value.entrance, "position", {
    ...selected.value.entrance.position,
    [axis]: value,
  });
}
const POI_TYPE_LABELS: Record<POIType, string> = {
  store: "매장",
  restroom: "화장실",
  elevator: "엘리베이터",
  stairs: "계단",
  information: "안내소",
  exit: "출구",
  custom: "기타",
};
const POI_TYPES: POIType[] = [
  "store",
  "restroom",
  "elevator",
  "stairs",
  "information",
  "exit",
  "custom",
];
const NAV_NODE_TYPES: NavigationNodeType[] = [
  "normal",
  "junction",
  "entrance",
  "stairs",
  "elevator",
];
const NAV_EDGE_TYPES: NavigationEdgeType[] = ["walk", "stairs", "elevator", "escalator"];
const NAV_EDGE_TYPE_LABELS: Record<NavigationEdgeType, string> = {
  walk: "보행",
  stairs: "계단",
  elevator: "엘리베이터",
  escalator: "에스컬레이터",
};
const NAV_NODE_TYPE_LABELS: Record<NavigationNodeType, string> = {
  normal: "일반",
  junction: "분기점",
  entrance: "출입구",
  stairs: "계단",
  elevator: "엘리베이터",
};
/** Node types that represent a vertical connector and can be linked across floors. */
const CROSS_FLOOR_NODE_TYPES: NavigationNodeType[] = ["stairs", "elevator"];

/**
 * Finds the id of the node on a *different* floor of `building` that `nodeId`
 * is currently linked to via a cross-floor navigation edge, if any. Mirrors
 * IndoorEditor's private findCrossFloorEdge (not exported), since a node can
 * have at most one cross-floor link by linkFloorNode's own convention.
 */
function findLinkedCrossFloorNodeId(
  building: Building,
  sourceFloorId: string,
  nodeId: string,
): string | null {
  for (const floor of building.floors) {
    for (const edge of floor.navigation.edges) {
      if (edge.from !== nodeId && edge.to !== nodeId) continue;
      const otherId = edge.from === nodeId ? edge.to : edge.from;
      const otherFloor = building.floors.find((f) =>
        f.navigation.nodes.some((n) => n.id === otherId),
      );
      if (otherFloor && otherFloor.id !== sourceFloorId) return otherId;
    }
  }
  return null;
}

type Selected =
  | { kind: "space"; space: Space }
  | { kind: "wall"; wall: Wall }
  | { kind: "entrance"; entrance: Entrance }
  | { kind: "poi"; poi: POI }
  | { kind: "furniture"; furniture: Furniture }
  | { kind: "group"; group: Group }
  | { kind: "navigationNode"; node: NavigationNode }
  | { kind: "navigationEdge"; edge: NavigationEdge }
  | { kind: "vertex"; space: Space; vertexIndex: number }
  | null;

const selected = computed<Selected>(() => {
  revision.value;
  const floor = props.editor.getActiveFloor();
  if (!floor) return null;
  const entry = props.editor.selection.current[0];
  if (!entry) return null;

  if (entry.vertexIndex !== undefined) {
    const space = floor.spaces.find((s) => s.id === entry.id);
    return space ? { kind: "vertex", space, vertexIndex: entry.vertexIndex } : null;
  }

  const kind = findObjectKind(floor, entry.id);
  if (kind === "space") {
    const space = floor.spaces.find((s) => s.id === entry.id);
    return space ? { kind, space } : null;
  }
  if (kind === "wall") {
    const wall = floor.walls.find((w) => w.id === entry.id);
    return wall ? { kind, wall } : null;
  }
  if (kind === "entrance") {
    const entrance = floor.entrances.find((e) => e.id === entry.id);
    return entrance ? { kind, entrance } : null;
  }
  if (kind === "poi") {
    const poi = floor.pois.find((p) => p.id === entry.id);
    return poi ? { kind, poi } : null;
  }
  if (kind === "furniture") {
    const furniture = floor.furniture.find((f) => f.id === entry.id);
    return furniture ? { kind, furniture } : null;
  }
  if (kind === "group") {
    const group = floor.groups.find((g) => g.id === entry.id);
    return group ? { kind, group } : null;
  }
  if (kind === "navigationNode") {
    const node = floor.navigation.nodes.find((n) => n.id === entry.id);
    return node ? { kind, node } : null;
  }
  if (kind === "navigationEdge") {
    const edge = floor.navigation.edges.find((e) => e.id === entry.id);
    return edge ? { kind, edge } : null;
  }
  return null;
});

const SELECTION_META: Record<NonNullable<Selected>["kind"], { icon: string; label: string }> = {
  space: { icon: mdiVectorSquare, label: "공간" },
  wall: { icon: mdiWall, label: "벽" },
  entrance: { icon: mdiDoorOpen, label: "출입구" },
  poi: { icon: mdiMapMarkerOutline, label: "관심 지점" },
  furniture: { icon: mdiSofaOutline, label: "가구" },
  group: { icon: mdiVectorCombine, label: "그룹" },
  navigationNode: { icon: mdiCircleMedium, label: "내비게이션 노드" },
  navigationEdge: { icon: mdiVectorLine, label: "내비게이션 경로" },
  vertex: { icon: mdiVectorPoint, label: "정점" },
};
const selectionMeta = computed(() => (selected.value ? SELECTION_META[selected.value.kind] : null));
function objectId(): string {
  const sel = selected.value;
  if (!sel) return "";
  switch (sel.kind) {
    case "space":
    case "vertex":
      return sel.space.id.slice(0, 8);
    case "wall":
      return sel.wall.id.slice(0, 8);
    case "entrance":
      return sel.entrance.id.slice(0, 8);
    case "poi":
      return sel.poi.id.slice(0, 8);
    case "furniture":
      return sel.furniture.id.slice(0, 8);
    case "group":
      return sel.group.id.slice(0, 8);
    case "navigationNode":
      return sel.node.id.slice(0, 8);
    case "navigationEdge":
      return sel.edge.id.slice(0, 8);
  }
}

function spaceName(spaceId: string | undefined): string {
  if (!spaceId) return "—";
  const floor = props.editor.getActiveFloor();
  const space = floor?.spaces.find((s) => s.id === spaceId);
  return space?.properties.name ?? space?.id.slice(0, 8) ?? "—";
}

function commitField<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (target[key] === value) return;
  props.editor.executeCommand(
    new ChangePropertyCommand(target, key, value, `Change ${String(key)}`),
  );
}

function onSpaceName(evt: Event): void {
  if (selected.value?.kind !== "space") return;
  commitField(
    selected.value.space.properties,
    "name",
    (evt.target as HTMLInputElement).value || undefined,
  );
}
function onSpaceCategory(evt: Event): void {
  if (selected.value?.kind !== "space") return;
  commitField(
    selected.value.space.properties,
    "category",
    (evt.target as HTMLInputElement).value || undefined,
  );
}
function onSpaceType(evt: Event): void {
  if (selected.value?.kind !== "space") return;
  commitField(selected.value.space, "type", (evt.target as HTMLSelectElement).value as SpaceType);
}
function onSpaceHeight(value: number): void {
  if (selected.value?.kind === "space") commitField(selected.value.space, "height", value);
}

function onWallThickness(value: number): void {
  if (selected.value?.kind === "wall") commitField(selected.value.wall, "thickness", value);
}

function onEntranceType(evt: Event): void {
  if (selected.value?.kind !== "entrance") return;
  commitField(
    selected.value.entrance,
    "type",
    (evt.target as HTMLSelectElement).value as EntranceType,
  );
}

function onPoiName(evt: Event): void {
  if (selected.value?.kind !== "poi") return;
  commitField(selected.value.poi, "name", (evt.target as HTMLInputElement).value);
}
function onPoiType(evt: Event): void {
  if (selected.value?.kind !== "poi") return;
  commitField(selected.value.poi, "type", (evt.target as HTMLSelectElement).value as POIType);
}

const FURNITURE_TYPES = (Object.keys(FURNITURE_PRESETS) as FurnitureType[]).filter(
  (type) => type !== "custom",
);

function onFurnitureName(evt: Event): void {
  if (selected.value?.kind !== "furniture") return;
  commitField(
    selected.value.furniture,
    "name",
    (evt.target as HTMLInputElement).value || undefined,
  );
}
function onFurnitureType(evt: Event): void {
  if (selected.value?.kind !== "furniture") return;
  commitField(
    selected.value.furniture,
    "type",
    (evt.target as HTMLSelectElement).value as FurnitureType,
  );
}
function onFurniturePosition(axis: "x" | "y", value: number): void {
  if (selected.value?.kind !== "furniture") return;
  commitField(selected.value.furniture, "position", {
    ...selected.value.furniture.position,
    [axis]: value,
  });
}
function onFurnitureDimension(key: "width" | "depth" | "height", value: number): void {
  if (selected.value?.kind !== "furniture") return;
  commitField(selected.value.furniture, key, value);
}
function onFurnitureRotation(value: number): void {
  if (selected.value?.kind !== "furniture") return;
  commitField(selected.value.furniture, "rotation", value);
}

function onGroupLabel(evt: Event): void {
  if (selected.value?.kind !== "group") return;
  const label = (evt.target as HTMLInputElement).value.trim();
  if (label) commitField(selected.value.group, "label", label);
}
function ungroupSelectedGroup(): void {
  props.editor.ungroupSelection();
}
const selectionCount = computed(() => {
  revision.value;
  return props.editor.selection.current.length;
});
function deleteSelected(): void {
  props.editor.deleteSelection();
}

/** A short, human-readable summary per member — falls back to the kind label when the object has no name of its own (walls, edges) or was deleted without the group being cleaned up yet. */
const groupMembers = computed(() => {
  revision.value;
  if (selected.value?.kind !== "group") return [];
  const floor = props.editor.getActiveFloor();
  if (!floor) return [];
  return selected.value.group.memberIds.map((id) => {
    const kind = findObjectKind(floor, id);
    if (!kind || kind === "group") return { id, icon: mdiVectorPoint, label: "(삭제됨)" };
    const meta = SELECTION_META[kind];
    const name =
      floor.spaces.find((s) => s.id === id)?.properties.name ??
      floor.pois.find((p) => p.id === id)?.name ??
      floor.furniture.find((f) => f.id === id)?.name ??
      floor.navigation.nodes.find((n) => n.id === id)?.name;
    return { id, icon: meta.icon, label: name ?? meta.label };
  });
});

function onNavNodeType(evt: Event): void {
  if (selected.value?.kind !== "navigationNode") return;
  commitField(
    selected.value.node,
    "type",
    (evt.target as HTMLSelectElement).value as NavigationNodeType,
  );
}
function onNavNodeName(evt: Event): void {
  if (selected.value?.kind !== "navigationNode") return;
  commitField(selected.value.node, "name", (evt.target as HTMLInputElement).value || undefined);
}

/** Prefers the node's own name (if set) over its type + id fragment — the whole point being that a random id fragment alone isn't recognizable anywhere this label is shown. */
function navNodeLabel(node: NavigationNode): string {
  return node.name?.trim() || `${NAV_NODE_TYPE_LABELS[node.type]} (${node.id.slice(0, 6)})`;
}

// The owning Building, found the same way App.vue's syncHistoryState locates
// the active floor's building — by scanning for the building whose floors
// include the current active floor.
const owningBuilding = computed<Building | undefined>(() => {
  revision.value;
  const floor = props.editor.getActiveFloor();
  if (!floor) return undefined;
  return props.editor.project.buildings.find((b) => b.floors.some((f) => f.id === floor.id));
});

const crossFloorNodeOptions = computed(() => {
  revision.value;
  if (selected.value?.kind !== "navigationNode") return [];
  const building = owningBuilding.value;
  const floor = props.editor.getActiveFloor();
  if (!building || !floor) return [];
  const options: Array<{ id: string; label: string }> = [];
  for (const otherFloor of building.floors) {
    if (otherFloor.id === floor.id) continue;
    for (const node of otherFloor.navigation.nodes) {
      options.push({ id: node.id, label: `${otherFloor.name} · ${navNodeLabel(node)}` });
    }
  }
  return options;
});

const linkedCrossFloorNodeId = computed(() => {
  revision.value;
  if (selected.value?.kind !== "navigationNode") return null;
  const building = owningBuilding.value;
  const floor = props.editor.getActiveFloor();
  if (!building || !floor) return null;
  return findLinkedCrossFloorNodeId(building, floor.id, selected.value.node.id);
});

function onLinkFloorNode(evt: Event): void {
  if (selected.value?.kind !== "navigationNode") return;
  const value = (evt.target as HTMLSelectElement).value;
  props.editor.linkFloorNode(
    selected.value.node.id,
    value || null,
    selected.value.node.type as NavigationEdgeType,
  );
}

// ---- Vertical connectors (elevator/stairs/escalator/ramp) at the selected node ----
const CONNECTOR_TYPES: ConnectorType[] = ["elevator", "stairs", "escalator", "ramp"];
const CONNECTOR_TYPE_LABELS: Record<ConnectorType, string> = {
  elevator: "엘리베이터",
  stairs: "계단",
  escalator: "에스컬레이터",
  ramp: "경사로",
};
const SPEC_FIELDS: Array<{ key: keyof ConnectorSpec; label: string; unit: string }> = [
  { key: "speed", label: "속도", unit: "m/s" },
  { key: "averageWait", label: "평균 대기", unit: "초" },
  { key: "boardingTime", label: "승하차", unit: "초" },
  { key: "capacity", label: "정원", unit: "명" },
];
const newConnectorType = ref<ConnectorType>("elevator");

const nodeConnectors = computed<Connector[]>(() => {
  revision.value;
  if (selected.value?.kind !== "navigationNode") return [];
  return props.editor.connectorsAtNode(selected.value.node.id).map((c) => c.connector);
});

function connectorStopRows(connector: Connector) {
  revision.value;
  const building = props.editor.findConnector(connector.id)?.building;
  return connector.stops
    .map((stop) => {
      const floor = building?.floors.find((f) => f.id === stop.floorId);
      const node = floor?.navigation.nodes.find((n) => n.id === stop.nodeId);
      return {
        nodeId: stop.nodeId,
        label: `${floor?.name ?? "삭제된 층"} · ${node ? navNodeLabel(node) : "삭제된 노드"}`,
        level: floor?.level ?? 0,
      };
    })
    .sort((a, b) => a.level - b.level);
}

/** Nodes on floors this connector doesn't stop at yet. */
function connectorStopOptions(connector: Connector) {
  revision.value;
  const building = props.editor.findConnector(connector.id)?.building;
  if (!building) return [];
  const served = new Set(connector.stops.map((s) => s.floorId));
  const options: Array<{ id: string; label: string }> = [];
  for (const floor of building.floors) {
    if (served.has(floor.id)) continue;
    for (const node of floor.navigation.nodes) {
      options.push({ id: node.id, label: `${floor.name} · ${navNodeLabel(node)}` });
    }
  }
  return options;
}

function specPlaceholder(connector: Connector, key: keyof ConnectorSpec): string {
  if (key === "capacity") return "선택";
  if (connector.type === "ramp" && key === "speed") return "기본: 보행 속도";
  return `기본 ${DEFAULT_CONNECTOR_TIMING[connector.type][key]}`;
}

function createConnectorHere(): void {
  if (selected.value?.kind !== "navigationNode") return;
  const node = selected.value.node;
  props.editor.createConnectorAtNode(node.id, newConnectorType.value, node.name || undefined);
}
function onConnectorName(connector: Connector, evt: Event): void {
  props.editor.updateConnector(
    connector.id,
    "name",
    (evt.target as HTMLInputElement).value.trim() || undefined,
  );
}
function onConnectorType(connector: Connector, evt: Event): void {
  const type = (evt.target as HTMLSelectElement).value as ConnectorType;
  props.editor.updateConnector(connector.id, "type", type);
  if (type !== "escalator" && connector.direction) {
    props.editor.updateConnector(connector.id, "direction", undefined);
  }
}
function onConnectorAccessible(connector: Connector, evt: Event): void {
  props.editor.updateConnector(
    connector.id,
    "accessible",
    (evt.target as HTMLInputElement).checked,
  );
}
function onConnectorDirection(connector: Connector, evt: Event): void {
  const value = (evt.target as HTMLSelectElement).value;
  props.editor.updateConnector(
    connector.id,
    "direction",
    value === "up" || value === "down" ? value : undefined,
  );
}
function onConnectorSpec(connector: Connector, key: keyof ConnectorSpec, evt: Event): void {
  const raw = (evt.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  const spec: ConnectorSpec = { ...connector.spec };
  if (!raw || !Number.isFinite(value) || value < 0) delete spec[key];
  else spec[key] = value;
  props.editor.updateConnector(connector.id, "spec", Object.keys(spec).length ? spec : undefined);
}
function onAddConnectorStop(connector: Connector, evt: Event): void {
  const select = evt.target as HTMLSelectElement;
  if (select.value) props.editor.addConnectorStop(connector.id, select.value);
  select.value = "";
}
function removeConnectorStop(connector: Connector, nodeId: string): void {
  props.editor.removeConnectorStop(connector.id, nodeId);
}
function deleteConnector(connector: Connector): void {
  props.editor.deleteConnector(connector.id);
}

// ---- Site view: outdoor node ↔ building node links ----
const inSiteView = computed(() => {
  revision.value;
  return props.editor.isSiteView();
});
const siteLinks = computed(() => {
  revision.value;
  if (selected.value?.kind !== "navigationNode" || !inSiteView.value) return [];
  const targets = new Map(props.editor.siteLinkTargets().map((t) => [t.nodeId, t.label]));
  return props.editor
    .siteLinksOf(selected.value.node.id)
    .map((link) => ({ ...link, label: targets.get(link.nodeId) ?? "삭제된 노드" }));
});
/** Entrances first: those are what outdoor paths normally attach to. */
const siteLinkOptions = computed(() => {
  revision.value;
  if (!inSiteView.value) return [];
  const linked = new Set(siteLinks.value.map((l) => l.nodeId));
  return props.editor
    .siteLinkTargets()
    .filter((t) => !linked.has(t.nodeId))
    .sort((a, b) => Number(b.type === "entrance") - Number(a.type === "entrance"));
});
function onAddSiteLink(evt: Event): void {
  const select = evt.target as HTMLSelectElement;
  if (selected.value?.kind === "navigationNode" && select.value) {
    props.editor.linkSiteNode(selected.value.node.id, select.value);
  }
  select.value = "";
}
function removeSiteLink(edgeId: string): void {
  props.editor.removeSiteEdge(edgeId);
}

// ---- Holes of the selected space ----
const spaceHoles = computed(() => {
  revision.value;
  if (selected.value?.kind !== "space") return [];
  return (selected.value.space.holes ?? []).map((hole, index) => ({
    index,
    vertices: hole.length,
    area: Math.abs(polygonArea(hole)),
  }));
});
const spaceNetArea = computed(() => {
  revision.value;
  return selected.value?.kind === "space" ? spaceArea(selected.value.space) : 0;
});
function removeHole(index: number): void {
  if (selected.value?.kind === "space") props.editor.removeHole(selected.value.space.id, index);
}

// ---- Hand-drawn floor link → connector ----
const conversionMessage = ref("");
function convertLinkToConnector(): void {
  if (selected.value?.kind !== "navigationNode") return;
  const { created, reasons } = props.editor.convertFloorLinksToConnectors(selected.value.node.id);
  conversionMessage.value = created
    ? ""
    : reasons.includes("one-way-ambiguous")
      ? "일방통행 방향이 섞여 있거나 에스컬레이터가 아닌 일방통행 연결이라 자동 변환하지 않았습니다. 설비를 직접 만들어 방향을 지정하세요."
      : reasons.includes("multiple-nodes-on-floor")
        ? "같은 층에 연결된 노드가 둘 이상이라 자동 변환할 수 없습니다. 설비를 직접 만들어 주세요."
        : "변환할 층간 연결이 없습니다.";
}

function onNavEdgeType(evt: Event): void {
  if (selected.value?.kind !== "navigationEdge") return;
  commitField(
    selected.value.edge,
    "type",
    (evt.target as HTMLSelectElement).value as NavigationEdgeType,
  );
}
function onNavEdgeDistance(value: number): void {
  if (selected.value?.kind === "navigationEdge")
    commitField(selected.value.edge, "distance", value);
}
function onNavEdgeAccessible(evt: Event): void {
  if (selected.value?.kind !== "navigationEdge") return;
  commitField(selected.value.edge, "accessible", (evt.target as HTMLInputElement).checked);
}

// ---- Empty-state summary: floor, object counts, save status, validation ----
const activeFloor = computed(() => {
  revision.value;
  return props.editor.getActiveFloor();
});
const floorStats = computed(() => {
  const floor = activeFloor.value;
  if (!floor) return null;
  return {
    spaces: floor.spaces.length,
    walls: floor.walls.length,
    entrances: floor.entrances.length,
    pois: floor.pois.length,
    furniture: floor.furniture.length,
    navNodes: floor.navigation.nodes.length,
  };
});
const validationSummary = computed(() => {
  revision.value;
  const issues = validateProject(props.editor.project);
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
});
const lastSavedLabel = computed(() => {
  now.value;
  if (!props.lastSavedAt) return "아직 저장되지 않음";
  const seconds = Math.round((now.value - props.lastSavedAt) / 1000);
  if (seconds < 5) return "방금 저장됨";
  if (seconds < 60) return `${seconds}초 전 자동 저장됨`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전 자동 저장됨`;
  return "저장된 지 오래됨";
});
</script>

<template>
  <div class="property-panel">
    <template v-if="!selected">
      <h3 class="panel-heading">속성</h3>
      <p class="empty-hint">캔버스에서 객체를 선택하면 속성을 편집할 수 있습니다.</p>

      <div class="summary-card">
        <div class="summary-row">
          <MdiIcon :path="mdiFloorPlan" :size="15" />
          <span class="summary-label">현재 층</span>
          <span class="summary-value">{{ activeFloor?.name ?? "—" }}</span>
        </div>
        <dl v-if="floorStats" class="stat-grid">
          <div class="stat">
            <dt>공간</dt>
            <dd>{{ floorStats.spaces }}</dd>
          </div>
          <div class="stat">
            <dt>벽</dt>
            <dd>{{ floorStats.walls }}</dd>
          </div>
          <div class="stat">
            <dt>출입구</dt>
            <dd>{{ floorStats.entrances }}</dd>
          </div>
          <div class="stat">
            <dt>POI</dt>
            <dd>{{ floorStats.pois }}</dd>
          </div>
          <div class="stat">
            <dt>가구</dt>
            <dd>{{ floorStats.furniture }}</dd>
          </div>
          <div class="stat">
            <dt>노드</dt>
            <dd>{{ floorStats.navNodes }}</dd>
          </div>
        </dl>
      </div>

      <div class="summary-card">
        <div class="summary-row">
          <MdiIcon :path="mdiClockOutline" :size="15" />
          <span class="summary-label">저장 상태</span>
        </div>
        <p class="summary-detail">
          {{ lastSavedLabel }}
        </p>
      </div>

      <div class="summary-card">
        <div class="summary-row">
          <MdiIcon
            :path="validationSummary.errors > 0 ? mdiShieldAlertOutline : mdiShieldCheckOutline"
            :size="15"
            :class="validationSummary.errors > 0 ? 'icon-danger' : 'icon-success'"
          />
          <span class="summary-label">검증 요약</span>
        </div>
        <p
          v-if="validationSummary.errors === 0 && validationSummary.warnings === 0"
          class="summary-detail success"
        >
          발견된 문제가 없습니다.
        </p>
        <p v-else class="summary-detail">
          <span v-if="validationSummary.errors" class="tag danger"
            >오류 {{ validationSummary.errors }}</span
          >
          <span v-if="validationSummary.warnings" class="tag warning"
            >경고 {{ validationSummary.warnings }}</span
          >
          <span class="hint-inline">하단 검증 바에서 자세히 확인하세요.</span>
        </p>
      </div>

      <PropertyGroup title="단지 · 지리 좌표" :default-open="false">
        <SiteSettings :editor="editor" />
      </PropertyGroup>
    </template>

    <template v-else>
      <div class="selection-header">
        <span class="selection-icon"><MdiIcon :path="selectionMeta!.icon" :size="16" /></span>
        <div class="selection-title">
          <strong
            >{{ selectionMeta!.label
            }}<template v-if="selectionCount > 1"> 외 {{ selectionCount - 1 }}개</template></strong
          >
          <span class="selection-id">#{{ objectId() }}</span>
        </div>
        <span class="autosave-note" title="변경 사항은 즉시 적용되고 자동 저장됩니다"
          >즉시 적용</span
        >
        <button
          class="btn-ghost btn-icon danger-ghost delete-selection-button"
          :title="
            selectionCount > 1
              ? `선택한 ${selectionCount}개 모두 삭제 (Delete)`
              : '선택 항목 삭제 (Delete)'
          "
          aria-label="선택 항목 삭제"
          @click="deleteSelected"
        >
          <MdiIcon :path="mdiTrashCanOutline" :size="15" />
        </button>
      </div>

      <template v-if="selected.kind === 'space'">
        <PropertyGroup title="기본 정보">
          <label class="field">
            <span class="field-label">이름</span>
            <input
              type="text"
              :value="selected.space.properties.name ?? ''"
              @change="onSpaceName"
            />
          </label>
          <label class="field">
            <span class="field-label">타입</span>
            <select :value="selected.space.type" @change="onSpaceType">
              <option v-for="type in SPACE_TYPES" :key="type" :value="type">
                {{ SPACE_TYPE_LABELS[type] }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">카테고리</span>
            <input
              type="text"
              :value="selected.space.properties.category ?? ''"
              @change="onSpaceCategory"
            />
          </label>
        </PropertyGroup>
        <PropertyGroup title="위치 및 크기">
          <NumberField
            label="높이"
            unit="m"
            :min="0"
            :step="0.1"
            :model-value="selected.space.height"
            @change="onSpaceHeight"
          />
          <template v-if="selected.space.type === 'stairs'">
            <NumberField
              label="오르는 방향"
              unit="°"
              :step="15"
              :model-value="selected.space.stairDirection ?? 0"
              @change="onStairSpace('stairDirection', $event)"
            />
            <NumberField
              label="계단 단수"
              unit="단"
              :min="2"
              :max="200"
              :step="1"
              :model-value="selected.space.stairSteps ?? Math.ceil(selected.space.height / 0.18)"
              @change="onStairSpace('stairSteps', $event)"
            />
          </template>
        </PropertyGroup>
        <PropertyGroup title="구멍 (기둥·보이드)" :default-open="spaceHoles.length > 0">
          <p class="readonly-field">순면적 {{ spaceNetArea.toFixed(1) }} m²</p>
          <ul v-if="spaceHoles.length" class="member-list">
            <li v-for="hole in spaceHoles" :key="hole.index" class="member-row">
              <span class="member-label"
                >구멍 {{ hole.index + 1 }} · {{ hole.area.toFixed(1) }} m²</span
              >
              <button
                type="button"
                class="btn-ghost btn-icon danger-ghost"
                :aria-label="`구멍 ${hole.index + 1} 삭제`"
                title="구멍 삭제"
                @click="removeHole(hole.index)"
              >
                <MdiIcon :path="mdiTrashCanOutline" :size="12" />
              </button>
            </li>
          </ul>
          <p class="hint">왼쪽 도구의 '구멍 그리기'(H)로 이 공간 안에 구멍을 그립니다.</p>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'wall'">
        <p class="hint">
          벽을 드래그하면 이동하고, 양 끝의 핸들을 끌면 길이가 바뀝니다. Shift: 수평·수직 · Alt:
          붙이기 해제 · Esc: 취소
        </p>
        <PropertyGroup title="위치 및 크기">
          <NumberField
            label="두께"
            unit="m"
            :min="0.05"
            :step="0.05"
            :model-value="selected.wall.thickness"
            @change="onWallThickness"
          />
          <NumberField
            label="벽 높이"
            unit="m"
            :min="0.1"
            :step="0.1"
            :model-value="selected.wall.height ?? 2.4"
            @change="onWallHeight"
          />
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'vertex'">
        <PropertyGroup title="위치 및 크기">
          <p class="readonly-field">
            정점 좌표: ({{ selected.space.polygon[selected.vertexIndex]?.x.toFixed(2) }},
            {{ selected.space.polygon[selected.vertexIndex]?.y.toFixed(2) }})
          </p>
          <p class="hint">드래그로 이동 · Delete로 정점 삭제</p>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'entrance'">
        <PropertyGroup title="기본 정보">
          <label class="field">
            <span class="field-label">타입</span>
            <select :value="selected.entrance.type" @change="onEntranceType">
              <option v-for="type in ENTRANCE_TYPES" :key="type" :value="type">
                {{ ELEMENT_LABELS[type] }}
              </option>
            </select>
          </label>
        </PropertyGroup>
        <PropertyGroup title="위치 및 크기">
          <NumberField
            v-for="axis in ['x', 'y'] as const"
            :key="axis"
            :label="`위치 ${axis}`"
            unit="m"
            :step="0.1"
            :model-value="selected.entrance.position[axis]"
            @change="onElementPosition(axis, $event)"
          />
          <NumberField
            v-for="field in dimensionFields"
            :key="field.key"
            :label="field.label"
            :unit="field.unit"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :model-value="selected.entrance[field.key] ?? field.default"
            @change="onDimension(field.key, $event)"
          />
          <p class="hint">
            치수는 기본값이며 도면에 맞게 수정할 수 있습니다. 문·창문은 벽 가까이에 배치하고, 벽에
            연결되면 방향은 자동으로 맞춰집니다.
          </p>
        </PropertyGroup>
        <PropertyGroup title="연결 및 네비게이션">
          <label
            v-if="['door', 'window', 'opening'].includes(selected.entrance.type)"
            class="field"
          >
            <span class="field-label">연결 벽</span>
            <select :value="selected.entrance.wallId ?? ''" @change="onHostWall">
              <option value="">가장 가까운 벽 자동 연결</option>
              <option v-for="(wall, index) in walls" :key="wall.id" :value="wall.id">
                벽 {{ index + 1 }} ({{ wall.id.slice(0, 6) }})
              </option>
            </select>
          </label>
          <p class="readonly-field">연결 공간 A: {{ spaceName(selected.entrance.spaceA) }}</p>
          <p class="readonly-field">연결 공간 B: {{ spaceName(selected.entrance.spaceB) }}</p>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'poi'">
        <PropertyGroup title="기본 정보">
          <label class="field">
            <span class="field-label">이름</span>
            <input type="text" :value="selected.poi.name" @change="onPoiName" />
          </label>
          <label class="field">
            <span class="field-label">타입</span>
            <select :value="selected.poi.type" @change="onPoiType">
              <option v-for="type in POI_TYPES" :key="type" :value="type">
                {{ POI_TYPE_LABELS[type] }}
              </option>
            </select>
          </label>
        </PropertyGroup>
        <PropertyGroup title="연결 및 네비게이션">
          <p class="readonly-field">소속 공간: {{ spaceName(selected.poi.spaceId) }}</p>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'furniture'">
        <PropertyGroup title="기본 정보">
          <label class="field">
            <span class="field-label">이름</span>
            <input
              type="text"
              placeholder="예: 책상 1"
              :value="selected.furniture.name ?? ''"
              @change="onFurnitureName"
            />
          </label>
          <label class="field">
            <span class="field-label">타입</span>
            <select
              :value="selected.furniture.type"
              :disabled="!!selected.furniture.modelData"
              @change="onFurnitureType"
            >
              <option v-if="selected.furniture.type === 'custom'" value="custom">
                사용자 모델 (GLB)
              </option>
              <option v-for="type in FURNITURE_TYPES" :key="type" :value="type">
                {{ FURNITURE_PRESETS[type].label }}
              </option>
            </select>
          </label>
        </PropertyGroup>
        <PropertyGroup title="위치 및 크기">
          <NumberField
            v-for="axis in ['x', 'y'] as const"
            :key="axis"
            :label="`위치 ${axis}`"
            unit="m"
            :step="0.1"
            :model-value="selected.furniture.position[axis]"
            @change="onFurniturePosition(axis, $event)"
          />
          <NumberField
            label="폭"
            unit="m"
            :min="0.1"
            :step="0.1"
            :model-value="
              selected.furniture.width ?? FURNITURE_PRESETS[selected.furniture.type].width
            "
            @change="onFurnitureDimension('width', $event)"
          />
          <NumberField
            label="깊이"
            unit="m"
            :min="0.1"
            :step="0.1"
            :model-value="
              selected.furniture.depth ?? FURNITURE_PRESETS[selected.furniture.type].depth
            "
            @change="onFurnitureDimension('depth', $event)"
          />
          <NumberField
            label="높이"
            unit="m"
            :min="0.1"
            :step="0.1"
            :model-value="
              selected.furniture.height ?? FURNITURE_PRESETS[selected.furniture.type].height
            "
            @change="onFurnitureDimension('height', $event)"
          />
          <NumberField
            label="회전"
            unit="°"
            :step="15"
            :model-value="selected.furniture.rotation ?? 0"
            @change="onFurnitureRotation"
          />
        </PropertyGroup>
        <PropertyGroup title="연결 및 네비게이션">
          <p class="readonly-field">소속 공간: {{ spaceName(selected.furniture.spaceId) }}</p>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'group'">
        <PropertyGroup title="기본 정보">
          <label class="field">
            <span class="field-label">이름</span>
            <input type="text" :value="selected.group.label" @change="onGroupLabel" />
          </label>
        </PropertyGroup>
        <PropertyGroup title="구성 요소">
          <p class="readonly-field">{{ groupMembers.length }}개 객체</p>
          <ul class="member-list">
            <li v-for="member in groupMembers" :key="member.id" class="member-row">
              <MdiIcon :path="member.icon" :size="14" />
              <span class="member-label">{{ member.label }}</span>
            </li>
          </ul>
          <button class="ungroup-button" @click="ungroupSelectedGroup">
            <MdiIcon :path="mdiUngroup" :size="14" />
            그룹 해제 (구성 요소 유지)
          </button>
          <p class="hint">
            캔버스에서 아무 구성 요소를 클릭해도 그룹 전체가 선택됩니다. Delete 키는 그룹과 모든
            구성 요소를 함께 삭제합니다.
          </p>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'navigationNode'">
        <PropertyGroup title="기본 정보">
          <label class="field">
            <span class="field-label">이름</span>
            <input
              type="text"
              placeholder="예: 정문, 동쪽 계단"
              :value="selected.node.name ?? ''"
              @change="onNavNodeName"
            />
          </label>
          <label class="field">
            <span class="field-label">타입</span>
            <select :value="selected.node.type" @change="onNavNodeType">
              <option v-for="type in NAV_NODE_TYPES" :key="type" :value="type">
                {{ NAV_NODE_TYPE_LABELS[type] }}
              </option>
            </select>
          </label>
        </PropertyGroup>
        <PropertyGroup v-if="inSiteView" title="건물 연결">
          <ul v-if="siteLinks.length" class="member-list">
            <li v-for="link in siteLinks" :key="link.edgeId" class="member-row">
              <span class="member-label">{{ link.label }}</span>
              <button
                type="button"
                class="btn-ghost btn-icon danger-ghost"
                :aria-label="`${link.label} 연결 해제`"
                title="연결 해제"
                @click="removeSiteLink(link.edgeId)"
              >
                <MdiIcon :path="mdiTrashCanOutline" :size="12" />
              </button>
            </li>
          </ul>
          <label class="field">
            <span class="field-label">건물 출입구 연결</span>
            <select value="" @change="onAddSiteLink">
              <option value="" disabled>건물 노드 선택…</option>
              <option v-for="option in siteLinkOptions" :key="option.nodeId" :value="option.nodeId">
                {{ option.label }}{{ option.type === "entrance" ? " (출입구)" : "" }}
              </option>
            </select>
          </label>
          <p class="hint">
            실외 경로를 건물 출입구 노드에 이으면 단지 → 건물 → 층으로 이어지는 경로를 찾습니다.
            거리는 건물 배치를 반영한 단지 좌표로 계산합니다.
          </p>
        </PropertyGroup>
        <PropertyGroup
          v-if="!inSiteView && CROSS_FLOOR_NODE_TYPES.includes(selected.node.type)"
          title="연결 및 네비게이션"
        >
          <label class="field">
            <span class="field-label">다른 층 연결</span>
            <select :value="linkedCrossFloorNodeId ?? ''" @change="onLinkFloorNode">
              <option value="">연결 안 함</option>
              <option v-for="option in crossFloorNodeOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
          </label>
          <p v-if="!crossFloorNodeOptions.length" class="hint">
            연결할 다른 층의 계단·엘리베이터 노드가 없습니다. 다른 층에 노드를 먼저 만드세요.
          </p>
          <template v-if="linkedCrossFloorNodeId">
            <button type="button" class="connector-create" @click="convertLinkToConnector">
              수직 이동 설비로 변환
            </button>
            <p class="hint">
              손으로 이은 층간 연결을 설비로 바꾸면 대기·속도 스펙이 경로 시간에 반영되고, 정차층을
              한 곳에서 관리합니다.
            </p>
          </template>
          <p v-if="conversionMessage" class="hint">
            {{ conversionMessage }}
          </p>
        </PropertyGroup>
        <PropertyGroup
          v-if="
            !inSiteView &&
            (CROSS_FLOOR_NODE_TYPES.includes(selected.node.type) || nodeConnectors.length)
          "
          title="수직 이동 설비"
        >
          <template v-if="!nodeConnectors.length">
            <p class="hint">
              엘리베이터·계단을 설비로 만들면 정차층만 지정해도 층간 경로가 자동으로 생기고, 대기
              시간·속도를 반영해 소요 시간 기준으로 경로를 찾습니다.
            </p>
            <label class="field">
              <span class="field-label">설비 종류</span>
              <select v-model="newConnectorType" aria-label="설비 종류">
                <option v-for="type in CONNECTOR_TYPES" :key="type" :value="type">
                  {{ CONNECTOR_TYPE_LABELS[type] }}
                </option>
              </select>
            </label>
            <button type="button" class="connector-create" @click="createConnectorHere">
              이 노드에서 설비 만들기
            </button>
          </template>
          <div v-for="connector in nodeConnectors" :key="connector.id" class="connector-card">
            <label class="field">
              <span class="field-label">설비 이름</span>
              <input
                type="text"
                placeholder="예: 1호기, 동쪽 계단"
                :value="connector.name ?? ''"
                @change="onConnectorName(connector, $event)"
              />
            </label>
            <label class="field">
              <span class="field-label">설비 종류</span>
              <select :value="connector.type" @change="onConnectorType(connector, $event)">
                <option v-for="type in CONNECTOR_TYPES" :key="type" :value="type">
                  {{ CONNECTOR_TYPE_LABELS[type] }}
                </option>
              </select>
            </label>
            <label v-if="connector.type === 'escalator'" class="field">
              <span class="field-label">운행 방향</span>
              <select
                :value="connector.direction ?? ''"
                @change="onConnectorDirection(connector, $event)"
              >
                <option value="">양방향</option>
                <option value="up">상행</option>
                <option value="down">하행</option>
              </select>
            </label>
            <label class="field checkbox-field">
              <input
                type="checkbox"
                :checked="connector.accessible"
                @change="onConnectorAccessible(connector, $event)"
              />
              휠체어 이용 가능
            </label>
            <div class="spec-grid">
              <label v-for="field in SPEC_FIELDS" :key="field.key" class="field">
                <span class="field-label">{{ field.label }} ({{ field.unit }})</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  :placeholder="specPlaceholder(connector, field.key)"
                  :value="connector.spec?.[field.key] ?? ''"
                  @change="onConnectorSpec(connector, field.key, $event)"
                />
              </label>
            </div>
            <div class="field">
              <span class="field-label">정차층 ({{ connector.stops.length }})</span>
              <ul class="member-list">
                <li
                  v-for="stop in connectorStopRows(connector)"
                  :key="stop.nodeId"
                  class="member-row"
                >
                  <span class="member-label">{{ stop.label }}</span>
                  <button
                    type="button"
                    class="btn-ghost btn-icon danger-ghost"
                    :aria-label="`${stop.label} 정차층 제거`"
                    title="정차층 제거"
                    @click="removeConnectorStop(connector, stop.nodeId)"
                  >
                    <MdiIcon :path="mdiTrashCanOutline" :size="12" />
                  </button>
                </li>
              </ul>
            </div>
            <label class="field">
              <span class="field-label">정차층 추가</span>
              <select value="" @change="onAddConnectorStop(connector, $event)">
                <option value="" disabled>다른 층의 노드 선택…</option>
                <option
                  v-for="option in connectorStopOptions(connector)"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <p v-if="connector.stops.length < 2" class="hint">
              정차층이 2개 이상이어야 층이 연결됩니다.
            </p>
            <button type="button" class="danger-ghost" @click="deleteConnector(connector)">
              설비 삭제
            </button>
          </div>
        </PropertyGroup>
      </template>

      <template v-else-if="selected.kind === 'navigationEdge'">
        <PropertyGroup title="연결 정보">
          <label class="field">
            <span class="field-label">타입</span>
            <select :value="selected.edge.type" @change="onNavEdgeType">
              <option v-for="type in NAV_EDGE_TYPES" :key="type" :value="type">
                {{ NAV_EDGE_TYPE_LABELS[type] }}
              </option>
            </select>
          </label>
          <NumberField
            label="거리"
            unit="m"
            :min="0"
            :step="0.1"
            :model-value="selected.edge.distance"
            @change="onNavEdgeDistance"
          />
          <label class="field checkbox-field">
            <input
              type="checkbox"
              :checked="selected.edge.accessible"
              @change="onNavEdgeAccessible"
            />
            접근 가능
          </label>
        </PropertyGroup>
      </template>
    </template>
  </div>
</template>

<style scoped>
.property-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.empty-hint {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-secondary);
  color: var(--text-tertiary);
  line-height: 1.5;
}
.readonly-field {
  margin: 0;
  font-size: var(--font-size-secondary);
  color: var(--text-tertiary);
}
.hint {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-secondary);
  color: var(--text-secondary);
}
.field-label {
  color: var(--text-secondary);
}
.checkbox-field {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}
.field input,
.field select {
  font-size: var(--font-size-body);
}

.selection-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}
.selection-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-secondary);
}
.selection-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--font-size-secondary);
}
.selection-title strong {
  font-size: var(--font-size-body);
  color: var(--text-primary);
}
.selection-id {
  color: var(--text-disabled);
  font-size: var(--font-size-caption);
  font-family: var(--font-mono);
}
.autosave-note {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-disabled);
  white-space: nowrap;
}
.delete-selection-button {
  flex-shrink: 0;
}
.danger-ghost:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger-border);
  background: var(--danger-soft);
}

.summary-card {
  padding: var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.summary-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-tertiary);
}
.summary-label {
  font-size: var(--font-size-caption);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.summary-value {
  margin-left: auto;
  font-size: var(--font-size-secondary);
  color: var(--text-primary);
}
.summary-detail {
  margin: 0;
  font-size: var(--font-size-secondary);
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.summary-detail.success {
  color: var(--success);
}
.icon-danger {
  color: var(--danger);
}
.icon-success {
  color: var(--success);
}
.hint-inline {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}
.tag {
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.tag.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.tag.warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.member-row:hover {
  background: var(--surface-2);
}
.member-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ungroup-button {
  width: 100%;
}
.connector-create {
  width: 100%;
}
.connector-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.connector-card + .connector-card {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-2);
}
.spec-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.spec-grid .field {
  min-width: 0;
}
.spec-grid input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.stat-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  background: var(--surface-1);
  border-radius: var(--radius-sm);
}
.stat dt {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
.stat dd {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
</style>
