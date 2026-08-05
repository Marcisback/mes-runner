import test from 'node:test'
import assert from 'node:assert/strict'
import type { WorkflowMode } from '../../src/types/eolRunner.ts'
import type { MesObservation, MesObservedState } from './mesRuntimeState.ts'
import {
  reconcileRuntimeState,
  getRuntimeActionPostconditions,
  type RuntimeReconciliationInput,
} from './runtimeReconciliation.ts'

function observation(
  state: MesObservedState,
  metadata: Partial<MesObservation['metadata']> = {},
): MesObservation {
  return {
    state,
    metadata: {
      initialScanner: 'absent',
      initialScannerEnabled: false,
      startAvailable: false,
      startTargetCount: 0,
      wipeTargetCount: 0,
      diagnosticTargetCount: 0,
      wipeInputActionable: false,
      wipeActionActionable: false,
      wipeInputMatchesAsset: false,
      diagnosticInputActionable: false,
      diagnosticPassActionable: false,
      diagnosticFailActionable: false,
      diagnosticInputMatchesAsset: false,
      failureDialogCount: 0,
      moveToRepairCount: 0,
      activeWorkflowPresent: false,
      completionProcessing: false,
      activeWorkflowAssetRelation: 'none',
      activeWorkflowAssetTagResolved: false,
      activeWorkflowAssetTagCandidateCount: 0,
      activeWorkflowAssetFieldContainerCount: 0,
      activeWorkflowAssetValidValueCandidateCount: 0,
      activeWorkflowAssetResolutionStrategy: 'asset-information-field-row',
      activeStates: [state],
      ...metadata,
    },
  }
}

function input(
  state: MesObservedState,
  override: Partial<RuntimeReconciliationInput> = {},
): RuntimeReconciliationInput {
  return {
    mode: 'EOL',
    observation: observation(state),
    expectedStage: 'asset-submission',
    lastConfirmedStage: 'none',
    pendingAction: null,
    retries: { assetEnter: 0, confirmWipe: 0, transitionTimedOut: false },
    interruption: {
      paused: false,
      stopRequested: false,
      authenticationRequired: false,
      browserDisconnected: false,
    },
    ...override,
  }
}

function actionFor(
  mode: WorkflowMode,
  state: MesObservedState,
  override: Partial<RuntimeReconciliationInput> = {},
): string {
  const decision = reconcileRuntimeState(input(state, { mode, ...override }))
  return decision.kind === 'act' || decision.kind === 'retry-transition'
    ? `${decision.kind}:${decision.action}`
    : decision.kind
}

test('normal EOL progression selects each safe action', () => {
  assert.equal(actionFor('EOL', 'landing'), 'act:submit-asset')
  assert.equal(actionFor('EOL', 'start-ready', { expectedStage: 'start' }), 'act:click-start')
  assert.equal(actionFor('EOL', 'wipe-ready', {
    expectedStage: 'wipe-scan',
    observation: observation('wipe-ready', { wipeInputActionable: true }),
  }), 'act:scan-wipe')
  assert.equal(actionFor('EOL', 'wipe-ready', {
    expectedStage: 'wipe-confirm',
    observation: observation('wipe-ready', { wipeActionActionable: true }),
  }), 'act:confirm-wipe')
  assert.equal(reconcileRuntimeState(input('landing', {
    expectedStage: 'completion',
    lastConfirmedStage: 'wipe-confirmed',
  })).kind, 'complete')
})

test('EOL already at Wipe skips Start without replay', () => {
  const result = reconcileRuntimeState(input('wipe-ready', { expectedStage: 'start' }))
  assert.equal(result.kind, 'skip-forward')
})

test('EOL already completed requires confirmed Wipe', () => {
  assert.equal(reconcileRuntimeState(input('workflow-completed', {
    expectedStage: 'completion',
    lastConfirmedStage: 'wipe-confirmed',
  })).kind, 'complete')
})

test('normal MRI Pass selects Diagnostic scan and pass', () => {
  assert.equal(actionFor('MRI', 'diagnostic-ready', {
    expectedStage: 'diagnostic-scan',
    observation: observation('diagnostic-ready', { diagnosticInputActionable: true }),
  }), 'act:scan-diagnostic')
  assert.equal(actionFor('MRI', 'diagnostic-ready', {
    expectedStage: 'diagnostic-action',
    observation: observation('diagnostic-ready', { diagnosticPassActionable: true }),
  }), 'act:confirm-diagnostic')
})

test('MRI active WRO with persistent scanner selects Start', () => {
  assert.equal(actionFor('MRI', 'start-ready', {
    expectedStage: 'start',
    observation: observation('start-ready', {
      initialScanner: 'empty',
      initialScannerEnabled: true,
      startAvailable: true,
      activeWorkflowPresent: true,
      activeWorkflowAssetRelation: 'current',
      activeWorkflowAssetTagResolved: true,
      activeWorkflowAssetTagCandidateCount: 1,
    }),
  }), 'act:click-start')
})

test('landing after Submit Asset waits for acknowledgement until deadline', () => {
  const pending = {
    mode: 'MRI' as const,
    expectedStage: 'start' as const,
    lastConfirmedStage: 'none' as const,
    pendingAction: 'submit-asset' as const,
  }
  assert.equal(reconcileRuntimeState(input('landing', {
    ...pending,
    retries: { assetEnter: 0, confirmWipe: 0, transitionTimedOut: false },
  })).kind, 'wait')

  const timedOut = reconcileRuntimeState(input('landing', {
    ...pending,
    retries: { assetEnter: 0, confirmWipe: 0, transitionTimedOut: true },
  }))
  assert.equal(timedOut.kind, 'needs-review')
  assert.match(timedOut.reason, /asset-submission transition timed out/)
})

test('Submit Asset completes only on a forward acknowledgement state', () => {
  const postconditions = getRuntimeActionPostconditions('submit-asset')
  assert.equal(postconditions.includes('landing'), false)
  assert.equal(postconditions.includes('start-ready'), true)
  assert.equal(postconditions.includes('wipe-ready'), true)
  assert.equal(postconditions.includes('diagnostic-ready'), true)
})

test('forward states after Submit Asset continue without resubmission', () => {
  const pending = {
    mode: 'MRI' as const,
    expectedStage: 'start' as const,
    lastConfirmedStage: 'none' as const,
    pendingAction: 'submit-asset' as const,
  }
  assert.equal(actionFor('MRI', 'start-ready', pending), 'act:click-start')
  assert.equal(reconcileRuntimeState(input('wipe-ready', pending)).kind, 'skip-forward')
  assert.equal(reconcileRuntimeState(input('wipe-processing', pending)).kind, 'skip-forward')
  assert.equal(reconcileRuntimeState(input('diagnostic-ready', pending)).kind, 'skip-forward')
  assert.equal(reconcileRuntimeState(input('diagnostic-processing', pending)).kind, 'skip-forward')
})

test('premature landing remains unsafe after genuine workflow entry', () => {
  const result = reconcileRuntimeState(input('landing', {
    mode: 'MRI',
    expectedStage: 'wipe-scan',
    lastConfirmedStage: 'start-confirmed',
    pendingAction: null,
  }))
  assert.equal(result.kind, 'needs-review')
  assert.match(result.reason, /required final transition/)
})

test('foreign active WRO stops without selecting an action', () => {
  const result = reconcileRuntimeState(input('active-workflow-mismatch', {
    mode: 'MRI',
    expectedStage: 'asset-submission',
    observation: observation('active-workflow-mismatch', {
      initialScanner: 'empty',
      initialScannerEnabled: true,
      startAvailable: true,
      activeWorkflowPresent: true,
      activeWorkflowAssetRelation: 'different',
      activeWorkflowAssetTagResolved: true,
      activeWorkflowAssetTagCandidateCount: 1,
    }),
  }))
  assert.equal(result.kind, 'needs-review')
  assert.equal(result.reason, 'MES already has an active workflow for a different asset. Finish or exit that workflow before continuing.')
})

test('unmatched active WRO stops before submission', () => {
  const result = reconcileRuntimeState(input('unknown', {
    observation: observation('unknown', {
      activeWorkflowPresent: true,
      activeWorkflowAssetRelation: 'unknown',
    }),
  }))
  assert.equal(result.kind, 'needs-review')
  assert.match(result.reason, /Asset tag could not be matched safely/)
})

test('pending submission waits for transient active-workflow identification', () => {
  const metadata = {
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'unknown' as const,
    startTargetCount: 1,
    wipeTargetCount: 1,
  }
  const waiting = reconcileRuntimeState(input('unknown', {
    mode: 'MRI',
    expectedStage: 'start',
    lastConfirmedStage: 'none',
    pendingAction: 'submit-asset',
    observation: observation('unknown', metadata),
  }))
  assert.equal(waiting.kind, 'wait')
  assert.match(waiting.reason, /waiting for Asset tag identification/)

  const timedOut = reconcileRuntimeState(input('unknown', {
    mode: 'MRI',
    expectedStage: 'start',
    lastConfirmedStage: 'none',
    pendingAction: 'submit-asset',
    observation: observation('unknown', metadata),
    retries: { assetEnter: 0, confirmWipe: 0, transitionTimedOut: true },
  }))
  assert.equal(timedOut.kind, 'needs-review')
  assert.match(timedOut.reason, /identification timeout/)
})

test('reported landing to identification to Start sequence advances safely', () => {
  const pending = {
    mode: 'MRI' as const,
    expectedStage: 'start' as const,
    lastConfirmedStage: 'none' as const,
    pendingAction: 'submit-asset' as const,
  }
  assert.equal(reconcileRuntimeState(input('landing', pending)).kind, 'wait')
  assert.equal(reconcileRuntimeState(input('unknown', {
    ...pending,
    observation: observation('unknown', {
      activeWorkflowPresent: true,
      activeWorkflowAssetRelation: 'unknown',
      startTargetCount: 1,
      wipeTargetCount: 1,
    }),
  })).kind, 'wait')
  assert.equal(actionFor('MRI', 'start-ready', {
    ...pending,
    observation: observation('start-ready', {
      activeWorkflowPresent: true,
      activeWorkflowAssetRelation: 'current',
      activeWorkflowAssetTagResolved: true,
      activeWorkflowAssetTagCandidateCount: 1,
      activeWorkflowAssetFieldContainerCount: 1,
      activeWorkflowAssetValidValueCandidateCount: 1,
      startAvailable: true,
      startTargetCount: 1,
      wipeTargetCount: 1,
    }),
  }), 'act:click-start')
})

test('MRI Pass already at Diagnostic skips Wipe', () => {
  assert.equal(reconcileRuntimeState(input('diagnostic-ready', {
    mode: 'MRI',
    expectedStage: 'wipe-transition',
  })).kind, 'skip-forward')
})

test('delayed Wipe-to-Diagnostic processing waits without replay', () => {
  assert.equal(reconcileRuntimeState(input('wipe-processing', {
    mode: 'MRI',
    expectedStage: 'wipe-transition',
    pendingAction: 'confirm-wipe',
  })).kind, 'wait')
})

test('normal MRI Fail chooses Diagnostic Failed', () => {
  assert.equal(actionFor('MRI_FAIL', 'diagnostic-ready', {
    expectedStage: 'diagnostic-action',
    observation: observation('diagnostic-ready', { diagnosticFailActionable: true }),
  }), 'act:click-diagnostic-failed')
})

test('MRI Fail existing failure dialog does not replay Diagnostic Failed', () => {
  assert.equal(actionFor('MRI_FAIL', 'failure-dialog', {
    expectedStage: 'diagnostic-action',
  }), 'act:complete-failure-dialog')
})

test('MRI Fail existing Move-to-Repair skips earlier failure actions', () => {
  assert.equal(actionFor('MRI_FAIL', 'move-to-repair', {
    expectedStage: 'failure-dialog',
  }), 'act:complete-move-to-repair')
})

test('MRI Fail premature generic completion needs review', () => {
  assert.equal(reconcileRuntimeState(input('landing', {
    mode: 'MRI_FAIL',
    expectedStage: 'completion',
    lastConfirmedStage: 'failure-confirmed',
  })).kind, 'needs-review')
})

test('mode-specific confirmed completion remains accepted', () => {
  assert.equal(reconcileRuntimeState(input('landing', {
    mode: 'EOL',
    expectedStage: 'completion',
    lastConfirmedStage: 'wipe-confirmed',
  })).kind, 'complete')
  assert.equal(reconcileRuntimeState(input('landing', {
    mode: 'MRI',
    expectedStage: 'completion',
    lastConfirmedStage: 'diagnostic-confirmed',
  })).kind, 'complete')
  assert.equal(reconcileRuntimeState(input('landing', {
    mode: 'MRI_FAIL',
    expectedStage: 'completion',
    lastConfirmedStage: 'move-confirmed',
  })).kind, 'complete')
})

test('retained asset uses two bounded Enter retries', () => {
  assert.equal(actionFor('EOL', 'asset-retained', {
    expectedStage: 'start',
    retries: { assetEnter: 0, confirmWipe: 0, transitionTimedOut: true },
  }), 'retry-transition:press-enter')
  assert.equal(reconcileRuntimeState(input('asset-retained', {
    expectedStage: 'start',
    retries: { assetEnter: 2, confirmWipe: 0, transitionTimedOut: true },
  })).kind, 'needs-review')
})

test('Start already completed skips forward to Wipe', () => {
  assert.equal(reconcileRuntimeState(input('wipe-ready', {
    expectedStage: 'start',
    pendingAction: 'click-start',
  })).kind, 'skip-forward')
})

test('busy stages wait without duplicate actions', () => {
  assert.equal(reconcileRuntimeState(input('wipe-processing', {
    expectedStage: 'wipe-transition',
  })).kind, 'wait')
  assert.equal(reconcileRuntimeState(input('diagnostic-processing', {
    mode: 'MRI',
    expectedStage: 'diagnostic-action',
  })).kind, 'wait')
})

test('authentication interruption and later resume re-evaluate current state', () => {
  assert.equal(reconcileRuntimeState(input('start-ready', {
    interruption: {
      paused: false,
      stopRequested: false,
      authenticationRequired: true,
      browserDisconnected: false,
    },
  })).kind, 'authentication-required')
  assert.equal(actionFor('EOL', 'wipe-ready', { expectedStage: 'start' }), 'skip-forward')
})

test('browser disconnection is terminal for reconciliation', () => {
  assert.equal(reconcileRuntimeState(input('browser-disconnected')).kind, 'disconnected')
})

test('known business popup selects only safe popup handling', () => {
  assert.equal(actionFor('EOL', 'business-error'), 'act:handle-business-error')
})

test('Pause and Stop Safely prevent a new action', () => {
  assert.equal(reconcileRuntimeState(input('start-ready', {
    interruption: { paused: true, stopRequested: false, authenticationRequired: false, browserDisconnected: false },
  })).kind, 'paused')
  assert.equal(reconcileRuntimeState(input('start-ready', {
    interruption: { paused: false, stopRequested: true, authenticationRequired: false, browserDisconnected: false },
  })).kind, 'stopped')
})

test('unknown and conflicting states fail closed', () => {
  assert.equal(reconcileRuntimeState(input('unknown')).kind, 'needs-review')
  assert.equal(reconcileRuntimeState(input('ambiguous')).kind, 'needs-review')
})

test('Confirm Wipe retry exhausts without replaying after advancement', () => {
  assert.equal(actionFor('MRI', 'wipe-ready', {
    expectedStage: 'wipe-transition',
    observation: observation('wipe-ready', { wipeActionActionable: true }),
  }), 'retry-transition:confirm-wipe')
  assert.equal(reconcileRuntimeState(input('wipe-ready', {
    mode: 'MRI',
    expectedStage: 'wipe-transition',
    observation: observation('wipe-ready', { wipeActionActionable: true }),
    retries: { assetEnter: 0, confirmWipe: 1, transitionTimedOut: true },
  })).kind, 'needs-review')
  assert.equal(reconcileRuntimeState(input('diagnostic-ready', {
    mode: 'MRI',
    expectedStage: 'wipe-transition',
    retries: { assetEnter: 0, confirmWipe: 1, transitionTimedOut: false },
  })).kind, 'skip-forward')
})

test('already-scanned Wipe and Diagnostic inputs are never replayed', () => {
  assert.equal(reconcileRuntimeState(input('wipe-ready', {
    mode: 'MRI',
    expectedStage: 'wipe-scan',
    observation: observation('wipe-ready', {
      wipeInputActionable: true,
      wipeActionActionable: true,
      wipeInputMatchesAsset: true,
    }),
  })).kind, 'skip-forward')
  assert.equal(reconcileRuntimeState(input('diagnostic-ready', {
    mode: 'MRI_FAIL',
    expectedStage: 'diagnostic-scan',
    observation: observation('diagnostic-ready', {
      diagnosticInputActionable: true,
      diagnosticFailActionable: true,
      diagnosticInputMatchesAsset: true,
    }),
  })).kind, 'skip-forward')
})
