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

test('known business error takes precedence over the underlying stage', () => {
  assert.equal(resolveObservedState(evidence({
    activeStates: ['wipe-ready'],
    businessError: true,
  })), 'business-error')
})

test('no recognized safe evidence resolves unknown', () => {
  assert.equal(resolveObservedState(evidence()), 'unknown')
})
