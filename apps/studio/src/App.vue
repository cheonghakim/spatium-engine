<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  projectToGeoJSON,
  serializeProject,
} from "@indoor/core";
import { IndoorEditor } from "@indoor/editor";
import StudioCanvas from "./components/StudioCanvas.vue";
import Preview3D from "./components/Preview3D.vue";
import LayersPanel from "./components/LayersPanel.vue";
import ReferencePanel from "./components/ReferencePanel.vue";
import VectorizePanel from "./components/VectorizePanel.vue";
import PropertyPanel from "./components/PropertyPanel.vue";
import FloorSwitcher from "./components/FloorSwitcher.vue";
import BuildingSwitcher from "./components/BuildingSwitcher.vue";
import RoutePanel from "./components/RoutePanel.vue";
import ValidationPanel from "./components/ValidationPanel.vue";

const project = createEmptyProject("spatium-engine");
const building = createBuilding("Building A");
const floor = createFloor("1F", 1);
building.floors.push(floor);
project.buildings.push(building);

const editor = new IndoorEditor({ project });
const revision = ref(0);
const panel = ref('properties');
const canvas = ref<InstanceType<typeof StudioCanvas> | null>(null);

const activeBuildingId = ref(building.id);
const activeBuilding = computed(
  () => {
    revision.value;
    return project.buildings.find((b) => b.id === activeBuildingId.value) ?? project.buildings[0] ?? building;
  },
);

function onSelectBuilding(buildingId: string): void {
  activeBuildingId.value = buildingId;
  const targetBuilding = project.buildings.find((b) => b.id === buildingId);
  const firstFloor = targetBuilding?.floors[0];
  if (firstFloor) editor.setFloor(firstFloor.id);
}

const ui = reactive({
  activeToolId: editor.tools.active?.id ?? "select",
  canUndo: editor.history.canUndo,
  canRedo: editor.history.canRedo,
});

const show3d = ref(false);
function toggle3d(): void {
  show3d.value = !show3d.value;
}

const gridSnapEnabled = ref(editor.gridSnap.isEnabled());
function toggleGridSnap(): void {
  gridSnapEnabled.value = !gridSnapEnabled.value;
  editor.gridSnap.setEnabled(gridSnapEnabled.value);
}

function syncHistoryState(): void {
  revision.value++;
  const owner = project.buildings.find(b => b.floors.some(f => f.id === editor.getActiveFloor()?.id));
  if (owner) activeBuildingId.value = owner.id;
  ui.canUndo = editor.tools.active?.id === 'draft-review' ? editor.draft.canUndo : editor.history.canUndo;
  ui.canRedo = editor.tools.active?.id === 'draft-review' ? editor.draft.canRedo : editor.history.canRedo;
}

function onCalibrationPointsPicked({
  a,
  b,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
}): void {
  const input = window.prompt("두 점 사이의 실제 거리를 입력하세요 (m):", "1");
  if (input === null) return;
  const meters = Number(input);
  if (!Number.isFinite(meters) || meters <= 0) return;
  editor.reference.calibrate(a, b, meters);
  editor.setTool("select");
}

let unsubscribers: Array<() => void> = [];

onMounted(() => {
  window.addEventListener('keydown', onShortcut);
  unsubscribers = [
    editor.on("toolChanged", (toolId) => {
      ui.activeToolId = toolId;
      if (toolId === 'draft-review') panel.value = 'review';
      syncHistoryState();
    }),
    editor.on("projectChanged", syncHistoryState),
    editor.on("calibrationPointsPicked", onCalibrationPointsPicked),
  ];
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcut);
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const tools = [
  { id: 'draft-review', label: '감지 결과 수정', key: 'B', hint: '벽 클릭·드래그: 이동 · 끝점 드래그: 길이 수정 · Delete: 제외 · Shift: 수평/수직 · Alt: 붙이기 해제' },
  { id: "select", label: "선택", key: "V", hint: "객체를 클릭해 속성을 수정하세요. Shift: 다중 선택 · Delete: 삭제 · Space/휠 클릭 드래그: 화면 이동" },
  { id: "polygon", label: "공간 그리기", key: "R", hint: "꼭짓점을 3개 이상 클릭한 후 Enter 또는 시작점을 클릭해 완성하세요. Esc: 취소" },
  { id: "wall", label: "벽 그리기", key: "W", hint: "시작점과 끝점을 클릭해 벽을 만드세요. Esc: 취소" },
  { id: "door", label: "출입구", key: "D", hint: "클릭해 배치한 뒤 속성에서 문·창문·계단으로 바꾸고 치수를 조정하세요. 문·창문은 벽 가까이에 배치합니다." },
  { id: "poi", label: "관심 지점", key: "P", hint: "지도 위를 클릭해 관심 지점을 추가하고 속성에서 이름을 입력하세요." },
  { id: "navigation", label: "경로 그리기", key: "N", hint: "빈 곳을 클릭해 지점을 잇따라 추가하세요. 기존 지점을 클릭하면 그 지점에 연결됩니다. Esc: 연결 끊기" },
  { id: "calibrate", label: "축척 보정", key: "C", hint: "도면의 두 점을 클릭한 후 실제 거리(m)를 입력하세요." },
];
const activeTool = computed(() => tools.find(t => t.id === ui.activeToolId)!);
const hasReference = computed(() => { revision.value; return !!editor.reference.current; });
const empty = computed(() => {
  revision.value;
  const f = editor.getActiveFloor();
  return f && !f.spaces.length && !f.walls.length && !f.entrances.length && !f.pois.length && !f.navigation.nodes.length && !hasReference.value;
});
function onShortcut(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable=true]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || show3d.value) return;
  const tool = tools.find(t => t.key.toLowerCase() === event.key.toLowerCase());
  if (tool && (tool.id !== 'calibrate' || hasReference.value) && (tool.id !== 'draft-review' || editor.draft.hasDraft)) { event.preventDefault(); selectTool(tool.id); }
}

function selectTool(id: string): void {
  show3d.value = false;
  editor.setTool(id);
}

function undo(): void {
  editor.undo();
}

function redo(): void {
  editor.redo();
}

function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson(): void {
  downloadFile(
    `${project.name}.map.json`,
    serializeProject(project),
    "application/json",
  );
}

function exportGeoJson(): void {
  downloadFile(
    `${project.name}.geojson`,
    JSON.stringify(projectToGeoJSON(project), null, 2),
    "application/geo+json",
  );
}
</script>

<template>
  <div class="studio">
    <header class="topbar">
      <span class="brand">S <strong>SPATIUM</strong></span>
      <span class="project-name">{{ project.name }}</span>
      <BuildingSwitcher
        :editor="editor"
        :project="project"
        :active-building-id="activeBuildingId"
        @select="onSelectBuilding"
      />
      <FloorSwitcher :editor="editor" :building="activeBuilding" />
      <div class="spacer" />
      <button class="compact" :disabled="!ui.canUndo" title="Ctrl/⌘ Z" @click="undo">↶ 실행 취소</button>
      <button class="compact" :disabled="!ui.canRedo" title="Ctrl/⌘ Shift Z" @click="redo">↷ 다시 실행</button>
      <button class="compact" :class="{ active: show3d }" @click="toggle3d">{{ show3d ? '2D 편집으로' : '3D 미리보기' }}</button>
      <details class="export-menu"><summary class="compact">내보내기 ↓</summary><div><button @click="exportJson">프로젝트 JSON</button><button @click="exportGeoJson">지도 GeoJSON</button></div></details>
    </header>

    <div class="body">
      <aside class="sidebar left">
        <section>
          <h3>편집 도구</h3>
          <div class="tools">
            <button
              v-for="tool in tools"
              :key="tool.id"
              :class="{ active: ui.activeToolId === tool.id }"
              :aria-pressed="ui.activeToolId === tool.id"
              :disabled="(tool.id === 'calibrate' && !hasReference) || (tool.id === 'draft-review' && !editor.draft.hasDraft)"
              :title="tool.id === 'calibrate' && !hasReference ? '도면을 먼저 업로드하세요' : tool.hint"
              @click="selectTool(tool.id)"
            >
              {{ tool.label }} <kbd>{{ tool.key }}</kbd>
            </button>
          </div>
        </section>

        <section>
          <LayersPanel :editor="editor" />
        </section>
      </aside>

      <main class="canvas-area">
        <div class="canvas-heading"><strong>{{ show3d ? '3D 미리보기' : activeTool.label }}</strong><p>{{ show3d ? '2D 편집으로 돌아가 지도를 수정할 수 있습니다.' : activeTool.hint }}</p></div>
        <div class="viewport">
        <StudioCanvas v-if="!show3d" ref="canvas" :editor="editor" />
        <Preview3D v-else :editor="editor" />
        <div v-if="empty && !show3d && ui.activeToolId === 'select'" class="welcome"><span class="hint">시작하기</span><h1>첫 공간을 그려보세요</h1><p>도면을 불러와 따라 그리거나,<br>공간 도구로 지도를 직접 만들 수 있습니다.</p><div><button class="active" @click="selectTool('polygon')">＋ 공간 그리기</button><button @click="panel = 'reference'">도면 불러오기</button></div><small>도면 → 공간과 벽 → 경로 연결 → 내보내기</small></div>
        <div v-if="!show3d" class="zoom-controls"><button :aria-pressed="canvas?.showGrid" @click="canvas?.toggleGrid()">격자</button><button title="격자에 맞춰 정렬합니다" :class="{ active: gridSnapEnabled }" :aria-pressed="gridSnapEnabled" @click="toggleGridSnap">격자 맞춤</button><button aria-label="축소" @click="canvas?.zoomBy(1 / 1.2)">−</button><button @click="canvas?.resetView()">화면 초기화</button><button aria-label="확대" @click="canvas?.zoomBy(1.2)">＋</button></div>
        </div>
      </main>

      <aside class="sidebar right">
        <nav class="panel-tabs" aria-label="작업 패널"><button v-for="tab in [{id:'properties',label:'속성'},{id:'reference',label:'도면'},{id:'route',label:'경로'},{id:'review',label:'검토'}]" :key="tab.id" :class="{active:panel === tab.id}" :aria-pressed="panel === tab.id" @click="panel = tab.id">{{ tab.label }}</button></nav>
        <section v-show="panel === 'properties'">
          <PropertyPanel :editor="editor" />
        </section>
        <section v-show="panel === 'route'">
          <RoutePanel :editor="editor" />
        </section>
        <section v-show="panel === 'reference'">
          <ReferencePanel :editor="editor" />
        </section>
        <section v-show="panel === 'review'">
          <VectorizePanel :editor="editor" />
        </section>
      </aside>
    </div>

    <footer class="statusbar">
      <ValidationPanel :editor="editor" />
    </footer>
  </div>
</template>



<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 480px;
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 13px;
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--accent);
  font-size: 21px;
  font-weight: 800;
}
.brand strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
}
.project-name {
  color: var(--text-tertiary);
  font-size: 12px;
  margin-left: 12px;
}
.spacer {
  flex: 1;
}
.topbar button.compact,
.topbar summary.compact {
  padding: 6px 10px;
  font-size: 12px;
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.export-menu {
  position: relative;
}
.export-menu summary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}
.export-menu summary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.export-menu > div {
  position: absolute;
  z-index: 20;
  right: 0;
  top: 40px;
  width: 190px;
  padding: 8px;
  display: grid;
  gap: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  animation: menu-in var(--dur) var(--ease-out);
}

.sidebar {
  flex-shrink: 0;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 12px;
  overflow-y: auto;
}
.sidebar.left {
  width: 190px;
  background: var(--surface-1);
  border-right: 1px solid var(--border-subtle);
}
.sidebar.right {
  width: 280px;
  background: var(--surface-1);
  border-left: 1px solid var(--border-subtle);
}
.sidebar h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.left section + section {
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.tools {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.tools button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  background: transparent;
  border-color: transparent;
  padding: 7px 8px;
  font-size: 12px;
}
.tools button:hover:not(:disabled):not(.active) {
  background: var(--surface-2);
  border-color: var(--border);
}
kbd {
  font: 600 10px var(--font-sans);
  color: var(--text-tertiary);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xs);
  width: 20px;
  text-align: center;
}
.hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.6;
}

.canvas-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.canvas-heading {
  padding: 12px 18px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
}
.canvas-heading p {
  color: var(--text-tertiary);
  font-size: 12px;
  margin: 5px 0 0;
}
.viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.welcome {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(410px, 90%);
  padding: 32px 26px;
  background: rgba(24, 24, 29, 0.92);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  text-align: center;
  box-shadow: var(--shadow-lg);
  animation: welcome-in 0.4s var(--ease-out);
}
.welcome .hint {
  display: inline-block;
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
}
.welcome h1 {
  font-size: 23px;
  margin: 14px 0 8px;
}
.welcome p {
  color: var(--text-secondary);
  line-height: 1.8;
}
.welcome > div {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin: 20px 0;
}
.welcome small {
  color: var(--text-tertiary);
  font-size: 11px;
}
.zoom-controls {
  position: absolute;
  bottom: 18px;
  right: 18px;
  display: flex;
  gap: 4px;
  padding: 5px;
  background: var(--overlay);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.zoom-controls button {
  font-size: 12px;
}

.panel-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 12px;
}
.panel-tabs button {
  flex: 1;
  padding: 7px 4px;
}
.sidebar :deep(.hint),
.sidebar :deep(.empty-hint) {
  color: var(--text-tertiary);
  line-height: 1.7;
}
.sidebar :deep(input),
.sidebar :deep(select) {
  min-width: 0;
  max-width: 100%;
}

.statusbar {
  max-height: 120px;
  padding: 10px 16px;
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
  overflow-y: auto;
  flex-shrink: 0;
}

@keyframes welcome-in {
  from {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1100px) {
  .left { width: 160px; }
  .right { width: 235px; }
  .project-name { display: none; }
  .topbar { padding: 8px 12px; }
}
@media (max-width: 760px) {
  .studio { height: auto; min-height: 100dvh; }
  .body { flex-wrap: wrap; }
  .left { width: 132px; padding: 12px 8px; }
  .right { width: 100%; border-left: 0; border-top: 1px solid var(--border-subtle); max-height: 360px; }
  .canvas-area { min-height: 520px; }
  .tools { grid-template-columns: 1fr; }
  .tools button { padding: 8px 4px; }
  kbd { display: none; }
  .welcome { padding: 20px 12px; }
  .welcome h1 { font-size: 19px; }
  .welcome > div { flex-wrap: wrap; }
}
</style>
