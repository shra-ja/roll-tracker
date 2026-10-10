import { expect, test } from 'vitest'
import { sizeOverlayRequested } from './dev-options'

test('the size overlay is asked for only by the debug build’s page script', () => {
  expect(sizeOverlayRequested({ __ASTRAL_INDEX_SIZE_OVERLAY__: true })).toBe(true)
  for (const scope of [{}, { __ASTRAL_INDEX_SIZE_OVERLAY__: 'true' }, { other: true }]) {
    expect(sizeOverlayRequested(scope)).toBe(false)
  }
  // The page itself carries no request unless the window was opened with one.
  expect(sizeOverlayRequested()).toBe(false)
})
