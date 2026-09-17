# 0001 — Minimal offline shell and test stack

Date: 2026-09-17
Status: Accepted

## Context

The first milestone needs a small Tauri shell, test-first development, and 100%
coverage including native startup. The user requires asdf where possible.
Imports, persistence and game rules remain outside this milestone.

## Decision

- Use vanilla TypeScript and Vite with npm, exact direct dependencies and a
  lockfile. No runtime UI framework or state-management library is needed yet.
- Use pinned Tauri 2 crates and Cargo.lock rather than the Tauri 3 alpha found
  during dependency discovery. Bundle assets; enable no capabilities/plugins.
  Production CSP denies network connections. Only development uses Vite.
- Select Ubuntu 24.04 x86_64 as the initial development/CI target, without implying
  Linux-only releases or support for untested platforms.
- Pin Node.js 26.8.1 and Rust nightly-2026-09-16 in `.tool-versions`. Reuse the
  existing asdf Node runtime. The asdf Rust plugin manages Cargo/Rustup, with
  rustfmt, clippy and llvm-tools-preview installed inside that toolchain.
- Use Vitest/jsdom and V8 coverage for TypeScript. Use cargo-llvm-cov 0.9.1 with
  nightly branch instrumentation for Rust, including `build.rs`. Exercise real
  startup with tauri-driver 2.0.6, WebKitWebDriver and Xvfb. Use Bubblewrap for
  an offline native smoke test with no external network route.
- Keep configuration declarative. Implement the integer-count coverage validator
  in TypeScript with test-first unit tests. Run gate probes and a source inventory
  in CI as well as locally.

## Alternatives and consequences

A component framework may help as the UI grows; adding one now adds dependencies
without benefiting a single empty-state screen. Stable-only Rust coverage would
omit required branch instrumentation. A dated nightly makes that tradeoff explicit;
updates must rerun the branch probe and all gates, not just compile.

Linux native tests need OS libraries and a virtual display; asdf does not replace
them. Add OS-specific checks before claiming other platforms are supported.
Tests are more involved than the shell because coverage includes startup/shutdown.

## Evidence

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri with Vite](https://v2.tauri.app/start/frontend/vite/)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
- [Vitest coverage](https://vitest.dev/guide/coverage.html)
- [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov)
- [asdf Rust plugin](https://github.com/code-lever/asdf-rust)
- Local red/green results and coverage probes: [testing notes](../TESTING.md).
