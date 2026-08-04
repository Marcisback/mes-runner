import type { WorkflowMode } from '../../src/types/eolRunner'
import type { MesObservation } from './mesRuntimeState'
import { WORKFLOW_RECOVERY_LIMITS } from './transitionRecoveryCore.ts'

export type WorkflowExpectedStage =
  | 'asset-submission'
  | 'start'
  | 'wipe-scan'
  | 'wipe-confirm'
  | 'wipe-transition'
  | 'diagnostic-scan'
  | 'diagnostic-action'
  | 'diagnostic-transition'
  | 'failure-dialog'
  | 'move-to-repair'
  | 'completion'

export type WorkflowConfirmedStage =
  | 'none'
  | 'asset-submitted'
  | 'start-confirmed'
  | 'wipe-scanned'
  | 'wipe-confirmed'
  | 'diagnostic-scanned'
  | 'diagnostic-confirmed'
  | 'diagnostic-failed'
  | 'failure-confirmed'
  | 'move-confirmed'

export type WorkflowPendingAction = RuntimeAction | null

export type RuntimeAction =
  | 'submit-asset'
  | 'press-enter'
  | 'click-start'
  | 'scan-wipe'
  | 'confirm-wipe'
  | 'scan-diagnostic'
  | 'confirm-diagnostic'
  | 'click-diagnostic-failed'
  | 'complete-failure-dialog'
  | 'complete-move-to-repair'
  | 'handle-business-error'

export interface RuntimeRetryCounters {
  assetEnter: number
  confirmWipe: number
  transitionTimedOut: boolean
}

export interface RuntimeInterruptionState {
  paused: boolean
  stopRequested: boolean
  authenticationRequired: boolean
  browserDisconnected: boolean
}

export interface RuntimeReconciliationInput {
  mode: WorkflowMode
  observation: MesObservation
  expectedStage: WorkflowExpectedStage
  lastConfirmedStage: WorkflowConfirmedStage
  pendingAction: WorkflowPendingAction
  retries: RuntimeRetryCounters
  interruption: RuntimeInterruptionState
}

export type RuntimeDecision =
  | { kind: 'act'; action: RuntimeAction; reason: string }
  | { kind: 'wait'; reason: string }
  | {
      kind: 'skip-forward'
      expectedStage: WorkflowExpectedStage
      confirmedStage: WorkflowConfirmedStage
      reason: string
    }
  | { kind: 'complete'; reason: string }
  | { kind: 'retry-transition'; action: RuntimeAction; reason: string }
  | { kind: 'needs-review'; reason: string }
  | { kind: 'authentication-required'; reason: string }
  | { kind: 'disconnected'; reason: string }
  | { kind: 'paused'; reason: string }
  | { kind: 'stopped'; reason: string }

export function reconcileRuntimeState(
  input: RuntimeReconciliationInput,
): RuntimeDecision {
  const interruption = reconcileInterruption(input)
  if (interruption !== null) return interruption

  const { state } = input.observation
  if (state === 'authentication-required') {
    return { kind: 'authentication-required', reason: 'MES authentication is required.' }
  }
  if (state === 'browser-disconnected') {
    return { kind: 'disconnected', reason: 'Managed Chrome is disconnected.' }
  }
  if (state === 'business-error') {
    return { kind: 'act', action: 'handle-business-error', reason: 'Known business dialog is visible.' }
  }
  if (state === 'unknown') {
    if (input.pendingAction !== null && !input.retries.transitionTimedOut) {
      return {
        kind: 'wait',
        reason: `Waiting for the postcondition of ${input.pendingAction}.`,
      }
    }
    return { kind: 'needs-review', reason: 'MES state is not recognized.' }
  }
  if (state === 'ambiguous') {
    return {
      kind: 'needs-review',
      reason: 'MES exposes multiple conflicting states.',
    }
  }

  switch (state) {
    case 'landing':
    case 'workflow-completed':
      return reconcileLandingOrCompletion(input)
    case 'asset-retained':
      return reconcileRetainedAsset(input)
    case 'start-ready':
      return input.expectedStage === 'asset-submission' || input.expectedStage === 'start'
        ? {
            kind: 'act',
            action: 'click-start',
            reason: 'Start is the next uniquely actionable transition.',
          }
        : {
            kind: 'needs-review',
            reason: 'Start reappeared after later workflow progress was confirmed.',
          }
    case 'wipe-processing':
    case 'diagnostic-processing':
      return { kind: 'wait', reason: `${state} is still observable.` }
    case 'wipe-ready':
      return reconcileWipe(input)
    case 'diagnostic-ready':
      return reconcileDiagnostic(input)
    case 'failure-dialog':
      return input.mode === 'MRI_FAIL' && input.lastConfirmedStage !== 'move-confirmed'
        ? {
            kind: 'act',
            action: 'complete-failure-dialog',
            reason: 'The existing failure dialog must be completed without replaying Diagnostic Failed.',
          }
        : { kind: 'needs-review', reason: 'Failure dialog is invalid for this workflow mode.' }
    case 'move-to-repair':
      return input.mode === 'MRI_FAIL' && input.lastConfirmedStage !== 'move-confirmed'
        ? {
            kind: 'act',
            action: 'complete-move-to-repair',
            reason: 'Move-to-Repair is already active; earlier failure actions are skipped.',
          }
        : { kind: 'needs-review', reason: 'Move-to-Repair is invalid for this workflow mode.' }
  }
}

function reconcileInterruption(
  input: RuntimeReconciliationInput,
): RuntimeDecision | null {
  if (input.interruption.stopRequested) {
    return { kind: 'stopped', reason: 'Stop Safely requested before the next action.' }
  }
  if (input.interruption.paused) {
    return { kind: 'paused', reason: 'Runner is paused before the next action.' }
  }
  if (input.interruption.authenticationRequired) {
    return { kind: 'authentication-required', reason: 'MES authentication is required.' }
  }
  if (input.interruption.browserDisconnected) {
    return { kind: 'disconnected', reason: 'Managed Chrome is disconnected.' }
  }
  return null
}

function reconcileLandingOrCompletion(
  input: RuntimeReconciliationInput,
): RuntimeDecision {
  if (input.expectedStage === 'asset-submission' && input.lastConfirmedStage === 'none') {
    return {
      kind: 'act',
      action: 'submit-asset',
      reason: 'Empty enabled landing scanner is ready for the current asset.',
    }
  }

  const validCompletion =
    (input.mode === 'EOL' && (
      input.lastConfirmedStage === 'wipe-confirmed' ||
      (input.expectedStage === 'wipe-transition' && input.pendingAction === 'confirm-wipe')
    )) ||
    (input.mode === 'MRI' && (
      input.lastConfirmedStage === 'diagnostic-confirmed' ||
      (input.expectedStage === 'diagnostic-transition' && input.pendingAction === 'confirm-diagnostic')
    )) ||
    (input.mode === 'MRI_FAIL' && input.lastConfirmedStage === 'move-confirmed')

  return validCompletion
    ? { kind: 'complete', reason: 'Mode-specific final transition was confirmed.' }
    : {
        kind: 'needs-review',
        reason: input.mode === 'MRI_FAIL'
          ? 'Generic completion appeared before Move-to-Repair completion was confirmed.'
          : 'Landing state appeared before the required final transition was confirmed.',
      }
}

function reconcileRetainedAsset(
  input: RuntimeReconciliationInput,
): RuntimeDecision {
  if (
    input.expectedStage !== 'start' &&
    input.expectedStage !== 'asset-submission'
  ) {
    return { kind: 'needs-review', reason: 'Initial scanner retained an asset after MES had advanced.' }
  }
  if (!input.retries.transitionTimedOut) {
    return { kind: 'wait', reason: 'Waiting for Start or a forward state before Enter recovery.' }
  }
  return input.retries.assetEnter < WORKFLOW_RECOVERY_LIMITS.assetSubmissionEnterRetries
    ? {
        kind: 'retry-transition',
        action: 'press-enter',
        reason: 'The verified current asset remains in the unique initial scanner.',
      }
    : { kind: 'needs-review', reason: 'Asset submission Enter retry limit was exhausted.' }
}

function reconcileWipe(input: RuntimeReconciliationInput): RuntimeDecision {
  const { metadata } = input.observation
  if (
    input.expectedStage === 'asset-submission' ||
    input.expectedStage === 'start'
  ) {
    return {
      kind: 'skip-forward',
      expectedStage: 'wipe-scan',
      confirmedStage: 'start-confirmed',
      reason: 'MES already advanced to Wipe.',
    }
  }
  if (input.expectedStage === 'wipe-scan' && metadata.wipeInputActionable) {
    if (metadata.wipeInputMatchesAsset && metadata.wipeActionActionable) {
      return {
        kind: 'skip-forward',
        expectedStage: 'wipe-confirm',
        confirmedStage: 'wipe-scanned',
        reason: 'Wipe scan is already present; the scan is not replayed.',
      }
    }
    return { kind: 'act', action: 'scan-wipe', reason: 'Wipe scanner is actionable.' }
  }
  if (input.expectedStage === 'wipe-confirm' && metadata.wipeActionActionable) {
    return { kind: 'act', action: 'confirm-wipe', reason: 'Confirm Wipe is actionable.' }
  }
  if (input.expectedStage === 'wipe-confirm') {
    return { kind: 'wait', reason: 'Waiting for Confirm Wipe to become actionable.' }
  }
  if (input.expectedStage === 'wipe-transition') {
    if (!metadata.wipeActionActionable) {
      return { kind: 'wait', reason: 'Wipe remains visible but Confirm Wipe is not actionable.' }
    }
    if (input.retries.confirmWipe < WORKFLOW_RECOVERY_LIMITS.confirmWipeRetries) {
      return {
        kind: 'retry-transition',
        action: 'confirm-wipe',
        reason: 'Wipe remains actionable after transition reconciliation.',
      }
    }
    return input.retries.transitionTimedOut
      ? { kind: 'needs-review', reason: 'Confirm Wipe retry limit was exhausted.' }
      : { kind: 'wait', reason: 'Waiting for advancement after Confirm Wipe retry.' }
  }
  return { kind: 'needs-review', reason: 'Wipe state conflicts with confirmed workflow progress.' }
}

function reconcileDiagnostic(input: RuntimeReconciliationInput): RuntimeDecision {
  if (input.mode === 'EOL') {
    return { kind: 'needs-review', reason: 'Diagnostic is not valid for EOL.' }
  }
  const { metadata } = input.observation
  if (isBeforeDiagnostic(input.expectedStage)) {
    return {
      kind: 'skip-forward',
      expectedStage: 'diagnostic-scan',
      confirmedStage: 'wipe-confirmed',
      reason: 'MES already advanced beyond Wipe.',
    }
  }
  if (input.expectedStage === 'diagnostic-scan' && metadata.diagnosticInputActionable) {
    const actionAlreadyAvailable = input.mode === 'MRI'
      ? metadata.diagnosticPassActionable
      : metadata.diagnosticFailActionable
    if (metadata.diagnosticInputMatchesAsset && actionAlreadyAvailable) {
      return {
        kind: 'skip-forward',
        expectedStage: 'diagnostic-action',
        confirmedStage: 'diagnostic-scanned',
        reason: 'Diagnostic scan is already present; the scan is not replayed.',
      }
    }
    return { kind: 'act', action: 'scan-diagnostic', reason: 'Diagnostic scanner is actionable.' }
  }
  if (input.expectedStage === 'diagnostic-action') {
    if (input.mode === 'MRI' && metadata.diagnosticPassActionable) {
      return { kind: 'act', action: 'confirm-diagnostic', reason: 'Confirm Diagnostic is actionable.' }
    }
    if (input.mode === 'MRI_FAIL' && metadata.diagnosticFailActionable) {
      return { kind: 'act', action: 'click-diagnostic-failed', reason: 'Diagnostic Failed is actionable.' }
    }
    return { kind: 'wait', reason: 'Waiting for the mode-specific Diagnostic action.' }
  }
  if (input.expectedStage === 'diagnostic-transition') {
    return { kind: 'wait', reason: 'Waiting for the Diagnostic transition postcondition.' }
  }
  return { kind: 'needs-review', reason: 'Diagnostic state conflicts with workflow progress.' }
}

function isBeforeDiagnostic(stage: WorkflowExpectedStage): boolean {
  return stage === 'asset-submission' ||
    stage === 'start' ||
    stage === 'wipe-scan' ||
    stage === 'wipe-confirm' ||
    stage === 'wipe-transition'
}
