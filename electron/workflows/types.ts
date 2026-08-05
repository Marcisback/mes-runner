import type { Locator, Page } from 'playwright-core'
import type {
  RepairOutcome,
  RunnerDiagnosticSeverity,
  WorkflowMode,
} from '../../src/types/eolRunner'
import type {
  QueueHandoffAuthorization,
  WorkflowTerminalStage,
} from './queueHandoffCore'

export const WORKFLOW_TIMEOUTS = {
  defaultMs: 15_000,
  passiveObservationHardMs: 1_500,
  semanticProbeMs: 250,
  failureDialogMountMs: 2_000,
  popupPollMs: 250,
  scopedPollMs: 150,
  stopPollMs: 100,
  initialScannerMs: 15_000,
  startButtonMs: 15_000,
  startRecoveryCycleMs: 15_000,
  confirmWipeMs: 15_000,
  wipeTransitionMs: 60_000,
  recoveryPollMs: 250,
  confirmDiagnosticMs: 15_000,
  completionVerificationMs: 15_000,
  betweenAssetSuccessMs: 1_500,
  afterAssetSkipMs: 2_500,
  mriShortDelayMs: 250,
  mriFinalSettleMs: 500,
  repairSettleMs: 300,
  repairStagePollMs: 150,
  repairOptionalConfirmMs: 4_000,
  repairAdvanceMs: 10_000,
} as const

export const WORKFLOW_RECOVERY_LIMITS = {
  assetSubmissionEnterRetries: 2,
  startRecoveryCycles: 2,
  confirmWipeRetries: 1,
  semanticTargetAttempts: 3,
  semanticTargetBackoffMs: 150,
  targetDiagnosticDedupMs: 2_000,
} as const

export const SELECTORS = {
  firstScanText: /^Scan the asset tag or serial number to get started$/i,
  startButtonText: /^Start$/i,
  confirmWipeText: /Confirm\s+wipe/i,
  confirmDiagnosticText: /Confirm\s+diagnostic/i,
  repairFailedText: /^Repair failed$/i,
  confirmRepairText: /^Confirm\s+repair$/i,
} as const

export interface WorkflowOptions {
  mode: WorkflowMode
  repairOutcome: RepairOutcome
  repairLocator: string
  moveToRepairLocator: string
}

export interface WorkflowRuntime {
  page: Page
  options: WorkflowOptions
  checkpoint(): Promise<void>
  isStopRequested(): boolean
  ensurePageReady(): Promise<void>
  setStep(step: string): void
  completeStep(step: string): void
  log(
    severity: RunnerDiagnosticSeverity,
    message: string,
    details?: {
      errorClass?: string
      reason?: string
      assetId?: string
    },
  ): void
}

export interface AssetWorkflowContext extends WorkflowRuntime {
  assetId: string
  getQueueHandoff(): QueueHandoffAuthorization | null
  consumeQueueHandoff(): boolean
  clearQueueHandoff(reason: string): void
}

export interface VisibleInputResult {
  locator: Locator
}

export interface CompletionSignal {
  mode: WorkflowMode
  signal: string
  terminalStage: WorkflowTerminalStage
}
