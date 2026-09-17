# Product brief

## Purpose

Give players a durable, local record of their rolls across multiple gacha games.
Users own their data and can inspect, back up, and export it without a hosted service.

## Confirmed requirements

- Tauri desktop application with a web-based interface.
- Offline operation.
- Multiple games, initially Genshin Impact and Honkai: Star Rail.
- Ingestion from directly supplied files and usable local installation sources.
- Test-driven development with a mandatory 100% first-party code coverage gate.
- Trunk-based development: all code changes on separate short-lived branches.

## Proposed first release

1. Select a game and account, then choose a supported history file.
2. Preview the detected format, account, accepted records, duplicates, and errors.
3. Confirm import and browse persistent history with game/account/banner/date filters.
4. View roll totals, rarity breakdowns, and game-specific pity information only
   where the imported evidence and verified rules support it.
5. Export a versioned portable backup and restore it into a fresh local profile.
6. Discover a supported local installation source, show what it contains, and
   import it through the same pipeline. Explain unsupported sources clearly.

The first vertical slice should cover one verified file format for one game.
Add the second adapter before calling the multi-game milestone complete.

## Acceptance criteria

- After installation, core workflows succeed with networking disabled.
- Data survives application restart; overlapping imports do not inflate history.
- Different games, accounts, and servers cannot contaminate each other's history.
- Failed imports leave existing data intact and explain how to correct the input.
- Missing historical coverage and uncertain statistics are visibly identified.
- Backup/restore preserves records, source identity, and relevant metadata.
- Import previews and history navigation work with a keyboard and have useful
  loading, empty, success, and error states.

## Outside the initial scope

Cloud sync, public profiles, spending recommendations, live game overlays,
automatic updates, game process inspection, and network-based history acquisition.

## Open decisions

- First supported desktop OS and packaging targets; development host does not
  establish release support.
- Frontend framework, styling approach, package manager, and persistence library.
- Exact supported input formats and available local sources, verified with
  documentation and synthetic or redacted samples before compatibility claims.
- How users identify accounts and resolve ambiguous imports.
- Visual design, branding, and distribution/license choices.

These are open decisions, not implied user preferences. Implementation may choose
reversible technical defaults and record the reasoning.
