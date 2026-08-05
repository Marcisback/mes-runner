export type WorkflowMode =
  | 'EOL'
  | 'MRI'
  | 'MRI_FAIL'
  | 'REPAIR'

export type RunnerId = 'runner-1' | 'runner-2' | 'runner-3'
export type RunnerSlot = 1 | 2 | 3

export type RepairOutcome = 'confirmed' | 'failed'

export type EolRunnerState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'error'

export type EolAssetState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'needs-review'

export interface WorkflowOptions {
  mode: WorkflowMode
  repairOutcome: RepairOutcome
  repairLocator: string
  moveToRepairLocator: string
}

export interface EolStartRequest extends Partial<WorkflowOptions> {
  assetsText: string
}

export interface EolAssetResult {
  id: string
  state: EolAssetState
  reason: string | null
  errorDetails: EolAssetErrorDetails | null
}

export type RunnerDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface RunnerDiagnosticEvent {
  id: number
  timestamp: string
  severity: RunnerDiagnosticSeverity
  runnerState: EolRunnerState
  workflowMode: WorkflowMode
  currentStep: string | null
  message: string
  errorClass: string | null
  reason: string | null
  assetId: string | null
}

export interface EolAssetErrorDetails {
  workflowMode: WorkflowMode
  lastCompletedStep: string | null
  failingStep: string | null
  errorClass: string
  sanitizedMessage: string
  timestamp: string
}

export interface EolRunnerSnapshot {
  state: EolRunnerState
  mode: WorkflowMode
  modeLabel: string
  assets: EolAssetResult[]
  currentAssetId: string | null
  total: number
  completed: number
  skipped: number
  needsReview: number
  errorMessage: string | null
  diagnostics: RunnerDiagnosticEvent[]
}

export interface RunnerSnapshot {
  runnerId: RunnerId
  slot: RunnerSlot
  label: string
  pageGeneration: number
  workflow: EolRunnerSnapshot
}

export type RunnerCapacityError = {
  code: 'capacity-reached'
  message: string
}

export type RunnerOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RunnerCapacityError | { code: 'not-found' | 'creation-failed'; message: string } }

export interface EolRunnerApi {
  createRunner(): Promise<RunnerOperationResult<RunnerSnapshot>>
  closeRunner(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerId>>
  listRunners(): Promise<RunnerSnapshot[]>
  getRunner(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>>
  startEol(runnerId: RunnerId, request: EolStartRequest): Promise<RunnerOperationResult<RunnerSnapshot>>
  pauseEol(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>>
  resumeEol(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>>
  stopEol(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>>
  onEolSnapshotChanged(
    listener: (snapshot: RunnerSnapshot) => void,
  ): () => void
  onRunnerRemoved(listener: (runnerId: RunnerId) => void): () => void
}

export const WORKFLOW_LABELS: Record<WorkflowMode, string> = {
  EOL: 'EOL',
  MRI: 'MRI',
  MRI_FAIL: 'MRI (FAIL MOBILE-DISPLAY)',
  REPAIR: 'Repair',
}

export const DEFAULT_REPAIR_LOCATOR = 'NEW102-SMOBILE1-EOL-11-D01'
export const DEFAULT_MOVE_TO_REPAIR_LOCATOR = 'NEW102-SMOBILE1-TECH-09-F01'
