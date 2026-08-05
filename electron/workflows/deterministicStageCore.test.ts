import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSlowPassiveProbe,
  resolveStageControlState,
  resolveStageLoopIteration,
  shouldTimeoutPendingAction,
  stabilizeMriCompletion,
  type MesWorkflowStage,
  type StageControlEvidence,
  type StageLoopAction,
  type StageLoopMode,
} from './deterministicStageCore.ts'

function evidence(override: Partial<StageControlEvidence> = {}): StageControlEvidence {
  return {
    sectionCandidateCount: 1,
    scannerCandidateCount: 1,
    scannerValue: 'empty',
    scannerVisible: true,
    scannerEnabled: true,
    scannerEditable: true,
    buttonCandidateCount: 1,
    buttonEnabled: false,
    headingMatchCount: 1,
    ignoredTimelineLabelCount: 0,
    deduplicatedAncestorCandidateCount: 0,
    resolutionStrategy: 'nearest-actionable-control-bundle',
    ...override,
  }
}

test('Wipe Started with empty scanner is scan-ready despite disabled Confirm Wipe', () => {
  assert.equal(resolveStageControlState('Wipe', evidence()), 'wipe-scan-ready')
})

test('passive probe timing warns only above 500 ms', () => {
  assert.equal(isSlowPassiveProbe(500), false)
  assert.equal(isSlowPassiveProbe(501), true)
})

test('scanned Wipe with enabled confirmation is confirm-ready', () => {
  assert.equal(resolveStageControlState('Wipe', evidence({
    scannerValue: 'current',
    buttonEnabled: true,
  })), 'wipe-confirm-ready')
})

test('Diagnostic needs no Started badge and derives readiness from its scanner', () => {
  assert.equal(resolveStageControlState('Diagnostic', evidence()), 'diagnostic-scan-ready')
  assert.equal(resolveStageControlState('Diagnostic', evidence({
    scannerValue: 'current',
    buttonEnabled: true,
  })), 'diagnostic-pass-ready')
})

test('missing, disabled, or conflicting controls are not guessed as processing', () => {
  assert.equal(resolveStageControlState('Wipe', evidence({ scannerEditable: false })), 'transitioning')
  assert.equal(resolveStageControlState('Wipe', evidence({ sectionCandidateCount: 2 })), 'ambiguous')
  assert.equal(resolveStageControlState('Diagnostic', evidence({ scannerCandidateCount: 2 })), 'ambiguous')
})

test('scanned controls wait for their mode-specific action instead of rescanning', () => {
  assert.equal(resolveStageControlState('Wipe', evidence({
    scannerValue: 'current',
  })), 'wipe-awaiting-confirm')
  assert.equal(resolveStageControlState('Diagnostic', evidence({
    scannerValue: 'current',
  })), 'diagnostic-awaiting-action')
  assert.equal(resolveStageControlState('Diagnostic', evidence({
    scannerValue: 'current',
    buttonEnabled: true,
  }), 'fail'), 'diagnostic-fail-ready')
})

function runSequence(mode: StageLoopMode, stages: MesWorkflowStage[]): {
  actions: StageLoopAction[]
  completed: boolean
} {
  let owned = false
  let pending: StageLoopAction | null = null
  const actions: StageLoopAction[] = []
  let completed = false
  for (const stage of stages) {
    const iteration = resolveStageLoopIteration(mode, stage, owned, pending)
    if (iteration.acknowledged) pending = null
    if (iteration.decision.kind === 'act') {
      actions.push(iteration.decision.action)
      pending = iteration.decision.action
      if (pending === 'submit-asset') owned = true
    } else if (iteration.decision.kind === 'complete') {
      completed = true
    } else if (iteration.decision.kind === 'needs-review') {
      throw new Error(iteration.decision.reason)
    }
  }
  return { actions, completed }
}

test('scripted fresh MRI sequence drives every proven action once', () => {
  const result = runSequence('MRI', [
    'landing',
    'start-ready',
    'wipe-scan-ready',
    'wipe-confirm-ready',
    'diagnostic-scan-ready',
    'diagnostic-pass-ready',
    'mri-completed',
  ])
  assert.deepEqual(result.actions, [
    'submit-asset',
    'click-start',
    'scan-wipe-asset',
    'confirm-wipe',
    'scan-diagnostic-asset',
    'confirm-diagnostic',
  ])
  assert.equal(result.completed, true)
})

test('already-started MRI acknowledges submission at Wipe and scans it first', () => {
  assert.deepEqual(runSequence('MRI', ['landing', 'wipe-scan-ready']).actions, [
    'submit-asset',
    'scan-wipe-asset',
  ])
})

test('resume stages skip earlier actions without replay', () => {
  assert.deepEqual(runSequence('MRI', ['landing', 'wipe-confirm-ready']).actions, [
    'submit-asset',
    'confirm-wipe',
  ])
  assert.deepEqual(runSequence('MRI', ['landing', 'diagnostic-scan-ready']).actions, [
    'submit-asset',
    'scan-diagnostic-asset',
  ])
  assert.deepEqual(runSequence('MRI', ['landing', 'diagnostic-pass-ready']).actions, [
    'submit-asset',
    'confirm-diagnostic',
  ])
  assert.equal(runSequence('MRI', ['landing', 'mri-completed']).completed, true)
})

test('MRI Fail resumes at each proven later stage', () => {
  assert.deepEqual(runSequence('MRI_FAIL', ['landing', 'diagnostic-scan-ready']).actions, [
    'submit-asset',
    'scan-diagnostic-asset',
  ])
  assert.deepEqual(runSequence('MRI_FAIL', ['landing', 'diagnostic-fail-ready']).actions, [
    'submit-asset',
    'fail-diagnostic',
  ])
  assert.deepEqual(runSequence('MRI_FAIL', ['landing', 'failure-dialog']).actions, [
    'submit-asset',
    'complete-failure-dialog',
  ])
  assert.deepEqual(runSequence('MRI_FAIL', ['landing', 'move-to-repair']).actions, [
    'submit-asset',
    'complete-move-to-repair',
  ])
})

test('EOL normal and already-started Wipe paths complete without Diagnostic', () => {
  const normal = runSequence('EOL', [
    'landing',
    'start-ready',
    'wipe-scan-ready',
    'wipe-confirm-ready',
    'eol-completed',
  ])
  assert.deepEqual(normal.actions, [
    'submit-asset',
    'click-start',
    'scan-wipe-asset',
    'confirm-wipe',
  ])
  assert.equal(normal.completed, true)
  assert.deepEqual(runSequence('EOL', ['landing', 'wipe-scan-ready']).actions, [
    'submit-asset',
    'scan-wipe-asset',
  ])
})

test('forward stages acknowledge pending actions regardless of expected intermediate stage', () => {
  assert.equal(resolveStageLoopIteration('MRI', 'wipe-scan-ready', true, 'submit-asset').acknowledged, true)
  assert.equal(resolveStageLoopIteration('MRI', 'diagnostic-scan-ready', true, 'click-start').acknowledged, true)
  assert.equal(resolveStageLoopIteration('MRI', 'diagnostic-pass-ready', true, 'confirm-wipe').acknowledged, true)
  assert.equal(resolveStageLoopIteration('MRI', 'mri-completed', true, 'confirm-diagnostic').acknowledged, true)
})

test('MRI terminal postcondition is stabilized and accepted after a nominal deadline', () => {
  const first = stabilizeMriCompletion('mri-completed', 0)
  assert.deepEqual(first, {
    stage: 'transitioning',
    consecutiveObservations: 1,
    stabilizing: true,
  })
  assert.equal(shouldTimeoutPendingAction(false, first.stabilizing, true), false)

  const second = stabilizeMriCompletion('mri-completed', first.consecutiveObservations)
  const iteration = resolveStageLoopIteration(
    'MRI',
    second.stage,
    true,
    'confirm-diagnostic',
  )
  assert.equal(iteration.acknowledged, true)
  assert.equal(shouldTimeoutPendingAction(iteration.acknowledged, false, true), false)
  assert.equal(iteration.decision.kind, 'complete')
})

test('genuinely unresolved pending action still times out after its deadline', () => {
  const observation = stabilizeMriCompletion('diagnostic-awaiting-action', 0)
  const iteration = resolveStageLoopIteration(
    'MRI',
    observation.stage,
    true,
    'confirm-diagnostic',
  )
  assert.equal(iteration.acknowledged, false)
  assert.equal(
    shouldTimeoutPendingAction(iteration.acknowledged, observation.stabilizing, true),
    true,
  )
})

test('failure dialog acknowledges Diagnostic Failed exactly once and owns the next action', () => {
  const waiting = resolveStageLoopIteration(
    'MRI_FAIL',
    'diagnostic-fail-ready',
    true,
    'fail-diagnostic',
  )
  assert.equal(waiting.acknowledged, false)
  assert.equal(waiting.decision.kind, 'wait')

  const recognized = resolveStageLoopIteration(
    'MRI_FAIL',
    'failure-dialog',
    true,
    'fail-diagnostic',
  )
  assert.equal(recognized.acknowledged, true)
  assert.deepEqual(recognized.decision, {
    kind: 'act',
    action: 'complete-failure-dialog',
    reason: 'Failure dialog is ready.',
  })
})
