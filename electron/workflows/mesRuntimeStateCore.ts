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
}

export function resolveObservedState(evidence: MesStateEvidence): MesObservedState {
  if (
    evidence.startCount > 1 ||
    evidence.failureDialogCount > 1 ||
    evidence.moveToRepairCount > 1 ||
    evidence.initialCandidateCount > 1
  ) {
    return 'ambiguous'
  }
  if (evidence.businessError) return 'business-error'
  if (evidence.failureDialogCount === 1) return 'failure-dialog'
  if (evidence.moveToRepairCount === 1) return 'move-to-repair'

  const activeStageStates = evidence.activeStates.filter(
    (state) => state !== 'failure-dialog' && state !== 'move-to-repair',
  )
  if (activeStageStates.length > 1) return 'ambiguous'
  if (activeStageStates.length === 1) return activeStageStates[0]
  if (evidence.initialState === 'initial-asset') return 'asset-retained'
  if (evidence.initialState === 'initial-empty' && evidence.initialEnabled) {
    return 'landing'
  }
  return 'unknown'
}
