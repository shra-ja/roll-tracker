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

- [ ] Select frontend tooling and first development target; record decisions.
- [ ] Create a short-lived task branch before adding any executable code.
- [ ] Establish test harnesses and coverage instrumentation for frontend, Rust,
  and executable tooling; enforce 100% per-file applicable metrics, including
  unexecuted files. Document exclusions and prove failing gates with probes.
- [ ] Add CI running full tests and coverage gates; document actual commands.
- [ ] Scaffold Tauri using verified current documentation and pinned dependencies.
- [ ] Use red-green-refactor to add a bundled, accessible empty-state screen
  with game selection.
- [ ] Document exact prerequisites and development, build, and check commands.
- [ ] Launch the native application and verify the shell without network access.

Done when a clean setup can build and launch the shell using documented commands.
Full tests and 100% coverage gates must pass before integration. Report untested
platforms explicitly. Configure GitHub required checks and `main` protection when
CI is available and remote administration is authorized; enforcement remains pending.

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
