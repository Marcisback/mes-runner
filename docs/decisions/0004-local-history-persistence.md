# ADR 0004: Local History Persistence

- **Status:** Accepted
- **Date:** 2026-08-05
- **Originating RFC:** [RFC 0003](../rfcs/0003-local-history-persistence.md)

## Context

Runner outcomes previously existed only in memory, so weekly counts and asset
history disappeared at application restart. Persistence must be authoritative
at the main-process runner lifecycle, remain private and local, avoid replaying
MES work on storage failure, and preserve the renderer's narrow typed boundary.

The development environment uses Node 26 while Electron 30 embeds Node 20. A
native SQLite dependency therefore also has to load safely in both runtimes and
be packaged outside ASAR where required.

## Decision

Use `sqlite3` 5.1.7 as a main-process-only local database at
`path.join(app.getPath('userData'), 'mes-runner.sqlite')`. Its Node-API binary
loads under both development Node and Electron without ABI-specific rebuilding.
Vite externalizes the module and Electron Builder includes its runtime files,
preserves the ABI-stable Node-API binary without an Electron-specific rebuild,
and unpacks the binary from ASAR.

The database uses foreign keys, WAL mode, parameterized statements, and ordered
transactional migrations recorded through `user_version`. It stores `runs` and
one idempotent `asset_results` row per `(run_id, asset_id)`. Only `completed` and
`needs_review` outcomes are historical; skipped assets are excluded.

UTC timestamps are stored. Main-process local calendar boundaries define
Monday-through-Sunday weekly totals and date/range queries. Weekly attempted
assets equal completed plus needs-review.

Renderer access is restricted to validated weekly summary, available-date,
date, and bounded range operations plus a change notification. React receives
typed results and health state, never SQL, a connection, or a filesystem path.

## Motivation

- SQLite provides transactional writes, indexes, migrations, idempotency, and
  bounded filtered queries without building those guarantees over JSON files.
- Main-process ownership aligns persistence with the authoritative final asset
  transition and Electron security boundaries.
- Node-API compatibility avoids the development/Electron ABI conflict found
  with `better-sqlite3` versions compatible with only one current runtime.
- An unavailable database can be isolated from automation while remaining
  visible through diagnostics and UI health.

## Alternatives

- **`better-sqlite3`:** initially preferred, but current releases require Node
  22+ while Electron 30 embeds Node 20; older Electron-compatible releases do
  not build under development Node 26.
- **JSON files:** rejected because migrations, transactional integrity,
  idempotency, indexes, and query safety would be reimplemented.
- **Renderer IndexedDB/localStorage:** rejected because it separates history
  from the authoritative runner lifecycle and weakens ownership boundaries.
- **Cloud persistence:** outside scope and incompatible with local-only privacy.

## Consequences

- Dashboard and History survive restart and refresh after each saved outcome.
- Native-module compatibility and packaged binary presence are explicit build
  validation responsibilities.
- The async callback driver is contained behind a Promise-based store.
- Storage failures produce sanitized health/diagnostic signals and do not
  replay MES actions.
- Asset IDs, modes, final outcomes, sanitized reasons, and timestamps are stored
  locally. Credentials, cookies, browser content, screenshots, locations, and
  full diagnostics are not stored.
- Persistent workflow checkpoints, restart recovery, needs-review resolution,
  export/import, and cloud synchronization remain unimplemented.

## Links

- [RFC 0003: Local History Persistence](../rfcs/0003-local-history-persistence.md)
