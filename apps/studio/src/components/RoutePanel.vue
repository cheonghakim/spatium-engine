<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { IndoorEditor } from "@indoor/editor";
import {
  diagnoseRoute,
  type NavigationNodeType,
  type NoRouteReason,
  type RouteEndpoint,
} from "@indoor/core";

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
    props.editor.on("projectLoaded", () => {
      form.start = "";
      form.end = "";
    }),
  ];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

interface Choice {
  /** "<nodeId>", "poi:<id>" or "space:<id>". */
  value: string;
  label: string;
  group: "POI" | "공간" | "경로 지점";
}

/**
 * Every place a route can start or end, across all buildings and the site
 * (campus routes no longer require switching to the site view first). With
 * more than one building, labels lead with the building so two "1F · 로비"
 * stay distinguishable.
 */
const choices = computed<Choice[]>(() => {
  revision.value;
  const project = props.editor.project;
  const multiBuilding = project.buildings.length > 1 || !!project.site;
  const prefix = (buildingName: string) => (multiBuilding ? `${buildingName} · ` : "");
  const list: Choice[] = [];
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const at = `${prefix(building.name)}${floor.name}`;
      for (const poi of floor.pois) {
        list.push({
          value: `poi:${poi.id}`,
          label: `${at} · ${poi.name || "이름 없는 POI"}`,
          group: "POI",
        });
      }
      for (const space of floor.spaces) {
        const name = space.properties.name?.trim();
        if (name)
          list.push({ value: `space:${space.id}`, label: `${at} · ${name}`, group: "공간" });
      }
      for (const node of floor.navigation.nodes) {
        const name =
          node.name?.trim() || `${NAV_NODE_TYPE_LABELS[node.type]} (${node.id.slice(0, 6)})`;
        list.push({ value: node.id, label: `${at} · ${name}`, group: "경로 지점" });
      }
    }
  }
  const site = project.site;
  for (const node of site?.navigation.nodes ?? []) {
    const name = node.name?.trim() || `${NAV_NODE_TYPE_LABELS[node.type]} (${node.id.slice(0, 6)})`;
    list.push({ value: node.id, label: `${site!.name} (실외) · ${name}`, group: "경로 지점" });
  }
  return list;
});

const routableCount = computed(() => choices.value.filter((c) => c.group === "경로 지점").length);

const query = ref("");
const GROUPS: Choice["group"][] = ["POI", "공간", "경로 지점"];
/** Filtered options; the current selection always stays listed so the select doesn't blank out. */
function optionsFor(selected: string) {
  const q = query.value.trim().toLowerCase();
  const visible = choices.value.filter(
    (c) => c.value === selected || !q || c.label.toLowerCase().includes(q),
  );
  return GROUPS.map((group) => ({ group, items: visible.filter((c) => c.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Select values are "<id>" for nodes, "poi:<id>" or "space:<id>" for places. */
function toEndpoint(value: string): RouteEndpoint {
  if (value.startsWith("poi:")) return { poiId: value.slice(4) };
  if (value.startsWith("space:")) return { spaceId: value.slice(6) };
  return value;
}

const form = reactive({
  start: "",
  end: "",
  avoidStairs: false,
  requireAccessible: false,
  preferElevator: false,
});

// A deleted POI/space/node can't stay selected (and its old route preview is stale).
watch(choices, (list) => {
  const exists = (value: string) => list.some((c) => c.value === value);
  if (form.start && !exists(form.start)) form.start = "";
  if (form.end && !exists(form.end)) form.end = "";
});

const preview = computed(() => {
  revision.value;
  return props.editor.routePreview.current;
});
const noRouteReason = ref<NoRouteReason | null>(null);

const REASON_TEXT: Record<NoRouteReason, string> = {
  "start-unreachable":
    "출발지에서 경로로 들어갈 수 없습니다. 근처에 경로 지점이 없거나, 문 없는 벽에 막혀 있습니다.",
  "end-unreachable":
    "도착지에 경로가 닿지 않습니다. 근처에 경로 지점이 없거나, 문 없는 벽에 막혀 있습니다.",
  "blocked-by-options":
    "계단 회피·접근 가능 조건을 만족하는 경로가 없습니다. 조건을 끄면 경로가 있습니다.",
  disconnected:
    "출발지와 도착지가 경로로 이어져 있지 않습니다. 층 연결(수직 이동 설비)이나 건물 출입구 연결을 확인하세요.",
};

function routeOptions() {
  return {
    avoidStairs: form.avoidStairs,
    requireAccessible: form.requireAccessible,
    preferElevator: form.preferElevator,
  };
}

function findRoute(): void {
  if (!form.start || !form.end) return;
  const from = toEndpoint(form.start);
  const to = toEndpoint(form.end);
  props.editor.routePreview.compute(from, to, routeOptions());
  noRouteReason.value = props.editor.routePreview.current?.result
    ? null
    : diagnoseRoute(props.editor.project, from, to, routeOptions());
}

function swap(): void {
  [form.start, form.end] = [form.end, form.start];
  if (preview.value) findRoute();
}

function clearRoute(): void {
  noRouteReason.value = null;
  props.editor.routePreview.clear();
}

/** Seconds → "1분 23초" / "45초" — routing cost is estimated travel time. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}분 ${rest}초` : `${rest}초`;
}
</script>

<template>
  <div class="route-panel">
    <h3>경로 미리보기</h3>

    <p v-if="routableCount < 2" class="empty-hint">
      경로를 계산하려면 경로 그리기 도구로 경로 지점을 2개 이상 만드세요.
    </p>

    <template v-else>
      <label class="field">
        찾기
        <input
          v-model="query"
          type="search"
          placeholder="건물·층·이름으로 좁히기"
          aria-label="출발지·도착지 찾기"
        />
      </label>
      <label class="field">
        출발지
        <select v-model="form.start" aria-label="출발지">
          <option value="" disabled>선택</option>
          <optgroup v-for="group in optionsFor(form.start)" :key="group.group" :label="group.group">
            <option v-for="choice in group.items" :key="choice.value" :value="choice.value">
              {{ choice.label }}
            </option>
          </optgroup>
        </select>
      </label>
      <button
        type="button"
        class="swap"
        title="출발지와 도착지 바꾸기"
        :disabled="!form.start && !form.end"
        @click="swap"
      >
        ⇅ 바꾸기
      </button>
      <label class="field">
        도착지
        <select v-model="form.end" aria-label="도착지">
          <option value="" disabled>선택</option>
          <optgroup v-for="group in optionsFor(form.end)" :key="group.group" :label="group.group">
            <option v-for="choice in group.items" :key="choice.value" :value="choice.value">
              {{ choice.label }}
            </option>
          </optgroup>
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
        <button :disabled="!form.start || !form.end" @click="findRoute">경로 찾기</button>
        <button @click="clearRoute">지우기</button>
      </div>

      <p v-if="preview && !preview.result" class="result error">
        경로를 찾을 수 없습니다.
        <template v-if="noRouteReason">
          {{ REASON_TEXT[noRouteReason] }}
        </template>
      </p>
      <p v-else-if="preview?.result" class="result">
        예상 소요: {{ formatDuration(preview.result.cost) }} · 거리:
        {{ preview.result.distance.toFixed(1) }} m · {{ preview.result.nodeIds.length }}개 지점
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
.field select,
.field input {
  font-size: 13px;
}
.swap {
  align-self: flex-end;
  padding: 2px 10px;
  font-size: 12px;
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
