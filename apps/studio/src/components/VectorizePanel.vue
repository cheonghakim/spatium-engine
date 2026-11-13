<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { IndoorEditor } from "@indoor/editor";
import type { Entrance, EntranceType } from "@indoor/core";

const props = defineProps<{ editor: IndoorEditor }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [props.editor.on("projectChanged", () => revision.value++)];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const draft = computed(() => {
  revision.value;
  return props.editor.draft.current;
});

const acceptedWallCount = computed(() => draft.value?.walls.filter((w) => w.accepted).length ?? 0);
const acceptedSpaceCount = computed(
  () => draft.value?.spaces.filter((s) => s.accepted).length ?? 0,
);
const acceptedElementCount = computed(
  () => draft.value?.elements.filter((e) => e.accepted).length ?? 0,
);
const confirmedCount = computed(() => {
  revision.value;
  const geometry = props.editor.draft.materialize(
    draft.value?.floorId ?? props.editor.getActiveFloor()?.id ?? "",
  );
  return geometry.walls.length + geometry.spaces.length + geometry.entrances.length;
});
const selectedElement = computed(() => {
  revision.value;
  return draft.value?.elements.find((e) => e.id === props.editor.draft.selectedId);
});
const labels: Record<string, string> = {
  opening: "통로 / 미분류 틈",
  door: "문",
  window: "창문",
  stairs: "계단",
};
function elementType(event: Event): void {
  if (selectedElement.value)
    props.editor.draft.updateElement(selectedElement.value.id, {
      type: (event.target as HTMLSelectElement).value as EntranceType,
    });
}
function elementNumber(
  key: "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight",
  event: Event,
): void {
  const input = event.target as HTMLInputElement;
  if (selectedElement.value && input.value.trim() && input.checkValidity())
    props.editor.draft.updateElement(selectedElement.value.id, {
      [key]: Number(input.value),
    } as Partial<Entrance>);
}
function elementPosition(axis: "x" | "y", event: Event): void {
  const input = event.target as HTMLInputElement,
    element = selectedElement.value;
  if (element && input.value.trim())
    props.editor.draft.updateElement(element.id, {
      position: { ...element.position, [axis]: Number(input.value) },
    });
}
const selectedWall = computed(() => {
  revision.value;
  return draft.value?.walls.find((w) => w.id === props.editor.draft.selectedId);
});
const wrongFloor = computed(() => {
  revision.value;
  return !!draft.value?.floorId && draft.value.floorId !== props.editor.getActiveFloor()?.id;
});
const canUndo = computed(() => {
  revision.value;
  return props.editor.draft.canUndo;
});
const canRedo = computed(() => {
  revision.value;
  return props.editor.draft.canRedo;
});
const selectedCount = computed(() => {
  revision.value;
  return props.editor.draft.selectedIds.length;
});
function isSelected(id: string): boolean {
  revision.value;
  return props.editor.draft.isSelected(id);
}
function setSelectedAccepted(accepted: boolean): void {
  props.editor.draft.setAccepted(props.editor.draft.selectedIds, accepted);
}
function focus(id: string, event?: MouseEvent): void {
  if (draft.value?.floorId) props.editor.setFloor(draft.value.floorId);
  props.editor.setTool("draft-review");
  // Shift/Ctrl+click in the list toggles the entry in a multi-selection without moving the camera.
  if (event && (event.shiftKey || event.ctrlKey || event.metaKey)) {
    props.editor.draft.toggleSelected(id);
    return;
  }
  const wall = draft.value?.walls.find((w) => w.id === id);
  const space = draft.value?.spaces.find((s) => s.id === id);
  const element = draft.value?.elements.find((e) => e.id === id);
  const points = wall ? [wall.start, wall.end] : element ? [element.position] : space?.polygon;
  if (points?.length) {
    props.editor.camera.setState({
      ...props.editor.camera.getState(),
      center: {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      },
    });
  }
  props.editor.draft.select(id);
}
function changeCoordinate(endpoint: "start" | "end", axis: "x" | "y", event: Event): void {
  const input = event.target as HTMLInputElement;
  const wall = selectedWall.value;
  const value = Number(input.value);
  if (!wall || !input.value.trim() || !Number.isFinite(value)) return;
  props.editor.draft.beginEdit();
  props.editor.draft.updateWall(
    wall.id,
    endpoint === "start" ? { ...wall.start, [axis]: value } : wall.start,
    endpoint === "end" ? { ...wall.end, [axis]: value } : wall.end,
  );
  props.editor.draft.commitEdit();
}
function edit(): void {
  if (draft.value?.floorId) props.editor.setFloor(draft.value.floorId);
  props.editor.setTool("draft-review");
}

function toggleWall(id: string): void {
  props.editor.draft.toggleWall(id);
}
function toggleSpace(id: string): void {
  props.editor.draft.toggleSpace(id);
}
function acceptAll(): void {
  props.editor.draft.setAllAccepted(true);
}
function rejectAll(): void {
  props.editor.draft.setAllAccepted(false);
}
function discard(): void {
  props.editor.setTool("select");
  props.editor.draft.clear();
}
function confirm(): void {
  props.editor.confirmDraft();
}
</script>

<template>
  <div v-if="draft" class="vectorize-panel">
    <h3>자동 감지 결과 검토</h3>
    <p class="hint">
      주황색: 포함 · 회색: 제외 · 파란색: 선택<br />선택한 항목을 드래그하면 한꺼번에 이동하고,
      이어진 벽과 방 윤곽이 따라옵니다(Alt: 연결 해제). 끝점·방 꼭짓점을 끌어 모양을 고치세요.<br />Shift/Ctrl+클릭,
      빈 곳·방 안에서 드래그(→ 완전히 포함 · ← 걸친 항목), Ctrl+A로 여러 개를 선택하고 Delete로
      제외하세요.
    </p>
    <button class="edit-button" @click="edit">캔버스에서 수정 (B)</button>
    <div class="bulk-actions">
      <button :disabled="!canUndo" @click="editor.draft.undo()">수정 취소</button
      ><button :disabled="!canRedo" @click="editor.draft.redo()">다시 실행</button>
    </div>
    <p v-if="wrongFloor" class="warning">
      다른 층의 초안입니다. ‘캔버스에서 수정’을 눌러 해당 층으로 이동하세요.
    </p>
    <div v-if="selectedCount > 1" class="coordinate-editor multi-selection">
      <strong>{{ selectedCount }}개 선택됨</strong>
      <div class="bulk-actions">
        <button @click="setSelectedAccepted(false)">선택 항목 제외 (Delete)</button>
        <button @click="setSelectedAccepted(true)">선택 항목 포함</button>
      </div>
      <button class="clear-selection" @click="editor.draft.select(null)">선택 해제 (Esc)</button>
    </div>
    <div v-if="selectedElement" class="coordinate-editor">
      <strong>건축 요소 후보 · 검토 필요</strong>
      <p>{{ selectedElement.reason }}</p>
      <label
        >종류<select :value="selectedElement.type" @change="elementType">
          <option
            v-for="type in selectedElement.supportWall ? ['opening', 'door', 'window'] : ['stairs']"
            :key="type"
            :value="type"
          >
            {{ labels[type] }}
          </option>
        </select></label
      >
      <label v-for="axis in ['x', 'y'] as const" :key="axis"
        >위치 {{ axis }} (m)<input
          type="number"
          step="0.01"
          :value="selectedElement.position[axis]"
          @change="elementPosition(axis, $event)"
      /></label>
      <label
        >폭 (m)<input
          type="number"
          min="0.1"
          step="0.01"
          :value="selectedElement.width"
          @change="elementNumber('width', $event)"
      /></label>
      <label
        >높이 (m · 추정 기본값)<input
          type="number"
          min="0.1"
          step="0.1"
          :value="
            selectedElement.height ??
            (selectedElement.type === 'stairs' ? 3 : selectedElement.type === 'window' ? 1.2 : 2.1)
          "
          @change="elementNumber('height', $event)"
      /></label>
      <label v-if="selectedElement.type === 'window'"
        >창문 하단 높이 (m)<input
          type="number"
          min="0"
          step="0.1"
          :value="selectedElement.sillHeight ?? 0.9"
          @change="elementNumber('sillHeight', $event)"
      /></label>
      <template v-if="selectedElement.type === 'stairs'">
        <label
          >오르는 방향 (°)<input
            type="number"
            step="any"
            :value="selectedElement.rotation"
            @change="elementNumber('rotation', $event)"
        /></label>
        <label
          >깊이 (m)<input
            type="number"
            min="0.1"
            step="0.01"
            :value="selectedElement.depth"
            @change="elementNumber('depth', $event)"
        /></label>
        <label
          >단수<input
            type="number"
            min="2"
            max="200"
            step="1"
            :value="selectedElement.stepCount"
            @change="elementNumber('stepCount', $event)"
        /></label>
      </template>
      <button @click="editor.draft.toggleElement(selectedElement.id)">
        {{ selectedElement.accepted ? "후보 제외" : "검토한 후보 포함" }}
      </button>
    </div>
    <div v-if="selectedWall" class="coordinate-editor">
      <strong
        >선택한 벽 ·
        {{
          Math.hypot(
            selectedWall.end.x - selectedWall.start.x,
            selectedWall.end.y - selectedWall.start.y,
          ).toFixed(2)
        }}
        m</strong
      >
      <label v-for="endpoint in ['start', 'end'] as const" :key="endpoint"
        >{{ endpoint === "start" ? "시작점" : "끝점" }} (m)<span
          ><input
            v-for="axis in ['x', 'y'] as const"
            :key="axis"
            :aria-label="`${endpoint} ${axis}`"
            type="number"
            step="0.01"
            :value="selectedWall[endpoint][axis]"
            @change="changeCoordinate(endpoint, axis, $event)" /></span
      ></label>
      <button @click="toggleWall(selectedWall.id)">
        {{ selectedWall.accepted ? "선택한 벽 제외" : "선택한 벽 복원" }}
      </button>
    </div>

    <p v-for="(warning, i) in draft.warnings" :key="i" class="warning">
      {{ warning }}
    </p>

    <div class="bulk-actions">
      <button @click="acceptAll">벽·방 전체 수락</button>
      <button @click="rejectAll">전체 거부</button>
    </div>

    <section v-if="draft.elements.length" class="list-section">
      <h4>건축 요소 후보 ({{ acceptedElementCount }}/{{ draft.elements.length }})</h4>
      <p class="hint">
        후보를 눌러 종류·치수·방향을 확인하세요. 계단을 포함하면 감지된 단선 벽을 대체합니다.
      </p>
      <div
        v-for="(element, index) in draft.elements"
        :key="element.id"
        class="list-row"
        :class="{ selected: isSelected(element.id) }"
      >
        <input
          type="checkbox"
          :aria-label="`후보 ${index + 1} 포함`"
          :checked="element.accepted"
          @change="editor.draft.toggleElement(element.id)"
        />
        <button @click="focus(element.id, $event)">
          {{ labels[element.type] }} {{ index + 1 }} · 검토 필요 ↗
        </button>
      </div>
    </section>

    <section v-if="draft.walls.length" class="list-section">
      <h4>벽 ({{ acceptedWallCount }}/{{ draft.walls.length }})</h4>
      <div
        v-for="(wall, index) in draft.walls"
        :key="wall.id"
        class="list-row"
        :class="{ selected: isSelected(wall.id) }"
      >
        <input
          type="checkbox"
          :aria-label="`벽 ${index + 1} 포함`"
          :checked="wall.accepted"
          @change="toggleWall(wall.id)"
        />
        <button @click="focus(wall.id, $event)">
          벽 {{ index + 1 }} ·
          {{ Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y).toFixed(2) }} m ↗
        </button>
      </div>
    </section>

    <section v-if="draft.spaces.length" class="list-section">
      <h4>방 ({{ acceptedSpaceCount }}/{{ draft.spaces.length }})</h4>
      <div
        v-for="(space, index) in draft.spaces"
        :key="space.id"
        class="list-row"
        :class="{ selected: isSelected(space.id) }"
      >
        <input
          type="checkbox"
          :aria-label="`방 ${index + 1} 포함`"
          :checked="space.accepted"
          @change="toggleSpace(space.id)"
        />
        <button @click="focus(space.id, $event)">
          방 {{ index + 1 }} · 꼭짓점 {{ space.polygon.length }}개{{
            space.needsReview ? " · 틈 경계 확인" : ""
          }}
          ↗
        </button>
      </div>
    </section>

    <p v-if="!draft.walls.length && !draft.spaces.length" class="hint">
      감지된 벽/방이 없습니다. 도면 대비를 확인하거나 축척을 보정해보세요.
    </p>

    <div class="confirm-actions">
      <button class="discard-button" @click="discard">취소</button>
      <button
        class="confirm-button"
        :disabled="wrongFloor || confirmedCount === 0"
        @click="confirm"
      >
        확정 ({{ confirmedCount }}개 추가)
      </button>
    </div>
    <p class="hint">
      확정 후에도 선택 도구로 벽을 수정할 수 있습니다. 확정 전체는 실행 취소 한 번으로 되돌립니다.
    </p>
  </div>
</template>

<style scoped>
.edit-button,
.coordinate-editor button {
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--text-primary);
  padding: 8px;
}
.edit-button:hover:not(:disabled),
.coordinate-editor button:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
}
.coordinate-editor {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-size: 12px;
}
.coordinate-editor label span {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.coordinate-editor input {
  width: 50%;
}
.list-row {
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out);
}
.list-row:hover {
  background: var(--surface-2);
}
.list-row.selected {
  background: var(--accent-soft);
}
.list-row button {
  flex: 1;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  padding: 6px;
}
.list-row button:hover:not(:disabled) {
  background: transparent;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.vectorize-panel {
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
h4 {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.warning {
  margin: 0;
  font-size: 11px;
  color: var(--warning);
  line-height: 1.4;
}
.bulk-actions {
  display: flex;
  gap: 6px;
}
.bulk-actions button {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
}
.list-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}
.list-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 0;
  cursor: pointer;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}
.confirm-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.discard-button {
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid var(--danger-border);
  padding: 6px 10px;
  font-size: 12px;
}
.discard-button:hover:not(:disabled) {
  background: var(--danger-border);
}
.confirm-button {
  flex: 1;
  background: var(--success-soft);
  color: var(--success);
  border: 1px solid var(--success-border);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
}
.confirm-button:hover:not(:disabled) {
  background: var(--success-border);
}
.confirm-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
