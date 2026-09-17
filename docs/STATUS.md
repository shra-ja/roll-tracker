# Project status

Updated: 2026-09-17

## Current state

Project context and directory scaffold created. No application code, dependency
manifests, database, import adapters, or runnable build/test commands exist yet.
Tauri, offline operation, and the two initial games are confirmed requirements.
TDD, 100% first-party code coverage, and trunk-based development on separate
short-lived branches are mandatory; see `../CONTRIBUTING.md`.
Other technical choices remain proposals. The initial documentation baseline is
on `main`, with `origin` set to `https://github.com/shra-ja/roll-tracker`. All commit
messages must follow Conventional Commits. No push has been performed.

## Verification

Documentation links and expected scaffold files checked locally. No application
tests or builds apply at this stage. External game formats and local installation
data availability have not been researched or verified.
Git initialization and repository state verified. Coverage is not applicable to
the documentation scaffold. Automated coverage gates, CI, and hosted branch
protection are not yet installed; they must not be reported as active enforcement.

## Next task

Implement milestone 1 in `ROADMAP.md` on a separate short-lived branch: choose and record a frontend
stack, establish tests and strict 100% coverage gates with CI, then develop the
Tauri shell test-first. Verify current framework documentation before selecting
dependency versions or APIs. Configure GitHub trunk protection and required checks
when CI is available and remote administration is authorized.

## Outstanding decisions

First release OS; frontend tooling; exact file formats; installation-source
feasibility; account selection UX; game-rule evidence; branding and license.
