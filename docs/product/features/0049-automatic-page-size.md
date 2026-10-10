# 0049 — Automatic page size

Status: Backlog · Backlog

Let the History screen fill the window with rolls, as an option beside the
fixed page sizes.

## Tasks

- [ ] Add an automatic page size that fits as many rolls as the rolls panel
  holds without scrolling, for the list, grid and icons layouts, and that
  follows window resizes and layout switches, keeping the first roll shown on
  the new page. Decide whether it becomes the default, its minimum in short
  windows, and how a resize debounces its reads. Its trade-offs: a page no
  longer means a fixed set of rolls, resizing re-reads the page from the local
  database, and the size depends on real layout, so native end-to-end tests
  carry it. Follows [0048 — Layout fixes](0048-layout-fixes.md).
