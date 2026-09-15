<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { IndoorEditor } from "@indoor/editor";

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
const acceptedSpaceCount = computed(() => draft.value?.spaces.filter((s) => s.accepted).length ?? 0);
const selectedWall = computed(() => { revision.value; return draft.value?.walls.find(w => w.id === props.editor.draft.selectedId); });
const wrongFloor = computed(() => { revision.value; return !!draft.value?.floorId && draft.value.floorId !== props.editor.getActiveFloor()?.id; });
const canUndo = computed(() => { revision.value; return props.editor.draft.canUndo; });
const canRedo = computed(() => { revision.value; return props.editor.draft.canRedo; });
function focus(id: string): void {
  if (draft.value?.floorId) props.editor.setFloor(draft.value.floorId);
  props.editor.setTool('draft-review');
  const wall = draft.value?.walls.find(w => w.id === id);
  const space = draft.value?.spaces.find(s => s.id === id);
  const points = wall ? [wall.start, wall.end] : space?.polygon;
  if (points?.length) {
    props.editor.camera.setState({ ...props.editor.camera.getState(), center: { x: points.reduce((s,p) => s+p.x,0)/points.length, y: points.reduce((s,p) => s+p.y,0)/points.length } });
  }
  props.editor.draft.select(id);
}
function changeCoordinate(endpoint: 'start' | 'end', axis: 'x' | 'y', event: Event): void {
  const input = event.target as HTMLInputElement;
  const wall = selectedWall.value;
  const value = Number(input.value);
  if (!wall || !input.value.trim() || !Number.isFinite(value)) return;
  props.editor.draft.beginEdit();
  props.editor.draft.updateWall(wall.id, endpoint === 'start' ? { ...wall.start, [axis]: value } : wall.start, endpoint === 'end' ? { ...wall.end, [axis]: value } : wall.end);
  props.editor.draft.commitEdit();
}
function edit(): void {
  if (draft.value?.floorId) props.editor.setFloor(draft.value.floorId);
  props.editor.setTool('draft-review');
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
  props.editor.setTool('select');
  props.editor.draft.clear();
}
function confirm(): void {
  props.editor.confirmDraft();
}
</script>

<template>
  <div v-if="draft" class="vectorize-panel">
    <h3>자동 감지 결과 검토</h3>
    <p class="hint">주황색: 포함 · 회색: 제외 · 하늘색: 선택<br>벽을 드래그해 이동하고, 끝점이나 방 꼭짓점을 끌어 수정하세요. Delete로 제외할 수 있습니다.</p>
    <button class="edit-button" @click="edit">캔버스에서 수정 (B)</button>
    <div class="bulk-actions"><button :disabled="!canUndo" @click="editor.draft.undo()">수정 취소</button><button :disabled="!canRedo" @click="editor.draft.redo()">다시 실행</button></div>
    <p v-if="wrongFloor" class="warning">다른 층의 초안입니다. ‘캔버스에서 수정’을 눌러 해당 층으로 이동하세요.</p>
    <p v-if="draft.roomsNeedReview" class="warning">벽을 수정해 방의 자동 선택을 해제했습니다. 방 윤곽을 확인·수정한 뒤 포함할 방을 다시 선택하세요.</p>
    <div v-if="selectedWall" class="coordinate-editor">
      <strong>선택한 벽 · {{ Math.hypot(selectedWall.end.x-selectedWall.start.x, selectedWall.end.y-selectedWall.start.y).toFixed(2) }} m</strong>
      <label v-for="endpoint in (['start','end'] as const)" :key="endpoint">{{ endpoint === 'start' ? '시작점' : '끝점' }} (m)<span><input v-for="axis in (['x','y'] as const)" :key="axis" :aria-label="`${endpoint} ${axis}`" type="number" step="0.01" :value="selectedWall[endpoint][axis]" @change="changeCoordinate(endpoint, axis, $event)" /></span></label>
      <button @click="toggleWall(selectedWall.id)">{{ selectedWall.accepted ? '선택한 벽 제외' : '선택한 벽 복원' }}</button>
    </div>

    <p v-for="(warning, i) in draft.warnings" :key="i" class="warning">
      {{ warning }}
    </p>

    <div class="bulk-actions">
      <button @click="acceptAll">전체 수락</button>
      <button @click="rejectAll">전체 거부</button>
    </div>

    <section v-if="draft.walls.length" class="list-section">
      <h4>벽 ({{ acceptedWallCount }}/{{ draft.walls.length }})</h4>
      <div v-for="(wall, index) in draft.walls" :key="wall.id" class="list-row" :class="{selected: editor.draft.selectedId === wall.id}">
        <input type="checkbox" :aria-label="`벽 ${index+1} 포함`" :checked="wall.accepted" @change="toggleWall(wall.id)" />
        <button @click="focus(wall.id)">벽 {{ index+1 }} · {{ Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y).toFixed(2) }} m ↗</button>
      </div>
    </section>

    <section v-if="draft.spaces.length" class="list-section">
      <h4>방 ({{ acceptedSpaceCount }}/{{ draft.spaces.length }})</h4>
      <div v-for="(space, index) in draft.spaces" :key="space.id" class="list-row" :class="{selected: editor.draft.selectedId === space.id}">
        <input type="checkbox" :aria-label="`방 ${index+1} 포함`" :checked="space.accepted" @change="toggleSpace(space.id)" />
        <button @click="focus(space.id)">방 {{ index+1 }} · 꼭짓점 {{ space.polygon.length }}개 ↗</button>
      </div>
    </section>

    <p v-if="!draft.walls.length && !draft.spaces.length" class="hint">
      감지된 벽/방이 없습니다. 도면 대비를 확인하거나 축척을 보정해보세요.
    </p>

    <div class="confirm-actions">
      <button class="discard-button" @click="discard">취소</button>
      <button class="confirm-button" :disabled="wrongFloor || acceptedWallCount + acceptedSpaceCount === 0" @click="confirm">
        확정 ({{ acceptedWallCount + acceptedSpaceCount }}개 추가)
      </button>
    </div>
    <p class="hint">확정 후에도 선택 도구로 벽을 수정할 수 있습니다. 확정 전체는 실행 취소 한 번으로 되돌립니다.</p>
  </div>
</template>

<style scoped>
.edit-button,.coordinate-editor button { background:#30365d; border:1px solid #626ee5; color:#eee; padding:8px; border-radius:6px; cursor:pointer; }
.coordinate-editor { display:grid; gap:8px; padding:10px; background:#20232e; border:1px solid #46566a; border-radius:6px; font-size:12px; }
.coordinate-editor label span { display:flex; gap:4px; margin-top:4px; }.coordinate-editor input { width:50%; background:#191920; color:#eee; border:1px solid #454555; border-radius:4px; padding:6px; }
.list-row.selected { background:#253c4a; }.list-row button { flex:1; text-align:left; background:transparent; border:0; color:inherit; padding:6px; cursor:pointer; }
button:disabled { opacity:.4; cursor:not-allowed; }
.vectorize-panel {
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
h4 {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: #b0b0b8;
}
.warning {
  margin: 0;
  font-size: 11px;
  color: #ffcf80;
  line-height: 1.4;
}
.bulk-actions {
  display: flex;
  gap: 6px;
}
.bulk-actions button {
  flex: 1;
  background: #232329;
  color: #e8e8ec;
  border: 1px solid #35353d;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
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
  color: #c7c7cf;
  padding: 2px 0;
  cursor: pointer;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: #71717a;
  line-height: 1.4;
}
.confirm-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.discard-button {
  background: #3a2323;
  color: #ffb3b3;
  border: 1px solid #5a3535;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.confirm-button {
  flex: 1;
  background: #23392a;
  color: #a9ffca;
  border: 1px solid #35594a;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.confirm-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
