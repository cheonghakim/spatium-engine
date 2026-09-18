<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { IndoorEditor, LayerId } from "@indoor/editor";
import {
  mdiDoorOpen,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiImageOutline,
  mdiMagnify,
  mdiMapMarkerOutline,
  mdiRoutes,
  mdiVectorSquare,
  mdiWall,
} from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";

const props = defineProps<{ editor: IndoorEditor }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [props.editor.on("projectChanged", () => revision.value++)];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const visibility = computed(() => {
  revision.value;
  return props.editor.layers.all;
});

/** Swatch colors mirror the canvas renderer's per-layer palette (canvas/render.ts) so the legend here always matches what's drawn. */
const LAYERS: Array<{ id: LayerId; label: string; icon: string; color: string }> = [
  { id: "reference", label: "도면", icon: mdiImageOutline, color: "#8d949f" },
  { id: "spaces", label: "공간", icon: mdiVectorSquare, color: "#9aa6c8" },
  { id: "walls", label: "벽", icon: mdiWall, color: "#b8bdc7" },
  { id: "entrances", label: "출입구", icon: mdiDoorOpen, color: "#8fb3ae" },
  { id: "pois", label: "POI", icon: mdiMapMarkerOutline, color: "#c9aa6e" },
  { id: "navigation", label: "내비게이션", icon: mdiRoutes, color: "#9298a3" },
];

const query = ref("");
const filteredLayers = computed(() =>
  LAYERS.filter((l) => l.label.toLowerCase().includes(query.value.trim().toLowerCase())),
);

function toggle(id: LayerId): void {
  props.editor.layers.toggle(id);
}
</script>

<template>
  <div class="layers-panel">
    <h3 class="panel-heading">레이어</h3>
    <label class="search">
      <MdiIcon :path="mdiMagnify" :size="14" />
      <input v-model="query" type="text" placeholder="레이어 검색" aria-label="레이어 검색" />
    </label>
    <ul class="layer-list">
      <li v-for="layer in filteredLayers" :key="layer.id" class="layer-row">
        <span class="swatch" :style="{ background: layer.color }" />
        <MdiIcon :path="layer.icon" :size="15" class="layer-icon" />
        <span class="layer-name">{{ layer.label }}</span>
        <button
          type="button"
          class="btn-ghost btn-icon visibility-toggle"
          :aria-pressed="visibility[layer.id]"
          :aria-label="`${layer.label} 레이어 ${visibility[layer.id] ? '숨기기' : '표시'}`"
          :title="visibility[layer.id] ? '숨기기' : '표시하기'"
          @click="toggle(layer.id)"
        >
          <MdiIcon :path="visibility[layer.id] ? mdiEyeOutline : mdiEyeOffOutline" :size="16" />
        </button>
      </li>
      <li v-if="!filteredLayers.length" class="empty-hint">일치하는 레이어가 없습니다.</li>
    </ul>
  </div>
</template>

<style scoped>
.layers-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.search {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 26px;
  padding: 0 var(--space-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-disabled);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  border: 0;
  padding: 0;
  font-size: var(--font-size-caption);
  color: var(--text-primary);
}
.layer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 28px;
  padding: 0 var(--space-1) 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out);
}
.layer-row:hover {
  background: var(--surface-2);
}
.swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.layer-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.layer-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.visibility-toggle {
  color: var(--text-disabled);
}
.visibility-toggle[aria-pressed="true"] {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}
.layer-row:hover .visibility-toggle {
  color: var(--text-secondary);
}
.empty-hint {
  padding: var(--space-2);
  font-size: var(--font-size-secondary);
  color: var(--text-tertiary);
}
</style>
