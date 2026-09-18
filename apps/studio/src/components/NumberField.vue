<script setup lang="ts">
import { mdiMinus, mdiPlus } from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue: number;
    unit?: string;
    min?: number;
    max?: number | undefined;
    step?: number;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { step: 1 },
);
const emit = defineEmits<{ change: [value: number] }>();

function clamp(value: number): number {
  let v = value;
  if (props.min !== undefined) v = Math.max(props.min, v);
  if (props.max !== undefined) v = Math.min(props.max, v);
  return v;
}

function commit(raw: string): void {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) return;
  emit("change", clamp(value));
}

function onInputChange(evt: Event): void {
  commit((evt.target as HTMLInputElement).value);
}

function adjust(direction: 1 | -1): void {
  if (props.disabled) return;
  const next = clamp(Number((props.modelValue + direction * props.step).toFixed(6)));
  emit("change", next);
}
</script>

<template>
  <label class="number-field" :class="{ disabled }">
    <span v-if="label" class="field-label">{{ label }}</span>
    <div class="number-control">
      <button
        type="button"
        class="btn-ghost btn-icon stepper"
        tabindex="-1"
        aria-label="감소"
        :disabled="disabled"
        @click="adjust(-1)"
      >
        <MdiIcon :path="mdiMinus" :size="12" />
      </button>
      <input
        type="number"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        :placeholder="placeholder"
        @change="onInputChange"
      />
      <span v-if="unit" class="unit">{{ unit }}</span>
      <button
        type="button"
        class="btn-ghost btn-icon stepper"
        tabindex="-1"
        aria-label="증가"
        :disabled="disabled"
        @click="adjust(1)"
      >
        <MdiIcon :path="mdiPlus" :size="12" />
      </button>
    </div>
  </label>
</template>

<style scoped>
.number-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-secondary);
  color: var(--text-secondary);
}
.number-field.disabled {
  opacity: 0.5;
}
.field-label {
  color: var(--text-secondary);
}
.number-control {
  display: flex;
  align-items: stretch;
  height: var(--control-height);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.number-control:focus-within {
  border-color: var(--accent);
}
.number-control input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0 2px 0 8px;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  text-align: left;
}
.number-control input:hover {
  border-color: transparent;
}
.unit {
  display: flex;
  align-items: center;
  padding: 0 4px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  white-space: nowrap;
}
.stepper {
  height: 100%;
  width: 22px;
  min-width: 22px;
  border: 0;
  border-radius: 0;
  color: var(--text-tertiary);
}
.stepper:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--surface-hover);
}
</style>
