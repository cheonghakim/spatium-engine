<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import {
  projectToIMDFArchive,
  validateProject,
  type IMDFIssue,
  type IndoorProject,
} from "@indoor/core";
import { mdiClose } from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";

/**
 * Pre-export check for IMDF: what will be exported, what was approximated or
 * left out, and what blocks the export — before any file is downloaded. A
 * generated archive is not the same as one Apple's validator accepts, so the
 * dialog says that too, and the report can be saved alongside the delivery.
 */
const props = defineProps<{ project: IndoorProject }>();
const emit = defineEmits<{ download: [filename: string, data: BlobPart, mimeType: string] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const archive = shallowRef<Uint8Array<ArrayBuffer> | null>(null);
const issues = ref<IMDFIssue[]>([]);
const validationErrors = ref(0);

const ISSUE_TEXT: Record<string, string> = {
  "missing-geo-anchor":
    "단지 기준 위경도가 없습니다. 선택을 해제하고 속성 패널의 '단지 · 지리 좌표'에서 입력하세요.",
  "missing-address": "단지 주소가 없습니다. IMDF venue에는 주소가 필요합니다.",
  "incomplete-address": "주소에 도로명·시군구·국가 코드 중 빠진 항목이 있습니다.",
  "approximated-footprint":
    "건물 외곽(footprint)이 없어 공간들을 감싸는 볼록 다각형으로 근사했습니다.",
  "missing-footprint": "건물 외곽을 만들 공간이 없습니다.",
  "empty-level": "공간이 없는 층은 IMDF level로 내보내지 않았습니다.",
  "amenity-without-unit": "공간 밖에 있는 POI라 IMDF unit에 연결되지 않았습니다.",
  "store-as-amenity":
    "매장 POI는 '분류 없음' amenity로 내보냈습니다(IMDF 입점사 occupant는 아직 미지원).",
  "connector-without-units":
    "정차층이 공간 안에 있지 않은 수직 이동 설비는 IMDF relationship으로 내보내지 않았습니다.",
  "empty-venue": "단지 외곽을 만들 건물이 없습니다.",
};

const errors = computed(() => issues.value.filter((i) => i.severity === "error"));
const warnings = computed(() => issues.value.filter((i) => i.severity === "warning"));
/** Same-code warnings grouped, so 40 unplaced POIs read as one line with a count. */
const groupedWarnings = computed(() => {
  const groups = new Map<string, { code: string; count: number; example: string }>();
  for (const issue of warnings.value) {
    const group = groups.get(issue.code);
    if (group) group.count++;
    else groups.set(issue.code, { code: issue.code, count: 1, example: issue.message });
  }
  return [...groups.values()];
});

function text(code: string, fallback: string): string {
  return ISSUE_TEXT[code] ?? fallback;
}

function open(): void {
  const result = projectToIMDFArchive(props.project);
  archive.value = result.archive;
  issues.value = result.issues;
  validationErrors.value = validateProject(props.project).filter(
    (i) => i.severity === "error",
  ).length;
  dialog.value?.showModal();
}
defineExpose({ open });

function close(): void {
  dialog.value?.close();
}

function exportArchive(): void {
  if (!archive.value || errors.value.length) return;
  emit("download", `${props.project.name}.imdf.zip`, archive.value, "application/zip");
  close();
}

function saveReport(): void {
  const report = {
    project: props.project.name,
    generatedAt: new Date().toISOString(),
    format: "IMDF 1.0.0",
    exportable: errors.value.length === 0,
    validationErrors: validationErrors.value,
    issues: issues.value,
  };
  emit(
    "download",
    `${props.project.name}.imdf-report.json`,
    JSON.stringify(report, null, 2),
    "application/json",
  );
}

function onDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) close();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="export-dialog"
    aria-labelledby="imdf-title"
    @click="onDialogClick"
    @keydown.stop
  >
    <div class="export-content">
      <header class="export-header">
        <h2 id="imdf-title">IMDF 내보내기 점검</h2>
        <button type="button" class="close-button" aria-label="닫기" @click="close">
          <MdiIcon :path="mdiClose" :size="16" />
        </button>
      </header>
      <div class="export-body">
        <p v-if="errors.length" class="status error" role="alert">
          내보낼 수 없습니다. 아래 오류를 먼저 고쳐 주세요.
        </p>
        <p v-else-if="warnings.length" class="status warning" role="status">
          내보낼 수 있지만, 아래 항목은 근사되거나 빠집니다.
        </p>
        <p v-else class="status ok" role="status">
          근사되거나 빠지는 항목 없이 내보낼 수 있습니다.
        </p>

        <ul v-if="errors.length" class="issue-list">
          <li v-for="(issue, index) in errors" :key="`e${index}`" class="issue error">
            {{ text(issue.code, issue.message) }}
          </li>
        </ul>
        <ul v-if="groupedWarnings.length" class="issue-list">
          <li v-for="group in groupedWarnings" :key="group.code" class="issue warning">
            {{ text(group.code, group.example) }}
            <span v-if="group.count > 1" class="count">{{ group.count }}건</span>
          </li>
        </ul>
        <p v-if="validationErrors" class="note">
          프로젝트 검증 오류가 {{ validationErrors }}개 있습니다. 하단 검증 결과에서 확인하세요.
        </p>
        <p class="note">
          파일 생성은 납품 가능 여부와 다릅니다. 제출 전에 Apple IMDF 검증 도구로 확인하고, 이 점검
          리포트를 함께 보관하세요.
        </p>
      </div>
      <footer class="export-footer">
        <button type="button" class="secondary" @click="saveReport">점검 리포트 저장</button>
        <span class="spacer" />
        <button type="button" class="secondary" @click="close">취소</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!archive || errors.length > 0"
          @click="exportArchive"
        >
          IMDF 내보내기
        </button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.export-dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: min(80dvh, 640px);
  padding: 0;
  background: var(--surface-1);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}
.export-dialog::backdrop {
  background: var(--overlay);
}
.export-content {
  display: flex;
  flex-direction: column;
  max-height: min(80dvh, 640px);
}
.export-header,
.export-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}
.export-header {
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
}
.export-footer {
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}
.export-header h2 {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 600;
}
.close-button {
  width: var(--control-height);
  padding: 0;
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}
.export-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.status {
  margin: 0;
  font-size: var(--font-size-secondary);
  font-weight: 600;
}
.status.error {
  color: var(--danger);
}
.status.warning {
  color: var(--warning);
}
.status.ok {
  color: var(--success);
}
.issue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.issue {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-size: var(--font-size-secondary);
  line-height: 1.5;
  border-left: 3px solid var(--border);
}
.issue.error {
  border-left-color: var(--danger);
}
.issue.warning {
  border-left-color: var(--warning);
}
.count {
  margin-left: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}
.note {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
}
.spacer {
  flex: 1;
}
</style>
