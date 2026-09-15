<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { IndoorEditor, LayerId } from "@indoor/editor";

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

const LAYERS: Array<{ id: LayerId; label: string }> = [
  { id: "reference", label: "도면" },
  { id: "spaces", label: "공간" },
  { id: "walls", label: "벽" },
  { id: "entrances", label: "출입구" },
  { id: "pois", label: "POI" },
  { id: "navigation", label: "내비게이션" },
];

function toggle(id: LayerId): void {
  props.editor.layers.toggle(id);
}
</script>

<template>
  <div class="layers-panel">
    <h3>레이어</h3>
    <label v-for="layer in LAYERS" :key="layer.id" class="layer-row">
      <input type="checkbox" :checked="visibility[layer.id]" @change="toggle(layer.id)" />
      {{ layer.label }}
    </label>
  </div>
</template>

<style scoped>
.layers-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
h3 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: #e8e8ec;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
</style>
