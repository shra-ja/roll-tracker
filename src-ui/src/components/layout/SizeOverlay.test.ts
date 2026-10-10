import { mount } from '@vue/test-utils'
import { expect, test } from 'vitest'
import SizeOverlay from './SizeOverlay.vue'

test('shows the width and height, and the scale only when it is not 1', () => {
  expect(mount(SizeOverlay, { props: { width: 1000, height: 760, scale: 1 } }).text()).toBe(
    '1000 × 760',
  )
  expect(mount(SizeOverlay, { props: { width: 800, height: 608, scale: 1.25 } }).text()).toBe(
    '800 × 608 · 1.25×',
  )
  // Fractional scales are rounded to two places.
  expect(mount(SizeOverlay, { props: { width: 731, height: 556, scale: 1.3333 } }).text()).toBe(
    '731 × 556 · 1.33×',
  )
})

test('is a visual aid only, hidden from assistive technology', () => {
  const overlay = mount(SizeOverlay, { props: { width: 1000, height: 760, scale: 1 } })
  expect(overlay.attributes('aria-hidden')).toBe('true')
  expect(overlay.classes()).toContain('size-overlay')
})
