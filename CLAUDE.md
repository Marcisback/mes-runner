# CLAUDE.md

**This document is the single source of truth for all engineering standards in
this repository.** Every contributor — human or AI — must read and follow it
before making changes.

---

## Project Overview

MES Runner is a production-quality desktop automation platform built with
Electron, React, TypeScript, and Playwright browser-control APIs. It uses the
installed organization-managed Google Chrome application as the MES browser and
will later drive it with browser automation and orchestrate long-running,
recoverable workflows as explicit state machines — with persistent application
storage, structured logging, crash recovery, and auto-updating.

Today the repository contains a working **application shell** and the first
managed-Chrome browser foundation. Most automation platform capabilities are still
planned; see [Current Architecture](#current-architecture) for the precise
boundary between what exists and what does not.

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

- **Electron main process** (`electron/main.ts`) — creates a single
  `BrowserWindow` titled "MES Runner" with a dark background and minimum size.
  Loads the Vite dev server in development and the built `index.html` in
  production. The host window explicitly enables `contextIsolation` and disables
  `nodeIntegration`.
- **Managed Chrome controller** (`electron/managedChromeController.ts`) —
  main-process-owned Playwright persistent context that launches the installed
  organization-managed Google Chrome application with `channel: "chrome"` and
  `headless: false`. It verifies the expected macOS Chrome executable exists,
  uses a dedicated profile at
  `path.join(app.getPath("userData"), "managed-chrome-profile")`, navigates to
  the MES URL, reuses the profile across app restarts, and keeps Playwright
  contexts, pages, process ownership, paths, and diagnostics out of React.
- **Managed Chrome IPC** (`electron/managedChromeIpc.ts`,
  `electron/managedChromeChannels.ts`, `electron/preload.ts`) — typed, narrow
  API exposed as `window.managedChrome`. The renderer can request launch,
  confirm readiness, stop Chrome, read current state, and subscribe to lifecycle
  updates. Lifecycle states are `stopped`, `launching`,
  `awaiting-authentication`, `connected`, `disconnected`, and `error`. Raw
  `ipcRenderer`, Playwright objects, Chrome process handles, profile paths,
  cookies, credentials, page contents, and arbitrary browser-control APIs are
  not exposed to React.
- **React renderer** — a componentized dark-theme application shell:
  - `AppLayout` — CSS-grid shell with header / sidebar / main / footer regions.
  - `Header` — brand + `StatusBadge` (static "Idle").
  - `Sidebar` — static nav (Dashboard, Automation, Logs, Settings) with local
    UI-only selection state; **no routing**.
  - `Footer` — static status bar ("Ready").
  - `ManagedChromeView` — main-content status/control view for the external
    managed Chrome window. It displays lifecycle state and offers launch,
    confirm-ready, and stop controls through the typed preload API.
- **Styling** — plain CSS + CSS Modules, driven by theme tokens in
  `src/styles/theme.css`; global reset in `src/styles/global.css`.
- **Security posture** — explicit host-window `contextIsolation` on and
  `nodeIntegration` off; no `<webview>` tag; no raw IPC in the renderer; MES
  runs in the installed managed Chrome application, not inside Electron.
  MES Runner does not spoof browser identity, bypass managed-browser controls,
  automate credentials or YubiKey authentication, expose CDP endpoints, inspect
  DOM content, execute page JavaScript, or access cookies/tokens.
- **Tooling** — Vite + `vite-plugin-electron`, TypeScript (strict), ESLint,
  `playwright-core` for installed-Chrome control, `electron-builder` producing
  per-platform installers.
- **Engineering docs** — `docs/rfcs/`, `docs/decisions/`, `docs/diagrams/`.

### Planned implementation (does NOT exist yet)

The following are goals, not current behavior. Do not reference them as if
implemented:

- Browser automation, DOM inspection, and arbitrary JavaScript execution inside
  MES content.
- CDP reconnection or remote-debugging endpoint management.
- State-machine-driven workflow engine with guarded transitions.
- Persistent application storage beyond the dedicated managed Chrome profile.
- Structured logging and crash recovery.
- Content Security Policy.
- Routing / multiple mounted views.
- Auto-update via GitHub Releases.
- GitHub Actions CI/CD.
- Automated tests (unit / integration / e2e).

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
| Automation     | Managed Chrome foundation via `playwright-core`; no automation | Browser automation + state-machine engine |
| Persistence    | Dedicated managed Chrome profile                    | App storage, logging, recovery           |
| Quality        | ESLint, `tsc --noEmit`                              | Test suite                               |

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
│   ├── preload.ts          # contextBridge preload
│   └── electron-env.d.ts   # Electron/renderer type declarations
├── src/
│   ├── main.tsx            # React entry
│   ├── App.tsx             # Composes the shell
│   ├── components/
│   │   ├── browser/        # ManagedChromeView status/control view
│   │   ├── layout/         # AppLayout, Header, Sidebar, Footer
│   │   ├── common/         # Reusable primitives (StatusBadge)
│   │   └── Welcome.tsx     # Unmounted placeholder component
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
