# Roadmap

Milestones group features for convenience, in dependency order. Each feature has
its own file in `features/`, holding its stories and tasks: open the file for the
feature at hand, and the ones it links, rather than reading every feature. The
[product brief](PROJECT.md) says why the project exists and what the first
release must do; [STATUS](../status/STATUS.md) says where it stands.

- Check a task only after its acceptance is demonstrated, and record the results
  and limitations in STATUS. Check a parent task only when all its steps are
  checked, and a feature only when all its tasks are.
- Each unchecked task is one deliverable increment on its own short-lived branch,
  following [CONTRIBUTING](../../CONTRIBUTING.md): red-green-refactor and 100%
  coverage before integration. Tasks run in the order listed.
- To add a feature, take the next number and copy the layout of an existing
  file: title, `Status:` (Planned, In progress, Done or Backlog) with its
  milestone, any decisions, a one-paragraph goal, then stories as `##` headings
  with task checklists. Add it to the list below.

## Milestones

### 0 — Project context

- [x] [0001 — Project foundations](features/0001-project-foundations.md)

### 1 — Runnable offline shell

- [x] [0002 — Offline shell](features/0002-offline-shell.md)
- [x] [0003 — Test and coverage gates](features/0003-test-and-coverage-gates.md)

### 2 — HSR API import foundations

Honkai: Star Rail API history import is the first feature to implement after the
shell. This milestone establishes its backend foundations; milestones 3 to 7 complete
the user-facing acquisition and import flow. Standalone history-file import is
not a prerequisite.

[API research](../games/hsr/api-research.md) records request extraction and a working
nine-field query. Advancing `end_id` and `page` reproduced 50 records across five
pages. The [initial API contract](../games/hsr/api-contract.md) now records observed fields,
accepted assumptions and the observed expired-key response. Additional external
verification does not block this milestone under the user's agreed scope.

- [x] [0004 — HSR API contract](features/0004-hsr-api-contract.md)
- [x] [0005 — HSR response parser](features/0005-hsr-response-parser.md)
- [x] [0006 — SQLite import storage](features/0006-sqlite-import-storage.md)

Done when synthetic HSR API responses can be validated, previewed, and committed
through tested services without duplicate records or partial writes, and repeated
overlapping imports retain only new rolls plus compact import summaries and
first-import provenance, with measured performance and storage-growth evidence. This is a
foundation for the first API-import feature, not a separate file-import release.

### 3 — HSR request discovery and extraction

Connect user-requested automatic discovery and extraction, locating `data_2`
internally in the supported cache directory. If discovery fails, accept a
user-provided cache file as the alternative. Do not require users to select a
discovered cache or game-data directory. Cache files supply request context,
not standalone roll-history exports.

- [x] [0007 — Cache request extraction](features/0007-cache-request-extraction.md)
- [x] [0008 — Current-user discovery](features/0008-current-user-discovery.md)
- [x] [0009 — Extraction commands and controls](features/0009-extraction-commands-and-controls.md)
- [x] [0010 — Installation verification](features/0010-installation-verification.md)

Done when the app extracts a request context on request, automatically from a
real installation on Windows or from WSL, or from a chosen cache file, without
the context reaching the webview.

### 4 — HSR history acquisition

Implement the [initial API contract](../games/hsr/api-contract.md) in a user-initiated
native client: the two history endpoints (collaboration warps use
`getLdGachaLog`), 1000-record default pages, cursor pagination,
cancellation and actionable failures. Use one retry
per transiently failed request, at most two extra attempts per acquisition, and
synthetic request mocks. No background or automatic fetching.

- [x] [0011 — Requests and transport](features/0011-requests-and-transport.md)
- [x] [0012 — Auth-key validation](features/0012-auth-key-validation.md)
- [x] [0013 — Cursor pagination](features/0013-cursor-pagination.md)
- [x] [0014 — Retries and cancellation](features/0014-retries-and-cancellation.md)
- [x] [0015 — Retrieval progress](features/0015-retrieval-progress.md)

Done when a validated context retrieves every page of every category with
bounded retries and pacing, can be cancelled, and reports its progress.

### 5 — Import review and save

Connect acquisition to import preview, atomic commit, and history display.
Expose a narrow native review DTO with validated account/server/context, counts
and conflict locations, plus the failing category and page for retrieval
failures.
Do not reparse private source bytes in the frontend or expose credentials/raw
payloads in diagnostics.

- [x] [0016 — Account resolution and review](features/0016-account-resolution-and-review.md)
- [x] [0017 — Acquisition session](features/0017-acquisition-session.md)
- [x] [0018 — Database location and portable mode](features/0018-database-location-and-portable-mode.md)
- [x] [0019 — Retrieve and commit commands](features/0019-retrieve-and-commit-commands.md)
- [x] [0020 — Review and save controls](features/0020-review-and-save-controls.md)

Done when a retrieval can be reviewed and saved in one transaction, or
discarded, from the desktop app, with the database in the local data folder or
in portable mode.

### 6 — Desktop UI foundation

- [x] [0021 — Vue frontend](features/0021-vue-frontend.md)
- [x] [0022 — Linting and formatting](features/0022-linting-and-formatting.md)
- [x] [0023 — Visual design](features/0023-visual-design.md)
- [x] [0024 — App shell and import screens](features/0024-app-shell-and-import-screens.md)
- [x] [0025 — Mock debug binary](features/0025-mock-debug-binary.md)

Done when the webview is a linted Vue app with the reviewed design and shell, and
the mock binary drives it end to end without a network.

### 7 — Saved history display and refresh

- [x] [0026 — Stored-history commands](features/0026-stored-history-commands.md)
- [x] [0027 — History screen](features/0027-history-screen.md)
- [x] [0028 — Incremental retrieval](features/0028-incremental-retrieval.md)
- [x] [0029 — End-to-end verification](features/0029-end-to-end-verification.md)

Done when an explicit user request retrieves HSR history through the API,
previews and commits it locally, and displays it after restart without duplicate
records. Failures preserve existing data; stored-history operations never trigger
acquisition. This is the first implemented import feature. See
[decision 0002](../architecture/decisions/0002-user-requested-history-acquisition.md).

### 8 — Project cleanup

- [x] [0044 — Markdown checks](features/0044-markdown-checks.md)
- [x] [0045 — Astral Index rebrand](features/0045-astral-index-rebrand.md)

Done when the docs are checked in `npm run check` and the app, code, docs and
GitHub repository carry the name Astral Index.

### 9 — History browsing and statistics

- [x] [0032 — Account switching and filters](features/0032-account-switching-and-filters.md)
- [x] [0035 — Pity](features/0035-pity.md)
- [x] [0033 — Grid and icon layouts](features/0033-grid-and-icon-layouts.md)

Done when the History screen switches between accounts and servers, filters
saved rolls by rarity, name and date, shows totals, rarity breakdowns and pity,
and offers list, grid and icon layouts with placeholder art.

### 10 — Release readiness

The first release covers Honkai: Star Rail only
([decision 0018](../architecture/decisions/0018-star-rail-first-release.md)).

- [x] [0047 — Astral brand](features/0047-astral-brand.md)
- [ ] [0048 — Layout fixes](features/0048-layout-fixes.md)
- [ ] [0038 — Release verification](features/0038-release-verification.md)
- [ ] [0039 — Distribution](features/0039-distribution.md)

Done when the app carries the Astral brand, its screens fit every window size,
and the first release is verified on each release OS and distributed in its
documented formats.

### 11 — Backup, restore and file import

- [ ] [0037 — Backup and restore](features/0037-backup-and-restore.md)
- [ ] [0030 — History-file import](features/0030-history-file-import.md)

Done when a fresh profile can recover the same records and metadata from a
backup, and supported history files reuse the import pipeline.

### 12 — Genshin Impact and the banner catalogue

Banner metadata and art come from a catalogue folder written by a separate
downloader ([decision 0022](../architecture/decisions/0022-banner-catalogue-downloader.md)).

- [ ] [0031 — Second game adapter](features/0031-second-game-adapter.md)
- [ ] [0034 — Banner metadata](features/0034-banner-metadata.md)
- [ ] [0036 — Item icons and banner art](features/0036-item-icons-and-banner-art.md)

Done when both games coexist without shared identity or rule assumptions, and a
user-selected catalogue folder supplies banner names, 50/50 outcomes, item icons
and banner art only where its verified entries support them.

## Backlog

Low-priority follow-ups, outside any milestone until scheduled.

- [ ] [0040 — Portable history copy](features/0040-portable-history-copy.md)
- [ ] [0041 — Review record preview](features/0041-review-record-preview.md)
- [ ] [0042 — Overlap anomaly detection](features/0042-overlap-anomaly-detection.md)
- [ ] [0043 — Braces audit follow-up](features/0043-braces-audit.md)
- [ ] [0046 — History gap detection](features/0046-history-gap-detection.md)
- [ ] [0049 — Automatic page size](features/0049-automatic-page-size.md)

## Earlier milestone numbers

Milestones were renumbered on 2026-10-04, when the old milestone 3 was split by
what it delivered, and twice on 2026-10-05: first when milestone 8, Project
cleanup, was inserted, then when the later features were reordered for a Star
Rail first release. Status history and decision records keep the numbers they
were written with:

| Before 2026-10-04 | 2026-10-04 | 2026-10-05, cleanup | Now |
| --- | --- | --- | --- |
| 0, 1, 2 | Unchanged | Unchanged | Unchanged |
| 3, First user-requested API history import | 3 to 7 | 3 to 7 | 3 to 7 |
| None | None | 8, Project cleanup | 8 |
| 4, Additional import sources, multi-game history and statistics | 8 | 9 | 9 (0032, 0033, 0035), 11 (0030), 12 (0031, 0034, 0036) |
| 5, Backup and restore | 9 | 10 | 11 |
| 6, Release readiness | 10 | 11 | 10 |
