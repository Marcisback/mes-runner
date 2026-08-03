# RFC 0001: Embedded Browser Foundation

- **Status:** Superseded
- **Date:** 2026-07-31
- **Superseded by:** [RFC 0002: Managed Chrome Integration](./0002-managed-chrome-integration.md)

> This RFC is preserved as the historical proposal for the Electron
> `WebContentsView` foundation. Manual testing later showed that InternalFB
> requires the organization-managed Google Chrome browser, so
> [RFC 0002](./0002-managed-chrome-integration.md) supersedes this embedded
> browser decision.

## Context

MES Runner currently contains a working Electron, React, and TypeScript
application shell only. The Electron main process creates one `BrowserWindow`,
loads the Vite renderer in development or the built `index.html` in production,
and sets a preload script. The React renderer composes a fixed shell with
header, sidebar, main-content, and footer regions; the main-content region
currently renders a placeholder `Welcome` view.

The verified project configuration is:

- Electron is declared as `^30.0.1` and resolves to `30.5.1`.
- React and React DOM are declared as `^18.2.0` and resolve to `18.3.1`.
- TypeScript is declared as `^5.2.2` and resolves to `5.9.3`; strict mode is
  enabled.
- Vite is declared as `^5.1.6` and resolves to `5.4.21`.
- `vite-plugin-electron` is declared as `^0.28.6` and resolves to `0.28.8`.
- `electron-builder` is declared and resolved as `24.13.3`.
- The build command runs `tsc && vite build && electron-builder`.
- `electron-builder.json5` packages `dist` and `dist-electron` and targets DMG,
  NSIS, and AppImage outputs.

The current main window does not explicitly set `contextIsolation` or
`nodeIntegration`; Feature 001 must harden this explicitly rather than relying
on Electron defaults. The current preload exposes a broad `ipcRenderer` shape to
the renderer. Feature 001 must replace that exposure with a narrow typed API and
must not expose raw IPC or Electron primitives to React.

## Problem

MES Runner needs to display the internal MES website inside the desktop
application while preserving the existing React shell and Electron security
boundaries. The embedded browser must live in the main-content area, resize with
the application layout, allow manual login and YubiKey authentication, and keep
React presentation code separate from browser-control logic.

The chosen foundation must also leave a clear future path for controlled DOM
inspection and automation without implementing or designing automation in
Feature 001.

## Goals

- Display the MES website inside the MES Runner desktop window.
- Load this initial MES URL:
  `https://www.internalfb.com/inventory/manufacturing/reverse/triage?env=prod`.
- Keep the existing React application shell visible around the browser.
- Place the embedded browser within the main-content area.
- Resize the browser correctly when the application window or sidebar changes.
- Allow the user to complete login and YubiKey authentication manually.
- Reuse the authenticated MES session during normal application use.
- Persist the MES browser session across application restarts.
- Preserve Electron process and privilege boundaries.
- Provide a future path for controlled DOM inspection and automation through
  separate architecture work.
- Keep React presentation code separate from browser-control logic.

## Non-goals

- Asset-processing automation.
- Clicking or typing into MES.
- Playwright integration.
- Queue management.
- State-machine implementation.
- Persistent application storage outside Electron's dedicated MES browser
  session partition.
- Logging infrastructure.
- Recovery workflows.
- User-facing sign-out or clear-session controls.
- DOM inspection.
- Arbitrary JavaScript execution in MES content.
- Automation.
- Auto-update.
- CI/CD.

## Constraints

- The host `BrowserWindow` must explicitly set `contextIsolation: true`.
- The host `BrowserWindow` must explicitly set `nodeIntegration: false`.
- The renderer must communicate through a typed preload bridge only.
- Feature 001 must replace the current broad preload `ipcRenderer` exposure with
  a narrow typed API.
- Raw IPC, raw Electron APIs, `WebContents`, session objects, cookie jars, and
  browser primitives must not be exposed to React.
- MES web content must not run in the same DOM, JavaScript context, or origin as
  the React application shell.
- The browser surface must be constrained to the app shell's main-content
  rectangle.
- Authentication must remain user-driven for this foundation; the app must not
  automate YubiKey prompts, password entry, or login forms.
- DOM inspection, JavaScript execution, and automation require separate future
  architecture work.
- The design must fit Electron 30 and avoid deprecated foundations when a
  supported replacement exists.

## Proposed Architecture

Use an Electron `WebContentsView` owned by the main process as the embedded MES
browser surface. The application `BrowserWindow` remains the host for the React
shell. The main process creates and owns the MES `WebContentsView`, attaches it
to the host window, loads the configured MES URL into the view's web contents,
and controls the view bounds.

The initial MES URL is:

```text
https://www.internalfb.com/inventory/manufacturing/reverse/triage?env=prod
```

React does not render the MES page. Instead, React renders a browser host region
inside the existing `AppLayout` main-content slot. That region is responsible
for presentation and measurement only. It reports its viewport-relative bounds
to the main process through a narrow preload API whenever the region changes
size or position.

The main process translates those reported bounds into `WebContentsView` bounds
and applies them in device-independent pixels. Window resize events and renderer
layout updates both converge on the same main-process browser-layout service.
This keeps browser-control logic outside React while allowing the browser to
visually occupy the main-content area.

Create a dedicated persistent Electron session partition for MES web contents:

```text
persist:mes-browser
```

This partition isolates MES cookies, local storage, and authentication state
from the React shell while allowing the authenticated session to survive
application restarts. The app must not store MES credentials or duplicate
authentication state in application storage.

Initial host `BrowserWindow` web preferences must be explicitly hardened:

- `contextIsolation: true`
- `nodeIntegration: false`

Initial MES browser web preferences should be hardened:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- no preload script for MES content
- `webSecurity: true`
- deny or explicitly handle unexpected new-window attempts

The browser-control code should live in main-process modules rather than React
components. A future implementation can introduce modules such as
`electron/browser/mesBrowserView.ts` or `electron/services/browserLayout.ts`,
but this RFC does not mandate exact filenames.

## Architecture Comparison

### `WebContentsView`

`WebContentsView` is the accepted approach. It is an Electron-supported way to
embed separate web contents inside a host `BrowserWindow` while keeping the
embedded site outside the React DOM. It gives the main process direct ownership
over loading, navigation policy, session partitioning, permissions, bounds, and
lifecycle cleanup.

The main cost is layout coordination: React must report the main-content
rectangle to the main process, and the main process must validate and apply
native view bounds.

### `<webview>` Tag

The `<webview>` tag would be simpler to place in React markup, but it pushes a
browser-control primitive into the renderer and requires enabling the webview
tag in the host window. That increases renderer responsibility and makes it
easier for presentation code to blur into browser-control code. It is not the
accepted foundation for MES Runner.

### `iframe`

An iframe would keep layout simple, but it is not a suitable desktop browser
foundation for an internal MES application that may need first-party browser
features, authentication redirects, permission handling, and future controlled
inspection. It also keeps the site in the renderer's DOM tree, which is the
wrong boundary for this project.

### Separate `BrowserWindow`

A separate child or sibling `BrowserWindow` would isolate MES content, but it
would not naturally live within the existing React shell. Keeping it visually
aligned with the main-content region would be fragile, especially across window
movement, focus changes, full-screen behavior, and platform differences.

### `BrowserView`

`BrowserView` historically solved a similar problem, but Electron has moved
toward `WebContentsView` for this class of embedding. Starting with
`WebContentsView` avoids building the first browser feature on an older API.

## Security Considerations

The React shell and MES website must remain separate trust zones. The React
renderer must never receive a raw `WebContents`, raw `ipcRenderer`, session
object, cookie jar, or general-purpose execute-JavaScript primitive.

Feature 001 must replace the existing raw preload `ipcRenderer` exposure with a
narrow typed API. The browser feature should expose intent-level methods, such
as attaching the browser host, updating bounds, and receiving lifecycle state,
not arbitrary channel access.

The main process must enforce an explicit navigation allowlist for the MES view:

- include the configured MES origin, `https://www.internalfb.com`
- support additional explicitly configured authentication origins
- do not invent authentication origins
- observe and confirm required authentication origins during manual integration
  testing before adding them to the allowlist

Unexpected navigation, protocols, permissions, downloads, and popup attempts
must remain denied unless explicitly approved. New-window handling, permission
requests, protocol launches, and downloads should be denied by default.

The MES view must not use a preload script for Feature 001. DOM inspection,
JavaScript execution, and automation remain out of scope and require separate
future architecture work that defines exactly what can be inspected or executed,
when it can run, and how results are validated before crossing IPC boundaries.

## Session and Authentication Behavior

The user completes MES login and YubiKey authentication manually inside the
embedded browser. MES Runner does not type credentials, click login controls, or
attempt to bypass interactive authentication.

The MES browser uses the dedicated persistent Electron session partition
`persist:mes-browser`, so cookies and site storage are scoped to MES browser
content and not shared with the React shell. During normal application use,
navigation and reloads reuse that session. The authenticated session must also
survive application restart, subject to the MES site's own session lifetime and
authentication policy.

Feature 001 does not introduce application-level credential storage, a custom
session database, user-facing sign-out controls, or user-facing clear-session
controls. Sign-out and session-clearing behavior require separate future design
work.

## Window and Layout Behavior

The React shell remains visible at all times. The embedded browser occupies only
the main-content area below the header, beside the sidebar, and above the
footer.

React reports viewport-relative geometry from `getBoundingClientRect()`. The
main process applies native `WebContentsView` bounds in device-independent
pixels. Before applying bounds, the main process must validate, normalize,
clamp, and round the geometry.

The main process must ignore:

- invalid bounds
- negative-size bounds
- stale bounds messages
- updates for an unmounted host
- updates for a destroyed or replaced view

The main process should update the `WebContentsView` bounds whenever:

- the application window is resized
- the browser host region is mounted or unmounted
- the sidebar width or visibility changes in a future layout
- zoom, device scale, or other layout-affecting conditions require recalculation

When the browser host is not visible, the main process should either hide the
view or set bounds that prevent it from covering other shell regions. React
should not rely on z-index to cover native browser content.

## Renderer/Main-Process Responsibilities

Renderer responsibilities:

- render the existing shell and a browser host region in main content
- measure the host region with viewport-relative geometry
- send typed layout updates to the preload bridge
- display only the lifecycle states `loading`, `ready`, and `error`
- avoid direct access to Electron browser primitives

Preload responsibilities:

- expose narrow, typed browser-host APIs
- validate input shape where practical before forwarding IPC
- avoid exposing raw `ipcRenderer` or arbitrary channel access
- avoid exposing raw Electron or browser primitives

Main-process responsibilities:

- explicitly harden the host `BrowserWindow`
- create and own the `WebContentsView`
- create and own the `persist:mes-browser` session partition
- load the configured MES URL
- validate, normalize, clamp, round, and apply bounds updates
- enforce navigation, permission, protocol, download, and popup policy
- expose only `loading`, `ready`, and `error` lifecycle state through typed IPC
- detach the `WebContentsView` from its host window when the host is destroyed
- destroy or close owned web contents as appropriate
- remove associated event listeners
- ensure stale renderer bounds messages cannot affect a destroyed or replaced
  view

## IPC Implications

The browser foundation requires new typed IPC, but only at intent boundaries.
Likely channels include:

- renderer to main: browser host mounted
- renderer to main: browser host bounds changed
- renderer to main: browser host unmounted or hidden
- main to renderer: browser lifecycle state changed

The only initial lifecycle states are:

- `loading`
- `ready`
- `error`

Feature 001 must not attempt to infer an `authentication-required` state.

IPC payloads should be small serializable objects with explicit types. Bounds
messages should include `x`, `y`, `width`, and `height` from
`getBoundingClientRect()`, plus enough host identity or generation context to
ignore stale updates if the host view unmounts or is replaced.

No IPC channel in this foundation should allow arbitrary JavaScript execution,
DOM inspection, automation, credential access, cookie access, filesystem access,
or arbitrary navigation.

## Lifecycle Cleanup

Feature 001 must include deterministic lifecycle cleanup for the native browser
surface:

- detach the `WebContentsView` from its host window when the host window is
  destroyed
- destroy or close the owned web contents as appropriate for Electron 30
- remove event listeners registered for browser lifecycle, navigation,
  permissions, downloads, popups, bounds, and host-window events
- invalidate the active browser host generation when the host unmounts or the
  view is replaced
- ignore renderer bounds messages that target an old generation, destroyed view,
  or unmounted host

## Alternatives Considered

- Use a React-rendered `<webview>` for simpler markup integration. Rejected
  because it puts browser-control capability too close to presentation code and
  requires enabling a powerful renderer feature.
- Use an iframe inside the React shell. Rejected because it provides the wrong
  process and trust boundary for MES authentication and future controlled
  inspection.
- Use a separate `BrowserWindow`. Rejected because it does not naturally embed
  into the main-content area and would complicate window movement, focus, and
  resizing.
- Use the older `BrowserView` API. Rejected in favor of `WebContentsView` as the
  supported foundation for new work in Electron 30.

## Risks and Mitigations

- **Risk:** Native view bounds drift from the React layout.
  **Mitigation:** Treat React measurement as the source of visual geometry and
  centralize validated bounds application in the main process.
- **Risk:** Invalid or stale bounds messages move a destroyed or replaced native
  view.
  **Mitigation:** Track host generation, reject stale updates, and ignore
  updates when the host is unmounted or the view is destroyed.
- **Risk:** Browser-control APIs leak into presentation components.
  **Mitigation:** Keep React components limited to rendering, measurement, and
  intent-level calls through typed preload APIs.
- **Risk:** MES authentication opens redirects outside the allowlist.
  **Mitigation:** Start with the MES origin, observe required authentication
  origins during manual integration testing, and add only explicitly confirmed
  origins.
- **Risk:** Future inspection becomes a general-purpose remote code execution
  path.
  **Mitigation:** Do not add MES preload, DOM inspection, automation, or
  arbitrary execute-JavaScript IPC in Feature 001; require later architecture
  work for inspection and automation.
- **Risk:** Persistent browser session storage retains sensitive site state.
  **Mitigation:** Isolate MES state in a dedicated Electron session partition;
  defer user-facing sign-out and clear-session controls to future design work.

## Implementation Stages

1. Explicitly harden the host `BrowserWindow` with `contextIsolation: true` and
   `nodeIntegration: false`.
2. Replace the current broad preload `ipcRenderer` exposure with a narrow typed
   API for browser-host layout events and browser lifecycle state.
3. Add a renderer browser host component in the main-content area that measures
   viewport-relative bounds and reports changes.
4. Add main-process browser-view management using `WebContentsView`, the
   persistent `persist:mes-browser` session partition, and hardened MES browser
   web preferences.
5. Load the configured MES URL.
6. Add explicit allowlist navigation, permission, protocol, download, and popup
   policy for the MES site and confirmed authentication origins.
7. Wire the `loading`, `ready`, and `error` lifecycle states back to the shell
   without adding automation or authentication inference.
8. Add deterministic cleanup for the native view, owned web contents, event
   listeners, and stale bounds messages.
9. Add focused validation for resizing, sidebar changes, authentication flow,
   session persistence, denied navigation and popups, security boundaries, and
   cleanup.

## Validation Plan

- Run `npm run lint`.
- Run `npm run build`.
- Verify the app shell still loads in development and production builds.
- Verify the MES browser appears only in the main-content area.
- Verify the browser resizes correctly when the host window resizes.
- Verify future sidebar width or visibility changes update browser bounds.
- Verify header, sidebar, and footer remain visible and are not covered by the
  browser view.
- Verify manual MES login and YubiKey authentication can complete.
- Verify reloads and normal navigation reuse the authenticated MES session.
- Verify the authenticated MES session survives application restart, subject to
  MES session lifetime and policy.
- Verify React cannot access Node.js APIs, raw IPC, raw Electron APIs, or raw
  browser primitives.
- Verify unexpected navigation, popup, protocol, permission, and download
  attempts are denied unless explicitly approved.
- Verify the native view detaches from its host window on window closure.
- Verify owned web contents are destroyed or closed as appropriate.
- Verify associated event listeners are removed during cleanup.
- Verify stale bounds messages cannot affect a destroyed or replaced view.

## Feature 001 Acceptance Criteria

- MES loads inside the shell's main-content area.
- Header, sidebar, and footer remain visible.
- Resizing keeps the native view aligned with the React host region.
- Manual login and YubiKey authentication work.
- The authenticated session survives application restart, subject to MES session
  lifetime and policy.
- Unexpected navigation and popup attempts are denied.
- Unexpected protocol, permission, and download attempts are denied unless
  explicitly approved.
- The native view and listeners are cleaned up on window closure.
- No automation, DOM inspection, arbitrary JavaScript execution, credential
  access, or cookie access is introduced.
- React receives no raw Electron or browser primitives.

## Open Questions

- Which additional authentication origins, if any, are required after observing
  and confirming the manual MES authentication flow during integration testing?
- What future user-facing sign-out or clear-session controls should MES Runner
  provide?
- What exact future DOM inspection or automation capability is needed, and what
  architecture should govern it?

These questions do not block Feature 001.

## Decision

MES Runner will embed the MES website using a main-process-owned
`WebContentsView` attached to the host `BrowserWindow`. The browser will load
`https://www.internalfb.com/inventory/manufacturing/reverse/triage?env=prod`
using the dedicated persistent Electron session partition
`persist:mes-browser`.

React remains responsible for the application shell and layout measurement only.
Browser creation, session ownership, navigation policy, permission policy,
native bounds application, lifecycle cleanup, and any future inspection hooks
stay in main-process-owned services exposed through narrow typed IPC.
