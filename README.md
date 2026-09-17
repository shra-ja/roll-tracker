# Roll Tracker

An offline Tauri desktop application for gacha history, starting with Genshin
Impact and Honkai: Star Rail. The first milestone provides a bundled web UI with
game selection and an empty state. Imports, persistence and statistics come next.

## Development setup

The initial development/test target is **Ubuntu 24.04 x86_64**. Windows and macOS
are not yet validated release targets. Use asdf 0.20.0 with its shims on `PATH`.
Node.js and Rust are pinned in [.tool-versions](.tool-versions).

Add plugins only if they are not already installed, then install project tools:

```sh
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add rust https://github.com/code-lever/asdf-rust.git
ASDF_RUST_PROFILE=minimal asdf install
rustup component add rustfmt clippy llvm-tools-preview
cargo install cargo-llvm-cov --version 0.9.1 --locked
cargo install tauri-driver --version 2.0.6 --locked
asdf reshim
```

The dated nightly enables Rust branch coverage. Follow asdf's shims rather than
sourcing the Rust installer's suggested environment. The
[asdf Rust plugin](https://github.com/code-lever/asdf-rust) manages its own
Cargo/Rustup directories.

Tauri's Linux shared libraries and test utilities are OS packages, not asdf runtimes:

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev xvfb webkit2gtk-driver xdotool dbus-x11 bubblewrap python3
npm ci --ignore-scripts
cargo fetch --manifest-path src-tauri/Cargo.toml --locked
```

The Python native-test helper uses only the standard library; system Python 3
or an existing asdf Python 3 installation works. Fetch dependencies before the
offline test. Setup needs internet access; the installed app does not. See
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform details.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run tauri -- dev` | Native development; Vite uses loopback port 1420 |
| `npm run dev` | Browser preview only; does not verify native behavior |
| `npm test` | UI behavior and coverage-validator tests |
| `npm run coverage` | Fresh frontend/tooling coverage with 100% per-file thresholds |
| `npm run build` | Strict TypeScript checks, including tests, and bundled web assets |
| `npm run test:native` | Instrumented Rust build/tests, native UI/keyboard/close tests, LLVM reports |
| `npm run test:offline` | Native test in a namespace with no external network route |
| `npm run test:probes` | Deliberate missing-report, uncovered-file and Rust branch failures |
| `npm run coverage:verify` | Validate both reports against source inventory and modification times |
| `npm run check` | All coverage, build/type, offline native, probe, format and lint gates |
| `npm run tauri -- build --no-bundle` | Production executable; installer packaging is deferred |

Native tests require Linux, Xvfb, WebKitWebDriver and user network namespaces.
They use X11 even on Wayland hosts. Run checks serially: probes temporarily change
source and restore it, then regenerate the real coverage reports. Inspect source
if a probe is interrupted.

The executable is `src-tauri/target/release/roll-tracker`. Reports live in
`coverage/frontend/` and `coverage/native/`; the native screenshot is
`test-results/native-shell.png`. These outputs are ignored by Git.

## Project context

[AGENTS.md](AGENTS.md) supplies persistent instructions. All code changes require
a short-lived branch from `main`, red-green-refactor and 100% coverage.
[CONTRIBUTING.md](CONTRIBUTING.md) defines these rules and Conventional Commits.
Keep [current status](docs/STATUS.md) up to date between tasks.

| Context | Purpose |
| --- | --- |
| [Product brief](docs/PROJECT.md) | Scope and user journeys |
| [Architecture](docs/ARCHITECTURE.md) | Boundaries and proposed data model |
| [Import design](docs/IMPORTS.md) | Requirements for the next milestone |
| [Roadmap](docs/ROADMAP.md) | Implementation milestones |
| [Testing](docs/TESTING.md) | Coverage scope, gates, TDD evidence and CI |
| [Stack decision](docs/decisions/0001-shell-and-test-stack.md) | Tools, target platform and tradeoffs |

GitHub Actions runs **Tests and 100% coverage** for pull requests, `main` pushes
and merge queues. Branch protection is enabled by the user; add this job as a
required check before merging. Hosted results are available on
[PR #1](https://github.com/shra-ja/roll-tracker/pull/1).
