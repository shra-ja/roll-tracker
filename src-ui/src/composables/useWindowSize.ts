import { onUnmounted, reactive, readonly } from 'vue'

/** The window's size in CSS pixels and its scale, followed while the caller is mounted. */
export function useWindowSize() {
  const size = reactive({ width: 0, height: 0, scale: 1 })
  const read = () =>
    Object.assign(size, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
    })
  read()
  window.addEventListener('resize', read)
  onUnmounted(() => window.removeEventListener('resize', read))
  return readonly(size)
}
