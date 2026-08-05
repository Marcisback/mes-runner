# RFC 0005: Electron Trust-Boundary Hardening

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

MES Runner already isolates its renderer from Node.js and exposes narrow typed
preload APIs, but several defenses are implicit or incomplete. The host window
does not explicitly sandbox the renderer, restrict navigation and new windows,
or provide a Content Security Policy. Main-process IPC associates events with a
known `BrowserWindow`, but does not also require the trusted main frame and
renderer entry URL. Clipboard writes execute in preload, which prevents using
Electron's renderer sandbox without changing that narrow boundary.

Runner slots are intentionally reusable. Snapshots include a page generation,
but runner removal events carry only the reusable runner ID. A delayed event
from a closed session could therefore remove or replace the renderer projection
of a newer session occupying the same slot.

The audit also found superseded validation-era state models and renderer
presentation helpers that are not imported by any production entry point.

## Decision

Harden the existing architecture without changing workflow behavior:

- explicitly enable the Electron renderer sandbox and web security while
  retaining context isolation and disabled Node integration;
- disable packaged DevTools, deny renderer-created windows, and prevent host
  navigation outside the configured Vite origin in development or the exact
  packaged renderer entry file;
- add a restrictive renderer Content Security Policy;
- validate every IPC event against both the owning window and the trusted main
  frame URL before routing it;
- move the bounded clipboard write behind a typed main-process IPC handler so
  preload needs only sandbox-supported bridge primitives;
- give every runner session a monotonic session generation, include it in
  snapshots and removal events, and reject stale renderer events;
- preserve runner IDs, slots, page generations, workflows, selectors, retry
  policy, browser context ownership, and database semantics;
- remove only modules and exports proven unreachable from production and
  tooling entry points.

## Alternatives Considered

### Rely on Electron defaults and context isolation

Rejected. Defaults can change, and context isolation alone does not constrain
navigation, child frames, popups, IPC senders, or preload capabilities.

### Validate only the renderer URL in each handler

Rejected. A child frame in an otherwise trusted window must not inherit the
application's IPC authority. The trusted main-frame relationship and URL are
both required.

### Reuse page generation as runner-session identity

Rejected. Page generation changes during navigation and authentication, while
session identity must remain stable for one runner lifetime and change on slot
reuse.

### Upgrade every dependency with an advisory

Rejected for this audit when npm offers only breaking major upgrades for
transitive install/build tooling. Reachability and compatible remediation are
evaluated separately rather than forcing an architecture change.

## Consequences

The renderer has a smaller explicit authority surface, untrusted navigation and
frames cannot invoke privileged handlers, and stale slot events cannot mutate a
replacement runner. Clipboard behavior remains available through a narrower
boundary. Development continues to support the configured Vite origin and its
WebSocket connection, while packaged builds do not expose DevTools.

The security helpers and generation logic require focused unit tests. The CSP
must be kept synchronized with intentional renderer resource needs. No live MES
workflow, selector, state transition, persistence model, profile, context, or
screencast architecture changes as part of this decision.
