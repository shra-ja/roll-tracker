# Development

How to set up, run and check Astral Index. The rules every change follows are
in [CONTRIBUTING](../../CONTRIBUTING.md); how the gates work is in
[TESTING](TESTING.md).

## Setup

Development and CI run on **Ubuntu 24.04 x86_64**, including under WSL. Windows
is the initial game-installation target; Windows and macOS are not yet validated
release targets. Use asdf 0.20.0 with its shims on `PATH`; Node.js and Rust are
pinned in [.tool-versions](../../.tool-versions).

Add the plugins if they are missing, then install the project tools:

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
sourcing the Rust installer's environment; the
[asdf Rust plugin](https://github.com/code-lever/asdf-rust) manages its own
Cargo and Rustup directories.

Tauri's Linux libraries and the native test tools are OS packages:

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev xvfb webkit2gtk-driver xdotool dbus-x11 bubblewrap python3
npm ci --ignore-scripts
cargo fetch --manifest-path src-tauri/Cargo.toml --locked
```

The Python native-test helper needs only the standard library. Fetch
dependencies before the isolated native tests, which have no network. See
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/) for platform
details.

## Running the app

| Command | Runs |
| --- | --- |
| `npm run tauri -- dev` | The desktop app in development; Vite uses loopback port 1420 |
| `npm run tauri:mock` | The same with the mock debug binary, against a synthetic HoYoverse |
| `npm run dev` | A browser preview only; it does not exercise native behaviour |
| `npm run tauri -- build --no-bundle` | The release executable, `src-tauri/target/release/astral-index`; installers come later |

`ASTRAL_INDEX_MOCK_SCENARIO` chooses the mock's behaviour: `history` (the
default), `expired-link`, `network-failure`, `rate-limited`, `no-history`,
`newer-history`, `second-account` or `mixed-accounts`
([decision 0014](../architecture/decisions/0014-mock-debug-binary.md)). The mock
keeps its history in its own `astral-index-mock` data folder.

Development builds read `ASTRAL_INDEX_ZOOM`, a webview zoom from 0.5 to 3. Under
WSL the app renders at 1×, so to match a Windows display at 125% run
`ASTRAL_INDEX_ZOOM=1.25 npm run tauri:mock`. Release builds ignore it.

`ASTRAL_INDEX_SIZE_OVERLAY=1` makes a development build show the window's size
in CSS pixels in the bottom-right corner, with the zoom when it is not 1,
updating while the window is resized, for finding the sizes where a layout
breaks. Other values, and release builds, show nothing. For example,
`ASTRAL_INDEX_SIZE_OVERLAY=1 ASTRAL_INDEX_ZOOM=1.25 npm run tauri:mock`.

## Checks

| Command | Does |
| --- | --- |
| `npm run check` | Every gate: formatting, lint, the docs check, the icon check, build, coverage, probes, report validation, Rust formatting, Clippy and the offline native tests |
| `npm test` | The frontend's tests (in `src-ui/`), then the tooling tests |
| `npm run coverage` / `coverage:json` | Fresh frontend and tooling coverage with per-file 100% thresholds, with or without HTML |
| `npm run typecheck` | `vue-tsc --build` over the app, UI-test and Node projects, templates included |
| `npm run build` | The type check, then the bundled web assets |
| `npm run format` / `format:check` | Format with Prettier, or only check |
| `npm run lint` / `lint:check` | Fix what ESLint and markdownlint can, or only check, failing on warnings |
| `npm run docs:check` | Check that doc links and anchors resolve, every doc is reachable from `AGENTS.md`, and STATUS stays short |
| `npm run icons` / `icons:check` | Write the app icons in `src-tauri/icons/` from the brand's emblems, or only check that the committed ones match |
| `npm run test:backend` | Rust unit, integration and end-to-end tests with coverage reports |
| `npm run test:offline` | `test:backend` in a network namespace with no external route |
| `npm run coverage:backend-unit` | Reset backend counters, run Rust unit tests and freeze their report |
| `npm run test:backend-integration` | The instrumented Cargo integration tests, without the desktop |
| `npm run test:e2e-smoke` | Build and drive the desktop app end to end |
| `npm run coverage:backend-report` | Render the backend report from the current counters |
| `npm run test:probes` | The mutation probes and the final full coverage run (run `npm run build` first) |
| `npm run coverage:verify` | Validate every report against the source inventories |

Run the check serially and do not edit or stage files while it runs: the probes
change source briefly ([recovery](TESTING.md#mutation-probes)). On a machine with
limited memory, run its stages one at a time with `CARGO_BUILD_JOBS` lowered.

Focused Rust tests, all synthetic and offline:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib hsr
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib storage
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --test storage
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib acquisition
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --test acquisition
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib discovery
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --test discovery --test system_discovery
```

Plain Cargo builds replace the coverage-instrumented binaries without Cargo
noticing; run `cargo clean -p astral-index` before the native tests after one.

## Outputs

Git ignores all of these:

- `coverage/frontend/`, `coverage/tooling/`, `coverage/backend-unit/` and
  `coverage/backend/`: coverage reports.
- `test-results/`: end-to-end screenshots (`e2e-*.png`), check logs and probe
  failure snapshots.
- `src-tauri/target/`: builds.

## Windows executable for manual checks

To try the app in a native Windows process without a Windows toolchain,
cross-compile from Linux or WSL with `cargo-xwin`. Tauri treats this as
experimental; it is not a release process, and installers and signing are
milestone 10 work. It was used for the
[native Windows verification](../games/hsr/api-research.md#native-windows-verification-2026-09-27).

```sh
sudo apt-get install -y clang lld llvm
rustup target add x86_64-pc-windows-msvc --toolchain nightly-2026-09-28
cargo install cargo-xwin --version 0.23.1 --locked
asdf reshim
npm run tauri -- build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
```

`cargo-xwin` downloads Microsoft's C runtime and Windows SDK on first use, which
means accepting the
[Microsoft Build Tools license](https://go.microsoft.com/fwlink/?LinkId=2086102);
read it first. The executable is
`src-tauri/target/x86_64-pc-windows-msvc/release/astral-index.exe`: copy it to a
Windows folder and start it from Explorer. It needs the WebView2 runtime, which
Windows 11 includes. Linker warnings about missing `libcmt` debug information are
harmless. Release builds use the Windows GUI subsystem, so no console opens;
debug builds keep it for logs. The executable embeds `src-tauri/icons/icon.ico`,
which `npm run icons` generates.
