<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { IndoorEditor } from "@indoor/editor";
import type { NavigationNodeType } from "@indoor/core";

const props = defineProps<{ editor: IndoorEditor }>();

const NAV_NODE_TYPE_LABELS: Record<NavigationNodeType, string> = {
  normal: "일반",
  junction: "분기점",
  entrance: "출입구",
  stairs: "계단",
  elevator: "엘리베이터",
};

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [
    props.editor.on("projectChanged", () => revision.value++),
    props.editor.on("floorChanged", () => revision.value++),
  ];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

// The owning Building, found the same way App.vue's syncHistoryState locates
// the active floor's building — by scanning for the building whose floors
// include the current active floor.
const owningBuilding = computed(() => {
  revision.value;
  const floor = props.editor.getActiveFloor();
  if (!floor) return undefined;
  return props.editor.project.buildings.find((b) => b.floors.some((f) => f.id === floor.id));
});

// Routing can cross floors (a stairs/elevator edge links nodes on different
// floors of the same building), so the picker offers every floor's nodes —
// not just the active floor's — tagged with a { floor } entry for nodeLabel
// to disambiguate nodes that would otherwise look identical across floors.
// Spread each floor's nodes into a new array: floor.navigation.nodes is
// mutated in place by commands, so returning it directly would keep the same
// reference and Vue's computed cache would never see a "change" to react to.
const nodes = computed(() => {
  revision.value;
  const building = owningBuilding.value;
  if (!building) return [];
  return building.floors.flatMap((floor) =>
    [...floor.navigation.nodes].map((node) => ({ node, floor })),
  );
});

const form = reactive({
  startNodeId: "",
  endNodeId: "",
  avoidStairs: false,
  requireAccessible: false,
  preferElevator: false,
});

const preview = computed(() => {
  revision.value;
  return props.editor.routePreview.current;
});

function findRoute(): void {
  if (!form.startNodeId || !form.endNodeId) return;
  props.editor.routePreview.compute(form.startNodeId, form.endNodeId, {
    avoidStairs: form.avoidStairs,
    requireAccessible: form.requireAccessible,
    preferElevator: form.preferElevator,
  });
}

function clearRoute(): void {
  props.editor.routePreview.clear();
}

/** Prefers the node's own name (if set) over its type + id fragment, matching PropertyPanel's navNodeLabel — an unnamed node still needs to be distinguishable from every other unnamed node of the same type. */
function nodeLabel(id: string): string {
  const entry = nodes.value.find((n) => n.node.id === id);
  if (!entry) return id.slice(0, 6);
  const name =
    entry.node.name?.trim() || `${NAV_NODE_TYPE_LABELS[entry.node.type]} (${id.slice(0, 6)})`;
  return `${entry.floor.name} · ${name}`;
}
</script>

<template>
  <div class="route-panel">
    <h3>경로 미리보기</h3>

    <p v-if="nodes.length < 2" class="empty-hint">
      경로를 계산하려면 Navigation Node 툴로 노드를 2개 이상 만드세요.
    </p>

    <template v-else>
      <label class="field">
        출발 노드
        <select v-model="form.startNodeId">
          <option value="" disabled>선택</option>
          <option v-for="entry in nodes" :key="entry.node.id" :value="entry.node.id">
            {{ nodeLabel(entry.node.id) }}
          </option>
        </select>
      </label>
      <label class="field">
        도착 노드
        <select v-model="form.endNodeId">
          <option value="" disabled>선택</option>
          <option v-for="entry in nodes" :key="entry.node.id" :value="entry.node.id">
            {{ nodeLabel(entry.node.id) }}
          </option>
        </select>
      </label>

      <label class="checkbox-row"
        ><input v-model="form.avoidStairs" type="checkbox" /> 계단 회피</label
      >
      <label class="checkbox-row">
        <input v-model="form.requireAccessible" type="checkbox" /> 접근 가능 경로만
      </label>
      <label class="checkbox-row">
        <input v-model="form.preferElevator" type="checkbox" /> 엘리베이터 우선
      </label>

      <div class="actions">
        <button @click="findRoute">경로 찾기</button>
        <button @click="clearRoute">지우기</button>
      </div>

      <p v-if="preview && !preview.result" class="result error">경로를 찾을 수 없습니다.</p>
      <p v-else-if="preview?.result" class="result">
        거리: {{ preview.result.distance.toFixed(1) }} m · {{ preview.result.nodeIds.length }}개
        노드
      </p>
    </template>
  </div>
</template>

<style scoped>
.route-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h3 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.4;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.field select {
  font-size: 13px;
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions button {
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
}
.result {
  margin: 0;
  font-size: 12px;
  color: var(--warning);
}
.result.error {
  color: var(--danger);
}
</style>
