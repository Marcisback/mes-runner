import type { MesObservation, MesObservationMetadata } from './mesRuntimeState'
import type { RuntimeDecision } from './runtimeReconciliation'

export function formatObservationEvidence(
  metadata: MesObservationMetadata,
): string {
  return [
    `initialScannerVisible=${metadata.initialScanner !== 'absent'}`,
    `initialScannerValue=${formatInitialValue(metadata.initialScanner)}`,
    `activeWorkflow=${metadata.activeWorkflowPresent}`,
    `activeAssetRelation=${metadata.activeWorkflowAssetRelation}`,
    `assetTagLabelCandidates=${metadata.activeWorkflowAssetTagCandidateCount}`,
    `assetTagFieldContainers=${metadata.activeWorkflowAssetFieldContainerCount}`,
    `assetTagValidValues=${metadata.activeWorkflowAssetValidValueCandidateCount}`,
    `assetTagStrategy=${metadata.activeWorkflowAssetResolutionStrategy}`,
    `startTargets=${metadata.startTargetCount}`,
    `wipeTargets=${metadata.wipeTargetCount}`,
    `diagnosticTargets=${metadata.diagnosticTargetCount}`,
    `failureDialogs=${metadata.failureDialogCount}`,
    `moveToRepairTargets=${metadata.moveToRepairCount}`,
  ].join('; ')
}

export function runtimeHistoryKey(
  observation: MesObservation,
  runnerState: string,
  expectedStage: string,
  lastConfirmedStage: string,
  pendingTransition: string,
  decision: RuntimeDecision,
): string {
  const action = 'action' in decision ? decision.action : 'none'
  return [
    observation.state,
    runnerState,
    expectedStage,
    lastConfirmedStage,
    pendingTransition,
    decision.kind,
    action,
    formatObservationEvidence(observation.metadata),
  ].join('|')
}

function formatInitialValue(
  state: MesObservationMetadata['initialScanner'],
): 'current' | 'empty' | 'different' | 'absent' | 'unknown' {
  switch (state) {
    case 'expected-asset': return 'current'
    case 'empty': return 'empty'
    case 'unexpected-value': return 'different'
    case 'absent': return 'absent'
    case 'unreadable': return 'unknown'
  }
}
