# 0048 — Layout fixes

Status: Planned · Milestone 10, Release readiness
Decisions: [0013](../../architecture/decisions/0013-visual-design.md)

Make every screen use the window well from the 480×560 minimum to very large
windows: no content cut off or squeezed out of reach in small windows, and no
narrow content stranded in a corner or empty panels in large ones. Screens were
checked natively at 480×560, 1000×760, 1600×1000 and 2560×1440.

## Tasks

Each task is one PR, in this order. Each fix is checked natively, test first,
with end-to-end checks at those window sizes and screenshots looked at by eye.

- [ ] Add a window size overlay for development: started with
  `ASTRAL_INDEX_SIZE_OVERLAY=1`, a development run (`npm run tauri:mock` or
  `tauri dev`) shows the window's width and height in CSS pixels in a corner,
  with the zoom when it is not 1, updating live while the window is resized, so
  narrow ranges of sizes where a layout breaks can be found by hand. It never
  appears in release builds or without the variable, so the end-to-end
  screenshots stay clean; it ignores the pointer and is hidden from assistive
  technology. Document it in DEVELOPMENT beside `ASTRAL_INDEX_ZOOM`.
- [ ] Keep Review Import's category table in reach in small windows. At
  480×560 the summary and the action bar take the height and the "By Category"
  table shrinks to its heading, with no way to scroll to its rows. The table
  keeps its rows and the screen scrolls instead, with the action bar still in
  reach.
- [ ] Fit History's rolls panel to its rolls. In tall windows the panel fills
  the height while a page holds 20 rolls, leaving most of it empty in every
  layout. The panel ends at its rolls with the pager below it; page sizes stay
  20, 50 and 100. Only one region scrolls at a time: in a short window the
  screen scrolls and the panel shows all its rolls, rather than a scrolling
  panel inside a scrolling screen; with more rolls than a tall window holds,
  the panel scrolls within the window.
- [ ] Give every screen one shared maximum content width, about 1,600 px,
  centred, and amend decision 0013 with it. History and Review Import stop
  spreading their columns across very wide windows; Import's source cards
  share the width in a fluid grid rather than stopping at about 1,200 px in the
  top-left corner. The Import screen's states align the same way: today the
  saved card is centred in both directions, the failed card only horizontally,
  and the start screen not at all. Small and medium windows keep their layout.
- [ ] Fix the layout breaks that appear only within narrow ranges of window
  sizes, found by hand with the size overlay. List each, with the sizes where
  it appears, in this task before its PR, and check it natively at those sizes.

Filling a tall window with more rolls per page, rather than ending the panel at
its rolls, is [0049](0049-automatic-page-size.md).
