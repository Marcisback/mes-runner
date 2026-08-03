import type {
  RepairOutcome,
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
  id: string
  name: string
}

/**
 * Per-runner configuration. Each runner tab keeps its own draft configuration
 * so an operator can prepare a run in one tab while another runner owns the
 * (single) automation engine. This is UI state only — it is dispatched to the
 * shared engine when the runner starts.
 */
export interface RunnerConfig {
  mode: WorkflowMode
  assetsText: string
  repairOutcome: RepairOutcome
  repairLocator: string
  moveToRepairLocator: string
}

/**
 * Presentation status for a runner tab / card. Because the engine is a
 * singleton, only the runner that currently owns the engine reflects live
 * engine state; every other runner is reported as idle.
 */
export type RunnerStatus =
  | 'running'
  | 'idle'
  | 'paused'
  | 'needs-review'
  | 'error'

export function isPrimaryWorkspace(id: WorkspaceId): id is PrimaryWorkspaceId {
  return (PRIMARY_WORKSPACES as readonly string[]).includes(id)
}
