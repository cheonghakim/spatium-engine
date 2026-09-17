<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { IndoorRuntime, type RouteAnimationType, type RouteCameraMode, type RouteCurveShape } from "@indoor/runtime";
import type { IndoorEditor } from "@indoor/editor";

const props = defineProps<{ editor: IndoorEditor }>();
const containerRef = ref<HTMLDivElement | null>(null);
const revision = ref(0);
const loading = ref(true);
const error = ref('');
const isPlaying = ref(false);
const curve = ref<RouteCurveShape>('smooth');
const animationType = ref<RouteAnimationType>('marker');
const cameraMode = ref<RouteCameraMode>('third');
let runtime: IndoorRuntime | null = null;
let disposed = false;
let generation = 0;
let unsubscribers: Array<() => void> = [];
let playbackWatchHandle: ReturnType<typeof setInterval> | null = null;

const previewProject = computed(() => { revision.value; return props.editor.getPreviewProject(); });
const previewFloor = computed(() => previewProject.value.buildings.flatMap(b => b.floors).find(f => f.id === props.editor.getActiveFloor()?.id));
const spaceCount = computed(() => previewFloor.value?.spaces.length ?? 0);
const wallCount = computed(() => previewFloor.value?.walls.length ?? 0);
const isEmpty = computed(() => spaceCount.value === 0 && wallCount.value === 0 && !previewFloor.value?.entrances.length);
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
  if (preview?.result) runtime.startRoute(preview.startNodeId, preview.endNodeId, preview.options);
  else runtime.clearRoute();
}

function playAnimation(): void {
  if (!runtime || !canPlayRoute.value) return;
  runtime.playRouteAnimation({ curve: curve.value, animationType: animationType.value, cameraMode: cameraMode.value });
  isPlaying.value = true;
  if (playbackWatchHandle === null) {
    playbackWatchHandle = setInterval(() => {
      if (!runtime?.isPlayingRouteAnimation()) {
        isPlaying.value = false;
        if (playbackWatchHandle !== null) {
          clearInterval(playbackWatchHandle);
          playbackWatchHandle = null;
        }
      }
    }, 250);
  }
}

function stopAnimation(): void {
  runtime?.stopRouteAnimation();
  isPlaying.value = false;
  if (playbackWatchHandle !== null) {
    clearInterval(playbackWatchHandle);
    playbackWatchHandle = null;
  }
}

async function refresh(): Promise<void> {
  const current = runtime;
  if (!current || disposed) return;
  const ticket = ++generation;
  revision.value++;
  try {
    await current.load(previewProject.value);
    if (disposed || ticket !== generation) return;
    const floorId = props.editor.getActiveFloor()?.id;
    if (floorId) current.setFloor(floorId);
    current.setCameraMode('3d');
    current.start();
    syncRouteIntoRuntime();
    error.value = '';
  } catch {
    if (!disposed && ticket === generation) error.value = '3D 화면을 시작하지 못했습니다. 브라우저의 그래픽 가속(WebGL) 사용 여부를 확인하고 다시 시도해 주세요.';
  } finally {
    if (!disposed && ticket === generation) loading.value = false;
  }
}

onMounted(() => {
  if (!containerRef.value) return;
  runtime = new IndoorRuntime({ container: containerRef.value });
  unsubscribers = [props.editor.on('projectChanged', refresh), props.editor.on('floorChanged', refresh)];
  void refresh();
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  if (playbackWatchHandle !== null) clearInterval(playbackWatchHandle);
  for (const unsubscribe of unsubscribers) unsubscribe();
  runtime?.destroy();
  runtime = null;
});
</script>

<template>
  <div class="preview-3d-wrapper">
    <div ref="containerRef" class="preview-3d"></div>
    <div v-if="loading" class="empty-overlay" role="status">3D 화면을 준비하고 있습니다.</div>
    <div v-else-if="error" class="empty-overlay error" role="alert"><p>{{ error }}</p><button @click="refresh">다시 시도</button></div>
    <div v-else-if="isEmpty" class="empty-overlay">
      <p>이 층에 3D로 표시할 벽이나 공간이 없습니다.</p>
      <p class="hint">
        {{ hasDraft ? '검토 탭에서 포함할 벽이나 방을 선택하세요. 제외한 항목은 미리보기에 표시되지 않습니다.' : '자동 벡터화를 실행하거나 공간·벽 도구로 지도를 그려 주세요. 도면 이미지만으로는 3D 모델이 표시되지 않습니다.' }}
      </p>
    </div>
    <div v-else class="hint-banner" role="status">
      <strong>{{ hasDraft ? '검토용 초안 포함 · 아직 확정되지 않았습니다' : '확정된 지도' }}</strong>
      <span>벽 {{ wallCount }}개 · 공간 {{ spaceCount }}개</span>
      <span v-if="spaceCount === 0">벽만 표시 중입니다. 공간을 추가하면 바닥도 표시됩니다.</span>
    </div>
    <div v-if="!loading && !error && !isEmpty" class="view-controls">
      <span>드래그: 회전 · 휠: 확대·축소</span>
      <button @click="runtime?.fitView3D()">전체 보기</button>
      <span class="divider" />
      <label>경로 모양
        <select v-model="curve" :disabled="isPlaying">
          <option value="smooth">곡선</option>
          <option value="straight">직선</option>
        </select>
      </label>
      <label>애니메이션
        <select v-model="animationType" :disabled="isPlaying">
          <option value="marker">마커 이동</option>
          <option value="flythrough">카메라 주행</option>
        </select>
      </label>
      <label>시점
        <select v-model="cameraMode" :disabled="isPlaying">
          <option value="third">3인칭</option>
          <option value="first">1인칭</option>
        </select>
      </label>
      <button
        :disabled="!canPlayRoute && !isPlaying"
        :title="canPlayRoute ? '' : '경로 탭에서 경로를 먼저 계산하세요'"
        @click="isPlaying ? stopAnimation() : playAnimation()"
      >{{ isPlaying ? '■ 정지' : '▶ 경로 재생' }}</button>
    </div>
  </div>
</template>

<style scoped>
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
.view-controls select {
  font-size: 12px;
  padding: 4px 6px;
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
