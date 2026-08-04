# ADR 0003: Runtime MES State Awareness

- **Status:** Accepted
- **Date:** 2026-08-04
- **Originating RFC:** None. This record documents the implemented Phase 1
  runtime decision; no retrospective RFC was created.

## Context

The proven EOL, MRI Pass, and MRI Fail workflows originally advanced through a
procedural sequence after each trusted interaction. Live observation showed
that MES can render slowly or fail to register an Enter or confirmation action.
A timeout therefore did not reliably distinguish page latency, a retained
input, an already-completed transition, a busy stage, or an unsafe unknown
state.

Targeted recovery first addressed retained asset submission and the
Wipe-to-Diagnostic handoff. Phase 1 generalizes that behavior across the proven
runtime workflows without adding persistent checkpoints or restart recovery.
Repair is not included because its end-to-end behavior remains unverified.

The implementation has passed automated tests, lint, strict TypeScript, and
Vite builds. It still requires controlled manual validation against live MES
using approved test assets and is not production-verified.

## Decision

MES Runner uses three separate main-process layers:

1. A central, non-mutating observer derives a typed MES state from exact,
   visible, stage-scoped roles, labels, placeholders, dialogs, and control
   bundles.
2. A pure reconciliation policy compares that observation with typed workflow
   progress and interruption inputs.
3. A shared runtime loop observes, decides, executes one safe action, and then
   observes again to verify the postcondition.

Observed MES state remains separate from workflow mode, expected stage, last
confirmed stage, pending action, retry counters, and runner lifecycle status.
No observer or reconciliation object is exposed to React.

## Observed-State Model

The model distinguishes:

- landing and retained-asset scanners
- Start ready
- Wipe ready and Wipe processing
- Diagnostic ready and Diagnostic processing
- failure-reason dialog
- Move-to-Repair
- workflow-completion evidence
- known business error
- authentication required
- browser disconnected
- unknown state
- ambiguous conflicting state

The observer does not mutate MES. Its metadata is limited to sanitized counts,
actionability flags, and whether a scoped stage input exactly matches the
current asset. It does not return page content, credentials, tokens, cookies,
profile paths, or Playwright objects to diagnostics or the renderer.

The top scanner may remain visible behind an active stage and is supporting
evidence rather than an automatic conflict. Multiple active workflow stages or
multiple candidate action targets are ambiguous and fail closed.

## Reconciliation Model

The pure policy accepts:

- workflow mode
- observed MES state and sanitized metadata
- expected workflow stage
- last confirmed workflow stage
- pending action
- bounded retry counters and deadline status
- pause, stop, authentication, and disconnection status

It returns one typed decision: act, wait, skip forward, complete, retry a
transition, needs review, authentication required, disconnected, paused, or
stopped.

Action targets are resolved again immediately before interaction. If a target
changes between observation and action, the runtime performs a fresh
observation rather than using a stale locator. Each action has an expected
postcondition, and generic completion is accepted only when the mode-specific
final transition has been confirmed.

## Mode-Specific Behavior

### EOL

EOL observes landing, retained asset, Start, Wipe ready/processing, and
completion. Reaching Wipe skips asset submission and Start. Completion is valid
only after Confirm Wipe advancement is observed and the existing completion
verification passes.

### MRI Pass

MRI Pass adds Diagnostic ready/processing. Reaching Diagnostic skips Wipe. A
Diagnostic input that already contains the current asset and exposes Confirm
Diagnostic is not scanned again. Completion requires confirmed Diagnostic
advancement and the existing MRI completion verification.

### MRI Fail

MRI Fail adds the failure dialog and Move-to-Repair. An existing failure dialog
is completed without clicking Diagnostic Failed again. Existing Move-to-Repair
skips earlier failure actions. The proven `Phone - Display` focus/keyboard
handling, exact locator suggestion selection, trusted typing, and Confirm Move
verification remain in their existing guarded helpers. Generic completion
before confirmed Move-to-Repair completion is needs-review.

Repair retains its existing dedicated implementation and remains unverified.

## Retry and Safety Policy

- Asset submission permits no more than two trusted Enter recovery attempts.
- Enter is retried only when the unique initial scanner still contains exactly
  the current asset and remains actionable.
- Confirm Wipe permits one retry within the original 60-second transition
  deadline.
- Busy or disabled controls wait within bounded deadlines and are not replayed.
- Existing Wipe and Diagnostic scans matching the current asset are skipped.
- Forward advancement skips completed transitions; the asset is never restarted
  automatically.
- Unknown states fail closed unless a known pending action is still inside its
  bounded postcondition wait. Ambiguous states always fail closed immediately.
- Pause and authentication suspend deadline consumption. Resume and successful
  reauthentication re-observe the current page before any new action.
- Stop Safely interrupts waits at an action boundary without starting another
  action. Browser disconnection fails closed.
- Recovery diagnostics are bounded and sanitized.

## Alternatives Considered

### Continue Procedural Waits

Rejected because a timeout after an attempted action cannot determine whether
MES is delayed, retained the prior value, advanced already, or entered an unsafe
state.

### Restart the Entire Asset on Timeout

Rejected because prior transitions may be destructive or non-idempotent. The
runtime retries only the smallest incomplete transition after observation.

### XState or Another State-Machine Dependency

Rejected for Phase 1. A focused discriminated-union policy and reducer provide
the required separation and exhaustive tests without adding a dependency or
expanding the renderer/API surface.

### Persist Workflow Checkpoints

Deferred. Runtime awareness and restart recovery have different ownership,
storage, reconciliation, and safety requirements. Phase 1 deliberately keeps
progress in memory.

## Consequences

- Proven workflows use one forward-only runtime decision model instead of
  assuming the last attempted action succeeded.
- Observation, policy, and Playwright action code can be tested and reviewed
  separately.
- Page latency, pause/resume, and authentication no longer force a procedural
  restart of the asset.
- More conservative unknown and ambiguity handling may send assets to review
  when MES introduces an unrecognized layout; this is intentional.
- Stop Safely during an active asset records that asset as needs-review because
  no persistent checkpoint exists from which to resume after the run stops.
- The runtime and diagnostics remain bounded in memory and are lost when the
  application exits.

## Known Limitations

- Persistent checkpoints, application-restart recovery, and crash recovery are
  not implemented.
- Repair has not received the shared runtime-awareness design and remains
  unverified.
- State recognition depends on the currently proven accessible names,
  placeholders, and section structure.
- Automated validation does not prove live MES timing, authentication, popup,
  or business behavior.
- Approved manual validation with non-production test assets remains required
  before this architecture can be considered production-verified.

## Manual Validation Still Required

Manual validation must exercise normal and already-advanced EOL, MRI Pass, and
MRI Fail states; delayed Start/Wipe/Diagnostic rendering; retained inputs;
failure-dialog and Move-to-Repair continuation; retry exhaustion; business
popups; pause/resume; Stop Safely; authentication and headless resumption;
browser disconnection; unknown states; and ambiguous targets. No production
asset should be used for this validation.

## Links

- [ADR 0002: Managed Chrome Integration](./0002-managed-chrome-integration.md)
