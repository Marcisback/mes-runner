# RFC 0004: Multi-Runner Browser Architecture

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

MES Runner currently owns one Playwright page, one workflow runner, one CDP
screencast, and one renderer-visible engine snapshot. Renderer-only tab state
therefore cannot represent independent concurrent automation. Operators need up
to three isolated runner queues while retaining one organization-managed Chrome
profile and one shared authentication session.

Multiple persistent contexts are not viable because they would contend for the
same profile lock, duplicate browser resources, and fragment authentication.
Workflow selectors and the proven observe-resolve-act engine must remain
unchanged.

## Decision

Launch exactly one persistent `BrowserContext` with the existing managed Chrome
profile. A main-process `RunnerManager` owns a typed map of at most three runner
sessions. Each session has a stable runner ID and reusable slot, a distinct
Playwright `Page`, page generation, one `EolRunner` workflow instance, queue,
diagnostics, terminal receipt, lifecycle state, and history run ownership.

Runner creation is transactional: a page is created and navigated before the
session is published. Slots are `Runner 1`, `Runner 2`, and `Runner 3`; the
lowest free slot is reused. A fourth creation returns a typed capacity error.
Closing a runner disposes only its workflow, page, listeners, and stream
resources. Global Stop Session and application shutdown close every runner and
the shared context.

## Browser And Authentication Ownership

The shared controller owns the persistent context, profile, browser lifecycle,
authentication transition, and runner page registry. It does not own workflow
queues or diagnostics. Every runner page uses the fixed 1600x1000 viewport and
the established MES URL.

Authentication is a shared barrier. Detection from any page suspends browser
actions for all workflows and permits only one visible authentication flow.
When the headless context is restored, pages are recreated for all retained
runner sessions, page generations advance, and each workflow re-observes MES
before resuming. Failure to restore the shared context fails all runners safely.

## Streaming And Input

Only the selected runner streams. Selection stops and detaches the prior CDP
session, advances a stream generation, starts a session for the selected page,
and tags frames with runner and stream generations. Stale frames and
acknowledgements are ignored. Background pages continue automation without a
screencast.

Every manual input request includes a runner ID and is accepted only when that
runner is the selected stream owner. Raw Playwright, CDP, context, process, and
profile objects remain main-process-only.

## IPC And Renderer Model

Runner-specific IPC validates a runner ID for create, close, list/get, start,
pause, resume, safe stop, stream selection, input, and diagnostics operations.
Created, updated, removed, frame, and shared-browser events carry typed IDs.

Renderer tabs are projections of main-process runner snapshots. Draft
configuration remains keyed by the real runner ID. Creation failure produces
no tab. Dashboard cards display each runner independently, and selecting a tab
selects its stream.

## Persistence

One main-process SQLite connection remains shared. An additive migration adds a
nullable runner label to `runs` so existing history stays readable. Each
`EolRunner` passes its stable slot label when creating a run; asset results keep
their existing run foreign key. SQLite serializes writes through the existing
connection, and persistence failure cannot replay MES actions.

## Safety And Limits

- Maximum three runner sessions.
- One profile and one persistent context.
- No workflow state is shared between runners.
- A runner failure cannot clear another queue, diagnostics, receipt, or run ID.
- Browser crashes and authentication are explicitly shared infrastructure
  events.
- Cleanup is idempotent.
- Repair remains unverified; its existing behavior is not redesigned.

## Alternatives Considered

### One persistent context per runner

Rejected because the shared profile cannot be opened concurrently and separate
profiles would lose the accepted shared-authentication and resource model.

### Renderer-owned virtual runners over one engine

Rejected because it creates phantom tabs and cannot isolate pages, queues,
diagnostics, or workflow state.

### Multiple Chrome processes with copied profiles

Rejected because profile copying is unsafe, authentication would diverge, and
resource/compliance costs would increase.

## Consequences

Three workflows can progress independently in one managed browser session.
Only one page incurs screencast overhead. Shared authentication and browser
failure require coordinated suspension or failure across all runners. The
controller and IPC surface become keyed collections rather than singletons, and
history gains runner attribution. Persistent workflow restart recovery remains
out of scope.

## Validation

Automated tests use fakes for context/page creation, workflow routing,
screencast selection, authentication coordination, cleanup, and history
attribution. Live MES workflows are not executed. Approved manual validation is
still required for three simultaneous managed pages, authentication recovery,
and resource behavior.
