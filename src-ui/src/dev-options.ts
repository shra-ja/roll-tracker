// Development options a debug build asks for with a page script before the app
// loads; release builds never add one.

/** Whether the window was opened with `ASTRAL_INDEX_SIZE_OVERLAY=1`. */
export function sizeOverlayRequested(scope: object = window): boolean {
  return (
    (scope as { __ASTRAL_INDEX_SIZE_OVERLAY__?: unknown }).__ASTRAL_INDEX_SIZE_OVERLAY__ === true
  )
}
