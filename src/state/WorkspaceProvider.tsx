import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  DEFAULT_REPAIR_LOCATOR,
  type RunnerId,
} from '../types/eolRunner'
import { isPrimaryWorkspace, type RunnerConfig, type RunnerTab, type WorkspaceId } from '../types/workspace'
import type { LogResultFilter } from '../lib/logs'
import { runnerTabsFromSnapshots } from '../lib/runnerViews'
import { useEngine } from './engineContext'
import { WorkspaceContext, type WorkspaceContextValue } from './workspaceContext'

function createDefaultConfig(): RunnerConfig {
  return {
    mode: 'EOL',
    assetsText: '',
    repairOutcome: 'confirmed',
    repairLocator: DEFAULT_REPAIR_LOCATOR,
    moveToRepairLocator: DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { runners: runnerSnapshots } = useEngine()
  const [runnerConfigs, setRunnerConfigs] = useState<Record<string, RunnerConfig>>({})
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<WorkspaceId>('dashboard')
  const [lastActiveRunnerId, setLastActiveRunnerId] = useState<RunnerId | null>(null)
  const [logsFilterIntent, setLogsFilterIntent] = useState<LogResultFilter>('all')
  const [creationPending, setCreationPending] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)

  const runners = useMemo<RunnerTab[]>(
    () => runnerTabsFromSnapshots(runnerSnapshots),
    [runnerSnapshots],
  )

  useEffect(() => {
    setRunnerConfigs((current) => {
      const next = { ...current }
      for (const runner of runners) next[runner.id] ??= createDefaultConfig()
      for (const id of Object.keys(next)) {
        if (!runners.some((runner) => runner.id === id)) delete next[id]
      }
      return next
    })
  }, [runners])

  const setActiveWorkspace = useCallback((id: WorkspaceId): void => {
    setActiveWorkspaceId(id)
    if (!isPrimaryWorkspace(id)) {
      const runnerId = id as RunnerId
      setLastActiveRunnerId(runnerId)
      void window.managedChrome.selectRunnerStream(runnerId)
    } else {
      void window.managedChrome.selectRunnerStream(null)
    }
  }, [])

  const openLogs = useCallback((filter: LogResultFilter = 'all'): void => {
    setLogsFilterIntent(filter)
    setActiveWorkspaceId('logs')
  }, [])

  const createRunner = useCallback(async (): Promise<RunnerId | null> => {
    if (creationPending || runners.length >= 3) return null
    setCreationPending(true)
    setCreationError(null)
    try {
      const result = await window.eolRunner.createRunner()
      if (!result.ok) {
        setCreationError(result.error.message)
        return null
      }
      const runnerId = result.value.runnerId
      setRunnerConfigs((current) => ({ ...current, [runnerId]: createDefaultConfig() }))
      setActiveWorkspace(runnerId)
      return runnerId
    } finally {
      setCreationPending(false)
    }
  }, [creationPending, runners.length, setActiveWorkspace])

  const closeRunner = useCallback(async (id: RunnerId): Promise<boolean> => {
    const result = await window.eolRunner.closeRunner(id)
    if (!result.ok) return false
    setActiveWorkspaceId((current) => current === id ? 'dashboard' : current)
    setLastActiveRunnerId((current) => current === id ? null : current)
    return true
  }, [])

  const updateRunnerConfig = useCallback((id: RunnerId, patch: Partial<RunnerConfig>): void => {
    setRunnerConfigs((current) => current[id] === undefined
      ? current
      : { ...current, [id]: { ...current[id], ...patch } })
  }, [])

  const getRunnerName = useCallback((id: string): string | null =>
    runners.find((runner) => runner.id === id)?.name ?? null, [runners])

  const value = useMemo<WorkspaceContextValue>(() => ({
    runners,
    runnerConfigs,
    activeWorkspaceId,
    lastActiveRunnerId,
    logsFilterIntent,
    creationPending,
    creationError,
    setActiveWorkspace,
    openLogs,
    createRunner,
    closeRunner,
    updateRunnerConfig,
    getRunnerName,
  }), [runners, runnerConfigs, activeWorkspaceId, lastActiveRunnerId, logsFilterIntent, creationPending, creationError, setActiveWorkspace, openLogs, createRunner, closeRunner, updateRunnerConfig, getRunnerName])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
