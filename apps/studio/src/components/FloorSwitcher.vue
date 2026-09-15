<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createFloor, type Building } from "@indoor/core";
import { AddFloorCommand, type IndoorEditor } from "@indoor/editor";

const props = defineProps<{ editor: IndoorEditor; building: Building }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [
    props.editor.on("floorChanged", () => revision.value++),
    props.editor.on("projectChanged", () => revision.value++),
  ];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const floors = computed(() => {
  revision.value;
  return [...props.building.floors].sort((a, b) => a.level - b.level);
});

const activeFloorId = computed(() => {
  revision.value;
  return props.editor.getActiveFloor()?.id ?? null;
});

function selectFloor(id: string): void {
  props.editor.setFloor(id);
}

function addFloor(): void {
  const name = window.prompt("새 층 이름:", `${props.building.floors.length + 1}F`);
  if (!name) return;

  const maxLevel = props.building.floors.reduce((max, f) => Math.max(max, f.level), 0);
  const floor = createFloor(name, maxLevel + 1);
  props.editor.executeCommand(new AddFloorCommand(props.building, floor));
  props.editor.setFloor(floor.id);
}
</script>

<template>
  <div class="floor-switcher">
    <button
      v-for="f in floors"
      :key="f.id"
      :class="{ active: f.id === activeFloorId }"
      @click="selectFloor(f.id)"
    >
      {{ f.name }}
    </button>
    <button class="add-floor" title="층 추가" @click="addFloor">+</button>
  </div>
</template>

<style scoped>
.floor-switcher {
  display: flex;
  gap: 4px;
}
.floor-switcher button {
  background: #232329;
  color: #e8e8ec;
  border: 1px solid #35353d;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
}
.floor-switcher button.active {
  background: #3d5afe;
  border-color: #3d5afe;
}
.add-floor {
  font-weight: 600;
}
</style>
