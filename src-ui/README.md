# Frontend

The Vue webview app, as the `astral-index-ui` npm workspace. See
[decision 0011](../docs/architecture/decisions/0011-vue-frontend.md) for the conventions.

- `src/main.ts` mounts `App.vue`, the shell with the sidebar beside the current
  screen; `src/router/` maps each game's History and Import routes to views,
  with hash history.
- `src/views/` holds screens: `HistoryView.vue` shows saved history and
  `ImportView.vue` the retrieval flow. Views wire composables to components and
  move focus.
- `src/components/` holds presentational components, which take props and emit
  events and never make native calls, grouped by where they are used:
  `layout/` for the shell and screen frame (`AppSidebar`, `ScreenHeader`,
  and `SizeOverlay`, the development window size overlay),
  `history/` for the History screen, `import/` for the Import screen, and
  `shared/` for pieces any screen may use (`AppTooltip`, `CachePicker`, and
  `AstralTile`, the brand emblem in its tile).
- `src/composables/` holds flow logic and is the only caller of the native
  commands: `useRetrieval.ts` runs retrieval, review and saving, and
  `useHistory.ts` reads the saved accounts and saved history a page at a time,
  keeping each game's account chosen in the switcher until the app restarts or
  a save into that game. `useWindowSize.ts` follows the window's size for the
  size overlay.
- `src/commands.ts` is the typed client for the native commands. Results carry
  failure categories only, never request contexts, paths or native detail. Keep
  native I/O behind typed backend commands rather than adding it here.
- `src/dev-options.ts` reads the development options a debug build asks for
  with a page script, such as the size overlay; release builds never add one.
- `src/input-modality.ts` tracks whether the latest press came from the
  keyboard, so tooltips show at once on keyboard focus.
- `src/messages.ts` says what the app tells the user about failures, progress
  and saving; `src/format.ts` holds other shared display text such as warp, game
  and tab names, dates and times.
- `src/assets/main.css` holds the base styles; each component carries scoped
  styles. `src/assets/brand/` holds the brand's emblem and wordmark, kept as
  supplied ([decision 0023](../docs/architecture/decisions/0023-astral-brand.md)). Everything is bundled (no remote fonts or assets).
- `build/vite.ts` holds the Vite configuration, to which `vite.config.ts` only
  delegates.

Unit tests sit beside the code they test as `*.test.ts`. Integration tests, which
mount the app with native commands mocked, live in `tests/`. Native end-to-end
tests live in the repository-root `tests/`. `npm test` and `npm run coverage` run
the frontend's own tests and coverage here, or with the tooling's from the
repository root, where `npm run typecheck` checks everything.
