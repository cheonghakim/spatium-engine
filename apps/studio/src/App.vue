<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  compareSchemaVersions,
  deserializeProject,
  InvalidProjectDataError,
  projectToGeoJSON,
  SchemaVersionMismatchError,
  serializeProject,
  type IndoorProject,
} from "@indoor/core";
import { IndoorEditor } from "@indoor/editor";
import {
  mdiArrowCollapseLeft,
  mdiArrowCollapseRight,
  mdiArrowExpandLeft,
  mdiArrowExpandRight,
  mdiAutoFix,
  mdiCropFree,
  mdiCubeOutline,
  mdiCursorDefault,
  mdiCursorMove,
  mdiDeleteSweepOutline,
  mdiDoor,
  mdiFilePlusOutline,
  mdiFolderOpenOutline,
  mdiGrid,
  mdiImageOutline,
  mdiMagnetOn,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiMapMarker,
  mdiMapOutline,
  mdiMenuDown,
  mdiRedo,
  mdiRoutes,
  mdiRulerSquareCompass,
  mdiShapePolygonPlus,
  mdiSofaOutline,
  mdiTrayArrowDown,
  mdiTuneVariant,
  mdiUndo,
  mdiUngroup,
  mdiVectorCombine,
  mdiVectorDifferenceAb,
  mdiWall,
} from "@mdi/js";
import MdiIcon from "./components/MdiIcon.vue";
import StudioCanvas from "./components/StudioCanvas.vue";
import Preview3D from "./components/Preview3D.vue";
import LayersPanel from "./components/LayersPanel.vue";
import FurnitureLibrary from "./components/FurnitureLibrary.vue";
import ReferencePanel from "./components/ReferencePanel.vue";
import VectorizePanel from "./components/VectorizePanel.vue";
import PropertyPanel from "./components/PropertyPanel.vue";
import FloorSwitcher from "./components/FloorSwitcher.vue";
import BuildingSwitcher from "./components/BuildingSwitcher.vue";
import RoutePanel from "./components/RoutePanel.vue";
import ImdfExportDialog from "./components/ImdfExportDialog.vue";
import ValidationPanel from "./components/ValidationPanel.vue";
import OpenSourceNotices from "./components/OpenSourceNotices.vue";

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
  rightCollapsed.value = false;
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
  // The 3D preview shows one building floor; leave the site view for the active building's first floor.
  if (!show3d.value && editor.isSiteView()) {
    const floor = activeBuilding.value?.floors[0];
    if (floor) editor.setFloor(floor.id);
  }
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

/**
 * Whether replacing the project would lose anything. Not just placed objects:
 * site work (outdoor paths, geo anchor, placement), extra buildings/floors,
 * connectors, groups, a loaded floor-plan image, an unconfirmed vectorization
 * draft, or simply any edit since the project was loaded all count. Only an
 * untouched default project is "nothing to lose".
 */
function hasWorkToLose(): boolean {
  if (editor.history.canUndo || editor.draft.hasDraft || editor.reference.current) return true;
  const project = editor.project;
  if (project.site || project.buildings.length > 1) return true;
  return project.buildings.some(
    (b) =>
      b.floors.length > 1 ||
      !!b.connectors?.length ||
      !!b.placement ||
      !!b.footprint ||
      b.floors.some(
        (f) =>
          f.spaces.length ||
          f.walls.length ||
          f.entrances.length ||
          f.pois.length ||
          f.furniture.length ||
          f.groups.length ||
          f.navigation.nodes.length ||
          f.navigation.edges.length,
      ),
  );
}

const openError = ref("");

/**
 * Studio is a desktop authoring tool: 1024px wide is the minimum supported
 * viewport. Below it the layout stacks (see the 760px media query) and a
 * notice says so; visitors' maps are served by the Runtime, not Studio.
 */
const MIN_SUPPORTED_WIDTH = 1024;
const smallScreen = ref(typeof window !== "undefined" && window.innerWidth < MIN_SUPPORTED_WIDTH);
const smallScreenDismissed = ref(loadSessionFlag("spatium-studio:smallScreenDismissed"));
function onViewportResize(): void {
  smallScreen.value = window.innerWidth < MIN_SUPPORTED_WIDTH;
}
function dismissSmallScreen(): void {
  smallScreenDismissed.value = true;
  try {
    window.sessionStorage.setItem("spatium-studio:smallScreenDismissed", "1");
  } catch {
    // ignore
  }
}
function loadSessionFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

const PREVIOUS_KEY = "spatium-studio:previous";
/**
 * The work replaced by the last "new project" / "open file", so the swap can
 * be undone. Kept in memory and in localStorage, so it can still be restored
 * after a reload (when the autosave slot already holds the new project).
 * Only the map data is kept — reference images and unconfirmed drafts are not
 * part of project JSON (the replace confirmation says so).
 */
interface ReplacedWork {
  json: string;
  reason: string;
  /** ms epoch when it was replaced. */
  savedAt: number;
  /** false when localStorage refused it: it is lost on reload. */
  persisted: boolean;
}
const replacedWork = ref<ReplacedWork | null>(loadStoredPreviousWork());

/**
 * Reads the snapshot left by an earlier session. Accepts the current envelope
 * and the older raw-project-JSON format; a corrupt or unreadable snapshot is
 * dropped so it can't block anything.
 */
function loadStoredPreviousWork(): ReplacedWork | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PREVIOUS_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const envelope =
      parsed && typeof parsed === "object" && "json" in parsed && typeof parsed.json === "string"
        ? (parsed as { json: string; savedAt?: unknown })
        : { json: raw };
    deserializeProject(envelope.json); // validate before offering it
    const savedAt = typeof envelope.savedAt === "number" ? envelope.savedAt : 0;
    const when = savedAt ? ` (${new Date(savedAt).toLocaleString()})` : "";
    return {
      json: envelope.json,
      reason: `교체되기 전 작업이 남아 있습니다${when}`,
      savedAt,
      persisted: true,
    };
  } catch {
    try {
      window.localStorage.removeItem(PREVIOUS_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

/** Keeps `json` as the restorable previous work (memory + best-effort storage). */
function rememberPreviousWork(json: string, reason: string): void {
  const savedAt = Date.now();
  let persisted = true;
  try {
    window.localStorage.setItem(PREVIOUS_KEY, JSON.stringify({ json, savedAt }));
  } catch {
    // Storage full: the in-memory copy still allows undoing until reload.
    persisted = false;
  }
  replacedWork.value = {
    json,
    reason: persisted ? reason : `${reason} · 저장 공간이 부족해 새로고침하면 되돌릴 수 없습니다`,
    savedAt,
    persisted,
  };
}

function forgetPreviousWork(): void {
  replacedWork.value = null;
  try {
    window.localStorage.removeItem(PREVIOUS_KEY);
  } catch {
    // ignore
  }
}

function replaceProject(next: IndoorProject, reason: string): void {
  if (hasWorkToLose()) rememberPreviousWork(serializeProject(editor.project), reason);
  else forgetPreviousWork();
  openError.value = "";
  editor.loadProject(next);
}

/**
 * Swaps the previous work back in. The work being left is kept as the new
 * "previous" (so restoring never destroys anything and can itself be undone).
 */
function restoreReplacedWork(): void {
  const previous = replacedWork.value;
  if (!previous) return;
  let project: IndoorProject;
  try {
    project = deserializeProject(previous.json);
  } catch {
    openError.value = "이전 작업을 복원하지 못했습니다. 저장된 데이터가 손상되었습니다.";
    forgetPreviousWork();
    return;
  }
  if (hasWorkToLose())
    rememberPreviousWork(serializeProject(editor.project), "이전 작업을 복원했습니다");
  else forgetPreviousWork();
  openError.value = "";
  editor.loadProject(project);
}

function newProject(): void {
  if (
    hasWorkToLose() &&
    !window.confirm(
      editor.reference.current || editor.draft.hasDraft
        ? "새 프로젝트를 시작합니다. 지도 데이터는 '이전 작업 되돌리기'로 다시 불러올 수 있지만, 불러온 도면 이미지와 확정하지 않은 자동 감지 결과는 사라집니다. 계속할까요?"
        : "새 프로젝트를 시작합니다. 현재 작업은 '이전 작업 되돌리기'로 다시 불러올 수 있습니다. 계속할까요?",
    )
  )
    return;
  replaceProject(createDefaultProject(), "새 프로젝트를 시작했습니다");
}

async function onOpenFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = deserializeProject(text);
    replaceProject(parsed, `${file.name} 파일을 열었습니다`);
  } catch (error) {
    if (error instanceof SchemaVersionMismatchError) {
      // Newer files need a newer Studio; older ones lack a migration path.
      openError.value =
        compareSchemaVersions(error.foundVersion, error.expectedVersion) > 0
          ? `이 파일은 더 새로운 버전(${error.foundVersion})에서 만들어졌습니다. Studio를 업데이트한 뒤 여세요 (현재 ${error.expectedVersion}).`
          : `지원하지 않는 프로젝트 파일 버전입니다 (${error.foundVersion || "버전 없음"}).`;
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

const lastSavedAt = ref<number | null>(null);
const autosaveError = ref("");
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, serializeProject(editor.project));
      lastSavedAt.value = Date.now();
      autosaveError.value = "";
    } catch {
      lastSavedAt.value = null;
      autosaveError.value =
        "자동 저장에 실패했습니다(저장 공간 부족 또는 사용 불가). 작업을 잃지 않도록 백업해 주세요.";
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
/** Separate from `revision`: App.vue only needs to know selection *changed* (for the group/ungroup buttons' enabled state) — projectChanged already covers everything else that could affect them (e.g. a group being deleted out from under the current selection). */
const selectionRevision = ref(0);

onMounted(() => {
  window.addEventListener("keydown", onShortcut);
  window.addEventListener("resize", onViewportResize);
  unsubscribers = [
    editor.on("toolChanged", (toolId) => {
      ui.activeToolId = toolId;
      if (toolId === "draft-review") {
        panel.value = "review";
        rightCollapsed.value = false;
      }
      syncHistoryState();
    }),
    editor.on("projectChanged", syncHistoryState),
    editor.on("projectChanged", scheduleAutosave),
    editor.on("projectLoaded", onProjectLoaded),
    editor.on("calibrationPointsPicked", onCalibrationPointsPicked),
    editor.on("toolNotice", showToolNotice),
    // Leaving the site view: a site-only tool would be stuck disabled.
    editor.on("floorChanged", () => {
      if (!editor.isSiteView() && editor.tools.active?.id === "site-building") {
        editor.setTool("select");
      }
    }),
    editor.on("selectionChanged", () => selectionRevision.value++),
  ];
  if (restoredNotice.value)
    setTimeout(() => {
      restoredNotice.value = false;
    }, 6000);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onShortcut);
  window.removeEventListener("resize", onViewportResize);
  for (const unsubscribe of unsubscribers) unsubscribe();
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  stopResize();
});

const tools = [
  {
    id: "select",
    label: "선택",
    icon: mdiCursorDefault,
    key: "V",
    hint: "객체를 클릭해 속성을 수정하세요. Shift/Ctrl+클릭: 다중 선택 · 드래그: 영역 선택 · Delete: 선택 항목 삭제 · Space/휠 클릭 드래그: 화면 이동",
  },
  {
    id: "polygon",
    label: "공간 그리기",
    icon: mdiShapePolygonPlus,
    key: "R",
    hint: "꼭짓점을 3개 이상 클릭한 후 Enter 또는 시작점을 클릭해 완성하세요. Esc: 취소",
  },
  {
    id: "hole",
    label: "구멍 그리기",
    icon: mdiVectorDifferenceAb,
    key: "H",
    hint: "기둥·코어·보이드를 공간 안에 그려 비웁니다. 선택한 공간(없으면 윤곽을 감싸는 공간)에 들어갑니다. Enter: 완성 · Esc: 취소",
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
    id: "furniture",
    label: "가구",
    icon: mdiSofaOutline,
    key: "F",
    hint: "클릭해 가구를 배치하세요. 책상·의자·소파 등 기본 모델이 제공되며, 속성에서 종류·치수·회전을 조정할 수 있습니다.",
  },
  {
    id: "navigation",
    label: "경로 그리기",
    icon: mdiRoutes,
    key: "N",
    hint: "빈 곳을 클릭해 지점을 잇따라 추가하세요. 기존 지점을 클릭하면 그 지점에 연결됩니다. Shift: 수평/수직 · Esc: 연결 끊기",
  },
  {
    id: "site-building",
    label: "건물 배치",
    icon: mdiCursorMove,
    key: "M",
    hint: "단지 뷰에서 건물을 끌어 옮기고, Shift+드래그로 회전합니다. 정확한 값은 속성 패널의 '단지 · 지리 좌표'에서 입력하세요.",
  },
  {
    id: "calibrate",
    label: "축척 보정",
    icon: mdiRulerSquareCompass,
    key: "C",
    hint: "도면의 두 점을 클릭한 후 실제 거리(m)를 입력하세요.",
  },
  {
    id: "draft-review",
    label: "감지 결과 수정",
    icon: mdiAutoFix,
    key: "B",
    hint: "벽 클릭·드래그: 이동 · 끝점 드래그: 길이 수정 · Shift/Ctrl+클릭·빈 곳 드래그: 다중 선택 · Delete: 선택 항목 제외 · Shift(끝점 드래그): 수평/수직 · Alt: 붙이기 해제",
  },
];
type Tool = (typeof tools)[number];
/** Purely a left-rail grouping label — doesn't affect tool ids, commands or shortcuts. */
const TOOL_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "선택 및 탐색", ids: ["select"] },
  { label: "도형 작성", ids: ["polygon", "hole", "wall"] },
  { label: "출입구", ids: ["door"] },
  { label: "POI 및 객체", ids: ["poi", "furniture"] },
  { label: "내비게이션", ids: ["navigation"] },
  { label: "단지", ids: ["site-building"] },
  { label: "측정 및 보정", ids: ["calibrate"] },
  { label: "자동 감지", ids: ["draft-review"] },
];
const groupedTools = computed(() =>
  TOOL_GROUPS.map((group) => ({
    label: group.label,
    items: group.ids.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => !!t),
  })),
);
const activeTool = computed(() => tools.find((t) => t.id === ui.activeToolId)!);
/** In the site view only these tools apply (the outdoor graph has no spaces or walls). */
const SITE_VIEW_TOOLS = new Set(["select", "navigation", "site-building"]);
const siteView = computed(() => {
  revision.value;
  return editor.isSiteView();
});
function toolAvailable(tool: Tool): boolean {
  if (siteView.value) return SITE_VIEW_TOOLS.has(tool.id);
  if (tool.id === "site-building") return false;
  if (tool.id === "calibrate") return hasReference.value;
  if (tool.id === "draft-review") return editor.draft.hasDraft;
  return true;
}
function toolTitle(tool: Tool): string {
  if (siteView.value && !SITE_VIEW_TOOLS.has(tool.id)) return "단지 뷰에서는 쓸 수 없습니다";
  if (tool.id === "site-building" && !siteView.value)
    return "상단의 '단지' 버튼으로 단지 뷰를 연 뒤 사용하세요";
  if (tool.id === "calibrate" && !hasReference.value) return "도면을 먼저 업로드하세요";
  if (tool.id === "draft-review" && !editor.draft.hasDraft)
    return "도면을 업로드하고 자동 벡터화를 실행하면 결과를 검토할 수 있습니다";
  return `${tool.label} (${tool.key})\n${tool.hint}`;
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
    !f.furniture.length &&
    !f.navigation.nodes.length &&
    !hasReference.value
  );
});
const floorEmpty = computed(() => {
  revision.value;
  const f = editor.getActiveFloor();
  return (
    !f ||
    (!f.spaces.length &&
      !f.walls.length &&
      !f.entrances.length &&
      !f.pois.length &&
      !f.furniture.length &&
      !f.navigation.nodes.length &&
      !f.navigation.edges.length)
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (event.shiftKey) {
      if (canUngroup.value) ungroupSelection();
    } else if (canGroup.value) {
      groupSelection();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || show3d.value) return;
  if (event.key === "Escape" && ui.activeToolId === "furniture") {
    event.preventDefault();
    selectTool("select");
    return;
  }
  const tool = tools.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
  if (tool && toolAvailable(tool)) {
    event.preventDefault();
    selectTool(tool.id);
  }
}

function enterSiteView(): void {
  show3d.value = false;
  editor.enterSiteView();
}

const TOOL_NOTICES: Record<string, string> = {
  "hole-no-space": "구멍을 넣을 공간이 없습니다. 공간을 먼저 선택하거나 공간 안쪽에 그리세요.",
  "hole-invalid":
    "구멍이 공간 밖으로 나가거나, 스스로 교차하거나, 다른 구멍과 겹쳐서 추가하지 않았습니다.",
};
const toolNotice = ref("");
let toolNoticeTimer: ReturnType<typeof setTimeout> | null = null;
function showToolNotice(code: string): void {
  toolNotice.value = TOOL_NOTICES[code] ?? code;
  if (toolNoticeTimer !== null) clearTimeout(toolNoticeTimer);
  toolNoticeTimer = setTimeout(() => (toolNotice.value = ""), 6000);
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

function clearFloor(): void {
  if (
    !window.confirm(
      "현재 층의 모든 요소(공간, 벽, 출입구, POI, 내비게이션)가 삭제됩니다. 계속할까요?",
    )
  )
    return;
  editor.clearFloor();
}

const canGroup = computed(() => {
  selectionRevision.value;
  return editor.selection.current.filter((e) => e.vertexIndex === undefined).length >= 2;
});
const canUngroup = computed(() => {
  selectionRevision.value;
  revision.value;
  const entries = editor.selection.current;
  if (entries.length !== 1) return false;
  return !!editor.getActiveFloor()?.groups.some((g) => g.id === entries[0]!.id);
});
function groupSelection(): void {
  editor.groupSelection("그룹");
}
function ungroupSelection(): void {
  editor.ungroupSelection();
}

function downloadFile(filename: string, content: BlobPart, mimeType: string): void {
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

/** IMDF goes through a pre-export check dialog (errors, approximations, report). */
const imdfDialog = ref<InstanceType<typeof ImdfExportDialog> | null>(null);
function exportImdf(): void {
  imdfDialog.value?.open();
}

// ---- Side panel layout: resizable width + collapse-to-rail, persisted locally ----
const LEFT_MIN = 168;
const LEFT_MAX = 360;
const LEFT_ICON_ONLY_BELOW = 188;
const RIGHT_MIN = 260;
const RIGHT_MAX = 420;
const RAIL_WIDTH = 48;

function loadNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const value = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
}
function loadFlag(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === "1";
}
function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // best-effort only
  }
}

const leftWidth = ref(loadNumber("spatium-studio:leftWidth", 230));
const rightWidth = ref(loadNumber("spatium-studio:rightWidth", 300));
const leftCollapsed = ref(loadFlag("spatium-studio:leftCollapsed", false));
const rightCollapsed = ref(loadFlag("spatium-studio:rightCollapsed", false));
const leftIconOnly = computed(() => leftCollapsed.value || leftWidth.value < LEFT_ICON_ONLY_BELOW);

function toggleLeftPanel(): void {
  leftCollapsed.value = !leftCollapsed.value;
  persist("spatium-studio:leftCollapsed", leftCollapsed.value ? "1" : "0");
}
function toggleRightPanel(): void {
  rightCollapsed.value = !rightCollapsed.value;
  persist("spatium-studio:rightCollapsed", rightCollapsed.value ? "1" : "0");
}

let resizing: "left" | "right" | null = null;
let resizeStartX = 0;
let resizeStartWidth = 0;

function startResize(side: "left" | "right", evt: PointerEvent): void {
  resizing = side;
  resizeStartX = evt.clientX;
  resizeStartWidth = side === "left" ? leftWidth.value : rightWidth.value;
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
}
function onResizeMove(evt: PointerEvent): void {
  if (!resizing) return;
  const delta = evt.clientX - resizeStartX;
  if (resizing === "left") {
    leftWidth.value = Math.min(LEFT_MAX, Math.max(LEFT_MIN, resizeStartWidth + delta));
  } else {
    rightWidth.value = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, resizeStartWidth - delta));
  }
}
function stopResize(): void {
  if (!resizing) return;
  resizing = null;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  persist("spatium-studio:leftWidth", String(leftWidth.value));
  persist("spatium-studio:rightWidth", String(rightWidth.value));
}

const PANEL_TABS = [
  { id: "properties", label: "속성", icon: mdiTuneVariant },
  { id: "reference", label: "도면", icon: mdiImageOutline },
  { id: "route", label: "경로", icon: mdiRoutes },
  { id: "review", label: "검토", icon: mdiAutoFix },
];
function selectRightTab(id: string): void {
  panel.value = id;
  if (rightCollapsed.value) toggleRightPanel();
}
</script>

<template>
  <div class="studio">
    <div v-if="smallScreen && !smallScreenDismissed" class="small-screen-notice" role="status">
      <span>
        Spatium Studio는 너비 {{ MIN_SUPPORTED_WIDTH }}px 이상의 데스크톱 화면을 기준으로 합니다.
        작은 화면에서는 도면 확인과 간단한 수정만 권장합니다.
      </span>
      <button
        type="button"
        class="dismiss"
        aria-label="화면 크기 안내 닫기"
        @click="dismissSmallScreen"
      >
        ×
      </button>
    </div>
    <header class="topbar">
      <div class="topbar-zone zone-project">
        <span class="brand">S <strong>SPATIUM</strong></span>
        <span class="project-name">{{ currentProject.name }}</span>
        <BuildingSwitcher
          :editor="editor"
          :project="currentProject"
          :active-building-id="activeBuildingId"
          @select="onSelectBuilding"
        />
        <FloorSwitcher v-if="activeBuilding" :editor="editor" :building="activeBuilding" />
        <button
          type="button"
          class="secondary site-toggle"
          :class="{ active: siteView }"
          :aria-pressed="siteView"
          title="단지 뷰: 건물 배치와 건물 사이 실외 경로를 편집합니다"
          @click="enterSiteView"
        >
          <MdiIcon :path="mdiMapOutline" :size="15" />
          단지
        </button>
      </div>

      <div class="topbar-divider" />

      <div class="topbar-zone zone-edit">
        <button
          class="btn-ghost btn-icon"
          :disabled="!ui.canUndo"
          title="실행 취소 (Ctrl/⌘ Z)"
          aria-label="실행 취소"
          @click="undo"
        >
          <MdiIcon :path="mdiUndo" :size="17" />
        </button>
        <button
          class="btn-ghost btn-icon"
          :disabled="!ui.canRedo"
          title="다시 실행 (Ctrl/⌘ Shift Z)"
          aria-label="다시 실행"
          @click="redo"
        >
          <MdiIcon :path="mdiRedo" :size="17" />
        </button>
        <button
          class="btn-ghost btn-icon danger-ghost"
          :disabled="floorEmpty"
          title="현재 층의 모든 요소를 지웁니다"
          aria-label="현재 층 전체 지우기"
          @click="clearFloor"
        >
          <MdiIcon :path="mdiDeleteSweepOutline" :size="16" />
        </button>
        <span class="topbar-divider" />
        <button
          class="btn-ghost btn-icon"
          :disabled="!canGroup"
          title="선택한 객체를 그룹으로 묶습니다 (Ctrl/⌘ G)"
          aria-label="그룹으로 묶기"
          @click="groupSelection"
        >
          <MdiIcon :path="mdiVectorCombine" :size="16" />
        </button>
        <button
          class="btn-ghost btn-icon"
          :disabled="!canUngroup"
          title="그룹을 해제합니다 (구성 요소는 유지, Ctrl/⌘ Shift G)"
          aria-label="그룹 해제"
          @click="ungroupSelection"
        >
          <MdiIcon :path="mdiUngroup" :size="16" />
        </button>
      </div>

      <span v-if="restoredNotice" class="restored-badge" role="status">
        이전 작업이 복원되었습니다
        <button class="dismiss" type="button" aria-label="알림 닫기" @click="dismissRestoredNotice">
          ×
        </button>
      </span>
      <span v-if="openError" class="error-text" role="alert">{{ openError }}</span>
      <span v-if="replacedWork" class="restored-badge" role="status">
        {{ replacedWork.reason }}
        <button class="link-button" type="button" @click="restoreReplacedWork">
          {{
            replacedWork.reason.startsWith("이전 작업을 복원")
              ? "방금 작업으로 돌아가기"
              : "이전 작업 되돌리기"
          }}
        </button>
        <button class="dismiss" type="button" aria-label="알림 닫기" @click="replacedWork = null">
          ×
        </button>
      </span>
      <span v-if="autosaveError" class="error-text" role="alert">
        {{ autosaveError }}
        <button class="link-button" type="button" @click="exportJson">지금 백업 다운로드</button>
      </span>
      <span v-if="toolNotice" class="error-text" role="status">{{ toolNotice }}</span>

      <div class="spacer" />

      <div class="topbar-divider" />

      <div class="topbar-zone zone-view">
        <button class="secondary" :aria-pressed="show3d" @click="toggle3d">
          <MdiIcon :path="mdiCubeOutline" :size="15" />
          {{ show3d ? "2D 편집으로" : "3D 미리보기" }}
        </button>
        <button class="secondary" title="새 프로젝트를 시작합니다" @click="newProject">
          <MdiIcon :path="mdiFilePlusOutline" :size="15" />
          새 프로젝트
        </button>
        <label class="secondary upload-button">
          <MdiIcon :path="mdiFolderOpenOutline" :size="15" />
          불러오기
          <input type="file" accept=".json,application/json" @change="onOpenFile" />
        </label>
        <details class="export-menu">
          <summary class="btn-primary">
            <MdiIcon :path="mdiTrayArrowDown" :size="15" />
            내보내기
            <MdiIcon :path="mdiMenuDown" :size="14" />
          </summary>
          <div>
            <button @click="exportJson">프로젝트 JSON</button>
            <button @click="exportGeoJson">지도 GeoJSON</button>
            <button @click="exportImdf">IMDF (Apple 실내 지도)</button>
          </div>
        </details>
        <ImdfExportDialog ref="imdfDialog" :project="currentProject" @download="downloadFile" />
      </div>
    </header>

    <div class="body">
      <aside
        class="sidebar left"
        :class="{ collapsed: leftCollapsed }"
        :style="{ width: (leftCollapsed ? RAIL_WIDTH : leftWidth) + 'px' }"
      >
        <div class="sidebar-header">
          <h3 v-if="!leftCollapsed" class="panel-heading">도구</h3>
          <button
            class="btn-ghost btn-icon collapse-toggle"
            :title="leftCollapsed ? '도구 패널 펼치기' : '도구 패널 접기'"
            :aria-label="leftCollapsed ? '도구 패널 펼치기' : '도구 패널 접기'"
            @click="toggleLeftPanel"
          >
            <MdiIcon
              :path="leftCollapsed ? mdiArrowExpandRight : mdiArrowCollapseLeft"
              :size="15"
            />
          </button>
        </div>

        <div class="tool-groups" :class="{ 'icon-only': leftIconOnly }">
          <FurnitureLibrary
            v-if="!leftIconOnly"
            :editor="editor"
            :active="ui.activeToolId === 'furniture'"
            @place="
              show3d = false;
              selectTool('furniture');
            "
          />
          <div v-for="group in groupedTools" :key="group.label" class="tool-group">
            <h4 v-if="!leftIconOnly" class="tool-group-label">
              {{ group.label }}
            </h4>
            <div class="tool-group-items">
              <button
                v-for="tool in group.items"
                :key="tool.id"
                class="tool"
                :class="{ active: ui.activeToolId === tool.id }"
                :aria-pressed="ui.activeToolId === tool.id"
                :aria-label="tool.label"
                :disabled="!toolAvailable(tool)"
                :title="toolTitle(tool)"
                @click="selectTool(tool.id)"
              >
                <MdiIcon :path="tool.icon" :size="17" class="tool-icon" />
                <span v-if="!leftIconOnly" class="tool-label">{{ tool.label }}</span>
                <kbd v-if="!leftIconOnly">{{ tool.key }}</kbd>
              </button>
            </div>
          </div>
        </div>

        <section v-if="!leftCollapsed" class="layers-section">
          <LayersPanel :editor="editor" />
        </section>
      </aside>

      <div
        v-if="!leftCollapsed"
        class="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="도구 패널 크기 조절"
        @pointerdown="startResize('left', $event)"
      />

      <main class="canvas-area">
        <div class="viewport">
          <StudioCanvas v-if="!show3d" ref="canvas" :editor="editor" />
          <Preview3D v-else :editor="editor" />

          <div v-if="!show3d" class="tool-hud">
            <strong>{{ activeTool.label }}</strong>
            <p>{{ activeTool.hint }}</p>
          </div>

          <div v-if="empty && !siteView && !show3d && ui.activeToolId === 'select'" class="welcome">
            <span class="hint">시작하기</span>
            <h1>첫 공간을 그려보세요</h1>
            <p>도면을 불러와 따라 그리거나,<br />공간 도구로 지도를 직접 만들 수 있습니다.</p>
            <div>
              <button class="btn-primary" @click="selectTool('polygon')">＋ 공간 그리기</button
              ><button class="secondary" @click="openReferenceUpload">도면 불러오기</button>
            </div>
            <small>도면 → 공간과 벽 → 경로 연결 → 내보내기</small>
          </div>

          <div v-if="!show3d" class="zoom-hud">
            <button
              class="btn-ghost btn-icon"
              :aria-pressed="canvas?.showGrid"
              title="격자 표시"
              aria-label="격자 표시 전환"
              @click="canvas?.toggleGrid()"
            >
              <MdiIcon :path="mdiGrid" :size="15" />
            </button>
            <button
              class="btn-ghost btn-icon"
              :class="{ active: gridSnapEnabled }"
              :aria-pressed="gridSnapEnabled"
              title="격자에 맞춰 정렬 (1m 간격)"
              aria-label="격자 맞춤 전환"
              @click="toggleGridSnap"
            >
              <MdiIcon :path="mdiMagnetOn" :size="15" />
            </button>
            <span class="hud-divider" />
            <button class="btn-ghost btn-icon" aria-label="축소" @click="canvas?.zoomBy(1 / 1.2)">
              <MdiIcon :path="mdiMagnifyMinusOutline" :size="15" />
            </button>
            <span class="zoom-readout">{{ canvas?.zoomPercent ?? 100 }}%</span>
            <button class="btn-ghost btn-icon" aria-label="확대" @click="canvas?.zoomBy(1.2)">
              <MdiIcon :path="mdiMagnifyPlusOutline" :size="15" />
            </button>
            <button
              class="btn-ghost btn-icon"
              title="화면 초기화"
              aria-label="화면 초기화"
              @click="canvas?.resetView()"
            >
              <MdiIcon :path="mdiCropFree" :size="15" />
            </button>
          </div>
        </div>
      </main>

      <div
        v-if="!rightCollapsed"
        class="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="속성 패널 크기 조절"
        @pointerdown="startResize('right', $event)"
      />

      <aside
        class="sidebar right"
        :class="{ collapsed: rightCollapsed }"
        :style="{ width: (rightCollapsed ? RAIL_WIDTH : rightWidth) + 'px' }"
      >
        <nav class="panel-tabs" :class="{ 'icon-only': rightCollapsed }" aria-label="작업 패널">
          <button
            v-for="tab in PANEL_TABS"
            :key="tab.id"
            class="tab"
            :class="{ active: panel === tab.id && !rightCollapsed }"
            :aria-pressed="panel === tab.id && !rightCollapsed"
            :title="tab.label"
            @click="selectRightTab(tab.id)"
          >
            <MdiIcon :path="tab.icon" :size="15" />
            <span v-if="!rightCollapsed">{{ tab.label }}</span>
          </button>
          <button
            class="btn-ghost btn-icon collapse-toggle"
            :title="rightCollapsed ? '속성 패널 펼치기' : '속성 패널 접기'"
            :aria-label="rightCollapsed ? '속성 패널 펼치기' : '속성 패널 접기'"
            @click="toggleRightPanel"
          >
            <MdiIcon
              :path="rightCollapsed ? mdiArrowExpandLeft : mdiArrowCollapseRight"
              :size="15"
            />
          </button>
        </nav>
        <template v-if="!rightCollapsed">
          <section v-show="panel === 'properties'" class="panel-body">
            <PropertyPanel :editor="editor" :last-saved-at="lastSavedAt" />
          </section>
          <section v-show="panel === 'route'" class="panel-body">
            <RoutePanel :editor="editor" />
          </section>
          <section v-show="panel === 'reference'" class="panel-body">
            <ReferencePanel ref="referencePanel" :editor="editor" />
          </section>
          <section v-show="panel === 'review'" class="panel-body">
            <VectorizePanel :editor="editor" />
          </section>
        </template>
      </aside>
    </div>

    <footer class="statusbar">
      <ValidationPanel class="statusbar-main" :editor="editor" />
      <OpenSourceNotices />
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
  font-size: var(--font-size-body);
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-1);
  border-bottom: 1px solid var(--border);
}
.topbar-zone {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.topbar-divider {
  width: 1px;
  align-self: stretch;
  margin: 4px 0;
  background: var(--border-subtle);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent);
  font-size: 18px;
  font-weight: 800;
}
.brand strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.project-name {
  color: var(--text-tertiary);
  font-size: var(--font-size-secondary);
  padding-right: var(--space-2);
  border-right: 1px solid var(--border-subtle);
  margin-right: 2px;
}
.spacer {
  flex: 1;
}
.secondary {
  background: var(--surface-2);
}
.danger-ghost:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger-border);
  background: var(--danger-soft);
}

.zone-view .upload-button {
  position: relative;
}
.zone-view .upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.zone-view .upload-button:focus-within {
  outline: 2px solid var(--accent-border);
  outline-offset: 2px;
}

.error-text {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--danger);
  line-height: 1.4;
  max-width: 220px;
}

.link-button {
  height: auto;
  padding: 0 var(--space-1);
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: inherit;
  text-decoration: underline;
}
.site-toggle.active {
  border-color: var(--accent);
  color: var(--accent);
}
.restored-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.3px;
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
.export-menu > div {
  position: absolute;
  z-index: 20;
  right: 0;
  top: 36px;
  width: 190px;
  padding: var(--space-2);
  display: grid;
  gap: 4px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  animation: menu-in var(--dur) var(--ease-out);
}
.export-menu > div button {
  width: 100%;
  justify-content: flex-start;
  background: transparent;
  border-color: transparent;
}

/* ---- Sidebars ---- */
.sidebar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-1);
  overflow: hidden;
  transition: width var(--dur) var(--ease-out);
}
.sidebar.left {
  border-right: 1px solid var(--border);
}
.sidebar.right {
  border-left: 1px solid var(--border);
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 var(--space-3);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.sidebar.collapsed .sidebar-header {
  justify-content: center;
  padding: 0;
}

.resizer {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
}
.resizer:hover,
.resizer:active {
  background: var(--accent-soft);
}

/* ---- Left: tool rail ---- */
.tool-groups {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.tool-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tool-group-label {
  margin: 0 0 2px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-disabled);
}
.tool-group-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tool-groups.icon-only .tool-group-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
  gap: 3px;
}
.tool {
  position: relative;
  justify-content: flex-start;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  background: transparent;
  border-color: transparent;
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
  color: var(--text-secondary);
}
.tool:hover:not(:disabled):not(.active) {
  background: var(--surface-2);
  color: var(--text-primary);
}
.tool.active {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--text-primary);
  box-shadow: inset 2px 0 0 var(--accent);
}
.tool-icon {
  flex-shrink: 0;
}
.tool-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-secondary);
}
.tool kbd {
  flex-shrink: 0;
}
.tool-groups.icon-only .tool {
  width: 34px;
  height: 34px;
  padding: 0;
  justify-content: center;
}
.tool-groups.icon-only .tool.active {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.layers-section {
  flex-shrink: 0;
  max-height: 42%;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

/* ---- Canvas ---- */
.canvas-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas-bg);
}
.viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.tool-hud {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  max-width: 320px;
  padding: 8px 12px;
  background: var(--overlay);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}
.tool-hud strong {
  display: block;
  font-size: var(--font-size-secondary);
  color: var(--text-primary);
}
.tool-hud p {
  margin: 3px 0 0;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
}

.welcome {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(410px, 90%);
  padding: 32px 26px;
  background: var(--overlay);
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
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
}
.welcome h1 {
  font-size: 22px;
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
  font-size: var(--font-size-caption);
}

.zoom-hud {
  position: absolute;
  bottom: var(--space-4);
  right: var(--space-4);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--overlay);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.hud-divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--border-strong);
}
.zoom-readout {
  min-width: 42px;
  text-align: center;
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* ---- Right panel tabs ---- */
.panel-tabs {
  display: flex;
  align-items: center;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 var(--space-1);
}
.panel-tabs.icon-only {
  flex-direction: column;
  height: auto;
  padding: var(--space-1) 0;
  gap: 2px;
}
.tab {
  flex: 1;
  gap: 6px;
  height: 32px;
  background: transparent;
  border: 0;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-secondary);
}
.tab:hover:not(:disabled) {
  background: transparent;
  color: var(--text-primary);
}
.tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
  box-shadow: none;
}
.panel-tabs.icon-only .tab {
  flex: none;
  width: 34px;
  height: 34px;
  border-bottom: 0;
  border-radius: var(--radius-sm);
}
.panel-tabs.icon-only .tab.active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
.panel-tabs .collapse-toggle {
  margin-left: auto;
  flex-shrink: 0;
}
.panel-tabs.icon-only .collapse-toggle {
  margin-left: 0;
  order: -1;
  margin-bottom: 4px;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3);
}
.panel-body :deep(.hint),
.panel-body :deep(.empty-hint) {
  color: var(--text-tertiary);
  line-height: 1.7;
}
.panel-body :deep(input),
.panel-body :deep(select) {
  min-width: 0;
  max-width: 100%;
}

.statusbar {
  display: flex;
  align-items: flex-start;
  flex-shrink: 0;
  background: var(--surface-1);
  border-top: 1px solid var(--border);
}
.statusbar-main {
  flex: 1;
  min-width: 0;
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

.small-screen-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-warning, #fff4d6);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.small-screen-notice span {
  flex: 1;
  min-width: 0;
}

@media (max-width: 760px) {
  .studio {
    height: auto;
    min-height: 100dvh;
    max-width: 100vw;
    overflow-x: hidden;
  }
  .topbar {
    flex-wrap: wrap;
    min-width: 0;
  }
  .canvas-area {
    width: 100%;
    min-width: 0;
    order: -1;
  }
  .body {
    flex-wrap: wrap;
  }
  .resizer {
    display: none;
  }
  .sidebar.left,
  .sidebar.right {
    width: 100% !important;
  }
  .sidebar.right {
    border-left: 0;
    border-top: 1px solid var(--border-subtle);
    max-height: 360px;
  }
  .canvas-area {
    min-height: 520px;
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
