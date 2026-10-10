import { mount } from '@vue/test-utils'
import { afterEach, expect, test } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { useWindowSize } from './useWindowSize'

const resize = (width: number, height: number, scale = 1) => {
  Object.assign(window, { innerWidth: width, innerHeight: height, devicePixelRatio: scale })
  window.dispatchEvent(new Event('resize'))
}
afterEach(() => resize(1024, 768))

const Probe = defineComponent({
  setup: () => ({ size: useWindowSize() }),
  template: '<p>{{ size.width }} {{ size.height }} {{ size.scale }}</p>',
})

test('follows the window’s size in CSS pixels and its scale while mounted', async () => {
  resize(1000, 760)
  const wrapper = mount(Probe)
  expect(wrapper.text()).toBe('1000 760 1')
  resize(481, 559, 1.25)
  await nextTick()
  expect(wrapper.text()).toBe('481 559 1.25')
  // Unmounted, it stops listening.
  const { size } = wrapper.vm as unknown as { size: { width: number } }
  wrapper.unmount()
  resize(900, 700)
  expect(size.width).toBe(481)
})
