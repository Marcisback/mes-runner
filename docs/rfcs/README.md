# RFCs — Requests for Comments

Major architectural proposals, written **before** implementation.

An RFC is where a significant change is thought through and debated: new
subsystems, cross-cutting refactors, dependency choices, protocol or data-model
changes, or anything with long-term structural impact. Small, local changes do
not need one.

## Purpose

- Capture the problem, motivation, and constraints before code is written.
- Present a concrete design and the alternatives considered.
- Give reviewers a single place to comment and reach consensus.

## Lifecycle

1. **Draft** — Author copies the naming convention below and writes the
   proposal. Status: `Draft`.
2. **In Review** — Opened for feedback. Design is discussed and revised inline.
   Status: `In Review`.
3. **Accepted** or **Rejected** — A decision is reached.
   - If **Accepted**, implementation may begin. Once the work lands, the
     outcome is recorded as an entry in [`../decisions/`](../decisions/), which
     links back to this RFC.
   - If **Rejected**, the RFC is kept for the historical record with a short
     note on why.
4. **Superseded** — A later RFC replaces this one. Link forward to the successor.

RFCs are **immutable once accepted** — they record the proposal as it stood.
Later changes of direction are captured in a new RFC or a decision record, not
by editing history.

## Naming convention

```
NNNN-short-title.md      e.g. 0001-embedded-browser-architecture.md
```

Use a zero-padded, incrementing number so ordering is stable.

## Records

- [RFC 0001: Embedded Browser Foundation](./0001-embedded-browser-foundation.md) — Superseded
- [RFC 0002: Managed Chrome Integration](./0002-managed-chrome-integration.md) — Accepted
- [RFC 0003: Local History Persistence](./0003-local-history-persistence.md) — Accepted
- [RFC 0004: Multi-Runner Browser Architecture](./0004-multi-runner-browser-architecture.md) — Accepted

## Related

- [`../decisions/`](../decisions/) — the accepted outcome after implementation.
- [`../diagrams/`](../diagrams/) — diagrams referenced by an RFC.
