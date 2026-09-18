<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  deserializeProject,
  InvalidProjectDataError,
  projectToGeoJSON,
  SchemaVersionMismatchError,
  serializeProject,
  type IndoorProject,
} from "@indoor/core";
import { IndoorEditor } from "@indoor/editor";
import {
  mdiAutoFix,
  mdiCursorDefault,
  mdiShapePolygonPlus,
  mdiWall,
  mdiDoor,
  mdiMapMarker,
  mdiRoutes,
  mdiRulerSquareCompass,
} from "@mdi/js";
import MdiIcon from "./components/MdiIcon.vue";
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

const AUTOSAVE_KEY = "spatium-studio:autosave";

function createDefaultProject(): IndoorProject {
  const defaultProject = createEmptyProject("spatium-engine");
  const building = createBuilding("Building A");
  const floor = createFloor("1F", 1);
  building.floors.push(floor);
  defaultProject.buildings.push(building);
  return defaultProject;
}

/** Reads and validates the autosaved project, if any. Never throws — a missing or corrupt autosave just means "nothing to restore". */
function loadAutosavedProject(): IndoorProject | null {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return deserializeProject(raw);
  } catch {
    return null;
  }
}

const restoredProject = loadAutosavedProject();
const editor = new IndoorEditor({ project: restoredProject ?? createDefaultProject() });
const revision = ref(0);
const panel = ref("properties");
const canvas = ref<InstanceType<typeof StudioCanvas> | null>(null);
const referencePanel = ref<InstanceType<typeof ReferencePanel> | null>(null);
function openReferenceUpload(): void {
  panel.value = "reference";
  referencePanel.value?.triggerUpload();
}
const restoredNotice = ref(restoredProject !== null);

// Gated on `revision` (bumped by the editor's events) rather than read directly,
// since `editor.project` is reassigned wholesale by loadProject — a plain
// destructured reference would go stale across a new-project/open/autosave-restore swap.
const currentProject = computed(() => {
  revision.value;
  return editor.project;
});

const activeBuildingId = ref(currentProject.value.buildings[0]?.id ?? "");
const activeBuilding = computed(() => {
  revision.value;
  return (
    currentProject.value.buildings.find((b) => b.id === activeBuildingId.value) ??
    currentProject.value.buildings[0]
  );
});

function onSelectBuilding(buildingId: string): void {
  activeBuildingId.value = buildingId;
  const targetBuilding = currentProject.value.buildings.find((b) => b.id === buildingId);
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
  const owner = editor.project.buildings.find((b) =>
    b.floors.some((f) => f.id === editor.getActiveFloor()?.id),
  );
  if (owner) activeBuildingId.value = owner.id;
  ui.canUndo =
    editor.tools.active?.id === "draft-review" ? editor.draft.canUndo : editor.history.canUndo;
  ui.canRedo =
    editor.tools.active?.id === "draft-review" ? editor.draft.canRedo : editor.history.canRedo;
}

/**
 * A full project swap (new/open/autosave-restore) invalidates App.vue's own
 * locally-held UI state, not just the editor's internal state that
 * `loadProject` already resets — `syncHistoryState` (driven by the
 * accompanying `projectChanged`) re-derives `activeBuildingId` from the new
 * active floor already, but only when the new project *has* a floor; this
 * covers the empty-project case too and resets the view-level state that has
 * no equivalent inside the editor.
 */
function onProjectLoaded(): void {
  revision.value++;
  activeBuildingId.value = editor.project.buildings[0]?.id ?? "";
  show3d.value = false;
  panel.value = "properties";
}

function hasUnsavedContent(): boolean {
  return currentProject.value.buildings.some((b) =>
    b.floors.some(
      (f) =>
        f.spaces.length ||
        f.walls.length ||
        f.entrances.length ||
        f.pois.length ||
        f.navigation.nodes.length,
    ),
  );
}

const openError = ref("");

function newProject(): void {
  if (
    hasUnsavedContent() &&
    !window.confirm("현재 작업 내용이 저장되지 않고 사라집니다. 새 프로젝트를 시작할까요?")
  )
    return;
  openError.value = "";
  editor.loadProject(createDefaultProject());
}

async function onOpenFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = deserializeProject(text);
    editor.loadProject(parsed);
    openError.value = "";
  } catch (error) {
    if (error instanceof SchemaVersionMismatchError) {
      openError.value = "지원하지 않는 프로젝트 파일 버전입니다.";
    } else if (error instanceof InvalidProjectDataError) {
      openError.value = "프로젝트 파일의 형식이 올바르지 않습니다.";
    } else {
      openError.value = "프로젝트 파일을 열 수 없습니다. 올바른 JSON 파일인지 확인하세요.";
    }
  }
}

function dismissRestoredNotice(): void {
  restoredNotice.value = false;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, serializeProject(editor.project));
    } catch {
      // localStorage unavailable (private mode, quota exceeded, etc.) — autosave is best-effort.
    }
  }, 1000);
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
  window.addEventListener("keydown", onShortcut);
  unsubscribers = [
    editor.on("toolChanged", (toolId) => {
      ui.activeToolId = toolId;
      if (toolId === "draft-review") panel.value = "review";
      syncHistoryState();
    }),
    editor.on("projectChanged", syncHistoryState),
    editor.on("projectChanged", scheduleAutosave),
    editor.on("projectLoaded", onProjectLoaded),
    editor.on("calibrationPointsPicked", onCalibrationPointsPicked),
  ];
  if (restoredNotice.value)
    setTimeout(() => {
      restoredNotice.value = false;
    }, 6000);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onShortcut);
  for (const unsubscribe of unsubscribers) unsubscribe();
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
});

const tools = [
  {
    id: "draft-review",
    label: "감지 결과 수정",
    icon: mdiAutoFix,
    key: "B",
    hint: "벽 클릭·드래그: 이동 · 끝점 드래그: 길이 수정 · Delete: 제외 · Shift: 수평/수직 · Alt: 붙이기 해제",
  },
  {
    id: "select",
    label: "선택",
    icon: mdiCursorDefault,
    key: "V",
    hint: "객체를 클릭해 속성을 수정하세요. Shift: 다중 선택 · Delete: 삭제 · Space/휠 클릭 드래그: 화면 이동",
  },
  {
    id: "polygon",
    label: "공간 그리기",
    icon: mdiShapePolygonPlus,
    key: "R",
    hint: "꼭짓점을 3개 이상 클릭한 후 Enter 또는 시작점을 클릭해 완성하세요. Esc: 취소",
  },
  {
    id: "wall",
    label: "벽 그리기",
    icon: mdiWall,
    key: "W",
    hint: "시작점과 끝점을 클릭해 벽을 만드세요. Esc: 취소",
  },
  {
    id: "door",
    label: "출입구",
    icon: mdiDoor,
    key: "D",
    hint: "클릭해 배치한 뒤 속성에서 문·창문·계단으로 바꾸고 치수를 조정하세요. 문·창문은 벽 가까이에 배치합니다.",
  },
  {
    id: "poi",
    label: "관심 지점",
    icon: mdiMapMarker,
    key: "P",
    hint: "지도 위를 클릭해 관심 지점을 추가하고 속성에서 이름을 입력하세요.",
  },
  {
    id: "navigation",
    label: "경로 그리기",
    icon: mdiRoutes,
    key: "N",
    hint: "빈 곳을 클릭해 지점을 잇따라 추가하세요. 기존 지점을 클릭하면 그 지점에 연결됩니다. Esc: 연결 끊기",
  },
  {
    id: "calibrate",
    label: "축척 보정",
    icon: mdiRulerSquareCompass,
    key: "C",
    hint: "도면의 두 점을 클릭한 후 실제 거리(m)를 입력하세요.",
  },
];
const activeTool = computed(() => tools.find((t) => t.id === ui.activeToolId)!);
function toolTitle(tool: (typeof tools)[number]): string {
  if (tool.id === "calibrate" && !hasReference.value) return "도면을 먼저 업로드하세요";
  if (tool.id === "draft-review" && !editor.draft.hasDraft)
    return "도면을 업로드하고 자동 벡터화를 실행하면 결과를 검토할 수 있습니다";
  return `${tool.label}\n${tool.hint}`;
}
const hasReference = computed(() => {
  revision.value;
  return !!editor.reference.current;
});
const empty = computed(() => {
  revision.value;
  const f = editor.getActiveFloor();
  return (
    f &&
    !f.spaces.length &&
    !f.walls.length &&
    !f.entrances.length &&
    !f.pois.length &&
    !f.navigation.nodes.length &&
    !hasReference.value
  );
});
function onShortcut(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]"))
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || show3d.value) return;
  const tool = tools.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
  if (
    tool &&
    (tool.id !== "calibrate" || hasReference.value) &&
    (tool.id !== "draft-review" || editor.draft.hasDraft)
  ) {
    event.preventDefault();
    selectTool(tool.id);
  }
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

function downloadFile(filename: string, content: string, mimeType: string): void {
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
    `${currentProject.value.name}.map.json`,
    serializeProject(currentProject.value),
    "application/json",
  );
}

function exportGeoJson(): void {
  downloadFile(
    `${currentProject.value.name}.geojson`,
    JSON.stringify(projectToGeoJSON(currentProject.value), null, 2),
    "application/geo+json",
  );
}
</script>

<template>
  <div class="studio">
    <header class="topbar">
      <span class="brand">S <strong>SPATIUM</strong></span>
      <span class="project-name">{{ currentProject.name }}</span>
      <span v-if="restoredNotice" class="restored-badge" role="status">
        이전 작업이 복원되었습니다
        <button class="dismiss" type="button" aria-label="알림 닫기" @click="dismissRestoredNotice">
          ×
        </button>
      </span>
      <BuildingSwitcher
        :editor="editor"
        :project="currentProject"
        :active-building-id="activeBuildingId"
        @select="onSelectBuilding"
      />
      <FloorSwitcher v-if="activeBuilding" :editor="editor" :building="activeBuilding" />
      <div class="spacer" />
      <button class="compact" :disabled="!ui.canUndo" title="Ctrl/⌘ Z" @click="undo">
        ↶ 실행 취소
      </button>
      <button class="compact" :disabled="!ui.canRedo" title="Ctrl/⌘ Shift Z" @click="redo">
        ↷ 다시 실행
      </button>
      <button class="compact" :class="{ active: show3d }" @click="toggle3d">
        {{ show3d ? "2D 편집으로" : "3D 미리보기" }}
      </button>
      <button class="compact" @click="newProject">새 프로젝트</button>
      <label class="compact upload-button">
        불러오기
        <input type="file" accept=".json,application/json" @change="onOpenFile" />
      </label>
      <details class="export-menu">
        <summary class="compact">내보내기 ↓</summary>
        <div>
          <button @click="exportJson">프로젝트 JSON</button
          ><button @click="exportGeoJson">지도 GeoJSON</button>
        </div>
      </details>
      <span v-if="openError" class="error-text" role="alert">{{ openError }}</span>
    </header>

    <div class="body">
      <aside class="sidebar left">
        <section>
          <h3>편집 도구</h3>
          <div class="tools">
            <button
              v-for="tool in tools"
              :key="tool.id"
              class="tool"
              :class="{ active: ui.activeToolId === tool.id }"
              :aria-pressed="ui.activeToolId === tool.id"
              :aria-label="tool.label"
              :disabled="
                (tool.id === 'calibrate' && !hasReference) ||
                (tool.id === 'draft-review' && !editor.draft.hasDraft)
              "
              :title="toolTitle(tool)"
              @click="selectTool(tool.id)"
            >
              <MdiIcon :path="tool.icon" :size="20" />
              <kbd>{{ tool.key }}</kbd>
            </button>
          </div>
        </section>

        <section>
          <LayersPanel :editor="editor" />
        </section>
      </aside>

      <main class="canvas-area">
        <div class="canvas-heading">
          <strong>{{ show3d ? "3D 미리보기" : activeTool.label }}</strong>
          <p>{{ show3d ? "2D 편집으로 돌아가 지도를 수정할 수 있습니다." : activeTool.hint }}</p>
        </div>
        <div class="viewport">
          <StudioCanvas v-if="!show3d" ref="canvas" :editor="editor" />
          <Preview3D v-else :editor="editor" />
          <div v-if="empty && !show3d && ui.activeToolId === 'select'" class="welcome">
            <span class="hint">시작하기</span>
            <h1>첫 공간을 그려보세요</h1>
            <p>도면을 불러와 따라 그리거나,<br />공간 도구로 지도를 직접 만들 수 있습니다.</p>
            <div>
              <button class="active" @click="selectTool('polygon')">＋ 공간 그리기</button
              ><button @click="openReferenceUpload">도면 불러오기</button>
            </div>
            <small>도면 → 공간과 벽 → 경로 연결 → 내보내기</small>
          </div>
          <div v-if="!show3d" class="zoom-controls">
            <button :aria-pressed="canvas?.showGrid" @click="canvas?.toggleGrid()">격자</button
            ><button
              title="격자에 맞춰 정렬합니다"
              :class="{ active: gridSnapEnabled }"
              :aria-pressed="gridSnapEnabled"
              @click="toggleGridSnap"
            >
              격자 맞춤</button
            ><button aria-label="축소" @click="canvas?.zoomBy(1 / 1.2)">−</button
            ><button @click="canvas?.resetView()">화면 초기화</button
            ><button aria-label="확대" @click="canvas?.zoomBy(1.2)">＋</button>
          </div>
        </div>
      </main>

      <aside class="sidebar right">
        <nav class="panel-tabs" aria-label="작업 패널">
          <button
            v-for="tab in [
              { id: 'properties', label: '속성' },
              { id: 'reference', label: '도면' },
              { id: 'route', label: '경로' },
              { id: 'review', label: '검토' },
            ]"
            :key="tab.id"
            :class="{ active: panel === tab.id }"
            :aria-pressed="panel === tab.id"
            @click="panel = tab.id"
          >
            {{ tab.label }}
          </button>
        </nav>
        <section v-show="panel === 'properties'">
          <PropertyPanel :editor="editor" />
        </section>
        <section v-show="panel === 'route'">
          <RoutePanel :editor="editor" />
        </section>
        <section v-show="panel === 'reference'">
          <ReferencePanel ref="referencePanel" :editor="editor" />
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
.topbar summary.compact,
.topbar label.compact {
  padding: 6px 10px;
  font-size: 12px;
}

.topbar .upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--surface-3);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.topbar .upload-button:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}
.topbar .upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.topbar .upload-button:focus-within {
  outline: 2px solid var(--accent-border);
  outline-offset: 2px;
}

.error-text {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
  line-height: 1.4;
  max-width: 220px;
}

.restored-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
}
.restored-badge .dismiss {
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.restored-badge .dismiss:hover {
  background: transparent;
  opacity: 0.7;
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
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.tool {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-color: transparent;
  padding: 10px 4px;
}
.tool:hover:not(:disabled):not(.active) {
  background: var(--surface-2);
  border-color: var(--border);
}
.tool kbd {
  position: absolute;
  top: 3px;
  right: 3px;
}
kbd {
  font: 600 9px var(--font-sans);
  color: var(--text-tertiary);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xs);
  width: 14px;
  line-height: 14px;
  text-align: center;
}
.tool.active kbd {
  color: var(--accent-contrast);
  background: rgba(255, 255, 255, 0.2);
  border-color: transparent;
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
  .left {
    width: 160px;
  }
  .right {
    width: 235px;
  }
  .project-name {
    display: none;
  }
  .topbar {
    padding: 8px 12px;
  }
}
@media (max-width: 760px) {
  .studio {
    height: auto;
    min-height: 100dvh;
  }
  .body {
    flex-wrap: wrap;
  }
  .left {
    width: 132px;
    padding: 12px 8px;
  }
  .right {
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--border-subtle);
    max-height: 360px;
  }
  .canvas-area {
    min-height: 520px;
  }
  .tool {
    padding: 8px 2px;
  }
  kbd {
    display: none;
  }
  .welcome {
    padding: 20px 12px;
  }
  .welcome h1 {
    font-size: 19px;
  }
  .welcome > div {
    flex-wrap: wrap;
  }
}
</style>
