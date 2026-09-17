# Roll Tracker — agent instructions

## Start here

Read `docs/PROJECT.md`, `docs/STATUS.md`, and the relevant sections of
`docs/ARCHITECTURE.md` before implementation. Read `CONTRIBUTING.md` for mandatory
TDD, coverage, and branch workflows. Use `docs/ROADMAP.md` for planned work
and `docs/IMPORTS.md` for ingestion requirements. These documents describe intent;
inspect actual code before assuming a feature exists.

## Product constraints

- Build an offline desktop application with a web UI hosted by Tauri.
- Start with Genshin Impact and Honkai: Star Rail, using separate game adapters.
- Support user-provided files and, where technically feasible, read-only local
  installation sources. Do not assume local files contain complete roll history.
- Core import, browsing, analysis, and export must work without network access.
- No accounts with our service, telemetry, cloud storage, remote assets, or hidden
  network dependencies. Any future online acquisition is a separate product decision.
- Keep player data local. Never commit real histories, account IDs, credentials,
  auth URLs, game logs, databases, or private filesystem paths. Use synthetic fixtures.

## Implementation conventions

- Tauri is decided; frontend framework, dependency versions, package manager, and
  database library are not yet selected. Record consequential choices in
  `docs/decisions/` and update setup instructions when scaffolding the app.
- Keep UI presentation, game rules, parsing, persistence, and OS discovery separate.
- Prefer Rust for file access, import validation, persistence, and authoritative
  domain logic. The frontend calls a narrow, typed command interface.
- Treat files as untrusted input. Bound input sizes, validate formats, provide
  actionable errors, and avoid exposing sensitive source content in errors/logs.
- Imports must be transactional and safe to repeat. Preserve source IDs as strings;
  never deduplicate only by timestamp or localized item name.
- Keep accounts, servers, games, and banner/pity groups separate. Do not infer
  complete history, guarantees, or exact pity from incomplete evidence.
- Never modify game installations. Limit file access to the source locations
  needed for the user-selected import; avoid broad filesystem scans.
- Use narrowly scoped Tauri permissions. Do not expose arbitrary filesystem or
  shell commands to the webview.
- Keep changes focused. Make routine reversible choices independently, documenting
  assumptions; ask only when missing information materially blocks the task.

## Mandatory development workflow

- Use Conventional Commits for every commit message:
  `type(optional-scope): description`. See `CONTRIBUTING.md` for examples.
- Follow trunk-based development with `main` as the trunk. Before any code change,
  create a separate short-lived task branch from up-to-date `main`. Never implement
  directly on `main`; this includes tests, build scripts, and CI configuration.
- Keep branches focused on one small change, integrate as soon as all gates pass
  (target the same working day), and delete merged branches. No long-lived develop,
  release, or feature branches. See `CONTRIBUTING.md` for bootstrap details.
- Use test-driven development for all behavior changes: write a meaningful test,
  run it and observe the expected failure, implement the minimum to pass, then
  refactor with tests green. Add a failing regression test before fixing a bug.
- Mandate 100% coverage of all first-party executable code, including frontend,
  Rust backend, native glue, and executable tooling. Require 100% lines, statements,
  functions, and branches wherever applicable; select tooling that can enforce
  these metrics rather than silently omitting an unsupported metric.
- Include unexecuted source files in coverage. Enforce thresholds per file and per
  language/package; do not round up, rely on changed-lines-only coverage, or hide
  missed paths with exclusions, ignore annotations, or trivial assertions.
- Establish automated test and coverage gates with the first executable code.
  Missing, empty, stale, or incomplete reports must fail. CI must run the same
  gates before integration; a docs-only scaffold is not evidence of 100% coverage.

## Validation and handoff

- This is currently a documentation scaffold: no app, manifests, or test commands
  exist. Do not report planned commands as runnable or checks as passing.
- Once code exists, document exact setup/check commands in `README.md`. Run focused
  tests during TDD and the full tests and coverage gates before handoff/integration.
  Test observable behavior rather than mirroring implementation.
- Prioritize parser failures, repeated/overlapping imports, cross-account isolation,
  migration safety, uncertain timestamps, incomplete histories, and offline use.
- For UI work, check keyboard operation, readable empty/error states, and native
  Tauri behavior where available. Browser mocks alone do not validate native I/O.
- Update `docs/STATUS.md` with completed work, actual verification, and the next
  concrete task. Update architecture/decisions when behavior or boundaries change.
- Report the task branch, red/green evidence, full test and coverage results, what
  changed, and any remaining limitations. Do not
  commit, publish, or release unless requested.

## Code review priorities

Flag data loss, duplicate or silently omitted rolls, account mixing, unjustified
pity calculations, accidental network dependencies, overbroad native permissions,
and leakage of player data. Require evidence for claimed import compatibility.
Reject code changes made on the trunk, missing TDD evidence, coverage below 100%,
and exclusions or disabled tests that conceal untested first-party code.
