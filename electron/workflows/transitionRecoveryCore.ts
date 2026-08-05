export const WORKFLOW_RECOVERY_LIMITS = {
  assetSubmissionEnterRetries: 2,
  startRecoveryCycles: 2,
  confirmWipeRetries: 1,
  semanticTargetAttempts: 3,
  semanticTargetBackoffMs: 150,
  targetDiagnosticDedupMs: 2_000,
} as const

export type ReconciledWorkflowState =
  | 'initial-empty'
  | 'initial-asset'
  | 'initial-unexpected'
  | 'start-available'
  | 'wipe-actionable'
  | 'wipe-processing'
  | 'diagnostic'
  | 'completed'
  | 'ambiguous'

export type StartRecoveryDecision =
  | 'click-start'
  | 'press-enter'
  | 'continue-wipe'
  | 'continue-diagnostic'
  | 'continue-completed'
  | 'wait'
  | 'fail'

export function decideStartRecovery(
  state: ReconciledWorkflowState,
  enterRetriesUsed: number,
): StartRecoveryDecision {
  switch (state) {
    case 'start-available':
      return 'click-start'
    case 'initial-asset':
      return enterRetriesUsed < WORKFLOW_RECOVERY_LIMITS.assetSubmissionEnterRetries
        ? 'press-enter'
        : 'fail'
    case 'wipe-actionable':
    case 'wipe-processing':
      return 'continue-wipe'
    case 'diagnostic':
      return 'continue-diagnostic'
    case 'completed':
      return 'continue-completed'
    case 'initial-empty':
    case 'initial-unexpected':
    case 'ambiguous':
      return 'fail'
  }
}

export type WipeRecoveryDecision =
  | 'continue-diagnostic'
  | 'continue-completed'
  | 'retry-confirm'
  | 'wait'
  | 'fail'

export function decideWipeRecovery(
  state: ReconciledWorkflowState,
  confirmRetriesUsed: number,
  transitionTimedOut = false,
): WipeRecoveryDecision {
  switch (state) {
    case 'diagnostic':
      return 'continue-diagnostic'
    case 'completed':
      return 'continue-completed'
    case 'wipe-processing':
      return 'wait'
    case 'wipe-actionable':
      if (confirmRetriesUsed < WORKFLOW_RECOVERY_LIMITS.confirmWipeRetries) {
        return 'retry-confirm'
      }
      return transitionTimedOut ? 'fail' : 'wait'
    case 'initial-empty':
    case 'initial-asset':
    case 'initial-unexpected':
    case 'start-available':
    case 'ambiguous':
      return 'fail'
  }
}
