# CLAUDE.md

**This document is the single source of truth for all engineering standards in
this repository.** Every contributor — human or AI — must read and follow it
before making changes.

---

## Project Overview

MES Runner is a production-quality desktop automation platform built with
Electron, React, TypeScript, and Playwright browser-control APIs. It uses the
installed organization-managed Google Chrome application as the MES browser and
drives the proven EOL and MRI workflows through runtime-observed, guarded
transitions. Final asset outcomes are persisted locally for Dashboard and
History reporting. Persistent workflow checkpoints, restart/crash recovery,
and auto-updating remain planned.

Today the repository contains a working three-runner desktop host, managed-Chrome browser
foundation, CDP screencast surface, and runtime-aware automation for the proven
EOL and MRI workflows. See [Current Architecture](#current-architecture) for
the precise boundary between implemented, validated, and planned behavior.

## Project Goals

- Provide a reliable, recoverable desktop host for browser automation.
- Model automation as **explicit, guarded state machines** rather than
  procedural scripts.
- Keep the UI (presentation) cleanly separated from automation and business
  logic.
- Maintain a hardened Electron security posture (context isolation, typed
  preload bridge, no node integration in the renderer).
- Ship continuously and safely via GitHub Actions CI/CD and auto-update through
  GitHub Releases.
- Treat documentation as a first-class deliverable, kept in sync with the code.

## Current Architecture

> **Rule: never document future work as if it already exists.** This section is
> the authority on that boundary. If a capability is not listed under "Current
> implementation," it does not exist yet.

### Current implementation

- **Electron main process** (`electron/main.ts`) — creates the hardened host
  `BrowserWindow`, owns managed-Chrome and workflow-runner orchestration, and
  registers narrow typed IPC. The host explicitly enables `contextIsolation`
  and disables `nodeIntegration`.
- **Managed Chrome controller** (`electron/managedChromeController.ts`) —
  main-process-owned Playwright persistent context that launches the installed
  organization-managed Google Chrome application with `channel: "chrome"` and
  a dedicated profile at
  `path.join(app.getPath("userData"), "managed-chrome-profile")`. Normal
  automation is headless at a fixed 1600x1000 viewport. One persistent context
  owns up to three independent runner pages. Only the selected page is displayed
  inside Electron through main-process-owned CDP screencasting; background pages
  continue automation without streaming. Authentication opens a
  visible managed-Chrome window for manual login and YubiKey interaction, then
  returns to a fresh headless context and recreates retained runner pages before
  workflows re-observe MES. Playwright contexts, pages, CDP sessions,
  process ownership, profile paths, and credentials remain outside React.
- **Managed Chrome IPC** (`electron/managedChromeIpc.ts`,
  `electron/managedChromeChannels.ts`, `electron/preload.ts`) — typed, narrow
  APIs exposed as `window.managedChrome` and `window.eolRunner`. The renderer
  sends lifecycle and runner-scoped input/workflow intents and receives sanitized
  runner snapshots and generation-tagged screencast frames. Runner IDs are
  validated in the main process. Raw IPC, Playwright, CDP sessions, Chrome
  handles, cookies, credentials, profile paths, and arbitrary browser control
  are not exposed to React.
- **Runtime MES state observer**
  (`electron/workflows/mesRuntimeState.ts`) — a central non-mutating observer
  composed from stage-scoped detectors. It identifies landing, retained asset,
  Start, Wipe, Diagnostic, failure-dialog, Move-to-Repair, completion evidence,
  known business-error, unknown, and ambiguous states. It returns sanitized
  counts and booleans, not DOM content or Playwright objects. Multiple
  conflicting actionable states fail closed as ambiguous.
- **Pure reconciliation policy**
  (`electron/workflows/runtimeReconciliation.ts`) — accepts workflow mode,
  observed MES state, expected stage, last confirmed stage, pending action,
  retry counters, and lifecycle interruption state as separate typed inputs. It
  returns an explicit act, wait, skip-forward, complete, retry, needs-review,
  authentication, disconnection, pause, or stop decision without touching MES.
- **Workflow runtime** (`electron/workflows/workflows.ts`) — EOL, MRI Pass, and
  MRI Fail share an observation/decision/action loop. Every action is selected
  from a fresh observation, re-resolves its scoped target before interaction,
  and requires a recognized postcondition. The loop moves forward when MES has
  already advanced, waits through bounded latency, and resumes from a fresh
  observation after pause or authentication. Unknown and ambiguous states fail
  closed. Repair keeps its existing dedicated implementation and remains
  unverified.
- **Recovery policy** — retained-asset submission permits at most two trusted
  Enter retries after state reconciliation. Confirm Wipe permits at most one
  retry within a 60-second transition deadline. Busy controls are not replayed,
  already-present Wipe/Diagnostic scans are not repeated, and MRI Fail cannot
  complete until Move-to-Repair completion is confirmed.
- **Runner manager and diagnostics** (`electron/runnerManager.ts`,
  `electron/eolRunner.ts`) — a typed main-process map owns at most three runner
  sessions. Each has a distinct page, page generation, workflow engine, queue,
  lifecycle flags, bounded diagnostics, terminal receipt, and history run ID.
  Slots are labelled Runner 1-3 and the lowest free slot is reused. Pause,
  Resume, Stop Safely, failure, and cleanup are runner-scoped. Runtime progress
  remains memory-only; restart recovery and persistent workflow checkpoints are
  not implemented.
- **Shared authentication** — authentication belongs to the one browser
  context. Any runner can trigger the single visible authentication flow; all
  runner actions suspend until the headless context and retained pages are
  restored, after which each runner re-observes independently.
- **Local history persistence** (`electron/history/`) — main-process-owned
  SQLite storage at `path.join(app.getPath("userData"), "mes-runner.sqlite")`.
  Transactional versioned migrations create run and final asset-result records;
  runs include a nullable stable runner label while asset results retain their
  run foreign key;
  only completed and needs-review outcomes are stored. UTC timestamps are
  queried through local calendar boundaries. Foreign keys and WAL mode are
  enabled, writes are parameterized and idempotent, and storage failures never
  replay MES actions. Persistent workflow checkpoints remain unimplemented.
- **History IPC** (`electron/history/historyIpc.ts`, `electron/preload.ts`) —
  validates bounded date/range/filter requests and exposes only typed summaries,
  results, health, and invalidation events. SQL, database handles, and database
  paths remain in the main process.
- **React renderer** — authoritative runner tabs and Dashboard cards sourced
  from main-process snapshots, selected-runner workspace/stream, independent
  contextual runner controls and diagnostics, persisted weekly Dashboard
  totals, date-oriented History, and settings presentation. Automation and
  persistence policy remain in the main process.
- **Styling** — plain CSS + CSS Modules, driven by theme tokens in
  `src/styles/theme.css`; global reset in `src/styles/global.css`.
- **Security posture** — explicit host-window `contextIsolation` on and
  `nodeIntegration` off; no `<webview>` tag; no raw IPC in the renderer. MES
  Runner uses scoped Playwright roles, labels, placeholders, and controls for
  workflow automation but does not spoof browser identity, bypass managed
  controls, automate credentials or YubiKey authentication, expose CDP or
  Playwright to React, or access cookies and tokens.
  Local history stores only asset IDs, canonical modes, final outcomes,
  sanitized needs-review reasons, and UTC timestamps. It does not store page
  content, screenshots, credentials, cookies, tokens, profile paths, locations,
  or full diagnostic logs.
- **Tooling** — Vite + `vite-plugin-electron`, TypeScript (strict), ESLint,
  `playwright-core` for installed-Chrome control, `sqlite3` for local history,
  and `electron-builder` producing per-platform installers with the SQLite
  ABI-stable Node-API binary preserved without an Electron-specific rebuild and
  unpacked from ASAR.
- **Automated validation** — Node test coverage for pure workflow policy,
  runner allocation/routing, persistence migration, and supporting logic,
  strict TypeScript, ESLint, and Vite builds. Runtime awareness and multi-page
  concurrency pass automated validation but still require approved manual
  testing against live MES behavior; they are not production-verified.
- **Engineering docs** — `docs/rfcs/`, `docs/decisions/`, `docs/diagrams/`.

### Planned implementation (does NOT exist yet)

The following are goals, not current behavior. Do not reference them as if
implemented:

- Persistent workflow checkpoints and restart/crash recovery.
- Persistent workflow checkpoints or restart recovery. Historical final
  outcomes do not provide workflow resumption.
- Verification or redesign of the Repair workflow.
- Production approval of Phase 1 runtime state awareness after controlled live
  MES testing with approved assets.
- Production approval of three-page concurrency and shared authentication
  recovery after controlled live MES testing.
- Content Security Policy.
- Routing / multiple mounted views.
- Auto-update via GitHub Releases.
- GitHub Actions CI/CD.
- Broader integration and end-to-end tests against a non-production MES test
  environment.

## Living Architecture

CLAUDE.md is a living document.

As the repository evolves, keep this handbook synchronized with the current state of the project.

Whenever architecture, conventions, workflows, dependencies, or engineering practices change, evaluate whether CLAUDE.md should be updated.

Examples include:

- New major folders
- New architectural layers
- New coding conventions
- New dependencies
- IPC changes
- State machine design changes
- Browser architecture changes
- Security model updates
- Build pipeline changes
- CI/CD changes
- Testing strategy changes
- Release process changes

Do not allow CLAUDE.md to become outdated.

If a change affects how future contributors should understand or work within the repository, update this document as part of the same task.

If no update is necessary, explicitly state why.

When architecture changes, evaluate whether the following sections also require updates:

- Current Architecture
- Repository Structure
- Tech Stack
- Electron Rules
- React Rules
- Automation Principles
- Security Model
- Development Workflow
- Validation Checklist


### Current Architecture is Authoritative

The **Current Architecture** section should always reflect the repository as it exists today.

Whenever a completed feature changes the system, update this section so future contributors understand the architecture without reverse-engineering the code.



## Tech Stack

| Area           | Current                                             | Planned                                  |
| -------------- | --------------------------------------------------- | ---------------------------------------- |
| Desktop host   | Electron 30                                         | Auto-update (GitHub Releases)            |
| UI             | React 18 + TypeScript (strict)                      | Routing, feature views                   |
| Build          | Vite + `vite-plugin-electron`, `electron-builder`   | GitHub Actions CI/CD                     |
| Styling        | Plain CSS + CSS Modules + theme tokens              | —                                        |
| Automation     | One managed Chrome context, up to three runner pages, selected-only CDP screencast, typed runtime observer/reconciliation via `playwright-core` | Persistent restart recovery; verified Repair |
| Persistence    | Dedicated Chrome profile; main-process SQLite final-outcome history; runtime checkpoints and diagnostics in memory | Persistent workflow checkpoints/restart recovery |
| Quality        | Node tests, ESLint, strict TypeScript, Vite builds   | Non-production MES integration/e2e tests |

**No Tailwind. No UI component framework** unless explicitly approved via RFC.

## Repository Structure

```
mes-runner/
├── CLAUDE.md               # This handbook — single source of truth
├── AGENTS.md               # AI-assistant entry point → points here
├── README.md               # Project/setup overview
├── index.html              # Renderer entry; document title "MES Runner"
├── electron/
│   ├── main.ts             # Main process / window lifecycle
│   ├── managedChromeController.ts
│   │                         # Main-process Playwright persistent-context owner
│   ├── managedChromeChannels.ts
│   │                         # Managed Chrome IPC channel constants
│   ├── managedChromeIpc.ts  # Typed managed Chrome IPC registration
│   ├── eolRunner.ts         # Sequential runner and bounded diagnostics
│   ├── runnerManager.ts     # Three-session ownership, slots, routing, cleanup
│   ├── runnerBrowserAccess.ts # Runner-scoped page/lifecycle boundary
│   ├── history/             # SQLite store, migrations, validation, IPC/tests
│   ├── workflows/           # Observer, reconciliation, actions, detectors/tests
│   ├── preload.ts          # contextBridge preload
│   └── electron-env.d.ts   # Electron/renderer type declarations
├── src/
│   ├── main.tsx            # React entry
│   ├── App.tsx             # Composes the shell
│   ├── components/         # Dashboard, runner, shell, settings, common UI
│   │   └── logs/           # Persisted History and session diagnostics views
│   ├── state/              # Renderer workspace and engine providers
│   ├── lib/                # Pure renderer derivations and tests
│   ├── types/              # Shared renderer/preload TypeScript contracts
│   └── styles/             # theme.css (tokens) + global.css (reset/base)
├── docs/
│   ├── rfcs/               # Proposals — before implementation
│   ├── decisions/          # ADRs — after implementation
│   └── diagrams/           # Mermaid architecture / state / data-flow
├── vite.config.ts
└── electron-builder.json5
```

## Development Workflow

Every task follows these steps, in order:

1. **Understand the problem** — clarify the requirement and its scope before
   touching code.
2. **Review architecture** — read the relevant parts of this document and the
   affected code so the change fits the existing design.
3. **Determine documentation impact** — decide up front what docs the change
   will affect (see [Documentation Workflow](#documentation-workflow)).
4. **Implement** — make the focused change, following the coding standards.
5. **Validate** — run the [Validation Checklist](#validation-checklist).
6. **Update documentation** — apply the doc changes identified in step 3.
7. **Summarize work** — state what changed, what was validated, and the
   documentation / RFC / ADR outcome.

## Documentation Workflow

**Documentation is part of every feature, not an afterthought.** For every
completed task, explicitly evaluate whether each of the following should change:

- `README.md`
- `CLAUDE.md`
- `docs/rfcs/*`
- `docs/decisions/*`
- `docs/diagrams/*`
- Architecture documentation
- Developer setup documentation

If documentation is **not** updated, **state why** in the task summary (e.g.
"no user-facing or architectural change"). Silence is not acceptable — the
evaluation itself must be visible.

## RFC Policy

Create an RFC in `docs/rfcs/` **before implementation** when changing:

- Overall architecture
- Browser architecture
- IPC
- Security
- Storage
- Automation engine
- State-machine design
- Major dependency adoption
- CI/CD
- Auto-update strategy

Small bug fixes and isolated UI changes **do not** require an RFC. See
`docs/rfcs/README.md` for the RFC lifecycle and naming convention.

## ADR Policy

After an RFC has been implemented and accepted, record an Architecture Decision
Record in `docs/decisions/` capturing:

- **Decision** — what was chosen.
- **Motivation** — the context and forces that drove it.
- **Alternatives** — options considered and why they were not chosen.
- **Consequences** — results and trade-offs accepted, including known downsides.

The ADR links back to its originating RFC. See `docs/decisions/README.md` for
the ADR lifecycle.


## Engineering Principle

Never assume a feature exists because it was planned.

Always verify implementation before documenting behavior.

The codebase—not previous conversations—is the source of truth.

## Coding Standards

- Use **strict TypeScript**.
- **Avoid `any`.** Prefer precise types; use `unknown` with narrowing when a
  type is genuinely open.
- **Avoid `@ts-ignore` / `@ts-expect-error`.** If unavoidable, justify it in a
  comment.
- **Prefer composition** over inheritance and over deep prop threading.
- **Keep components and modules focused** — one clear responsibility each.
- **Avoid unrelated refactors** — keep a change scoped to its task.
- **Explain trade-offs** when a decision is non-obvious.
- **Preserve working behavior** — do not regress existing functionality.

## React Rules

- Presentation components remain **free of automation logic**.
- Business logic belongs in **dedicated services**, not in components.
- React **never directly automates the browser** — it dispatches to services
  which own automation.

## Electron Rules

- Keep **`contextIsolation` enabled**.
- **Never enable `nodeIntegration`** in the renderer.
- The renderer communicates only through a **typed preload bridge**.
- **Never expose raw Electron APIs** to the renderer; expose narrow, typed
  functions instead.
- SQLite connections, SQL, migrations, and database paths are main-process
  only. Renderer history access must remain validated and typed through preload.

## Styling Rules

- Use **CSS Modules**.
- Use **theme tokens** from `src/styles/theme.css`; avoid hard-coded values.
- **No Tailwind.**
- **No UI framework** unless explicitly approved (via RFC).

## Automation Principles

- Automation should become **state-driven**.
- **Avoid large procedural scripts.**
- Model workflows as **explicit states with guarded transitions**, so runs are
  observable, recoverable, and testable.

## Validation Checklist

Before finishing any task, verify:

- [ ] TypeScript passes (`tsc --noEmit` / `npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Tests pass (when a test suite exists)
- [ ] Native SQLite loads under development Node and Electron, and packaged
      builds contain its unpacked `.node` binary when persistence changes
- [ ] Documentation reviewed (see [Documentation Workflow](#documentation-workflow))
- [ ] RFC need evaluated (see [RFC Policy](#rfc-policy))
- [ ] ADR need evaluated (see [ADR Policy](#adr-policy))

## Definition of Done

Work is **not** complete until:

- Code is complete.
- Validation succeeds.
- Documentation impact has been evaluated (and applied, or justified).
- A summary has been provided.


## AI Contribution Rules

When contributing:

- Never implement more than the requested scope.
- Prefer asking for clarification over making assumptions.
- Do not silently change architecture.
- Explain tradeoffs when multiple approaches exist.
- Avoid introducing dependencies without justification.
- Preserve consistency over novelty.
- Keep commits reviewable.
- Prefer maintainability over cleverness.
- Do not optimize prematurely.
- Prefer simple, extensible solutions until complexity is justified.

## Repository Philosophy

MES Runner is intended to resemble a professionally maintained production application.

Every change should improve:

- readability
- maintainability
- reliability
- recoverability

Avoid temporary shortcuts that create long-term technical debt.

## Dependency Policy

Do not add dependencies simply because they are popular.

Before introducing a dependency:

- explain the problem
- explain why existing tools are insufficient
- compare alternatives
- explain long-term maintenance impact

## Problem Solving Strategy

Before implementing code:

1. Understand the problem.

2. Identify constraints.

3. Consider at least two approaches.

4. Choose the simplest maintainable solution.

5. Explain why.

Do not jump directly into implementation.

## Versioning

Follow Semantic Versioning.

major.minor.patch

Major:
Breaking architecture changes

Minor:
New features

Patch:
Bug fixes

## Git Workflow

Use Conventional Commits.


Prefer commits like:

feat:

fix:

refactor:

docs:

test:

build:

chore:

perf:

ci:

## Repository Memory

CLAUDE.md represents the accumulated engineering knowledge of the project.

When a significant architectural decision is made:

1. Update the relevant RFC or ADR.
2. Update CLAUDE.md if contributor guidance has changed.
3. Ensure future contributors can understand the current architecture without reading commit history.

The goal is that a new engineer—or an AI assistant—can become productive by reading this document before reading the source code.

## Documentation Completion Rule

Before completing any task, answer these questions:

- Did the architecture change?
- Did the engineering workflow change?
- Did the project structure change?
- Did coding conventions change?
- Did dependencies change?
- Did security assumptions change?
- Did build or deployment change?

If any answer is "Yes", update CLAUDE.md before considering the task complete.

If all answers are "No", explicitly state that CLAUDE.md was reviewed and no updates were required.
