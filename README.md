# Roll Tracker

An offline desktop application for tracking gacha rolls across games, starting
with **Genshin Impact** and **Honkai: Star Rail**. A web UI will run inside Tauri,
with data imported from user-provided files or supported local game sources.

**Status:** project context and directory scaffold only. The application has not
been generated; there are no dependencies to install or development commands yet.

## Project map

| Path | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Repository instructions for Codex |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Mandatory TDD, 100% coverage, and trunk-based workflow |
| [docs/PROJECT.md](docs/PROJECT.md) | Scope, user journeys, and acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Proposed boundaries and data model |
| [docs/IMPORTS.md](docs/IMPORTS.md) | Import contract and source research checklist |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Ordered implementation milestones |
| [docs/STATUS.md](docs/STATUS.md) | Current state and next task |
| [docs/decisions/](docs/decisions/README.md) | Architecture decision records |
| [src/](src/README.md) | Future frontend |
| [src-tauri/](src-tauri/README.md) | Future Rust/Tauri backend |
| [tests/fixtures/](tests/fixtures/README.md) | Synthetic import fixtures |

## Working with Codex

Open this directory in Codex and start with a bounded task from the roadmap.
The root `AGENTS.md` provides persistent project instructions, following the
[official Codex guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
Supporting documents are linked from it; keep `docs/STATUS.md` current between tasks.

All code changes require a separate short-lived branch from `main`, test-first
development, and 100% coverage. See [CONTRIBUTING.md](CONTRIBUTING.md) for metric
scope, merge gates, and the initial-commit bootstrap. Coverage tooling and CI must
be established with the first executable code; coverage is not yet measurable.

Suggested first implementation prompt:

> Read the project context and CONTRIBUTING.md, check that main has its authorized
> documentation baseline commit, and create a short-lived branch for milestone 1
> in docs/ROADMAP.md. Select and record a small frontend stack, establish tests,
> 100% coverage gates and CI, then use red-green-refactor to scaffold the Tauri
> shell and offline empty state. Document and run the checks. Keep import
> implementation for the next milestone.

Runtime offline operation is a requirement. Initial development setup may need
network access to install tools and dependencies. Record exact prerequisites,
versions, and runnable commands here when the application is scaffolded.
