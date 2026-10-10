<script setup lang="ts">
// Presentational: the window's size in a corner, for finding layout breaks by hand
// in development. It ignores the pointer and is hidden from assistive technology.
import { computed } from 'vue'

const props = defineProps<{ width: number; height: number; scale: number }>()
const scale = computed(() =>
  props.scale === 1 ? '' : ` · ${Math.round(props.scale * 100) / 100}×`,
)
</script>

<template>
  <div class="size-overlay" aria-hidden="true">{{ width }} × {{ height }}{{ scale }}</div>
</template>

<style scoped>
.size-overlay {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 1000;
  padding: 4px 8px;
  border: 1px solid var(--rim-strong);
  border-radius: 6px;
  background: var(--sidebar);
  color: var(--text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
  pointer-events: none;
}
</style>
