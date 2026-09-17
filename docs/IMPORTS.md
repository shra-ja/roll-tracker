# Import design and research

## Source status

No external formats or installation sources have been verified yet. A local game
installation is not proof that roll history is available offline. An extracted
URL or token is not itself history, and fetching it would require an explicitly
separate online feature. Never promise recovery of unavailable records.

| Game | User-provided files | Installation source |
| --- | --- | --- |
| Genshin Impact | Planned; format and version to verify | Research required per OS/version |
| Honkai: Star Rail | Planned; format and version to verify | Research required per OS/version |

## Adapter contract

Each adapter should describe supported format versions, detection evidence,
required account/server context, record identity, timestamp semantics, ordering,
banner mapping, and known history limitations. Detection must reject ambiguous
formats rather than selecting an adapter merely because a filename matches.

Pipeline:

1. Read an explicitly chosen file or supported local source with size limits.
2. Detect game/format/version and request missing account context when necessary.
3. Parse and validate without changing persistent history.
4. Normalize records while preserving identity, ordering, and time uncertainty.
5. Produce a preview: valid, duplicate, conflicting, and rejected counts with
   useful record-level diagnostics that omit private payloads.
6. Commit the reviewed records in a single transaction and record provenance.
7. Return a summary and refresh history/statistics from stored records.

Default to blocking commit on invalid records. If partial import is introduced,
make skipped records explicit and require a deliberate choice in the import UI.
Cancellation or failure must not leave a partially committed batch.

## Research checklist for each source

- Identify official or format-owner documentation, source version, and research date.
- Establish whether data is actually local or requires a remote request.
- Verify path discovery and file access on each claimed OS; support manual selection.
- Document available fields, history limits, timezone, server, and ordering semantics.
- Confirm IDs remain stable across overlapping exports and banner categories.
- Create synthetic fixtures for valid, empty, malformed, duplicate, overlapping,
  out-of-order, and conflicting histories; include multiple accounts and servers.
- Define unknown-version handling and prove errors cannot corrupt existing data.

Never commit source credentials, token-bearing URLs, real logs, or player histories.
Fixtures must state whether they model an external format or an internal proposal;
a synthetic example alone does not establish external compatibility.
