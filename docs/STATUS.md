# Project status

Updated: 2026-09-19

## Current state

Milestone 1 implementation and validation are complete. Work was developed on
`feat/offline-shell` from authorized baseline `2d78399` and published in
[PR #1](https://github.com/shra-ja/roll-tracker/pull/1). The user confirmed hosted
CI passed and **Tests and 100% coverage** is required on protected `main`.
The remote uses SSH: `git@github.com:shra-ja/roll-tracker.git`.

The app is a vanilla TypeScript/Vite web UI in Tauri 2, with game selection,
an accessible offline empty state and bundled styling. No import, database,
game rules or statistics are implemented. Production CSP blocks network calls;
no native capabilities or plugins are enabled. Decision 0001 records the stack.

## Environment

Installed through asdf: Rust nightly-2026-09-16; project selects existing Node.js
26.8.1. Rust includes rustfmt, clippy, llvm-tools-preview, cargo-llvm-cov 0.9.1 and
tauri-driver 2.0.6. `.tool-versions` pins the runtimes. The user installed the
required Ubuntu shared libraries/test utilities; their availability was verified.
Python 3 from the existing asdf setup runs the standard-library-only X11 test helper.

## Verification

- `npm run check`: passed on Ubuntu 24.04 x86_64, including strict TypeScript
  checks of app/tooling/tests, Rust formatting and Clippy with warnings denied.
- 17 UI/coverage-validator tests, native integration, 3 failure-probe tests and
  source-inventory/report validation passed. Native probes run additional smoke tests.
- Frontend and executable coverage tooling: 100% lines/statements/functions/branches.
- Rust startup and `build.rs`: 100% lines/regions/functions; no handwritten branch
  points in the final shell. A temporary real Rust branch proved missed branches
  are measured and rejected, then was removed and coverage regenerated.
- Native test ran under Xvfb/WebKitWebDriver without an external network route,
  verified bundled content, game selection by keyboard, blocked external fetch,
  screenshot capture and graceful shutdown with process coverage flushed.
- Tauri production executable built successfully; installer packaging is deferred.
- Milestone audit confirmed all local implementation items; Markdown links and
  workflow YAML validate.
- Hosted CI passed, as confirmed by the user on 2026-09-19. The workflow installs
  the pinned asdf binary with `asdf_version` and grants user namespaces to its
  own Bubblewrap executable with a scoped AppArmor profile, preserving offline
  tests on the Ubuntu runner. **Tests and 100% coverage** is configured as a
  required check in branch protection.

See `TESTING.md` for red/green evidence, scope, exclusions and probe behavior.
Reports and the native screenshot are ignored local artifacts. Other platforms
are untested. There are no Rust domain unit tests yet; real native integration
covers the minimal shell and build script.

## Next task

Milestone 2: verify one real file format, define record identity/time semantics,
and implement the first transactional local import using test-first Rust domain
tests and synthetic data. Start a new short-lived branch from up-to-date `main`
following the integration workflow in `../CONTRIBUTING.md`.

## Outstanding decisions

Supported release OS/packaging; persistence library; exact import formats and
installation-source feasibility; account UX; game-rule evidence; final branding
and license. Do not assume installation files contain usable offline history.
