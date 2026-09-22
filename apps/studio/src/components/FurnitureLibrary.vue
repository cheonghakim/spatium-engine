<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { FURNITURE_PRESETS, type FurnitureType } from "@indoor/core";
import type { IndoorEditor, FurnitureTemplate } from "@indoor/editor";
import {
  readFurnitureLibrary,
  writeFurnitureLibrary,
  snapshotFurniture,
  type SavedFurniture,
} from "../furnitureLibrary";

const props = defineProps<{ editor: IndoorEditor; active: boolean }>();
const emit = defineEmits<{ place: [] }>();
const revision = ref(0);
const saved = ref<SavedFurniture[]>([]);
const name = ref("");
const message = ref("");
const error = ref("");
const importing = ref(false);
let disposed = false;
const chosen = ref("desk");
try {
  saved.value = readFurnitureLibrary();
} catch {
  error.value = "내 가구를 읽지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.";
}
const initialTemplate = props.editor.furnitureTool.getTemplate();
chosen.value =
  saved.value.find((item) =>
    (["type", "name", "width", "depth", "height", "rotation", "modelData"] as const).every(
      (key) => item.template[key] === initialTemplate[key],
    ),
  )?.id ?? initialTemplate.type;
const unsubscribe = [
  props.editor.on("selectionChanged", () => {
    revision.value++;
    name.value = "";
  }),
  props.editor.on("projectChanged", () => revision.value++),
];
onBeforeUnmount(() => {
  disposed = true;
  unsubscribe.forEach((stop) => stop());
});
const selected = computed(() => {
  revision.value;
  const entries = props.editor.selection.current;
  return entries.length === 1
    ? props.editor.getActiveFloor()?.furniture.find((item) => item.id === entries[0]?.id)
    : undefined;
});
const types = (Object.keys(FURNITURE_PRESETS) as FurnitureType[]).filter(
  (type) => type !== "custom",
);
const currentLabel = computed(
  () =>
    saved.value.find((item) => item.id === chosen.value)?.label ??
    FURNITURE_PRESETS[chosen.value as FurnitureType]?.label ??
    "가구",
);
function choose(id: string, template: FurnitureTemplate) {
  props.editor.furnitureTool.setTemplate(template);
  chosen.value = id;
  message.value = "";
  emit("place");
}
function persist(next: SavedFurniture[]): boolean {
  try {
    writeFurnitureLibrary(next);
    saved.value = next;
    error.value = "";
    return true;
  } catch {
    error.value = "저장하지 못했습니다. 브라우저 저장 공간과 설정을 확인해 주세요.";
    return false;
  }
}
function save() {
  if (!selected.value || !name.value.trim()) return;
  const label = name.value.trim();
  const item = {
    id: crypto.randomUUID(),
    label,
    template: snapshotFurniture(selected.value, label),
  };
  if (persist([...saved.value, item])) {
    message.value = `‘${label}’ 저장 완료`;
    name.value = "";
  }
}
function remove(id: string) {
  if (!persist(saved.value.filter((item) => item.id !== id))) return;
  if (chosen.value === id) {
    chosen.value = "desk";
    props.editor.furnitureTool.setTemplate({ type: "desk" });
  }
  message.value = "내 가구에서 삭제했습니다. 도면에 배치한 가구는 유지됩니다.";
}

async function importModel(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || importing.value) return;
  importing.value = true;
  error.value = "";
  try {
    if (!file.name.toLowerCase().endsWith(".glb")) throw new Error("GLB 파일을 선택해 주세요.");
    if (file.size > 2 * 1024 * 1024) throw new Error("GLB 파일은 2 MB 이하로 추가해 주세요.");
    const { importFurnitureGLB } = await import("@indoor/runtime");
    const model = await importFurnitureGLB(await file.arrayBuffer());
    if (disposed) return;
    const label = file.name.replace(/\.glb$/i, "");
    const item: SavedFurniture = {
      id: crypto.randomUUID(),
      label,
      template: {
        type: "custom",
        name: label,
        rotation: 0,
        ...model,
      },
    };
    if (persist([...saved.value, item])) {
      choose(item.id, item.template);
      message.value = "모델을 추가했습니다. 도면에 배치한 뒤 크기와 회전을 조정하세요.";
    }
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? `모델을 추가하지 못했습니다: ${cause.message}`
        : "모델을 불러오지 못했습니다.";
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <details class="furniture-library" :open="active || !!selected">
    <summary>가구 라이브러리</summary>
    <label class="import-model">
      {{ importing ? "모델 확인 중…" : "GLB 모델 추가" }}
      <input
        type="file"
        accept=".glb,model/gltf-binary"
        :disabled="importing"
        aria-label="GLB 모델 추가"
        @change="importModel"
      />
    </label>
    <p class="hint">텍스처가 포함된 GLB · 최대 2 MB · 정적 모델</p>
    <p v-if="active" class="hint" role="status">
      {{ currentLabel }} · 도면을 클릭해 배치하세요. 반복 배치 가능 · Esc로 종료
    </p>
    <div class="preset-grid">
      <button
        v-for="type in types"
        :key="type"
        type="button"
        :aria-pressed="active && chosen === type"
        @click="choose(type, { type })"
      >
        <strong>{{ FURNITURE_PRESETS[type].label }}</strong>
        <small>{{ FURNITURE_PRESETS[type].width }} × {{ FURNITURE_PRESETS[type].depth }} m</small>
      </button>
    </div>
    <h4>내 가구</h4>
    <p class="hint">이 브라우저에 저장되어 다른 프로젝트에서도 사용할 수 있습니다.</p>
    <p v-if="!saved.length" class="hint">가구를 배치하고 속성을 조정한 뒤 저장해 보세요.</p>
    <div v-for="item in saved" :key="item.id" class="saved-row">
      <button
        type="button"
        :aria-pressed="active && chosen === item.id"
        @click="choose(item.id, item.template)"
      >
        {{ item.label }}
        <small
          >{{ item.template.width }} × {{ item.template.depth }} m ·
          {{ item.template.rotation }}°</small
        >
      </button>
      <button
        type="button"
        class="remove"
        :aria-label="`${item.label} 삭제`"
        @click="remove(item.id)"
      >
        ×
      </button>
    </div>
    <form v-if="selected" @submit.prevent="save">
      <label
        >저장할 가구 이름<input v-model="name" maxlength="80" placeholder="예: 회의실 긴 테이블"
      /></label>
      <button type="submit" :disabled="!name.trim()">선택한 가구 저장</button>
    </form>
    <p v-else class="hint">도면에서 가구 하나를 선택하면 내 가구로 저장할 수 있습니다.</p>
    <p v-if="message" class="hint" role="status">
      {{ message }}
    </p>
    <p v-if="error" class="error" role="alert">
      {{ error }}
    </p>
  </details>
</template>

<style scoped>
.import-model {
  display: block;
  margin-top: 10px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
}
.import-model input {
  width: 100%;
  font-size: 10px;
}
.furniture-library {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 10px;
}
summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
}
h4 {
  font-size: 12px;
  margin: 14px 0 6px;
}
.hint,
.error {
  font-size: 11px;
  line-height: 1.5;
  margin: 8px 0;
}
.hint {
  color: var(--text-secondary);
}
.error {
  color: #ef9696;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 10px;
}
.preset-grid > button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  height: auto;
  min-height: 60px;
}
.preset-grid strong {
  white-space: nowrap;
}
.saved-row > button:first-child {
  display: block;
  height: auto;
}
button {
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  padding: 8px;
  background: var(--surface-2);
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  overflow-wrap: anywhere;
}
button[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
small {
  display: block;
  font-size: 10px;
  margin-top: 4px;
  color: var(--text-secondary);
}
.saved-row {
  display: flex;
  gap: 4px;
  margin: 5px 0;
}
.saved-row > button:first-child {
  flex: 1;
  min-width: 0;
}
.remove {
  flex: 0 0 28px;
  text-align: center;
}
form {
  display: grid;
  gap: 7px;
  margin-top: 12px;
}
label {
  font-size: 11px;
}
input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 5px;
  padding: 7px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: transparent;
  color: inherit;
}
</style>
