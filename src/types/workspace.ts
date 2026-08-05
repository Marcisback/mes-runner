import type {
  RepairOutcome,
  RunnerId,
  WorkflowMode,
} from './eolRunner'

/**
 * Reserved workspace identifiers for the permanent primary views. Runner
 * workspaces use generated ids that never collide with these.
 */
export const PRIMARY_WORKSPACES = ['dashboard', 'logs', 'settings'] as const

export type PrimaryWorkspaceId = (typeof PRIMARY_WORKSPACES)[number]

/** A workspace is either a permanent primary view or a runner tab. */
export type WorkspaceId = PrimaryWorkspaceId | string

export interface RunnerTab {
  id: RunnerId
  name: string
}

/**
 * Per-runner draft configuration dispatched only to that runner's engine.
 */
export interface RunnerConfig {
  mode: WorkflowMode
  assetsText: string
  repairOutcome: RepairOutcome
  repairLocator: string
  moveToRepairLocator: string
}

/**
 * Presentation status for one independently owned runner tab or card.
 */
export type RunnerStatus =
  | 'running'
  | 'idle'
  | 'paused'
  | 'needs-review'
  | 'error'

export type LogsFilterIntent = 'all' | 'completed' | 'skipped' | 'needs-review'

export function isPrimaryWorkspace(id: WorkspaceId): id is PrimaryWorkspaceId {
  return (PRIMARY_WORKSPACES as readonly string[]).includes(id)
}
