# RFC 0003: Local History Persistence

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

MES Runner currently keeps runner results and diagnostics only in memory. The
Dashboard reports the current session, and the Logs workspace derives its rows
from the current runner snapshot. Operators need durable local counts and asset
history across application restarts without storing MES page content, browser
state, credentials, or complete diagnostics.

This change adds storage, a native dependency, a schema, and a renderer-facing
IPC surface. It does not add workflow restart recovery or persistent workflow
checkpoints. Historical `needs_review` outcomes describe what automation
observed; they are not tasks that MES Runner later resolves.

## Decision

Use `sqlite3` in the Electron main process and store one SQLite database
at:

```ts
path.join(app.getPath('userData'), 'mes-runner.sqlite')
```

The database is initialized before windows and history IPC are registered.
Schema changes run as ordered, transactional migrations recorded through
SQLite's `user_version`. Foreign keys are enabled and WAL mode is requested.
Electron Builder preserves the Node-API binary without an ABI-specific rebuild
and unpacks it from ASAR. This avoids Electron Builder treating the Electron
version as an invalid N-API target while retaining one binary verified under
both development Node and Electron.

The Electron main process exclusively owns the connection and SQL. React uses a
narrow typed preload API for weekly summaries, available dates, date queries,
bounded range queries, and change notifications. Main-process validation
rejects invalid dates, ranges, pagination, modes, and outcomes.

## Data Model

`runs` records the mode, lifecycle status, and UTC start/finish timestamps.
`asset_results` records one final `completed` or `needs_review` outcome per
`(run_id, asset_id)`, including its canonical mode, sanitized reason, and UTC
start/finish timestamps. It references `runs(id)` and is indexed by finish time,
mode, and outcome.

Skipped assets are deliberately excluded. Duplicate final notifications use an
idempotent insert and cannot create duplicate historical results.

## Lifecycle Integration

The authoritative main-process runner creates a run record after a start
request has passed validation and retains its database ID for that run. Asset
start time is captured in memory. A completed or needs-review final transition
is recorded once after the runner has already committed its in-memory result;
skipped transitions do not write history. Run completion, safe stop,
disconnection, and error paths finalize the run with an appropriate status.

Persistence errors are sanitized, reflected in database health, and added to
bounded diagnostics. They never cause MES actions or final transitions to be
replayed.

## Query and Calendar Rules

UTC ISO timestamps are stored. Date and Monday-through-Sunday week boundaries
are constructed in the main process from local calendar values, then converted
to UTC query bounds. A result belongs to the local date on which its final
outcome was recorded.

Weekly progress counts `completed + needs_review`. Mode totals use canonical
workflow modes. Repair history may be stored by the shared lifecycle, but the
weekly Dashboard's requested category breakdown is MRI, MRI Fail, and EOL.

History queries are bounded and paginated. Search is asset-ID-only and uses
parameterized statements. No arbitrary SQL, raw database handles, or filesystem
paths cross the preload boundary.

## Privacy and Security

The database stores asset IDs, canonical mode values, final outcomes, sanitized
needs-review reasons, and UTC timestamps only. It does not store credentials,
cookies, tokens, browser/profile data, screenshots, page content, storage
locations, or full diagnostics. Data remains local with no synchronization or
export surface.

## Alternatives Considered

### JSON files

Rejected because transactional updates, idempotency, migrations, indexed date
queries, and bounded filtering would require recreating database behavior and
would be more vulnerable to partial writes.

### Node's built-in SQLite API

Rejected because the Electron 30 runtime is based on a Node version where that
API is not a stable available dependency for this application.

### `better-sqlite3`

Preferred initially, but rejected after compatibility validation found a
concrete blocker. The current development environment runs Node 26 while
Electron 30 embeds Node 20. `better-sqlite3` 13 requires Node 22 or newer and
crashes in Electron 30; the Electron-compatible 11.x line cannot build against
Node 26. `sqlite3` ships a Node-API native module that is ABI-stable across both
runtimes. Its callback API is contained behind a focused Promise-based
main-process store, so no callback or database detail reaches lifecycle code or
React.

### Renderer-owned IndexedDB or localStorage

Rejected because persistence belongs with the authoritative runner lifecycle,
would duplicate ownership in React, and would weaken the typed Electron
boundary.

## Consequences

- Historical counts and results survive application restarts.
- Main-process lifecycle events remain the single source of final outcomes.
- The Dashboard and History view can refresh through a narrow invalidation
  event.
- Native dependency rebuilding and packaging verification become required.
- Database corruption or initialization failure disables history while leaving
  automation available; the UI reports the unavailable state.
- This design does not provide workflow checkpointing, crash resumption,
  needs-review resolution tracking, cloud synchronization, or import/export.

## Validation

Automated tests use temporary database files and cover migrations, lifecycle
writes, idempotency, calendar boundaries, queries, validation, notification,
and persistence-failure isolation. Packaging validation must confirm the native
module loads under Electron and its binary is included outside ASAR.
