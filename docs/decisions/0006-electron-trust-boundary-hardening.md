# ADR 0006: Electron Trust-Boundary Hardening

- **Status:** Accepted
- **Date:** 2026-08-05
- **Originating RFC:** [RFC 0005](../rfcs/0005-electron-trust-boundary-hardening.md)

## Context

MES Runner's renderer already used context isolation, disabled Node integration,
and narrow preload APIs. The host did not explicitly sandbox the renderer,
restrict renderer navigation and new windows, or declare a Content Security
Policy. IPC handlers associated events with an application window but did not
also verify the trusted main frame and entry URL. Reusable runner IDs also
needed a lifetime identity so delayed events could not affect a replacement
session in the same slot.

## Decision

Explicitly enable the Electron sandbox, context isolation, and web security and
disable Node integration. Packaged DevTools are disabled. New windows are
denied, host navigation and redirects are limited to the configured development
origin or exact packaged renderer entry, and the renderer declares a restrictive
CSP.

All managed-browser, runner, history, and clipboard IPC is authorized only for
the trusted main frame and renderer URL. Clipboard writes move from preload to a
bounded main-process handler; preload exposes only the existing typed method.
Runner sessions receive a monotonic session generation and snapshot revision.
Renderer projections reject older generations/revisions and removal events must
match the current session generation.

Runner start payloads are validated and bounded in the main process. Diagnostic
and persisted needs-review text strips URL queries, local user paths, and
credential-like assignments. SQLite rejects database schema versions newer
than the application understands.

Superseded whole-page observer/reducer modules, procedural transition helpers,
unused viewport IPC, and the former in-memory Logs model were removed after
import-graph verification. The continuous stage-scoped observe-resolve-act
engine and all selectors/actions remain unchanged.

## Alternatives

- **Rely on context isolation alone:** rejected because it does not constrain
  navigation, child-frame IPC, popup creation, or preload capabilities.
- **Use page generation as session identity:** rejected because navigation and
  authentication legitimately change page generation within one runner.
- **Force dependency majors:** rejected because npm offers only breaking major
  upgrades for the remaining advisories; those upgrades require separate
  compatibility work.

## Consequences

- A compromised child frame or untrusted navigation cannot use application IPC.
- The preload surface works in Electron's sandbox and no longer imports the
  clipboard implementation.
- Delayed events cannot overwrite or remove a replacement runner.
- Fixed 1600x1000 automation no longer has a no-op renderer viewport channel.
- The remaining dependency advisories are documented audit findings, not hidden
  by forced upgrades.
- Workflow behavior, browser/profile ownership, persistence semantics, and UI
  design are unchanged.

## Links

- [RFC 0005: Electron Trust-Boundary Hardening](../rfcs/0005-electron-trust-boundary-hardening.md)
