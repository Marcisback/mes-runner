# ADR 0001: Embedded Browser Foundation

- **Status:** Superseded
- **Date:** 2026-07-31
- **Superseded by:** [RFC 0002: Managed Chrome Integration](../rfcs/0002-managed-chrome-integration.md)

> This ADR is preserved as the record of the implemented `WebContentsView`
> foundation. Manual testing later showed that InternalFB requires the
> organization-managed Google Chrome browser, so
> [RFC 0002](../rfcs/0002-managed-chrome-integration.md) supersedes this
> decision.

## Context

Feature 001 implements the accepted embedded browser foundation proposed in
[`../rfcs/0001-embedded-browser-foundation.md`](../rfcs/0001-embedded-browser-foundation.md).
MES Runner needs to display the internal MES website inside the existing
Electron application shell while preserving a hardened renderer boundary and
keeping React presentation code separate from browser ownership and policy.

## Decision

MES Runner embeds MES using a main-process-owned Electron `WebContentsView`
attached to the host `BrowserWindow`. The browser loads:

```text
https://www.internalfb.com/inventory/manufacturing/reverse/triage?env=prod
```

The MES browser uses the dedicated persistent Electron session partition
`persist:mes-browser`. The host `BrowserWindow` explicitly enables
`contextIsolation` and disables `nodeIntegration`. The preload bridge exposes
only a narrow typed `window.mesBrowser` API for mounting/unmounting the browser
host, reporting host bounds, and receiving `loading`, `ready`, and `error`
lifecycle updates.

React owns the application shell and layout measurement. The main process owns
browser creation, session partitioning, navigation policy, permission policy,
native bounds application, lifecycle state, and cleanup.

## Consequences

- MES content is isolated from the React DOM and does not receive a preload
  script.
- React does not receive raw `ipcRenderer`, raw Electron APIs, `WebContents`,
  session objects, cookies, arbitrary navigation, arbitrary JavaScript
  execution, or filesystem access.
- Browser bounds must be coordinated through typed IPC and validated in the main
  process before being applied as native view bounds.
- MES cookies and site storage persist across application restarts through the
  dedicated Electron partition, subject to MES session policy.
- Navigation starts with an allowlist containing only the configured MES origin.
  Additional authentication origins must be observed during manual integration
  testing and added explicitly.
- DOM inspection, JavaScript execution, browser automation, sign-out controls,
  and clear-session controls remain future design work.

## Links

- Originating RFC:
  [`../rfcs/0001-embedded-browser-foundation.md`](../rfcs/0001-embedded-browser-foundation.md)
