<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { IndoorEditor } from "@indoor/editor";
import { vectorizeReferenceImage } from "../canvas/vectorizeReference";

const props = defineProps<{ editor: IndoorEditor }>();

const revision = ref(0);
const vectorizing = ref(false);
const vectorizeError = ref<string | null>(null);
const uploadError = ref('');
const settings = reactive({ autoThreshold: true, threshold: 128, minSegmentLengthPx: 25, maxLineGapPx: 2, maxMergeGapPx: 2, minWallThicknessPx: 2, snapTolerancePx: 3 });
const hasDraft = computed(() => { revision.value; return props.editor.draft.hasDraft; });
function preset(mode: 'balanced' | 'clean' | 'faint'): void {
  Object.assign(settings, { autoThreshold: true, threshold: 128, minSegmentLengthPx: mode === 'clean' ? 45 : mode === 'faint' ? 15 : 25,
    maxLineGapPx: mode === 'faint' ? 3 : 2, maxMergeGapPx: 2, minWallThicknessPx: mode === 'clean' ? 3 : mode === 'faint' ? 1 : 2, snapTolerancePx: 3 });
}
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [props.editor.on("projectChanged", () => revision.value++)];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const reference = computed(() => {
  revision.value;
  return props.editor.reference.current;
});

function onFileChange(evt: Event): void {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploadError.value = '';

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    props.editor.reference.setImage(url, image.naturalWidth, image.naturalHeight);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    uploadError.value = '이미지를 열 수 없습니다. PNG 또는 JPEG 파일을 선택하세요.';
  };
  image.src = url;
  input.value = "";
}

function onOpacityInput(evt: Event): void {
  const percent = Number((evt.target as HTMLInputElement).value);
  props.editor.reference.setOpacity(percent / 100);
}

function removeReference(): void {
  props.editor.reference.clear();
}

async function autoVectorize(): Promise<void> {
  if (vectorizing.value) return;
  const floorId = props.editor.getActiveFloor()?.id;
  const source = props.editor.reference.current;
  if (!floorId || !source) return;
  vectorizeError.value = null;
  vectorizing.value = true;
  try {
    // Yield a frame so the "분석 중..." state paints before the (synchronous, potentially slow) CV pass runs.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (props.editor.getActiveFloor()?.id !== floorId || props.editor.reference.current !== source) return;
    const { threshold, ...rest } = settings;
    const result = vectorizeReferenceImage(props.editor.reference, { ...rest, ...(settings.autoThreshold ? {} : { threshold }) });
    if (!result) {
      vectorizeError.value = "이미지를 아직 불러오는 중입니다. 잠시 후 다시 시도하세요.";
      return;
    }
    props.editor.draft.setDraft(
      result.walls,
      result.spaces,
      result.warnings.map((w) => w.message),
      floorId,
    );
    props.editor.setTool('draft-review');
  } catch {
    vectorizeError.value = '도면 분석에 실패했습니다. 다른 이미지로 다시 시도하세요.';
  } finally {
    vectorizing.value = false;
  }
}
</script>

<template>
  <div class="reference-panel">
    <h3>도면 (Reference)</h3>

    <label class="upload-button">
      이미지 업로드
      <input type="file" accept="image/png,image/jpeg" @change="onFileChange" />
    </label>
    <p v-if="uploadError" class="error-text" role="alert">{{ uploadError }}</p>

    <template v-if="reference">
      <label class="opacity-row">
        투명도
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="Math.round(reference.opacity * 100)"
          @input="onOpacityInput"
        />
        <span>{{ Math.round(reference.opacity * 100) }}%</span>
      </label>

      <p class="scale-info">축척: {{ reference.metersPerPixel.toFixed(4) }} m/px</p>
      <p class="hint">Calibrate 툴로 두 점을 클릭하고 실제 거리를 입력하면 축척이 보정됩니다.</p>

      <h3>자동 벡터화</h3>
      <div class="presets"><button @click="preset('balanced')">기본</button><button @click="preset('clean')">가구 선 줄이기</button><button @click="preset('faint')">얇은 벽 살리기</button></div>
      <details class="settings"><summary>감지 설정 조절</summary>
        <label><input v-model="settings.autoThreshold" type="checkbox" /> 이미지 밝기에 맞춰 자동 감지</label>
        <label v-if="!settings.autoThreshold">밝기 기준 {{ settings.threshold }}<input v-model.number="settings.threshold" type="range" min="1" max="254" /></label>
        <label>최소 선 길이 {{ settings.minSegmentLengthPx }} px<input v-model.number="settings.minSegmentLengthPx" type="range" min="5" max="150" /></label>
        <label>최소 벽 두께 {{ settings.minWallThicknessPx }} px<input v-model.number="settings.minWallThicknessPx" type="range" min="1" max="10" /></label>
        <label>끊긴 선 연결 {{ settings.maxLineGapPx }} px<input v-model.number="settings.maxLineGapPx" type="range" min="0" max="8" /></label>
        <label>이중선 병합 간격 {{ settings.maxMergeGapPx }} px<input v-model.number="settings.maxMergeGapPx" type="range" min="1" max="30" /></label>
        <p class="hint">가구가 잡히면 최소 길이·두께를 높이세요. 벽이 빠지면 낮추세요. 연결·병합 간격을 너무 높이면 출입구나 서로 다른 벽이 합쳐질 수 있습니다.</p>
      </details>
      <p v-if="hasDraft" class="hint">다시 분석하면 현재 초안과 초안 수정 내역을 새 결과로 교체합니다. 확정된 지도는 유지됩니다.</p>
      <button class="vectorize-button" :disabled="vectorizing" @click="autoVectorize">
        {{ vectorizing ? "분석 중..." : hasDraft ? "다시 분석 (초안 교체)" : "자동 벡터화" }}
      </button>
      <p class="hint">수평·수직 벽을 감지합니다. 사선·곡선 벽은 직접 그려 보완해 주세요. 투명도와 화면 격자는 감지 결과에 영향을 주지 않습니다.</p>
      <p v-if="vectorizeError" class="error-text">{{ vectorizeError }}</p>

      <button class="remove-button" @click="removeReference">도면 제거</button>
    </template>
  </div>
</template>

<style scoped>
.presets { display:flex; flex-wrap:wrap; gap:4px; }
.presets button { padding:6px; font-size:11px; background:#252532; color:#ddd; border:1px solid #454555; border-radius:5px; cursor:pointer; }
.settings { padding:10px; border:1px solid #35353d; border-radius:6px; }
.settings summary { cursor:pointer; }
.settings label { display:block; margin-top:12px; font-size:12px; }
.settings input[type=range] { display:block; width:100%; margin:6px 0; }
.reference-panel {
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
.upload-button {
  position: relative;
  display: inline-block;
  background: #232329;
  border: 1px solid #35353d;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  text-align: center;
  font-size: 13px;
}
.upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.upload-button:focus-within { outline: 2px solid #a5b4fc; outline-offset: 3px; }
.opacity-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.opacity-row input {
  flex: 1;
}
.scale-info {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9a9aa5;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: #71717a;
  line-height: 1.4;
}
.remove-button {
  background: #3a2323;
  color: #ffb3b3;
  border: 1px solid #5a3535;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.vectorize-button {
  background: #2a2f23;
  color: #d7ffb3;
  border: 1px solid #45502f;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.vectorize-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error-text {
  margin: 0;
  font-size: 11px;
  color: #ff8080;
  line-height: 1.4;
}
</style>
