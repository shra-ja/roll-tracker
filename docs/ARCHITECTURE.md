# Proposed architecture

Tauri and offline operation are requirements. The remaining design below is a
starting proposal, to be validated and recorded as decisions during implementation.

## Boundaries

```text
Web UI (src/)
    | typed Tauri commands and results
Rust application services (src-tauri/src/)
    |-- source readers: selected files and read-only installation discovery
    |-- game adapters: detection, parsing, normalization, banner rules
    |-- import service: validation, preview, deduplication, transaction
    |-- history/statistics service: queries and evidence-aware calculations
    `-- persistence: local database, migrations, backup/restore
```

Use one application, without a local HTTP server or remote backend. Keep parsing
and game logic testable independently of Tauri and UI state. Start with concrete
adapters and a small shared contract rather than a general plugin framework.

## Testability requirements

Follow `../CONTRIBUTING.md`: test-first implementation and 100% coverage are
mandatory. Keep domain logic independent of webview startup and inject clocks,
file readers, and other nondeterministic boundaries so success and failure paths
can be tested. Exercise persistence and native boundaries with integration tests;
do not exclude handwritten native glue or UI components from coverage. Select
tooling capable of measuring all required metrics before adding application code.

## Storage proposal

SQLite in the OS application-data directory is the initial proposal. Select its
Rust integration during implementation. Keep SQL and migrations in the backend;
do not store durable history in browser localStorage or inside game directories.
Bundle assets and required game metadata for offline use, with explicit versions.

Logical entities (not a finalized schema):

| Entity | Information |
| --- | --- |
| Account | Internal key, game key, source account ID as text, server/region, display label |
| Roll | Internal key, account key, source roll ID as text when available, item ID/name, rarity, banner type, source ordering, timestamp and time-zone evidence |
| Import batch | Format/adapter version, source fingerprint, import time, counts, diagnostics without secrets |
| Provenance | Roll-to-batch association; enough evidence to explain merges and conflicts |
| Coverage | Known history boundaries, gaps, and source limitations per account/banner group |
| Game metadata | Versioned item/banner mappings and independently verified rule sets |

Keep game IDs such as `genshin-impact` and `honkai-star-rail` stable internally.
Use source IDs for identity, localized labels for display. Preserve timestamp
text and uncertainty; derive UTC only when the source provides sufficient context.

Deduplication uses adapter-defined stable identity scoped to game/account/server.
If source IDs are absent, design and test an explicit fallback; identical-looking
rolls can be legitimate. Ambiguous matches need reconciliation, not silent removal.

## Native boundary and durability

Expose specific commands for preview, commit, query, export, and restore. Validate
all parameters in Rust, including paths and identifiers. A preview must identify
the validated bytes; do not blindly re-read a changed file on commit. Keep imports
atomic and enforce uniqueness in storage as well as in preflight validation.

Use schema versions and tested migrations. Backups need their own format version
and validation. Do not overwrite a database until a replacement has been validated;
define recovery behavior before implementing restore or destructive migrations.

Restrict webview capabilities and bundle UI resources. Files are data, never code.
Render imported names as text, and keep raw source payloads out of normal logs.

## Statistics

Pity and guarantee rules belong to each game adapter and may vary by banner and
rule version. Record evidence for rule mappings. Preserve banner identity even
when multiple banners share a pity group. Incomplete history must not be presented
as a known starting state; report observed counts or unknown values explicitly.
