<script setup lang="ts">
import { ref } from "vue";
import { mdiClose, mdiScaleBalance } from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";
// Single source of truth shared with the SDK package (copied into its dist/
// at build time) — bundled as text so the notice works offline as well.
import notices from "../../../../THIRD_PARTY_NOTICES.md?raw";
import { parseNotices } from "../openSourceNotices";

/** null → the file changed shape; fall back to showing it verbatim rather than hiding anything. */
const parsed = parseNotices(notices);

const dialog = ref<HTMLDialogElement | null>(null);

function open(): void {
  dialog.value?.showModal();
}

function close(): void {
  dialog.value?.close();
}

/** Clicking the backdrop (the dialog element itself, outside its content box) closes it. */
function onDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) close();
}
</script>

<template>
  <button type="button" class="notices-link" @click="open">
    <MdiIcon :path="mdiScaleBalance" :size="13" />
    오픈소스 라이선스
  </button>

  <!-- keydown.stop keeps Studio's global tool shortcuts (W, F, Delete…) from
       acting on the canvas behind the modal; Esc still closes it natively. -->
  <dialog
    ref="dialog"
    class="notices-dialog"
    aria-labelledby="notices-title"
    @click="onDialogClick"
    @keydown.stop
  >
    <div class="notices-content">
      <header class="notices-header">
        <h2 id="notices-title">오픈소스 라이선스</h2>
        <button type="button" class="close-button" aria-label="닫기" @click="close">
          <MdiIcon :path="mdiClose" :size="16" />
        </button>
      </header>
      <div class="notices-body">
        <p class="notices-intro">
          Spatium Studio는 아래 오픈소스 소프트웨어를 사용합니다. 각 구성 요소의 라이선스 전문을
          함께 수록합니다.
        </p>

        <template v-if="parsed">
          <table class="component-table">
            <thead>
              <tr>
                <th scope="col">구성 요소</th>
                <th scope="col">버전</th>
                <th scope="col">라이선스</th>
                <th scope="col">용도</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in parsed.components" :key="item.name">
                <td>
                  <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.name }}</a>
                </td>
                <td class="mono">
                  {{ item.version }}
                </td>
                <td>{{ item.license }}</td>
                <td class="muted">
                  {{ item.purpose }}
                </td>
              </tr>
            </tbody>
          </table>

          <h3 class="section-title">라이선스 전문</h3>
          <details v-for="entry in parsed.licenses" :key="entry.title" class="license-entry">
            <summary>{{ entry.title }}</summary>
            <p v-if="entry.note" class="license-note">
              {{ entry.note }}
            </p>
            <pre class="notices-text">{{ entry.text }}</pre>
          </details>
        </template>
        <pre v-else class="notices-text">{{ notices }}</pre>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.notices-link {
  flex-shrink: 0;
  height: 36px;
  gap: var(--space-1);
  background: transparent;
  border: 0;
  border-left: 1px solid var(--border-subtle);
  border-radius: 0;
  padding: 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
  white-space: nowrap;
}
.notices-link:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border-subtle);
  color: var(--text-secondary);
}

.notices-dialog {
  width: min(760px, calc(100vw - 32px));
  max-height: min(80dvh, 720px);
  padding: 0;
  background: var(--surface-1);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}
.notices-dialog::backdrop {
  background: var(--overlay);
}
.notices-content {
  display: flex;
  flex-direction: column;
  max-height: min(80dvh, 720px);
}
.notices-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}
.notices-header h2 {
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
.notices-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4) var(--space-4);
}
.notices-intro {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-secondary);
  color: var(--text-secondary);
}

.component-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-secondary);
}
.component-table th {
  padding: var(--space-1) var(--space-2);
  text-align: left;
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border);
}
.component-table td {
  padding: var(--space-2);
  vertical-align: top;
  border-bottom: 1px solid var(--border-subtle);
}
.component-table a {
  color: var(--accent);
  text-decoration: none;
}
.component-table a:hover {
  text-decoration: underline;
}
.mono {
  font-family: var(--font-mono);
  font-size: var(--font-size-caption);
  white-space: nowrap;
}
.muted {
  color: var(--text-secondary);
}

.section-title {
  margin: var(--space-5) 0 var(--space-2);
  font-size: var(--font-size-section);
  font-weight: 600;
  color: var(--text-secondary);
}
.license-entry {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-2);
}
/* Override the global summary-as-button look (tokens.css) with a plain disclosure row. */
.license-entry > summary {
  display: list-item;
  height: auto;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  font-weight: 600;
  line-height: 1.4;
}
.license-entry > summary:hover {
  background: var(--surface-2);
}
/* The global summary style hides the native marker; draw an explicit
   disclosure caret so it's clear each entry expands. */
.license-entry > summary {
  list-style: none;
}
.license-entry > summary::-webkit-details-marker {
  display: none;
}
.license-entry > summary::before {
  content: "▸";
  display: inline-block;
  width: 1em;
  margin-right: var(--space-1);
  color: var(--text-tertiary);
  transition: transform var(--dur-fast) var(--ease-out);
}
.license-entry[open] > summary::before {
  transform: rotate(90deg);
}
.license-note {
  margin: 0 var(--space-3) var(--space-2);
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
.notices-text {
  margin: 0 var(--space-3) var(--space-3);
  padding: var(--space-3);
  max-height: 320px;
  overflow: auto;
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--font-size-caption);
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Fallback (unparsed) view: the whole file in one block, no per-entry margins. */
.notices-body > .notices-text {
  margin: 0;
  max-height: none;
}

@media (max-width: 560px) {
  .component-table thead {
    display: none;
  }
  .component-table tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .component-table td {
    padding: 0;
    border: 0;
  }
  .component-table td:nth-child(3),
  .component-table td:nth-child(4) {
    grid-column: 1 / -1;
  }
}
</style>
