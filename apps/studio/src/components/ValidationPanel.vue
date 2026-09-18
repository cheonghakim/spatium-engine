<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { validateProject, type ValidationIssue } from "@indoor/core";
import type { IndoorEditor } from "@indoor/editor";
import {
  mdiAlertCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiCloseCircleOutline,
  mdiInformationOutline,
  mdiShieldCheckOutline,
} from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";

const props = defineProps<{ editor: IndoorEditor }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers = [props.editor.on("projectChanged", () => revision.value++)];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const expanded = ref(false);

const SEVERITY_ORDER: Record<ValidationIssue["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};
const SEVERITY_LABEL: Record<ValidationIssue["severity"], string> = {
  error: "오류",
  warning: "경고",
  info: "정보",
};
const SEVERITY_ICON: Record<ValidationIssue["severity"], string> = {
  error: mdiCloseCircleOutline,
  warning: mdiAlertCircleOutline,
  info: mdiInformationOutline,
};

/**
 * Rephrases each validation rule's internal (English, technical) message
 * into a short user-facing Korean sentence, keyed by the rule's stable
 * `type` code — see packages/core/src/validation/rules.ts. This is purely a
 * display concern: the underlying validation logic and issue data are
 * untouched, so a rule change there can't silently desync from this map
 * (an unrecognized type just falls back to the raw message).
 */
function friendlyMessage(issue: ValidationIssue): string {
  switch (issue.type) {
    case "invalid-polygon":
      return "공간의 윤곽선이 올바르지 않습니다 (꼭짓점이 3개 미만입니다).";
    case "self-intersecting-polygon":
      return "공간의 윤곽선이 스스로 교차하고 있습니다.";
    case "unknown-space-type":
      return "공간에 유형이 지정되지 않았습니다.";
    case "overlapping-spaces":
      return "다른 공간과 영역이 겹칩니다.";
    case "degenerate-wall":
      return "벽의 길이가 너무 짧습니다.";
    case "invalid-wall-thickness":
      return "벽의 두께 값이 올바르지 않습니다.";
    case "invalid-element-dimension":
      return "출입구의 치수 값이 올바르지 않습니다.";
    case "missing-host-wall":
      return "출입구가 연결되어 있던 벽이 삭제되었습니다.";
    case "opening-above-wall":
      return "출입구 높이가 벽 높이를 넘어 잘려 보일 수 있습니다.";
    case "disconnected-entrance":
      return issue.message.includes("is not connected to any space")
        ? "출입구가 어느 공간과도 연결되어 있지 않습니다."
        : "출입구가 존재하지 않는 공간을 참조하고 있습니다.";
    case "invalid-poi":
      return "관심 지점(POI)이 존재하지 않는 공간을 참조하고 있습니다.";
    case "broken-navigation-edge":
      return "내비게이션 경로가 존재하지 않는 지점을 참조하고 있습니다.";
    case "inaccurate-edge-distance":
      return "내비게이션 경로의 거리 값이 실제 거리와 크게 다릅니다.";
    case "duplicate-navigation-edge":
      return "같은 두 지점 사이에 중복된 내비게이션 경로가 있습니다.";
    case "disconnected-navigation-node":
      return "내비게이션 지점이 경로에 연결되어 있지 않습니다.";
    case "missing-floor-connection":
      return "다른 층으로 연결되는 수직 이동 경로가 없습니다.";
    default:
      return issue.message;
  }
}

const issues = computed<ValidationIssue[]>(() => {
  revision.value;
  return [...validateProject(props.editor.project)].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
});
const counts = computed(() => ({
  error: issues.value.filter((i) => i.severity === "error").length,
  warning: issues.value.filter((i) => i.severity === "warning").length,
  info: issues.value.filter((i) => i.severity === "info").length,
}));
const ok = computed(() => issues.value.length === 0);

function focus(issue: ValidationIssue): void {
  if (issue.objectId) props.editor.focusObject(issue.objectId);
}
</script>

<template>
  <div class="validation-bar" :class="{ expanded }">
    <button
      type="button"
      class="status-summary"
      :aria-expanded="expanded"
      aria-label="검증 결과 펼치기/접기"
      @click="expanded = !expanded"
    >
      <MdiIcon
        :path="ok ? mdiShieldCheckOutline : mdiAlertCircleOutline"
        :size="15"
        :class="ok ? 'status-icon ok' : 'status-icon warn'"
      />
      <span class="status-text">{{ ok ? "검증 통과 · 문제 없음" : "검증 결과" }}</span>
      <span class="counts">
        <span v-if="counts.error" class="count-chip danger">
          <MdiIcon :path="SEVERITY_ICON.error" :size="12" />{{ counts.error }}
        </span>
        <span v-if="counts.warning" class="count-chip warning">
          <MdiIcon :path="SEVERITY_ICON.warning" :size="12" />{{ counts.warning }}
        </span>
        <span v-if="counts.info" class="count-chip info">
          <MdiIcon :path="SEVERITY_ICON.info" :size="12" />{{ counts.info }}
        </span>
      </span>
      <MdiIcon :path="expanded ? mdiChevronDown : mdiChevronUp" :size="14" class="chevron" />
    </button>

    <div v-if="expanded" class="issue-panel">
      <p v-if="ok" class="empty-hint">모든 검증 규칙을 통과했습니다.</p>
      <ul v-else class="issue-list">
        <li
          v-for="issue in issues"
          :key="issue.id"
          :class="['issue', issue.severity, { clickable: !!issue.objectId }]"
          :title="issue.objectId ? '클릭하면 해당 객체로 이동합니다' : undefined"
          @click="focus(issue)"
        >
          <MdiIcon :path="SEVERITY_ICON[issue.severity]" :size="14" class="issue-icon" />
          <span class="badge">{{ SEVERITY_LABEL[issue.severity] }}</span>
          <span class="message">{{ friendlyMessage(issue) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.validation-bar {
  display: flex;
  flex-direction: column;
}
.status-summary {
  width: 100%;
  height: 36px;
  justify-content: flex-start;
  gap: var(--space-2);
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0 var(--space-4);
  color: var(--text-secondary);
}
.status-summary:hover {
  background: var(--surface-2);
  border-color: transparent;
}
.status-icon.ok {
  color: var(--success);
}
.status-icon.warn {
  color: var(--warning);
}
.status-text {
  font-size: var(--font-size-secondary);
  font-weight: 600;
  color: var(--text-primary);
}
.counts {
  display: flex;
  gap: var(--space-1);
}
.count-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.count-chip.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.count-chip.warning {
  background: var(--warning-soft);
  color: var(--warning);
}
.count-chip.info {
  background: var(--info-soft);
  color: var(--info);
}
.chevron {
  margin-left: auto;
  color: var(--text-disabled);
}

.issue-panel {
  max-height: 200px;
  overflow-y: auto;
  padding: 0 var(--space-4) var(--space-3);
  border-top: 1px solid var(--border-subtle);
}
.empty-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-secondary);
  color: var(--text-tertiary);
}
.issue-list {
  list-style: none;
  margin: var(--space-1) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.issue {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 5px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-secondary);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out);
}
.issue.clickable {
  cursor: pointer;
}
.issue.clickable:hover {
  background: var(--surface-2);
  color: var(--text-primary);
}
.issue-icon {
  flex-shrink: 0;
}
.issue.error .issue-icon {
  color: var(--danger);
}
.issue.warning .issue-icon {
  color: var(--warning);
}
.issue.info .issue-icon {
  color: var(--info);
}
.badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 600;
}
.issue.error .badge {
  background: var(--danger-soft);
  color: var(--danger);
}
.issue.warning .badge {
  background: var(--warning-soft);
  color: var(--warning);
}
.issue.info .badge {
  background: var(--info-soft);
  color: var(--info);
}
.message {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
