import { createContext, useContext } from 'react'
import type { LogResultFilter } from '../lib/logs'
import type {
  RunnerConfig,
  RunnerTab,
  WorkspaceId,
} from '../types/workspace'

/**
 * Context definition and consumer hook for the workspace/navigation model. Kept
 * separate from the provider component so each module has a single kind of
 * export (component vs. hook/const), which keeps React Fast Refresh happy.
 */
export interface WorkspaceContextValue {
  runners: RunnerTab[]
  runnerConfigs: Record<string, RunnerConfig>
  activeWorkspaceId: WorkspaceId
  /** The most recently focused runner tab, kept so the persistent runner
   * workspace has a runner to render while a primary view is shown. */
  lastActiveRunnerId: string | null
  /** The runner that started the current/last engine run, or null. */
  engineOwnerId: string | null
  setActiveWorkspace(id: WorkspaceId): void
  /** The result filter the Logs view should apply on its next open. */
  logsFilterIntent: LogResultFilter
  /** Opens/focuses the Logs workspace, optionally pre-applying a result filter. */
  openLogs(filter?: LogResultFilter): void
  /**
   * Creates the single runner ("Runner 1") if none exists and focuses it;
   * focuses the existing runner otherwise. Returns the runner id, or null if a
   * creation is already in flight. Never creates a second runner.
   */
  createRunner(): string | null
  closeRunner(id: string): void
  updateRunnerConfig(id: string, patch: Partial<RunnerConfig>): void
  /** Records that a runner has claimed the singleton engine. */
  claimEngine(id: string): void
  getRunnerName(id: string): string | null
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
)

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)

  if (value === null) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider.')
  }

  return value
}
