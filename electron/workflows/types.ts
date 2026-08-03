import type { Locator, Page } from 'playwright-core'
import type {
  RepairOutcome,
  RunnerDiagnosticSeverity,
  WorkflowMode,
} from '../../src/types/eolRunner'

export const WORKFLOW_TIMEOUTS = {
  defaultMs: 15_000,
  popupPollMs: 250,
  scopedPollMs: 150,
  stopPollMs: 100,
  initialScannerMs: 15_000,
  startButtonMs: 15_000,
  confirmWipeMs: 15_000,
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

export const SELECTORS = {
  firstScanText: /Scan the asset tag|serial number to get started/i,
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
}

export interface VisibleInputResult {
  locator: Locator
}

export interface CompletionSignal {
  mode: WorkflowMode
  signal: string
}
