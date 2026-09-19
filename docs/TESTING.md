# Testing and coverage

## Scope and metrics

`npm run check` is the authoritative local and CI gate, exiting at the first
failed stage. UI tests verify empty-state copy, accessible labels and game
selection. The native WebDriver test launches the real instrumented Tauri binary,
loads bundled assets from `tauri:`, exercises keyboard selection, checks external
fetch is blocked by CSP, saves a screenshot and closes through an X11 window-manager
message. It waits for that process's LLVM profile; forcibly killing the app
cannot count as successful native coverage.

The offline command wraps that test in Bubblewrap's isolated network namespace.
Only loopback is available for WebDriver; there is no external network route or
Vite server. Cargo uses pre-fetched dependencies with `--locked --offline`.
Ubuntu's hosted runner restricts unprivileged user namespaces. CI loads a narrow
AppArmor profile for a CI-only copy of `/usr/local/bin/bwrap`, granting that
executable user namespaces without turning off the system-wide restriction.
The preflight must succeed; the offline test is never skipped or run online as
a fallback. See [Ubuntu's namespace policy](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
This is a native development build with production bundled assets. Installer
packaging and other operating systems are later release work.

| Source | Instrumentation | Mandatory per-file metrics |
| --- | --- | --- |
| `src/**/*.ts` | Vitest V8 | Lines, statements, functions, branches: 100% |
| `scripts/**/*.ts` | Vitest V8 | Lines, statements, functions, branches: 100% |
| `src-tauri/src/**/*.rs`, `src-tauri/build.rs` | cargo-llvm-cov with nightly branch instrumentation | Lines, regions, functions, branches: 100% |

LLVM uses executable regions rather than a distinct Rust statement metric. Zero
branch points means there are no branches to cover; the shell currently has no
handwritten Rust conditionals. An automated probe adds an actual conditional and
verifies LLVM reports a missed branch before restoring the source. Macro-generated
mappings remain in the report; handwritten native glue is not excluded.

`scripts/coverage.ts` compares integer covered/total counts, so rounded percentages
cannot pass. The validator itself has 100% coverage. `tests/reports.test.ts`
inventories source independently of execution and rejects absent, empty or stale
reports. New executable files outside the instrumented directories fail the
inventory check until instrumentation is added. V8 includes unexecuted files; the
inventory also catches Rust source never compiled into a module. Each run clears
its own report directory and Rust counters and rebuilds first-party Rust,
including `build.rs`.

Exclusions are limited to:

- `tests/`: test code, the X11 test helper, and synthetic fixtures.
- `node_modules/`, Cargo dependencies and `src-tauri/target/`: third-party or generated artifacts.
- `src-tauri/gen/`, `dist/`, `coverage/`: mechanically generated output.
- HTML, CSS, SVG/PNG, Markdown, lockfiles and declarative JSON/YAML/TOML: no
  instrumentable TypeScript/Rust control flow. They are exercised by native smoke
  tests, builds and schema checks as applicable.

There are no coverage-ignore annotations or handwritten-source exclusions.
Workflow steps and npm scripts compose tool commands; the custom executable gate
is TypeScript and is instrumented.

## Red-green evidence for milestone 1

On `feat/offline-shell`, based on authorized documentation baseline `2d78399`:

1. UI tests ran against a one-line placeholder and failed on the absent heading
   and game selector. The empty state and selection handler made both pass.
2. Coverage-validator tests ran against a no-op: 14 failed because missing or
   invalid coverage was accepted. The implementation then passed all 15 tests
   with full branch coverage.
3. The native test ran against an empty Rust `main`; session creation timed out
   because no window existed. The Tauri event loop made native assertions pass.
   Harness fixes then ensured a graceful real app exit and coverage from that
   process, rather than accepting a killed process as success.
4. Automated probes introduce an unexecuted TypeScript file/branch, an uncovered
   Rust branch, an uncompiled Rust source file, and missing/incomplete reports.
   Each must fail the real gate, then restore source and regenerate clean reports.

The shell has no Rust domain logic yet, so `cargo test` reports zero Rust unit
tests. Native integration covers startup and the build script. Add Rust unit
tests first when implementing import/domain logic.

## CI and handoff

`.github/workflows/check.yml` installs pinned asdf toolchains and coverage tools,
runs `npm run check`, then builds the production native binary. It uploads
HTML/JSON reports and the native screenshot, including on failures. The required
job is **Tests and 100% coverage**. Configure that status in branch protection
after the first hosted run; local success does not prove remote CI ran.

Do not run probes concurrently with editing, coverage or native builds. They
mutate source briefly and restore it in `finally` blocks. After interruption,
inspect `src/coverage-probe.ts`, `src-tauri/src/coverage_probe.rs`,
`src-tauri/src/main.rs`, and report backup files before resuming.
