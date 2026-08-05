import test from 'node:test'
import assert from 'node:assert/strict'
import type { MesObservationMetadata, MesObservedState } from './mesRuntimeState.ts'
import { formatObservationEvidence, runtimeHistoryKey } from './runtimeDiagnosticsCore.ts'

function metadata(): MesObservationMetadata {
  return {
    initialScanner: 'empty',
    initialScannerEnabled: true,
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
    activeStates: [],
  }
}

test('diagnostic evidence is sanitized counts and relations only', () => {
  assert.equal(formatObservationEvidence(metadata()), [
    'initialScannerVisible=true',
    'initialScannerValue=empty',
    'activeWorkflow=false',
    'activeAssetRelation=none',
    'assetTagLabelCandidates=0',
    'assetTagFieldContainers=0',
    'assetTagValidValues=0',
    'assetTagStrategy=asset-information-field-row',
    'startTargets=0',
    'wipeTargets=0',
    'diagnosticTargets=0',
    'failureDialogs=0',
    'moveToRepairTargets=0',
  ].join('; '))
})

test('every recognized state can produce sanitized diagnostic history', () => {
  const states: MesObservedState[] = [
    'landing', 'asset-retained', 'start-ready', 'wipe-ready', 'wipe-processing',
    'diagnostic-ready', 'diagnostic-processing', 'failure-dialog', 'move-to-repair',
    'workflow-completed', 'business-error', 'authentication-required',
    'browser-disconnected', 'active-workflow-mismatch', 'unknown', 'ambiguous',
  ]
  for (const state of states) {
    const key = runtimeHistoryKey(
      { state, metadata: metadata() },
      'awaiting-start',
      'start',
      'none',
      'submit-asset',
      { kind: 'wait', reason: 'test' },
    )
    assert.match(key, new RegExp(`^${state}\\|`))
    assert.doesNotMatch(key, /IT\d+/)
  }
})

test('identical polling observations produce the same deduplication key', () => {
  const observation = { state: 'landing' as const, metadata: metadata() }
  const decision = { kind: 'wait' as const, reason: 'waiting' }
  assert.equal(
    runtimeHistoryKey(observation, 'awaiting-submission', 'start', 'none', 'submit-asset', decision),
    runtimeHistoryKey(observation, 'awaiting-submission', 'start', 'none', 'submit-asset', decision),
  )
})
