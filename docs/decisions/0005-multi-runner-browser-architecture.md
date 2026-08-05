# ADR 0005: Multi-Runner Browser Architecture

- **Status:** Accepted
- **Date:** 2026-08-05
- **Originating RFC:** [RFC 0004](../rfcs/0004-multi-runner-browser-architecture.md)

## Context

MES Runner previously bound managed Chrome, CDP streaming, workflow state,
diagnostics, and renderer tabs to one page and one runner. Renderer-created tabs
could not provide real page, queue, or workflow isolation. The application must
support three simultaneous workflows without creating competing profile owners
or duplicating authentication.

## Decision

Use one organization-managed Chrome persistent profile and one Playwright
persistent `BrowserContext`. A main-process `RunnerManager` owns up to three
sessions in a typed map. Each session has a stable reusable slot, distinct
`Page`, page generation, `EolRunner`, queue, configuration/run snapshot,
diagnostics, terminal receipt, and history run ownership.

Runner creation publishes a snapshot only after page creation and MES
navigation succeed. Slots 1-3 are allocated lowest-first; capacity and creation
failures are typed. Closing a runner safely stops and disposes only its own
workflow and page. Global Stop Session and shutdown close all sessions and then
the shared context.

Runner-scoped IPC carries a validated runner ID for lifecycle commands, stream
selection, manual input, snapshots, removal events, and frames. React receives
sanitized snapshots only. Tabs and Dashboard cards are projections of those
main-process snapshots rather than renderer counters.

Only the selected runner page owns a CDP screencast. Switching selection
detaches the prior session, increments a stream generation, and rejects stale
frames. Background pages continue automation without streaming. Manual input is
accepted only for the selected runner ID.

Authentication remains shared. Detection on any page changes the shared
browser lifecycle, making every runner temporarily non-actionable. One guarded
visible authentication context is used. On return to headless mode, all retained
runner pages are recreated before the shared state becomes actionable and each
workflow re-observes its own page.

SQLite remains one main-process connection. Schema version 2 adds nullable
`runs.runner_label`; existing rows remain readable and new runs store their
owning stable slot label. Asset results continue to reference their run ID.

## Alternatives

- **Three persistent contexts/profiles:** rejected because it fragments
  authentication, increases resources, and creates profile-lock/compliance
  concerns.
- **Renderer-only virtual runners:** rejected because it cannot isolate pages,
  workflows, receipts, diagnostics, or persistence ownership.
- **Stream every page:** rejected because background screencasts add unnecessary
  CDP, encoding, IPC, and renderer load.

## Consequences

- Up to three EOL/MRI/MRI Fail runners can progress independently.
- The browser context and authentication remain shared infrastructure; their
  failure is explicitly global.
- Runner cleanup is isolated and slots are reusable.
- Stream switching has generation checks and background automation does not
  depend on rendering.
- Existing workflow selectors and reconciliation decisions are unchanged.
- Existing history remains readable and new runs are attributable to a runner.
- Persistent workflow checkpoints and restart recovery remain unimplemented.
- Automated validation is complete, but approved manual validation of three
  simultaneous live MES pages and shared authentication recovery is still
  required.

## Links

- [RFC 0004: Multi-Runner Browser Architecture](../rfcs/0004-multi-runner-browser-architecture.md)
