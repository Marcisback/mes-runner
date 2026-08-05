# Decisions — Architecture Decision Records (ADRs)

Accepted architectural decisions, recorded **after** implementation.

Where an [RFC](../rfcs/) proposes and debates a design, a decision record
captures what was actually decided and shipped, and — critically — *why*. It is
the durable answer to "why is it built this way?" for anyone who joins later.

## Purpose

- Document the decision that was made and the context that forced it.
- Record the consequences and trade-offs accepted, including known downsides.
- Provide a stable reference the codebase and future RFCs can point back to.

## Lifecycle

1. **Proposed** — Written when a decision has been reached (often as an RFC is
   accepted, or when a smaller decision is made without a full RFC).
   Status: `Proposed`.
2. **Accepted** — The decision is in effect and reflected in the code.
   Status: `Accepted`. This is the normal resting state.
3. **Deprecated** — No longer recommended, but not yet replaced.
4. **Superseded** — Replaced by a newer decision. Link forward to the record
   that supersedes it; do not delete the old one.

Decision records are **append-only**. When direction changes, write a new record
and mark the old one `Superseded` — the history of *why* is as valuable as the
current state.

## Suggested format

Each record is short and follows a consistent shape:

- **Context** — the situation and forces at play.
- **Decision** — what was chosen.
- **Consequences** — results and trade-offs, good and bad.
- **Links** — the originating RFC (if any) and related records.

## Naming convention

```
NNNN-short-title.md      e.g. 0001-use-playwright-for-automation.md
```

## Records

- [ADR 0001: Embedded Browser Foundation](./0001-embedded-browser-foundation.md)
  - Superseded
- [ADR 0002: Managed Chrome Integration](./0002-managed-chrome-integration.md)
  - Accepted
- [ADR 0003: Runtime MES State Awareness](./0003-runtime-mes-state-awareness.md)
  - Accepted; automated validation complete, approved live MES validation pending
- [ADR 0004: Local History Persistence](./0004-local-history-persistence.md)
  - Accepted

## Related

- [`../rfcs/`](../rfcs/) — the proposal that preceded the decision.
- [`../diagrams/`](../diagrams/) — diagrams that illustrate a decision.
