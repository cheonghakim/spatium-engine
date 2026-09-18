<script setup lang="ts">
import { ref } from "vue";
import { mdiChevronDown, mdiChevronRight } from "@mdi/js";
import MdiIcon from "./MdiIcon.vue";

const props = withDefaults(defineProps<{ title: string; defaultOpen?: boolean }>(), {
  defaultOpen: true,
});
const open = ref(props.defaultOpen);
</script>

<template>
  <section class="property-group">
    <button type="button" class="group-header" :aria-expanded="open" @click="open = !open">
      <MdiIcon :path="open ? mdiChevronDown : mdiChevronRight" :size="14" />
      <span>{{ title }}</span>
    </button>
    <div v-show="open" class="group-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.property-group {
  border-bottom: 1px solid var(--border-subtle);
}
.property-group:last-child {
  border-bottom: 0;
}
.group-header {
  width: 100%;
  height: auto;
  justify-content: flex-start;
  gap: var(--space-1);
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: var(--space-2) 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-section);
  font-weight: 600;
  letter-spacing: 0.2px;
  text-transform: uppercase;
}
.group-header:hover {
  background: transparent;
  color: var(--text-secondary);
}
.group-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
}
</style>
