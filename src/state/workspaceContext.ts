import { createContext, useContext } from 'react'
import type { RunnerId } from '../types/eolRunner'
import type {
  LogsFilterIntent,
  RunnerConfig,
  RunnerTab,
  WorkspaceId,
} from '../types/workspace'

export interface WorkspaceContextValue {
  runners: RunnerTab[]
  runnerConfigs: Record<string, RunnerConfig>
  activeWorkspaceId: WorkspaceId
  lastActiveRunnerId: RunnerId | null
  logsFilterIntent: LogsFilterIntent
  creationPending: boolean
  creationError: string | null
  setActiveWorkspace(id: WorkspaceId): void
  openLogs(filter?: LogsFilterIntent): void
  createRunner(): Promise<RunnerId | null>
  closeRunner(id: RunnerId): Promise<boolean>
  updateRunnerConfig(id: RunnerId, patch: Partial<RunnerConfig>): void
  getRunnerName(id: string): string | null
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (value === null) throw new Error('useWorkspace must be used within a WorkspaceProvider.')
  return value
}
