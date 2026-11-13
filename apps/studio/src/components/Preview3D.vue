<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  IndoorRuntime,
  type RoutePlaybackOptions,
  type RoutePlaybackState,
  type RouteCurveShape,
} from "@indoor/runtime";
import type { IndoorEditor } from "@indoor/editor";

const props = defineProps<{ editor: IndoorEditor }>();
const containerRef = ref<HTMLDivElement | null>(null);
const revision = ref(0);
const loading = ref(true);
const error = ref("");
/** WebGL context lost mid-session: rendering is paused until the browser restores it. */
const contextLost = ref(false);
const WEBGL_UNAVAILABLE_MESSAGE =
  "3D 화면을 시작하지 못했습니다. 브라우저의 그래픽 가속(WebGL) 사용 여부를 확인하고 다시 시도해 주세요. 2D 편집은 계속 사용할 수 있습니다.";
type ViewMode = "overview" | "follow" | "first";
const VIEW_MODES: Record<ViewMode, Pick<RoutePlaybackOptions, "animationType" | "cameraMode">> = {
  overview: { animationType: "marker", cameraMode: "overview" },
  follow: { animationType: "marker", cameraMode: "third" },
  first: { animationType: "flythrough", cameraMode: "first" },
};
const SPEEDS = [0.5, 1, 2, 4] as const;

const playback = ref<RoutePlaybackState | null>(null);
const isPlaying = computed(() => playback.value !== null);
const curve = ref<RouteCurveShape>("smooth");
const viewMode = ref<ViewMode>("follow");
const speed = ref<number>(1);
let runtime: IndoorRuntime | null = null;
let disposed = false;
let generation = 0;
let unsubscribers: Array<() => void> = [];
/** Set by the runtime's `render3d.unavailable` event during the current refresh. */
let webglFailed = false;
let playbackFrame: number | null = null;

/**
 * Counts for the floor the 3D view shows. Recomputed from `revision` on every
 * refresh: the project is mutated in place and getPreviewProject() returns the
 * same object, so a computed chained off it would never notice a different
 * building/floor or new geometry and would describe a stale floor.
 */
const floorStats = computed(() => {
  revision.value;
  const floorId = props.editor.getActiveFloor()?.id;
  const floor = props.editor
    .getPreviewProject()
    .buildings.flatMap((b) => b.floors)
    .find((f) => f.id === floorId);
  const spaces = floor?.spaces.length ?? 0;
  const walls = floor?.walls.length ?? 0;
  const furniture = floor?.furniture.length ?? 0;
  return {
    spaces,
    walls,
    furniture,
    empty:
      spaces === 0 &&
      walls === 0 &&
      furniture === 0 &&
      !floor?.entrances.length &&
      !floor?.pois.length,
  };
});
const spaceCount = computed(() => floorStats.value.spaces);
const wallCount = computed(() => floorStats.value.walls);
const furnitureCount = computed(() => floorStats.value.furniture);
const isEmpty = computed(() => floorStats.value.empty);
const hasDraft = computed(() => {
  revision.value;
  const draft = props.editor.draft.current;
  return !!draft && (!draft.floorId || draft.floorId === props.editor.getActiveFloor()?.id);
});
const canPlayRoute = computed(() => {
  revision.value;
  return !!props.editor.routePreview.current?.result;
});

function syncRouteIntoRuntime(): void {
  if (!runtime) return;
  const preview = props.editor.routePreview.current;
  if (preview?.result) runtime.startRoute(preview.start, preview.end, preview.options);
  else runtime.clearRoute();
}

/** Mirrors the runtime's playback state every frame while playback is active. */
function trackPlayback(): void {
  playback.value = runtime?.getRouteAnimationState() ?? null;
  playbackFrame = playback.value ? requestAnimationFrame(trackPlayback) : null;
}

function stopTracking(): void {
  if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
  playbackFrame = null;
}

function playAnimation(): void {
  if (!runtime || !canPlayRoute.value) return;
  runtime.playRouteAnimation({
    curve: curve.value,
    speed: speed.value,
    ...VIEW_MODES[viewMode.value],
  });
  stopTracking();
  trackPlayback();
}

function stopAnimation(): void {
  runtime?.stopRouteAnimation();
  stopTracking();
  playback.value = null;
}

function togglePause(): void {
  if (!runtime || !playback.value) return;
  if (playback.value.paused) runtime.resumeRouteAnimation();
  else runtime.pauseRouteAnimation();
  playback.value = runtime.getRouteAnimationState();
}

function seek(event: Event): void {
  if (!runtime) return;
  runtime.seekRouteAnimation(Number((event.target as HTMLInputElement).value) / 1000);
  playback.value = runtime.getRouteAnimationState();
}

watch(curve, (shape) => runtime?.setRouteShape(shape));
watch(speed, (value) => runtime?.setRouteAnimationSpeed(value));

function floorName(floorId: string | undefined): string {
  if (!floorId) return "";
  revision.value;
  for (const building of props.editor.getPreviewProject().buildings) {
    const floor = building.floors.find((f) => f.id === floorId);
    if (floor) return floor.name;
  }
  return "";
}

const VIA_LABEL: Record<string, string> = {
  elevator: "엘리베이터",
  stairs: "계단",
  escalator: "에스컬레이터",
  ramp: "경사로",
  walk: "통로",
};

/** "엘리베이터로 3F 이동 중 ↑" while playback is changing floors. */
const transitionLabel = computed(() => {
  const transition = playback.value?.transition;
  if (!transition) return "";
  const to = floorName(transition.toFloorId) || "다른 층";
  const arrow = transition.direction === "down" ? "↓" : "↑";
  return `${VIA_LABEL[transition.via] ?? "이동"}로 ${to} 이동 중 ${arrow}`;
});

const playbackFloorName = computed(() => {
  return floorName(playback.value?.floorId);
});

function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function refresh(): Promise<void> {
  const current = runtime;
  if (!current || disposed) return;
  const ticket = ++generation;
  revision.value++;
  try {
    await current.load(props.editor.getPreviewProject());
    if (disposed || ticket !== generation) return;
    const floorId = props.editor.getActiveFloor()?.id;
    if (floorId) current.setFloor(floorId);
    // The runtime reports a missing WebGL context through an event instead of
    // throwing (so embeds degrade gracefully) — treat it as a failed start here.
    webglFailed = false;
    current.setCameraMode("3d");
    if (webglFailed) {
      error.value = WEBGL_UNAVAILABLE_MESSAGE;
      return;
    }
    current.setRouteShape(curve.value);
    current.start();
    syncRouteIntoRuntime();
    error.value = "";
  } catch {
    if (!disposed && ticket === generation) error.value = WEBGL_UNAVAILABLE_MESSAGE;
  } finally {
    if (!disposed && ticket === generation) loading.value = false;
  }
}

onMounted(() => {
  if (!containerRef.value) return;
  runtime = new IndoorRuntime({ container: containerRef.value });
  unsubscribers = [
    props.editor.on("projectChanged", refresh),
    props.editor.on("floorChanged", refresh),
    runtime.on("render3d.unavailable", () => {
      webglFailed = true;
    }),
    runtime.on("render3d.contextLost", () => {
      contextLost.value = true;
      stopAnimation();
    }),
    runtime.on("render3d.contextRestored", () => {
      contextLost.value = false;
    }),
  ];
  void refresh();
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  stopTracking();
  for (const unsubscribe of unsubscribers) unsubscribe();
  runtime?.destroy();
  runtime = null;
});
</script>

<template>
  <div class="preview-3d-wrapper">
    <div ref="containerRef" class="preview-3d" />
    <div v-if="loading" class="empty-overlay" role="status">3D 화면을 준비하고 있습니다.</div>
    <div v-else-if="error" class="empty-overlay error" role="alert">
      <p>{{ error }}</p>
      <button @click="refresh">다시 시도</button>
    </div>
    <div v-else-if="contextLost" class="empty-overlay error" role="alert">
      <p>
        그래픽 연결이 끊겨 3D 화면을 일시 중지했습니다. 브라우저가 복구하면 자동으로 다시
        표시됩니다.
      </p>
    </div>
    <div v-else-if="isEmpty" class="empty-overlay">
      <p>이 층에 3D로 표시할 요소가 없습니다.</p>
      <p class="hint">
        {{
          hasDraft
            ? "검토 탭에서 포함할 벽이나 방을 선택하세요. 제외한 항목은 미리보기에 표시되지 않습니다."
            : "공간·벽·출입구·가구를 추가하거나 자동 벡터화를 실행해 주세요. 도면 이미지만으로는 3D 모델이 표시되지 않습니다."
        }}
      </p>
    </div>
    <div v-else class="hint-banner" role="status">
      <strong>{{
        hasDraft ? "검토용 초안 포함 · 아직 확정되지 않았습니다" : "확정된 지도"
      }}</strong>
      <span>벽 {{ wallCount }}개 · 공간 {{ spaceCount }}개 · 가구 {{ furnitureCount }}개</span>
      <span v-if="spaceCount === 0">공간을 추가하면 바닥도 표시됩니다.</span>
    </div>
    <div v-if="!loading && !error && !contextLost && !isEmpty" class="view-controls">
      <span>드래그: 회전 · 휠: 확대·축소</span>
      <button @click="runtime?.fitView3D()">전체 보기</button>
      <span class="divider" />
      <label :class="{ inert: !canPlayRoute && !isPlaying }"
        >경로 모양
        <select v-model="curve" :disabled="!canPlayRoute && !isPlaying">
          <option value="smooth">모서리 둥글게</option>
          <option value="straight">직선</option>
        </select>
      </label>
      <label :class="{ inert: !canPlayRoute && !isPlaying }"
        >보기
        <select
          v-model="viewMode"
          :disabled="isPlaying || !canPlayRoute"
          :title="isPlaying ? '정지한 뒤 바꿀 수 있습니다' : ''"
        >
          <option value="overview">위에서 보기</option>
          <option value="follow">따라가기</option>
          <option value="first">1인칭</option>
        </select>
      </label>
      <label :class="{ inert: !canPlayRoute && !isPlaying }"
        >속도
        <select v-model.number="speed" :disabled="!canPlayRoute && !isPlaying">
          <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
        </select>
      </label>
      <button
        v-if="!isPlaying"
        :disabled="!canPlayRoute"
        :title="canPlayRoute ? '' : '경로 탭에서 경로를 먼저 계산하세요'"
        @click="playAnimation"
      >
        ▶ 경로 재생
      </button>
      <span v-if="!canPlayRoute && !isPlaying" class="route-needed-hint"
        >경로 탭에서 경로를 먼저 계산하세요</span
      >
    </div>
    <div v-if="transitionLabel" class="floor-transition" role="status">
      {{ transitionLabel }}
    </div>
    <div v-if="playback" class="playback-bar" role="group" aria-label="경로 재생">
      <button
        class="icon"
        :aria-label="playback.paused ? '계속 재생' : '일시정지'"
        :title="playback.paused ? '계속 재생' : '일시정지'"
        @click="togglePause"
      >
        {{ playback.paused ? "▶" : "❚❚" }}
      </button>
      <button class="icon" aria-label="정지" title="정지" @click="stopAnimation">■</button>
      <input
        class="scrubber"
        type="range"
        min="0"
        max="1000"
        step="1"
        aria-label="재생 위치"
        :value="Math.round(playback.progress * 1000)"
        @input="seek"
      />
      <span class="playback-meta">
        {{ playback.distance.toFixed(0) }} / {{ playback.totalDistance.toFixed(0) }} m · 남은
        {{ formatSeconds(playback.remainingSeconds) }}
        <template v-if="playback.legCount > 1">
          · {{ playbackFloorName || "다른 층" }} ({{ playback.legIndex + 1 }}/{{
            playback.legCount
          }})
        </template>
      </span>
      <span v-if="playback.paused && viewMode !== 'overview'" class="playback-hint"
        >일시정지 중에는 드래그로 둘러볼 수 있습니다</span
      >
    </div>
  </div>
</template>

<style scoped>
.floor-transition {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 10px 18px;
  border-radius: var(--radius-md);
  background: rgba(17, 20, 26, 0.82);
  border: 1px solid var(--accent-border);
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
  pointer-events: none;
  z-index: 2;
}
.preview-3d-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}
.preview-3d {
  width: 100%;
  height: 100%;
}
.empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  pointer-events: none;
  color: var(--text-tertiary);
  font-size: 14px;
}
.empty-overlay .hint {
  font-size: 12px;
  max-width: 360px;
  line-height: 1.5;
}
.hint-banner {
  display: grid;
  gap: 4px;
  text-align: center;
  max-width: calc(100% - 24px);
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--overlay);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  pointer-events: none;
  white-space: normal;
}
.error {
  pointer-events: auto;
}
.view-controls {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 28px);
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  background: var(--overlay);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 12px;
  box-shadow: var(--shadow-sm);
}
.view-controls .divider {
  width: 1px;
  height: 20px;
  background: var(--border-strong);
}
.view-controls label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.view-controls label.inert {
  opacity: 0.45;
}
.view-controls select {
  font-size: 12px;
  padding: 4px 6px;
}
.playback-bar {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 70px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  max-width: 720px;
  margin: 0 auto;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: var(--overlay);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 12px;
  box-shadow: var(--shadow-sm);
}
.playback-bar button.icon {
  min-width: 34px;
  padding: 6px 8px;
}
.scrubber {
  flex: 1 1 200px;
  min-width: 120px;
  accent-color: var(--accent);
}
.playback-meta {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.playback-hint {
  flex-basis: 100%;
  color: var(--text-tertiary);
  font-size: 11px;
}
.route-needed-hint {
  color: var(--warning);
  white-space: nowrap;
}
button {
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--text-primary);
  padding: 8px 12px;
}
button:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
}
</style>
