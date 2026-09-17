# Roadmap

Milestones are ordered by dependency. Check items only after their acceptance
criteria are demonstrated; record results and limitations in `STATUS.md`.
Every code milestone follows `../CONTRIBUTING.md`: a short-lived task branch,
red-green-refactor, and passing full tests and 100% coverage before integration.

## 0 — Project context

- [x] Document product intent, agent instructions, boundaries, and import risks.
- [x] Reserve frontend, native backend, and fixture directories.
- [x] Define mandatory TDD, 100% coverage, and trunk-based development conventions.
- [x] Initialize Git with `main` as the trunk and configure the GitHub remote.
- [x] Establish the authorized documentation baseline commit.

## 1 — Runnable offline shell

- [x] Select and record vanilla TypeScript/Vite/npm, Tauri 2, and Ubuntu 24.04.
- [x] Create `feat/offline-shell` from the authorized baseline before adding code.
- [x] Pin asdf Node/Rust toolchains and exact frontend/Rust dependencies.
- [x] Establish frontend/tooling V8 coverage and native LLVM branch instrumentation,
  including `build.rs`; enforce 100% per-file metrics and source inventory.
- [x] Prove gate failures for unexecuted files, missed branches and missing reports.
- [x] Add CI running the same local checks and uploading coverage/screenshots.
- [x] Scaffold Tauri with bundled assets and restrictive production CSP.
- [x] Use red-green-refactor for an accessible empty state with game selection.
- [x] Document and run setup, tests, coverage, lint/type and production build commands.
- [x] Launch and exercise the native shell in an isolated network namespace.

Local milestone validation is complete on Ubuntu 24.04 x86_64. Windows/macOS
and installer packaging remain untested. Branch protection is enabled by the
user; the new workflow still needs its first hosted run and its
**Tests and 100% coverage** job selected as a required check before integration.
Remaining integration steps:

- [x] Commit the milestone branch with a Conventional Commit and push it for review.
- [ ] Open a pull request and obtain a passing hosted **Tests and 100% coverage** run.
- [ ] Require that job in `main` branch protection and integrate the reviewed change.
- [ ] Delete the short-lived branch after integration.

Milestone commit `f95e2e7` is pushed to `origin/feat/offline-shell`. PR creation and
hosted CI verification are pending authenticated GitHub API access. No merge has
been performed. No remaining local implementation gap was found in the audit.

## 2 — First file-import vertical slice

- [ ] Verify one game/format, including identity and timezone semantics.
- [ ] Implement domain model, local database, initial migration, and parser fixtures.
- [ ] Implement file selection, preview, atomic commit, and history display.
- [ ] Verify restart persistence, repeat/overlap imports, errors, and account isolation.

Done when one supported file can be imported and browsed offline without duplicate
records on re-import, with failure cases leaving history intact.

## 3 — Multi-game history and statistics

- [ ] Add the second game's independently verified adapter and fixtures.
- [ ] Add account/server switching, filters, totals, and rarity breakdowns.
- [ ] Implement verified banner grouping and coverage-aware pity calculations.

Done when both games coexist without shared identity/rule assumptions and partial
histories display appropriate uncertainty.

## 4 — Backup and restore

- [ ] Define a versioned export format and validate imports of backups.
- [ ] Implement backup, restore, and migration recovery behavior.
- [ ] Verify round trips and corrupted/unsupported backup handling.

Done when a fresh profile can recover the same records and metadata from a backup.

## 5 — Local installation ingestion

- [ ] Research actual offline data availability per game and target OS.
- [ ] Record supported and unsupported sources with evidence.
- [ ] Add read-only discovery/manual selection and reuse the validated import pipeline.

Done when a verified local source works end to end. If history is unavailable
offline, document that limitation and retain file import; do not claim this source
is implemented or silently introduce network acquisition.

## 6 — Release readiness

- [ ] Check accessibility, large histories, native permissions, and bundled resources.
- [ ] Verify offline workflows, upgrades, backups, and packaging on each release OS.
- [ ] Choose license/distribution, document supported formats, and provide recovery help.
