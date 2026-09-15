<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createBuilding, createFloor, type IndoorProject } from "@indoor/core";
import { AddBuildingCommand, type IndoorEditor } from "@indoor/editor";

const props = defineProps<{ editor: IndoorEditor; project: IndoorProject; activeBuildingId: string }>();
const emit = defineEmits<{ select: [buildingId: string] }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [props.editor.on("projectChanged", () => revision.value++)];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const buildings = computed(() => {
  revision.value;
  return [...props.project.buildings];
});

function select(buildingId: string): void {
  emit("select", buildingId);
}

function addBuilding(): void {
  const name = window.prompt("새 Building 이름:", `Building ${props.project.buildings.length + 1}`);
  if (!name) return;

  const building = createBuilding(name);
  building.floors.push(createFloor("1F", 1));
  props.editor.executeCommand(new AddBuildingCommand(props.project, building));
  emit("select", building.id);
}
</script>

<template>
  <div class="building-switcher">
    <select :value="activeBuildingId" @change="select(($event.target as HTMLSelectElement).value)">
      <option v-for="b in buildings" :key="b.id" :value="b.id">{{ b.name }}</option>
    </select>
    <button class="add-building" title="빌딩 추가" @click="addBuilding">+</button>
  </div>
</template>

<style scoped>
.building-switcher {
  display: flex;
  gap: 4px;
  align-items: center;
}
.building-switcher select,
.building-switcher button {
  background: #232329;
  color: #e8e8ec;
  border: 1px solid #35353d;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
}
.add-building {
  font-weight: 600;
}
</style>
