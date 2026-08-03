import test from 'node:test'
import assert from 'node:assert/strict'
import { getWorkflowOperationPlan } from './workflowCompositionCore.ts'

test('EOL reuses shared Wipe Pass after starting the asset', () => {
  assert.deepEqual(getWorkflowOperationPlan('EOL'), [
    'startAsset',
    'runWipePass',
    'verifyEolCompletion',
  ])
})

test('MRI Pass reuses shared Wipe Pass and shared Diagnostic Pass', () => {
  assert.deepEqual(getWorkflowOperationPlan('MRI'), [
    'startAsset',
    'runWipePass',
    'runDiagnosticPass',
    'verifyMriCompletion',
  ])
})

test('MRI Fail preserves proven failure flow around shared Wipe Pass', () => {
  assert.deepEqual(getWorkflowOperationPlan('MRI_FAIL'), [
    'startAsset',
    'runWipePass',
    'scanDiagnosticAsset',
    'completeDiagnosticFailure',
    'moveToRepair',
    'verifyMoveToRepairCompletion',
  ])
})

test('Repair remains available with current dedicated workflow behavior', () => {
  assert.deepEqual(getWorkflowOperationPlan('REPAIR'), [])
})
