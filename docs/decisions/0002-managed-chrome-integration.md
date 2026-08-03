# ADR 0002: Managed Chrome Integration

- **Status:** Accepted
- **Date:** 2026-07-31
- **Supersedes:** [ADR 0001: Embedded Browser Foundation](./0001-embedded-browser-foundation.md)
- **Originating RFC:** [RFC 0002: Managed Chrome Integration](../rfcs/0002-managed-chrome-integration.md)

## Context

The RFC 0001 `WebContentsView` foundation proved the Electron shell, typed
preload boundary, and main-process browser ownership pattern, but manual testing
showed that InternalFB rejects Electron Chromium because it is not recognized as
the organization-managed Google Chrome browser. The prior Python MES Runner
successfully accessed MES by using Playwright's persistent-context API with
`channel: "chrome"`, a dedicated profile, manual login, and manual YubiKey
authentication.

MES Runner needs a compliant browser foundation without spoofing browser
identity, bypassing managed controls, automating credentials, exposing browser
internals to React, or using the user's everyday Chrome profile.

## Decision

MES Runner launches the installed managed Google Chrome application from the
Electron main process using `playwright-core` and
`chromium.launchPersistentContext()` with:

- `channel: "chrome"`
- `headless: false`
- a dedicated profile directory at
  `path.join(app.getPath("userData"), "managed-chrome-profile")`

The Electron renderer remains the control interface. Chrome opens as a separate
native window. React communicates only through a typed preload API that can
launch Chrome, confirm readiness, stop Chrome, read the current lifecycle state,
and subscribe to lifecycle changes.

Lifecycle state is limited to `stopped`, `launching`,
`awaiting-authentication`, `connected`, `disconnected`, and `error`.
`connected` means only that the user explicitly selected Confirm Ready; MES
Runner does not programmatically verify authentication in this foundation.

The implementation verifies the expected macOS Chrome executable exists before
launching and does not fall back to bundled Chromium, the default Chrome
profile, the user's everyday Chrome profile, or the old Python prototype
profile. Profile-lock errors are surfaced as clear user-facing guidance to
close the stale MES Runner Chrome window and try again; MES Runner does not kill
unknown Chrome processes.

## Alternatives

- **Electron `WebContentsView`:** Implemented from RFC 0001 but rejected by
  InternalFB managed-browser controls.
- **Playwright `launchPersistentContext` with bundled Chromium:** Rejected
  because bundled Chromium is not the organization-managed Chrome browser.
- **Electron-launched Chrome plus CDP reconnect:** Deferred because the proven
  persistent-context design does not need a remote-debugging endpoint and CDP
  adds port, endpoint, and reconnection complexity.
- **Launch Chrome without Playwright ownership:** Rejected for the foundation
  because it provides weaker lifecycle control and a poorer path to future
  controlled inspection or automation.

## Consequences

- MES access occurs in the managed browser required by InternalFB.
- The authenticated MES session is preserved in Chrome's own dedicated profile
  storage across MES Runner restarts.
- The first implementation has no embedded MES surface inside Electron; users
  work with an external Chrome window plus the MES Runner control interface.
- Future automation can build on Playwright-owned browser context ownership
  without exposing Playwright, CDP, cookies, credentials, profile paths, page
  contents, or process handles to React.
- If MES Runner crashes, Chrome may remain open. A subsequent profile lock is
  handled with user guidance rather than process killing.
- DOM inspection, JavaScript execution, clicking, typing, workflow automation,
  queue management, logging, recovery workflows, and auto-update remain planned
  work and are not part of this decision.

## Links

- [RFC 0002: Managed Chrome Integration](../rfcs/0002-managed-chrome-integration.md)
- [RFC 0001: Embedded Browser Foundation](../rfcs/0001-embedded-browser-foundation.md)
- [ADR 0001: Embedded Browser Foundation](./0001-embedded-browser-foundation.md)
