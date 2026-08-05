export type MesObservedState =
  | 'landing'
  | 'asset-retained'
  | 'start-ready'
  | 'wipe-ready'
  | 'wipe-processing'
  | 'diagnostic-ready'
  | 'diagnostic-processing'
  | 'failure-dialog'
  | 'move-to-repair'
  | 'workflow-completed'
  | 'business-error'
  | 'authentication-required'
  | 'browser-disconnected'
  | 'active-workflow-mismatch'
  | 'unknown'
  | 'ambiguous'

export interface MesStateEvidence {
  activeStates: MesObservedState[]
  startCount: number
  failureDialogCount: number
  moveToRepairCount: number
  businessError: boolean
  initialState: 'initial-empty' | 'initial-asset' | 'initial-unexpected' | 'ambiguous'
  initialCandidateCount: number
  initialEnabled: boolean
  activeWorkflowPresent: boolean
  completionProcessing: boolean
  activeWorkflowAssetRelation: import('./activeWorkflowAssetCore').ActiveWorkflowAssetRelation
  assetTagCandidateCount: number
}

export function resolveObservedState(evidence: MesStateEvidence): MesObservedState {
  if (
    evidence.startCount > 1 ||
    evidence.failureDialogCount > 1 ||
    evidence.moveToRepairCount > 1
  ) {
    return 'ambiguous'
  }
  if (evidence.businessError) return 'business-error'
  if (evidence.activeWorkflowAssetRelation === 'different') {
    return 'active-workflow-mismatch'
  }
  if (evidence.activeWorkflowAssetRelation === 'ambiguous') return 'ambiguous'
  if (
    evidence.activeWorkflowPresent &&
    evidence.activeWorkflowAssetRelation === 'unknown'
  ) {
    return evidence.assetTagCandidateCount > 1 ? 'ambiguous' : 'unknown'
  }
  if (evidence.failureDialogCount === 1) return 'failure-dialog'
  if (evidence.moveToRepairCount === 1) return 'move-to-repair'

  const activeStageStates = evidence.activeStates.filter(
    (state) => state !== 'failure-dialog' && state !== 'move-to-repair',
  )
  if (
    activeStageStates.length === 2 &&
    activeStageStates.includes('start-ready') &&
    activeStageStates.includes('wipe-processing')
  ) {
    return 'start-ready'
  }
  if (activeStageStates.length > 1) return 'ambiguous'
  if (activeStageStates.length === 1) return activeStageStates[0]
  if (evidence.initialCandidateCount > 1) return 'ambiguous'
  if (evidence.initialState === 'initial-asset') return 'asset-retained'
  if (
    evidence.initialState === 'initial-empty' &&
    evidence.initialCandidateCount === 1 &&
    evidence.initialEnabled &&
    !evidence.activeWorkflowPresent &&
    !evidence.completionProcessing
  ) {
    return 'landing'
  }
  return 'unknown'
}
