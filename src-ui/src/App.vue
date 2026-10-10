<script setup lang="ts">
// The app shell: the sidebar beside the current screen. It owns the retrieval flow,
// so a retrieval keeps running while another screen is shown.
import { computed, provide } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from './components/layout/AppSidebar.vue'
import SizeOverlay from './components/layout/SizeOverlay.vue'
import { retrievalKey } from './composables/retrieval'
import { useRetrieval } from './composables/useRetrieval'
import { useWindowSize } from './composables/useWindowSize'
import { sizeOverlayRequested } from './dev-options'
import type { Game, Screen } from './format'

provide(retrievalKey, useRetrieval())
const route = useRoute()
const game = computed(() => route.params.game as Game)
const screen = computed(() => route.name as Screen)
// A debug build opened with ASTRAL_INDEX_SIZE_OVERLAY=1 shows the window's size.
const size = sizeOverlayRequested() ? useWindowSize() : null
</script>

<template>
  <div class="app">
    <!-- Shown once the router has resolved the first screen. -->
    <AppSidebar v-if="route.name" :game :screen />
    <RouterView />
    <SizeOverlay v-if="size" v-bind="size" />
  </div>
</template>

<style scoped>
.app {
  container: app / inline-size;
  display: flex;
  min-width: 480px;
  height: 100vh;
  min-height: 560px;
  overflow: hidden;
}
</style>
