<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { validateProject, type ValidationIssue } from "@indoor/core";
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

const SEVERITY_ORDER: Record<ValidationIssue["severity"], number> = { error: 0, warning: 1, info: 2 };
const SEVERITY_LABEL: Record<ValidationIssue["severity"], string> = {
  error: "오류",
  warning: "경고",
  info: "정보",
};

const issues = computed<ValidationIssue[]>(() => {
  revision.value;
  return [...validateProject(props.editor.project)].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
});

function focus(issue: ValidationIssue): void {
  if (issue.objectId) props.editor.focusObject(issue.objectId);
}
</script>

<template>
  <div class="validation-panel">
    <h3>검증 ({{ issues.length }})</h3>
    <p v-if="issues.length === 0" class="empty-hint">문제가 없습니다.</p>
    <ul v-else class="issue-list">
      <li
        v-for="issue in issues"
        :key="issue.id"
        :class="['issue', issue.severity, { clickable: !!issue.objectId }]"
        @click="focus(issue)"
      >
        <span class="badge">{{ SEVERITY_LABEL[issue.severity] }}</span>
        <span class="message">{{ issue.message }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.validation-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
}
h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.issue {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out);
}
.issue.clickable {
  cursor: pointer;
}
.issue.clickable:hover {
  background: var(--surface-2);
}
.badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: 11px;
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
</style>
