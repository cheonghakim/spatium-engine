<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  Entrance,
  EntranceType,
  NavigationEdge,
  NavigationEdgeType,
  NavigationNode,
  NavigationNodeType,
  POI,
  POIType,
  Space,
  SpaceType,
  Wall,
} from "@indoor/core";
import { ChangePropertyCommand, findObjectKind, type IndoorEditor } from "@indoor/editor";

const props = defineProps<{ editor: IndoorEditor }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [
    props.editor.on("selectionChanged", () => revision.value++),
    props.editor.on("projectChanged", () => revision.value++),
    props.editor.on("floorChanged", () => revision.value++),
  ];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

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
const ENTRANCE_TYPES: EntranceType[] = ["door", "opening", "stairs", "elevator", "escalator"];
const POI_TYPES: POIType[] = [
  "store",
  "restroom",
  "elevator",
  "stairs",
  "information",
  "exit",
  "custom",
];
const NAV_NODE_TYPES: NavigationNodeType[] = ["normal", "junction", "entrance", "stairs", "elevator"];
const NAV_EDGE_TYPES: NavigationEdgeType[] = ["walk", "stairs", "elevator", "escalator"];

type Selected =
  | { kind: "space"; space: Space }
  | { kind: "wall"; wall: Wall }
  | { kind: "entrance"; entrance: Entrance }
  | { kind: "poi"; poi: POI }
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

function spaceName(spaceId: string | undefined): string {
  if (!spaceId) return "—";
  const floor = props.editor.getActiveFloor();
  const space = floor?.spaces.find((s) => s.id === spaceId);
  return space?.properties.name ?? space?.id.slice(0, 8) ?? "—";
}

function commitField<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (target[key] === value) return;
  props.editor.executeCommand(new ChangePropertyCommand(target, key, value, `Change ${String(key)}`));
}

function onSpaceName(evt: Event): void {
  if (selected.value?.kind !== "space") return;
  commitField(selected.value.space.properties, "name", (evt.target as HTMLInputElement).value || undefined);
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
function onSpaceHeight(evt: Event): void {
  if (selected.value?.kind !== "space") return;
  const value = Number((evt.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value > 0) commitField(selected.value.space, "height", value);
}

function onWallThickness(evt: Event): void {
  if (selected.value?.kind !== "wall") return;
  const value = Number((evt.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value > 0) commitField(selected.value.wall, "thickness", value);
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

function onNavNodeType(evt: Event): void {
  if (selected.value?.kind !== "navigationNode") return;
  commitField(
    selected.value.node,
    "type",
    (evt.target as HTMLSelectElement).value as NavigationNodeType,
  );
}

function onNavEdgeType(evt: Event): void {
  if (selected.value?.kind !== "navigationEdge") return;
  commitField(
    selected.value.edge,
    "type",
    (evt.target as HTMLSelectElement).value as NavigationEdgeType,
  );
}
function onNavEdgeDistance(evt: Event): void {
  if (selected.value?.kind !== "navigationEdge") return;
  const value = Number((evt.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value > 0) commitField(selected.value.edge, "distance", value);
}
function onNavEdgeAccessible(evt: Event): void {
  if (selected.value?.kind !== "navigationEdge") return;
  commitField(selected.value.edge, "accessible", (evt.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="property-panel">
    <h3>속성</h3>

    <p v-if="!selected" class="empty-hint">선택된 항목이 없습니다.</p>

    <template v-else-if="selected.kind === 'space'">
      <label class="field">
        이름
        <input type="text" :value="selected.space.properties.name ?? ''" @change="onSpaceName" />
      </label>
      <label class="field">
        타입
        <select :value="selected.space.type" @change="onSpaceType">
          <option v-for="type in SPACE_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="field">
        카테고리
        <input
          type="text"
          :value="selected.space.properties.category ?? ''"
          @change="onSpaceCategory"
        />
      </label>
      <label class="field">
        높이 (m)
        <input type="number" min="0" step="0.1" :value="selected.space.height" @change="onSpaceHeight" />
      </label>
    </template>

    <template v-else-if="selected.kind === 'wall'">
      <p class="hint">벽을 드래그하면 이동하고, 양 끝의 흰 점을 끌면 길이가 바뀝니다. Shift: 수평·수직 · Alt: 붙이기 해제 · Esc: 취소</p>
      <label class="field">
        두께 (m)
        <input type="number" min="0.05" step="0.05" :value="selected.wall.thickness" @change="onWallThickness" />
      </label>
    </template>

    <template v-else-if="selected.kind === 'vertex'">
      <p class="readonly-field">
        정점 좌표: ({{ selected.space.polygon[selected.vertexIndex]?.x.toFixed(2) }},
        {{ selected.space.polygon[selected.vertexIndex]?.y.toFixed(2) }})
      </p>
      <p class="hint">드래그로 이동 · Delete로 정점 삭제</p>
    </template>

    <template v-else-if="selected.kind === 'entrance'">
      <label class="field">
        타입
        <select :value="selected.entrance.type" @change="onEntranceType">
          <option v-for="type in ENTRANCE_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <p class="readonly-field">연결 공간 A: {{ spaceName(selected.entrance.spaceA) }}</p>
      <p class="readonly-field">연결 공간 B: {{ spaceName(selected.entrance.spaceB) }}</p>
    </template>

    <template v-else-if="selected.kind === 'poi'">
      <label class="field">
        이름
        <input type="text" :value="selected.poi.name" @change="onPoiName" />
      </label>
      <label class="field">
        타입
        <select :value="selected.poi.type" @change="onPoiType">
          <option v-for="type in POI_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <p class="readonly-field">소속 공간: {{ spaceName(selected.poi.spaceId) }}</p>
    </template>

    <template v-else-if="selected.kind === 'navigationNode'">
      <label class="field">
        타입
        <select :value="selected.node.type" @change="onNavNodeType">
          <option v-for="type in NAV_NODE_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
    </template>

    <template v-else-if="selected.kind === 'navigationEdge'">
      <label class="field">
        타입
        <select :value="selected.edge.type" @change="onNavEdgeType">
          <option v-for="type in NAV_EDGE_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="field">
        거리 (m)
        <input
          type="number"
          min="0"
          step="0.1"
          :value="selected.edge.distance"
          @change="onNavEdgeDistance"
        />
      </label>
      <label class="field checkbox-field">
        <input type="checkbox" :checked="selected.edge.accessible" @change="onNavEdgeAccessible" />
        접근 가능
      </label>
    </template>
  </div>
</template>

<style scoped>
.property-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h3 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: #e8e8ec;
}
.empty-hint {
  margin: 0;
  font-size: 12px;
  color: #71717a;
}
.readonly-field {
  margin: 0;
  font-size: 12px;
  color: #9a9aa5;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: #71717a;
  line-height: 1.4;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #c7c7cf;
}
.checkbox-field {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.field input,
.field select {
  background: #1c1c20;
  color: #e8e8ec;
  border: 1px solid #35353d;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
</style>
