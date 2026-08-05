export type MesWorkflowStage =
  | 'landing'
  | 'asset-retained'
  | 'start-ready'
  | 'wipe-scan-ready'
  | 'wipe-awaiting-confirm'
  | 'wipe-confirm-ready'
  | 'diagnostic-scan-ready'
  | 'diagnostic-awaiting-action'
  | 'diagnostic-pass-ready'
  | 'diagnostic-fail-ready'
  | 'failure-dialog'
  | 'move-to-repair'
  | 'mri-completed'
  | 'eol-completed'
  | 'transitioning'
  | 'business-error'
  | 'authentication-required'
  | 'browser-disconnected'
  | 'unknown'
  | 'ambiguous'

export type StageLoopMode = 'EOL' | 'MRI' | 'MRI_FAIL'

export type StageLoopAction =
  | 'submit-asset'
  | 'press-enter'
  | 'click-start'
  | 'scan-wipe-asset'
  | 'confirm-wipe'
  | 'scan-diagnostic-asset'
  | 'confirm-diagnostic'
  | 'fail-diagnostic'
  | 'complete-failure-dialog'
  | 'complete-move-to-repair'

export type StageLoopDecision =
  | { kind: 'act'; action: StageLoopAction; reason: string }
  | { kind: 'wait'; reason: string }
  | { kind: 'complete'; reason: string }
  | { kind: 'needs-review'; reason: string }

export interface StageControlEvidence {
  sectionCandidateCount: number
  scannerCandidateCount: number
  scannerValue: 'empty' | 'current' | 'different' | 'unreadable'
  scannerVisible: boolean
  scannerEnabled: boolean
  scannerEditable: boolean
  buttonCandidateCount: number
  buttonEnabled: boolean
  headingMatchCount: number
  ignoredTimelineLabelCount: number
  deduplicatedAncestorCandidateCount: number
  resolutionStrategy: 'nearest-actionable-control-bundle'
}

export interface WorkflowSnapshotSignals {
  mode: StageLoopMode
  startCount: number
  startActionable: boolean
  wipe: MesWorkflowStage
  diagnostic: MesWorkflowStage
  initialState: 'initial-empty' | 'initial-asset' | 'initial-unexpected' | 'ambiguous'
  initialCount: number
  initialEnabled: boolean
  failureDialogCount: number
  moveToRepairCount: number
  mriCompletionCount: number
  activeWorkflowPresent: boolean
}

export function resolveSnapshotStage(signals: WorkflowSnapshotSignals): MesWorkflowStage {
  if (
    signals.failureDialogCount > 1 ||
    signals.moveToRepairCount > 1 ||
    signals.mriCompletionCount > 1 ||
    signals.startCount > 1 ||
    signals.wipe === 'ambiguous' ||
    signals.diagnostic === 'ambiguous' ||
    signals.initialCount > 1
  ) return 'ambiguous'
  if (signals.failureDialogCount === 1) return 'failure-dialog'
  if (signals.moveToRepairCount === 1) return 'move-to-repair'
  if (signals.mriCompletionCount === 1) return 'mri-completed'
  if (isDiagnosticStage(signals.diagnostic)) return signals.diagnostic
  if (isWipeStage(signals.wipe)) return signals.wipe
  if (signals.startActionable && signals.startCount === 1) return 'start-ready'
  if (!signals.activeWorkflowPresent && signals.initialCount === 1 && signals.initialEnabled) {
    if (signals.initialState === 'initial-empty') return 'landing'
    if (signals.initialState === 'initial-asset') return 'asset-retained'
  }
  if (signals.activeWorkflowPresent) return 'transitioning'
  return signals.initialState === 'ambiguous' || signals.initialState === 'initial-unexpected'
    ? 'ambiguous'
    : 'unknown'
}

function isWipeStage(stage: MesWorkflowStage): boolean {
  return stage === 'wipe-scan-ready' ||
    stage === 'wipe-awaiting-confirm' ||
    stage === 'wipe-confirm-ready'
}

function isDiagnosticStage(stage: MesWorkflowStage): boolean {
  return stage === 'diagnostic-scan-ready' ||
    stage === 'diagnostic-awaiting-action' ||
    stage === 'diagnostic-pass-ready' ||
    stage === 'diagnostic-fail-ready'
}

export function resolveStageControlState(
  stage: 'Wipe' | 'Diagnostic',
  evidence: StageControlEvidence,
  diagnosticAction: 'pass' | 'fail' = 'pass',
): MesWorkflowStage {
  if (
    evidence.sectionCandidateCount > 1 ||
    evidence.scannerCandidateCount > 1 ||
    evidence.buttonCandidateCount > 1
  ) {
    return 'ambiguous'
  }
  if (
    evidence.sectionCandidateCount !== 1 ||
    evidence.scannerCandidateCount !== 1 ||
    !evidence.scannerVisible
  ) {
    return 'unknown'
  }
  if (
    evidence.scannerValue === 'empty' &&
    evidence.scannerEnabled &&
    evidence.scannerEditable
  ) {
    return stage === 'Wipe' ? 'wipe-scan-ready' : 'diagnostic-scan-ready'
  }
  if (evidence.scannerValue === 'current') {
    if (evidence.buttonCandidateCount === 1 && evidence.buttonEnabled) {
      if (stage === 'Wipe') return 'wipe-confirm-ready'
      return diagnosticAction === 'pass'
        ? 'diagnostic-pass-ready'
        : 'diagnostic-fail-ready'
    }
    return stage === 'Wipe'
      ? 'wipe-awaiting-confirm'
      : 'diagnostic-awaiting-action'
  }
  return evidence.scannerValue === 'different' ? 'ambiguous' : 'transitioning'
}

export function decideStageAction(
  mode: StageLoopMode,
  stage: MesWorkflowStage,
  submissionOwned: boolean,
): StageLoopDecision {
  switch (stage) {
    case 'landing':
      return submissionOwned
        ? { kind: 'wait', reason: 'Waiting for MES to expose the submitted workflow.' }
        : { kind: 'act', action: 'submit-asset', reason: 'Verified clean landing is ready.' }
    case 'asset-retained':
      return { kind: 'wait', reason: 'Submitted asset remains in the initial scanner.' }
    case 'start-ready':
      return { kind: 'act', action: 'click-start', reason: 'Start is uniquely actionable.' }
    case 'wipe-scan-ready':
      return { kind: 'act', action: 'scan-wipe-asset', reason: 'Scoped Wipe scanner is actionable.' }
    case 'wipe-awaiting-confirm':
      return { kind: 'wait', reason: 'Waiting for Confirm Wipe to enable.' }
    case 'wipe-confirm-ready':
      return { kind: 'act', action: 'confirm-wipe', reason: 'Confirm Wipe is uniquely actionable.' }
    case 'diagnostic-scan-ready':
      return mode === 'EOL'
        ? { kind: 'needs-review', reason: 'Diagnostic is not valid for EOL.' }
        : { kind: 'act', action: 'scan-diagnostic-asset', reason: 'Scoped Diagnostic scanner is actionable.' }
    case 'diagnostic-awaiting-action':
      return mode === 'EOL'
        ? { kind: 'needs-review', reason: 'Diagnostic is not valid for EOL.' }
        : { kind: 'wait', reason: 'Waiting for the mode-specific Diagnostic action.' }
    case 'diagnostic-pass-ready':
      return mode === 'MRI'
        ? { kind: 'act', action: 'confirm-diagnostic', reason: 'Confirm Diagnostic is uniquely actionable.' }
        : { kind: 'needs-review', reason: 'Diagnostic pass is invalid for this workflow mode.' }
    case 'diagnostic-fail-ready':
      return mode === 'MRI_FAIL'
        ? { kind: 'act', action: 'fail-diagnostic', reason: 'Diagnostic Failed is uniquely actionable.' }
        : { kind: 'needs-review', reason: 'Diagnostic failure is invalid for this workflow mode.' }
    case 'failure-dialog':
      return mode === 'MRI_FAIL'
        ? { kind: 'act', action: 'complete-failure-dialog', reason: 'Failure dialog is ready.' }
        : { kind: 'needs-review', reason: 'Failure dialog is invalid for this workflow mode.' }
    case 'move-to-repair':
      return mode === 'MRI_FAIL'
        ? { kind: 'act', action: 'complete-move-to-repair', reason: 'Move-to-Repair is ready.' }
        : { kind: 'needs-review', reason: 'Move-to-Repair is invalid for this workflow mode.' }
    case 'mri-completed':
      return mode === 'MRI'
        ? { kind: 'complete', reason: 'Move to storage is stably visible.' }
        : { kind: 'needs-review', reason: mode === 'MRI_FAIL'
          ? 'Generic MRI completion appeared before Move-to-Repair was confirmed.'
          : 'MRI completion is invalid for EOL.' }
    case 'eol-completed':
      return mode === 'EOL'
        ? { kind: 'complete', reason: 'EOL completion is verified.' }
        : { kind: 'needs-review', reason: 'EOL completion is invalid for this workflow mode.' }
    case 'transitioning':
    case 'unknown':
      return { kind: 'wait', reason: 'Waiting for a proven actionable stage.' }
    case 'ambiguous':
      return { kind: 'needs-review', reason: 'MES exposes conflicting actionable controls.' }
    case 'business-error':
      return { kind: 'wait', reason: 'Known business popup is handled before reconciliation.' }
    case 'authentication-required':
    case 'browser-disconnected':
      return { kind: 'wait', reason: 'Browser lifecycle interruption is handled by the runner.' }
  }
}

const STAGE_RANK: Record<MesWorkflowStage, number> = {
  landing: 0,
  'asset-retained': 0,
  'start-ready': 1,
  'wipe-scan-ready': 2,
  'wipe-awaiting-confirm': 3,
  'wipe-confirm-ready': 3,
  'diagnostic-scan-ready': 4,
  'diagnostic-awaiting-action': 5,
  'diagnostic-pass-ready': 5,
  'diagnostic-fail-ready': 5,
  'failure-dialog': 6,
  'move-to-repair': 7,
  'mri-completed': 8,
  'eol-completed': 8,
  transitioning: -1,
  'business-error': -1,
  'authentication-required': -1,
  'browser-disconnected': -1,
  unknown: -1,
  ambiguous: -1,
}

const ACTION_RANK: Record<StageLoopAction, number> = {
  'submit-asset': 0,
  'press-enter': 0,
  'click-start': 1,
  'scan-wipe-asset': 2,
  'confirm-wipe': 3,
  'scan-diagnostic-asset': 4,
  'confirm-diagnostic': 5,
  'fail-diagnostic': 5,
  'complete-failure-dialog': 6,
  'complete-move-to-repair': 7,
}

export function stageAcknowledgesAction(
  action: StageLoopAction,
  stage: MesWorkflowStage,
): boolean {
  if (action === 'scan-wipe-asset' && stage === 'wipe-awaiting-confirm') return true
  if (action === 'scan-diagnostic-asset' && stage === 'diagnostic-awaiting-action') return true
  return STAGE_RANK[stage] > ACTION_RANK[action]
}

export function resolveStageLoopIteration(
  mode: StageLoopMode,
  stage: MesWorkflowStage,
  submissionOwned: boolean,
  pendingAction: StageLoopAction | null,
): { acknowledged: boolean; decision: StageLoopDecision } {
  const acknowledged = pendingAction !== null && stageAcknowledgesAction(pendingAction, stage)
  if (pendingAction !== null && !acknowledged) {
    return {
      acknowledged: false,
      decision: { kind: 'wait', reason: `Waiting for ${pendingAction} postcondition.` },
    }
  }
  return {
    acknowledged,
    decision: decideStageAction(mode, stage, submissionOwned),
  }
}

export function isSlowPassiveProbe(durationMs: number): boolean {
  return durationMs > 500
}

export function stabilizeMriCompletion(
  observedStage: MesWorkflowStage,
  consecutiveObservations: number,
): {
  stage: MesWorkflowStage
  consecutiveObservations: number
  stabilizing: boolean
} {
  if (observedStage !== 'mri-completed') {
    return { stage: observedStage, consecutiveObservations: 0, stabilizing: false }
  }
  const nextCount = consecutiveObservations + 1
  return {
    stage: nextCount < 2 ? 'transitioning' : 'mri-completed',
    consecutiveObservations: nextCount,
    stabilizing: nextCount < 2,
  }
}

export function shouldTimeoutPendingAction(
  acknowledged: boolean,
  completionStabilizing: boolean,
  deadlineReached: boolean,
): boolean {
  return deadlineReached && !acknowledged && !completionStabilizing
}
