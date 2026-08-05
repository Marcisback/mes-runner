import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveObservedState,
  type MesStateEvidence,
} from './mesRuntimeStateCore.ts'

function evidence(override: Partial<MesStateEvidence> = {}): MesStateEvidence {
  return {
    activeStates: [],
    startCount: 0,
    failureDialogCount: 0,
    moveToRepairCount: 0,
    businessError: false,
    initialState: 'ambiguous',
    initialCandidateCount: 0,
    initialEnabled: false,
    activeWorkflowPresent: false,
    completionProcessing: false,
    activeWorkflowAssetRelation: 'none',
    assetTagCandidateCount: 0,
    ...override,
  }
}

test('empty enabled initial scanner resolves landing', () => {
  assert.equal(resolveObservedState(evidence({
    initialState: 'initial-empty',
    initialCandidateCount: 1,
    initialEnabled: true,
  })), 'landing')
})

test('verified retained asset resolves independently of expected progress', () => {
  assert.equal(resolveObservedState(evidence({
    initialState: 'initial-asset',
    initialCandidateCount: 1,
  })), 'asset-retained')
})

test('one active scoped stage wins over supporting top-scanner evidence', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['wipe-processing'],
    initialState: 'initial-asset',
    initialCandidateCount: 1,
  })), 'wipe-processing')
})

test('persistent top scanner does not override active workflow states', () => {
  const shell = {
    initialState: 'initial-empty' as const,
    initialCandidateCount: 1,
    initialEnabled: true,
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'current' as const,
  }

  for (const state of [
    'start-ready',
    'wipe-ready',
    'wipe-processing',
    'diagnostic-ready',
    'failure-dialog',
    'move-to-repair',
  ] as const) {
    assert.equal(resolveObservedState(evidence({
      ...shell,
      activeStates: [state],
      startCount: state === 'start-ready' ? 1 : 0,
      failureDialogCount: state === 'failure-dialog' ? 1 : 0,
      moveToRepairCount: state === 'move-to-repair' ? 1 : 0,
    })), state)
  }
})

test('mounted workflow without an actionable stage is not landing', () => {
  assert.equal(resolveObservedState(evidence({
    initialState: 'initial-empty',
    initialCandidateCount: 1,
    initialEnabled: true,
    startCount: 1,
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'unknown',
  })), 'unknown')
  assert.equal(resolveObservedState(evidence({
    initialState: 'initial-empty',
    initialCandidateCount: 1,
    initialEnabled: true,
    completionProcessing: true,
  })), 'unknown')
})

test('persistent shell evidence does not make one workflow stage ambiguous', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['start-ready'],
    startCount: 1,
    initialState: 'initial-empty',
    initialCandidateCount: 2,
    initialEnabled: true,
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'current',
  })), 'start-ready')
})

test('foreign active WRO outranks scanner and actionable stage evidence', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['start-ready'],
    startCount: 1,
    initialState: 'initial-empty',
    initialCandidateCount: 1,
    initialEnabled: true,
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'different',
    assetTagCandidateCount: 1,
  })), 'active-workflow-mismatch')
})

test('unresolved active WRO fails closed and multiple Asset tags are ambiguous', () => {
  assert.equal(resolveObservedState(evidence({
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'unknown',
  })), 'unknown')
  assert.equal(resolveObservedState(evidence({
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'unknown',
    assetTagCandidateCount: 2,
  })), 'ambiguous')
})

test('failure dialog and Move-to-Repair cover their underlying Diagnostic stage', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['diagnostic-ready', 'failure-dialog'],
    failureDialogCount: 1,
  })), 'failure-dialog')
  assert.equal(resolveObservedState(evidence({
    activeStates: ['diagnostic-ready', 'move-to-repair'],
    moveToRepairCount: 1,
  })), 'move-to-repair')
})

test('conflicting active stages and duplicate targets are ambiguous', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['start-ready', 'wipe-ready'],
  })), 'ambiguous')
  assert.equal(resolveObservedState(evidence({ startCount: 2 })), 'ambiguous')
  assert.equal(resolveObservedState(evidence({ moveToRepairCount: 2 })), 'ambiguous')
})

test('Start outranks a present but not-started Wipe stage', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['start-ready', 'wipe-processing'],
    startCount: 1,
    activeWorkflowPresent: true,
    activeWorkflowAssetRelation: 'current',
  })), 'start-ready')
})

test('known business error takes precedence over the underlying stage', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['wipe-ready'],
    businessError: true,
  })), 'business-error')
})

test('no recognized safe evidence resolves unknown', () => {
  assert.equal(resolveObservedState(evidence()), 'unknown')
})
