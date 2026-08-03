# RFC 0002: Managed Chrome Integration

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

Feature 001 implemented the accepted embedded-browser foundation from
[`0001-embedded-browser-foundation.md`](./0001-embedded-browser-foundation.md)
and recorded the shipped decision in
[`../decisions/0001-embedded-browser-foundation.md`](../decisions/0001-embedded-browser-foundation.md).
That implementation keeps React behind a typed preload boundary and owns MES
browser state in the Electron main process, but it uses Electron Chromium
through `WebContentsView`.

Manual testing revealed a mandatory environmental constraint: Meta InternalFB
blocks access when the browser is not recognized as the organization-managed
Google Chrome browser. The Electron `WebContentsView` loaded the site, but
InternalFB displayed:

```text
Your Meta internal access is blocked due to non-compliant controls.
```

The reported failing control was:

```text
Intern Access Managed Browser
```

This means Electron Chromium cannot serve as the production MES browser. The
previous Python implementation successfully accessed MES by launching the
installed Google Chrome application with a dedicated persistent browser profile
and allowing the user to complete login and YubiKey authentication manually.
That implementation used Playwright's persistent-context API:

```python
context = p.chromium.launch_persistent_context(
    user_data_dir=str(CHROME_PROFILE_DIR),
    channel="chrome",
    headless=False,
    slow_mo=80,
)
```

Verified behavior from that implementation:

- `channel="chrome"` launched the installed managed Google Chrome application.
- The dedicated persistent user-data directory preserved the authenticated
  session.
- No bundled Chromium was used.
- No manually managed CDP port or `connect_over_cdp` flow was used.
- Playwright owned the Chrome context and process lifecycle.
- First-time setup launched installed Chrome with `--user-data-dir`.
- The user manually completed login and YubiKey authentication.
- The user quit Chrome and reran the application.
- During normal runs, the application navigated to the MES URL and waited for
  explicit user confirmation before starting.
- Chrome remained open until the user selected Stop.
- `context.close()` closed the controlled Chrome session.

This RFC proposes a compliant architecture that uses the installed
organization-managed Google Chrome browser. It supersedes RFC 0001's
embedded-browser decision. RFC 0001 and ADR 0001 remain preserved as historical
records and link forward to this accepted successor.

## Problem

MES Runner must let users access the internal MES website in a browser accepted
by InternalFB managed-browser controls. The application must still provide a
desktop control interface, preserve Electron security boundaries, retain manual
login and YubiKey authentication, and leave a future path for controlled
browser inspection and automation.

Embedding MES in Electron Chromium is now known to fail the production access
control. The next architecture must use installed managed Google Chrome without
spoofing browser identity, bypassing managed controls, automating credentials,
or weakening organization security checks.

## Goals

- Keep Electron as the MES Runner desktop control interface.
- Run MES in the installed organization-managed Google Chrome application.
- Open Chrome as a separate native window rather than embedding it inside
  Electron.
- Use a main-process-owned browser controller to launch and stop Chrome.
- Use a dedicated persistent Chrome profile owned by MES Runner.
- Keep first-run login and YubiKey authentication entirely manual.
- Reuse the authenticated Chrome profile on later application runs when the MES
  session remains valid.
- Preserve a future path for Playwright-driven inspection and automation against
  the managed Chrome instance.
- Keep React behind a narrow typed preload/IPC boundary.
- Ensure React never receives raw Playwright, CDP, Chrome-process, filesystem,
  credential, cookie, token, or browser-control access.

## Non-goals

- MES workflow automation.
- Asset processing.
- DOM inspection.
- Clicking or typing into MES.
- Queue management.
- MRI/EOL behavior.
- Credential or YubiKey automation.
- Persistent application database.
- Recovery workflows beyond browser-process lifecycle handling.
- CI/CD.
- Auto-update.
- User-agent spoofing, browser-attestation spoofing, managed-control bypass, or
  disabling organization security checks.

## Constraints

- Electron Chromium and bundled Chromium are not acceptable production browsers
  for InternalFB.
- There must be no fallback to bundled Chromium for InternalFB access.
- The managed Google Chrome executable must be discovered explicitly, with clear
  errors if missing.
- Chrome must use a dedicated MES Runner user-data directory, not the user's
  everyday Chrome profile.
- MES Runner must not store passwords, YubiKey data, cookies, or tokens outside
  Chrome's own profile storage.
- The profile directory is sensitive local application data.
- Authentication remains user-driven.
- Remote debugging, if used, must be bound to the local machine only and must
  not be exposed broadly.
- React receives only intent-level status/control APIs through preload.
- The first implementation must not use CDP reconnection or attach to an
  already-running Chrome process.

## Proposed Architecture

Replace the Electron `WebContentsView` MES browser with an external managed
Google Chrome integration.

Electron remains the application shell and control interface. The Electron main
process owns a managed-Chrome controller responsible for discovering Chrome,
creating or reusing the dedicated profile directory, launching Chrome, tracking
process and connection lifecycle, and publishing typed lifecycle state to the
renderer. React renders an external-browser status/control view instead of a
native embedded browser host.

The accepted architecture is:

1. Use Playwright's TypeScript/Node persistent-context API with
   `channel: "chrome"`, `headless: false`, and a dedicated MES Runner profile
   directory.
2. Let Playwright launch the installed managed Google Chrome application as a
   separate native window.
3. Keep Playwright and browser objects owned by the Electron main process.
4. Keep first implementation limited to launch/close lifecycle, manual
   authentication, profile reuse, explicit user confirmation, and status
   reporting.
5. Avoid a separately managed CDP endpoint unless later implementation work
   discovers a TypeScript/Node Playwright blocker or a reviewed reconnect
   requirement that `launchPersistentContext` cannot satisfy.

This recommendation is based on verified prior behavior from the Python MES
Runner. There is no known TypeScript/Node Playwright API limitation that blocks
the equivalent design. The implementation must verify the equivalent
TypeScript/Node behavior during development.

## Managed Chrome Discovery

On macOS, the first expected executable path is:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

Discovery should also allow an explicitly configured Chrome path for developer
or managed-device variance, but the selected executable must be Google Chrome
and must not silently fall back to Electron Chromium, Playwright bundled
Chromium, or another browser for InternalFB access.

If managed Chrome is missing or cannot be launched, MES Runner should enter an
`error` state and show a clear message in the Electron control interface. The
message should identify that managed Google Chrome is required and that bundled
Chromium is intentionally not used. It should not include credentials, cookies,
tokens, or sensitive page content.

Future platform support can add Windows and Linux discovery rules, but this RFC
only requires macOS discovery because the current development target is macOS.

## Profile Ownership

Chrome must use a dedicated MES Runner user-data directory. MES Runner must not
use or automate the user's everyday Chrome profile.

Candidate profile locations:

- Electron application-data directory, such as a subdirectory under
  `app.getPath('userData')`.
- A manually configured path for development or migration from the old Python
  prototype.
- The old prototype path, only as an import or compatibility option if reviewed
  later.

The production profile directory is:

```ts
path.join(app.getPath('userData'), 'managed-chrome-profile')
```

This location is app-scoped, predictable for packaged builds, and avoids
mandating prototype-specific local paths such as `Documents`. The first
implementation must not migrate, modify, or reuse the existing working Python
profile at `~/Documents/chrome-automation-profile`. A later migration/import
decision can evaluate whether any legacy profile support is needed.

First run creates the dedicated profile directory and launches managed Chrome
against it. The user manually completes login and YubiKey authentication in the
Chrome window. Later launches reuse that profile so Chrome can reuse its own
cookies, local storage, certificates, browser management state, and MES session
data according to Chrome and MES policy.

The profile directory must be treated as sensitive local application data.
MES Runner must not copy cookies, export tokens, read passwords, or duplicate
profile state into an application database.

If the profile is already open, Chrome may reject the launch or reuse the
existing process depending on platform behavior and command-line flags. The
controller must detect profile-lock failures and surface a clear state to the
user. It should not switch to the user's everyday Chrome profile. Acceptable
behaviors include:

- ask the user to close the other Chrome process using the MES Runner profile
- enter `error` with profile-lock diagnostics if launch is not possible

The first implementation must not silently kill an unknown Chrome process and
must not attach to an already-running process.

## Manual Authentication

First launch opens managed Chrome to the MES URL:

```text
https://www.internalfb.com/inventory/manufacturing/reverse/triage?env=prod
```

The user completes login and YubiKey authentication manually. MES Runner must
not type credentials, click login controls, script authentication pages, bypass
authentication checks, or automate YubiKey interaction.

The first implementation should wait for explicit user confirmation in the
Electron control interface before starting any MES workflow. It should not infer
authentication readiness through premature DOM inspection. Later designs may
evaluate high-level URL or page lifecycle verification, but that is not part of
the initial managed-Chrome foundation.

Subsequent launches reuse the persistent Chrome profile when valid. If the MES
session has expired, Chrome returns the user to login or authentication screens
and MES Runner returns control to the user for manual reauthentication.

First-run behavior is:

1. Create the dedicated profile directory.
2. Launch managed Chrome directly through Playwright
   `chromium.launchPersistentContext()`.
3. Navigate to the MES URL.
4. Place MES Runner in `awaiting-authentication`.
5. Let the user complete login and YubiKey authentication manually.
6. Require the user to select `Confirm Ready`.

The first implementation must not use a separate preliminary non-Playwright
Chrome launch unless implementation testing proves it necessary and that change
is reviewed.

## Browser Connectivity

MES Runner needs a future path for controlled inspection and automation without
exposing browser-control primitives to React. The preferred foundation is
Playwright-owned persistent context using installed managed Chrome through
`channel: "chrome"`.

In TypeScript/Node, the intended API shape is:

```ts
await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
})
```

The dedicated profile directory is
`path.join(app.getPath('userData'), 'managed-chrome-profile')`. The configured
MES URL is opened in the visible browser context. The main process owns the
resulting browser context and pages. React receives only typed lifecycle state
and intent-level controls.

The verified Python implementation did not require a manually managed CDP port
or `connect_over_cdp`. The TypeScript implementation should follow that simpler
model unless practical API differences or repository constraints create a
blocker.

CDP reconnection is explicitly not part of the first implementation. It remains
a rejected/deferred alternative because the proven Playwright-owned
persistent-context design does not need it, it adds port and
endpoint-management complexity, and crash reconnection is not currently
valuable enough to justify that complexity.

If the CDP approach is reconsidered later, MES Runner would launch managed
Chrome with a localhost-only debugging endpoint, such as
`--remote-debugging-address=127.0.0.1` and a dynamically assigned or safely
reserved port. The controller would record endpoint metadata only as local
process-control metadata, not as sensitive MES state. Endpoint metadata would be
invalidated when Chrome exits, when connection attempts fail, or when the
profile no longer matches the expected MES Runner profile.

Readiness detection should wait for Chrome to create the debugging endpoint and
then connect with a bounded timeout. Timeout should transition to `error` or
`disconnected` with clear diagnostics and no policy weakening. Stale processes
and stale endpoint metadata should be handled by probing the endpoint, verifying
it corresponds to the expected local Chrome/profile where practical, and
discarding metadata when verification fails.

With `launchPersistentContext`, reconnecting to an already-running Chrome
process is not the primary lifecycle model. The first implementation should
assume MES Runner launches and owns the persistent context for the current run.
If the dedicated profile is already locked by another Chrome process, MES Runner
should surface the profile-lock state and ask the user to close that process.

Reconnecting to an already-running Chrome process is a CDP-specific alternative
and is not supported by the first implementation. A regular user-launched Chrome
window with no debugging endpoint should not be considered controllable, even if
it is managed Chrome. The app should ask the user to close stale Chrome
processes that hold the MES Runner profile lock.

React must never receive raw CDP, Playwright objects, Chrome process handles,
remote-debugging URLs, filesystem paths that grant profile access, cookies, or
credentials. React receives typed lifecycle state and intent-level controls
only.

## Process Lifecycle

The controller should expose explicit lifecycle states:

- `stopped`
- `launching`
- `awaiting-authentication`
- `connected`
- `disconnected`
- `error`

These states can be represented with plain TypeScript types. This RFC does not
introduce a state-machine library.

State meanings:

- **`stopped`:** no controlled Chrome context exists.
- **`launching`:** Playwright is starting managed Chrome.
- **`awaiting-authentication`:** Chrome is open and awaiting manual login,
  YubiKey authentication, or user confirmation.
- **`connected`:** the user selected `Confirm Ready`.
- **`disconnected`:** the previously controlled Chrome context closed
  unexpectedly.
- **`error`:** launch, discovery, profile-lock, or cleanup failed.

`connected` means the user explicitly confirmed readiness. It must not claim
that authentication was automatically verified.

Lifecycle behavior:

- **MES Runner closes normally:** close the Playwright context cleanly.
- **User selects Stop Chrome:** call `context.close()` to close the controlled
  Chrome session.
- **A future automation run completes:** do not automatically close Chrome.
  Chrome remains open until `Stop Chrome` or normal MES Runner shutdown.
- **Chrome closes unexpectedly:** transition to `disconnected` or `error`,
  clear owned context state, and offer `Launch Chrome Again`.
- **MES Runner crashes:** Chrome may remain open. With
  `launchPersistentContext`, the next launch should detect profile locking and
  show a clear user-facing error instructing the user to close the stale MES
  Runner Chrome process before relaunching. Do not silently kill an unknown
  Chrome process. CDP reconnection is a deferred alternative, not the default.
- **Chrome is already running:** if it is using the MES Runner profile,
  `launchPersistentContext` may fail due to profile locking. Do not attach to or
  automate the user's everyday profile. CDP reconnection may be allowed only for
  a deliberately launched MES Runner Chrome process with the expected local
  endpoint.
- **Profile is locked:** surface a clear profile-lock state or error; do not
  switch profiles silently.
- **Connection times out:** transition to `error` or `disconnected` and keep
  Chrome access manual.
- **User needs to reauthenticate:** transition to `awaiting-authentication` when
  the app can determine that state without DOM inspection, or otherwise present
  a neutral "open Chrome and confirm when ready" workflow.

## Window Behavior

Chrome will not be embedded inside Electron. MES Runner should treat Chrome as a
separate native window and avoid fragile window manipulation.

The first implementation should keep window behavior simple:

- open the managed Chrome window
- present status and controls in the Electron shell
- optionally bring Chrome forward when the user explicitly launches it, if
  supported by the platform and not blocked by OS focus rules
- avoid trying to tile, resize, parent, or embed the external Chrome window

MES Runner may later offer convenience guidance such as opening beside Chrome,
but external window positioning and focusing are platform-dependent and should
not be required for correctness.

## Renderer/Main-Process Responsibilities

Renderer responsibilities:

- render the MES Runner shell and an external-browser status/control view
- expose the initial user controls `Launch Chrome`, `Confirm Ready`, and
  `Stop Chrome`
- after an unexpected Chrome closure, present launch as `Launch Chrome Again` if
  helpful
- display lifecycle state from the main process
- never access raw Playwright, CDP, Chrome process, filesystem, cookies,
  credentials, or tokens

Preload responsibilities:

- expose a narrow typed API for managed-Chrome lifecycle intents and lifecycle
  subscription
- validate payload shape where practical
- avoid raw IPC channel access

Main-process responsibilities:

- discover the managed Chrome executable
- select and create the dedicated profile directory
- launch and own the Playwright persistent Chrome context
- close the controlled context when the chosen lifecycle policy requires it
- manage local debugging endpoint metadata only if CDP is selected
- own Playwright objects if future automation is added
- enforce local-only debugging endpoint configuration if CDP is selected
- track lifecycle state and publish typed updates
- handle profile locks, process exits, connection timeouts, normal shutdown
  policy, and stale endpoint metadata only if CDP is selected
- avoid CDP reconnection and avoid attaching to already-running Chrome in the
  first implementation

## Alternatives Considered

### 1. Playwright `launchPersistentContext` With Installed Google Chrome

This option uses Playwright to launch a persistent browser context with the
installed managed Google Chrome executable or Chrome channel and the dedicated
MES Runner profile directory.

- **Managed-browser compatibility:** strongest currently supported option. The
  prior Python implementation verified that `channel="chrome"` launched the
  installed managed Google Chrome application and successfully accessed
  InternalFB. The TypeScript implementation should verify equivalent behavior
  with `channel: "chrome"`.
- **Persistent-profile behavior:** good. `launchPersistentContext` directly
  takes a user-data directory and preserved the authenticated session in the
  prior implementation.
- **Ability to reconnect after application restart:** good for normal restarts
  when Chrome was closed cleanly and the persistent profile is reused. It is not
  designed to attach to an already-running stale Chrome process after a crash;
  profile-lock handling should ask the user to close that process.
- **Process lifecycle ownership:** simple while MES Runner is running because
  Playwright owns Chrome. The prior implementation kept Chrome open until the
  user selected Stop and then closed it with `context.close()`.
- **Future automation capability:** strong. Playwright has first-class APIs once
  connected.
- **Security implications:** acceptable only if all automation objects remain in
  the main process and React receives no raw Playwright access. Launch flags
  must not weaken managed controls.
- **Reliability and recovery:** strong for clean launch, manual authentication,
  stop, close, and profile reuse. Crash recovery depends on detecting profile
  locks and asking the user to close stale Chrome.
- **Development complexity:** moderate and lower than separately managed CDP.
  Playwright handles launch and context lifecycle; MES Runner still handles
  profile path selection, Chrome-channel validation, profile locking, and typed
  IPC.
- **Manual login/YubiKey:** preserved. The user interacts with the visible
  managed Chrome window directly.

### 2. Electron Launches Chrome and Playwright Connects Over CDP

This option has the Electron main process launch installed managed Chrome with
the dedicated profile and a localhost-only remote-debugging endpoint. Playwright
connects over CDP when controlled access is needed.

- **Managed-browser compatibility:** plausible but less proven than
  `launchPersistentContext`. It must be validated that managed-browser controls
  tolerate a manually specified local debugging endpoint.
- **Persistent-profile behavior:** good. Chrome owns profile storage in the
  dedicated MES Runner user-data directory.
- **Ability to reconnect after application restart:** best among automation
  options if Chrome remains running with the expected local endpoint, because
  MES Runner can reconnect to CDP after restart.
- **Process lifecycle ownership:** explicit. MES Runner owns launch metadata,
  endpoint metadata, and can decide whether Chrome closes with the app.
- **Future automation capability:** good. Playwright can connect over CDP, with
  some limitations compared with a fully Playwright-owned browser.
- **Security implications:** requires careful local-only endpoint handling,
  dynamic or safely reserved port selection, metadata cleanup, and no endpoint
  exposure to React. It avoids browser spoofing and keeps the managed browser in
  use.
- **Reliability and recovery:** potentially strong if endpoint probing, stale
  metadata cleanup, process-exit detection, and timeout handling are
  implemented.
- **Development complexity:** higher than `launchPersistentContext` because MES
  Runner owns process launch, endpoint readiness, reconnection, port management,
  and stale-state handling. The prior working Python implementation did not need
  this complexity.
- **Manual login/YubiKey:** preserved. Authentication remains in visible managed
  Chrome.
- **Outcome:** rejected/deferred for the first implementation. Crash
  reconnection is not currently valuable enough to justify the added port and
  endpoint-management complexity.

### 3. Playwright Launches Bundled Chromium

This option uses Playwright's bundled Chromium.

- **Managed-browser compatibility:** fails the observed requirement. Bundled
  Chromium is not the organization-managed Google Chrome browser.
- **Persistent-profile behavior:** possible, but irrelevant because browser
  compliance fails.
- **Ability to reconnect after application restart:** possible only with extra
  remote-debugging design, but not worth pursuing.
- **Process lifecycle ownership:** simple under Playwright.
- **Future automation capability:** strong technically.
- **Security implications:** unacceptable for InternalFB because it bypasses the
  managed-browser requirement by using the wrong browser class.
- **Reliability and recovery:** technically familiar, but production access is
  blocked.
- **Development complexity:** low to moderate.
- **Manual login/YubiKey:** a user could interact manually, but InternalFB
  blocks access before this becomes useful.

### 4. Continue With Electron `WebContentsView`

This is the current Feature 001 implementation from RFC 0001 and ADR 0001.

- **Managed-browser compatibility:** fails. InternalFB reports
  `Intern Access Managed Browser` as non-compliant.
- **Persistent-profile behavior:** good inside Electron's
  `persist:mes-browser` partition, but the session cannot overcome managed
  browser controls.
- **Ability to reconnect after application restart:** good for Electron session
  reuse, but not useful for production access.
- **Process lifecycle ownership:** simple. Electron owns the native view.
- **Future automation capability:** possible through Electron APIs or future
  automation, but this would be against a blocked browser.
- **Security implications:** strong Electron isolation was implemented, but it
  does not satisfy organization-managed browser requirements.
- **Reliability and recovery:** reliable as an embedded surface, but production
  login is blocked.
- **Development complexity:** already implemented locally.
- **Manual login/YubiKey:** cannot complete production access when InternalFB
  blocks the browser.

### 5. Launch Chrome Without Automation Connectivity

This option launches installed managed Chrome with a dedicated profile and MES
URL but does not start a remote-debugging endpoint and does not connect
Playwright.

- **Managed-browser compatibility:** strong if the installed managed Chrome app
  is used.
- **Persistent-profile behavior:** good. Chrome owns the dedicated profile.
- **Ability to reconnect after application restart:** limited to process
  discovery and user-visible status. MES Runner cannot safely inspect browser
  state or attach automation without a control channel.
- **Process lifecycle ownership:** moderate. MES Runner can launch Chrome and
  observe child-process exit if it owns the process, but cannot reliably attach
  to a user-started or surviving process.
- **Future automation capability:** weak. A later migration would need to add
  CDP or Playwright-owned launch semantics.
- **Security implications:** simplest and lowest browser-control exposure. It
  avoids remote debugging entirely.
- **Reliability and recovery:** good for manual use, limited for controlled
  status and recovery.
- **Development complexity:** lowest.
- **Manual login/YubiKey:** fully preserved.

## Recommendation

The accepted architecture is Playwright `launchPersistentContext` using
installed managed Google Chrome via
`channel: "chrome"` and a dedicated profile beneath Electron's `userData`
directory.

This best matches the discovered production constraint and the verified prior
implementation. It uses managed Chrome, avoids bundled Chromium, preserves the
authenticated session in Chrome's own persistent profile storage, keeps login
and YubiKey authentication manual, and gives the main process first-class
Playwright control for future inspection and automation.

Compared with a separately managed CDP connection, this approach is simpler,
already proven in the previous Python MES Runner, and avoids manually managing
ports and endpoint metadata. CDP remains a valid alternative if TypeScript/Node
Playwright constraints or future reconnect requirements prove that
`launchPersistentContext` is insufficient.

## Security Considerations

This architecture explicitly prohibits:

- user-agent spoofing
- browser-attestation spoofing
- managed-control bypass
- credential automation
- YubiKey automation
- broad remote-debugging exposure
- raw CDP access in React
- raw Playwright access in React
- Chrome process handles in React
- filesystem access to the profile from React
- using the user's normal Chrome profile
- logging cookies, tokens, credentials, or sensitive MES page content

Diagnostics may include sanitized lifecycle events, executable discovery status,
profile-lock status, local connection timeout status, and blocked/missing
configuration names. Diagnostics must not include cookie values, tokens,
passwords, YubiKey data, full sensitive URLs with secrets, request bodies, or
page content.

Remote debugging must not be introduced for the first implementation. If the CDP
alternative is later selected, bind to `127.0.0.1`, use a dynamic or safely
reserved port, store endpoint metadata with restrictive local scope, and
invalidate that metadata aggressively when Chrome exits, MES Runner exits,
connection attempts fail, or the profile identity cannot be confirmed.

## Migration From Feature 001

The current uncommitted `WebContentsView` implementation contains useful
concepts but the embedded browser surface must be removed or replaced.

Concepts to keep:

- typed preload/IPC boundary
- main-process ownership of browser lifecycle
- narrow renderer API
- lifecycle reporting to React
- clear separation between React presentation and browser-control logic
- sanitized diagnostics

Modules to remove or replace during implementation:

- replace `electron/mesBrowserController.ts` with a managed-Chrome controller
- replace `electron/mesBrowserConfig.ts` with managed Chrome URL, Chrome
  channel, executable-discovery, and profile configuration
- replace embedded-browser IPC channel names with managed-Chrome intent names
- remove native `WebContentsView` bounds reporting and layout IPC
- remove Electron session partition `persist:mes-browser` as the MES browser
  session store
- evolve `src/components/browser/BrowserHost.tsx` into an external-browser
  status/control view

`CLAUDE.md` must be corrected during implementation so Current Architecture no
longer says MES runs inside `WebContentsView`. It should describe managed
Chrome as the current MES browser foundation only after RFC 0002 is accepted
and implemented.

RFC 0001 and ADR 0001 are marked `Superseded` by this accepted RFC. They remain
preserved as historical records and link forward to RFC 0002. The migration must
avoid leaving dead embedded browser code in the main process, preload bridge,
renderer, or docs.

## Implementation Stages

1. Replace the `WebContentsView` controller with a managed-Chrome controller in
   the Electron main process.
2. Add managed Chrome discovery with macOS path support and clear missing-Chrome
   errors.
3. Add dedicated profile-directory creation at
   `path.join(app.getPath('userData'), 'managed-chrome-profile')`.
4. Add Playwright `launchPersistentContext` using `channel: "chrome"`,
   `headless: false`, and the dedicated profile directory.
5. Add explicit user confirmation for authentication readiness before starting
   normal MES work.
6. Add Chrome launch/close lifecycle with explicit states and profile-lock
   handling.
7. Add the renderer controls `Launch Chrome`, `Confirm Ready`, and `Stop
   Chrome`; after unexpected closure, allow `Launch Chrome Again`.
8. Evolve `BrowserHost` into an external-browser status/control view.
9. Preserve narrow typed preload/IPC and keep browser-control objects out of
   React.
10. Update `CLAUDE.md`, ADRs, and any implementation docs to reflect the managed
   Chrome foundation.

## Validation Plan

Automated validation:

- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npx vite build`.
- Run relevant tests when a test suite exists.
- Run `npm run build`, but report TypeScript/Vite phases separately from DMG
  packaging because the current environment has an unrelated `hdiutil`
  packaging failure.

Manual validation:

- Detect installed managed Google Chrome at
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Verify clear error behavior when managed Chrome is missing.
- Verify there is no bundled-Chromium fallback for InternalFB.
- Create the dedicated MES Runner Chrome profile directory.
- Verify the profile directory is
  `path.join(app.getPath('userData'), 'managed-chrome-profile')`.
- Confirm the user's everyday Chrome profile is not used.
- Confirm the existing Python profile at
  `~/Documents/chrome-automation-profile` is not migrated, modified, or used.
- Complete first-run manual login.
- Complete YubiKey authentication manually.
- Verify InternalFB recognizes the browser as managed.
- Verify session reuse across MES Runner restarts.
- Verify normal-run behavior opens MES and waits for explicit user confirmation
  before continuing.
- Verify expired sessions return control to the user for manual
  reauthentication.
- Verify profile-lock handling when the dedicated profile is already open.
- Verify Chrome remains open while MES Runner is running.
- Verify completing a future automation run does not automatically close Chrome.
- Verify normal MES Runner shutdown closes the Playwright context cleanly.
- Verify Chrome remains open until the user selects `Stop Chrome` during normal
  operation.
- Verify `context.close()` closes the controlled Chrome session.
- Verify a profile lock after a MES Runner crash produces a clear user-facing
  error instructing the user to close the stale MES Runner Chrome process.
- Verify no unknown Chrome process is silently killed.
- Verify connection timeout behavior.
- Verify stale Chrome/profile-lock behavior.
- Verify no remote debugging endpoint is used in the recommended first
  implementation.
- If CDP is selected later, verify remote debugging is local-only and stale
  endpoint metadata is cleaned up.
- Verify React receives no raw browser-control APIs, Playwright objects, CDP
  sessions, Chrome process handles, filesystem access, cookies, tokens, or
  credentials.

## Open Questions

- If the app later needs crash reconnection to an already-running Chrome
  process, is that need strong enough to justify the CDP alternative?
- Should a future implementation add high-level URL or page lifecycle checks to
  supplement explicit `Confirm Ready` without introducing DOM inspection?
- Should there be future user-facing controls to repair, archive, or reset the
  dedicated managed-Chrome profile?

These questions do not block the first managed-Chrome implementation.

## Decision

Supersede the embedded Electron `WebContentsView` browser from RFC 0001 with an
external installed managed Google Chrome browser launched through Playwright
`chromium.launchPersistentContext()`.

The accepted foundation is:

- `channel: "chrome"`
- `headless: false`
- profile directory:
  `path.join(app.getPath('userData'), 'managed-chrome-profile')`
- explicit user confirmation through `Confirm Ready`
- controls: `Launch Chrome`, `Confirm Ready`, and `Stop Chrome`
- no CDP reconnection in the first implementation

This preserves managed-browser compliance, manual authentication, persistent
profile reuse, typed IPC boundaries, and a future automation path without
exposing browser control to React.
