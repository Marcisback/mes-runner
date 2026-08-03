import {
  useCallback,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  DEFAULT_REPAIR_LOCATOR,
} from '../types/eolRunner'
import {
  isPrimaryWorkspace,
  type RunnerConfig,
  type RunnerTab,
  type WorkspaceId,
} from '../types/workspace'
import {
  INITIAL_RUNNER_SLOT,
  RUNNER_ID,
  runnerSlotReducer,
} from '../lib/runnerSlot'
import type { LogResultFilter } from '../lib/logs'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from './workspaceContext'

/**
 * Owns application navigation and the runner-tab model. This is UI-only state:
 * the runner list, which workspace is active, each runner's draft configuration,
 * and which runner currently owns the singleton automation engine.
 *
 * It deliberately knows nothing about Playwright, IPC, or engine internals —
 * those live behind {@link EngineProvider} and the typed preload bridge.
 */

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
  // The runner slot is the single source of truth for how many runners exist
  // (0 or 1). It is deliberately NOT a monotonically increasing counter, so the
  // visible label is always "Runner 1" and is released on close.
  const [slot, dispatchSlot] = useReducer(
    runnerSlotReducer,
    INITIAL_RUNNER_SLOT,
  )
  const [runnerConfigs, setRunnerConfigs] = useState<
    Record<string, RunnerConfig>
  >({})
  const [activeWorkspaceId, setActiveWorkspaceId] =
    useState<WorkspaceId>('dashboard')
  const [lastActiveRunnerId, setLastActiveRunnerId] = useState<string | null>(
    null,
  )
  const [engineOwnerId, setEngineOwnerId] = useState<string | null>(null)
  const [logsFilterIntent, setLogsFilterIntent] =
    useState<LogResultFilter>('all')

  const runners = useMemo<RunnerTab[]>(
    () => (slot.runner !== null ? [slot.runner] : []),
    [slot.runner],
  )

  const setActiveWorkspace = useCallback((id: WorkspaceId): void => {
    setActiveWorkspaceId(id)

    if (!isPrimaryWorkspace(id)) {
      setLastActiveRunnerId(id)
    }
  }, [])

  const openLogs = useCallback((filter: LogResultFilter = 'all'): void => {
    // Central navigation state: focuses the single Logs workspace and records
    // the result filter the Logs view should apply when it next mounts.
    setLogsFilterIntent(filter)
    setActiveWorkspaceId('logs')
  }, [])

  const createRunner = useCallback((): string | null => {
    // A runner already exists: this is a focus ("Open Runner") request, never a
    // second runner. Never create a duplicate tab for the singleton runner.
    if (slot.runner !== null) {
      setActiveWorkspaceId(slot.runner.id)
      setLastActiveRunnerId(slot.runner.id)
      return slot.runner.id
    }

    // A creation is already in flight: ignore repeated clicks.
    if (slot.creationPending) {
      return null
    }

    // Request then confirm creation. Creation is synchronous here (UI-only), so
    // the slot is allocated exactly once. The reducer rejects duplicate requests.
    dispatchSlot({ type: 'request-create' })
    dispatchSlot({ type: 'create-succeeded' })

    // Idempotent: never clobber an existing config if this somehow re-runs.
    setRunnerConfigs((current) =>
      RUNNER_ID in current
        ? current
        : { ...current, [RUNNER_ID]: createDefaultConfig() },
    )
    setActiveWorkspaceId(RUNNER_ID)
    setLastActiveRunnerId(RUNNER_ID)

    return RUNNER_ID
  }, [slot.runner, slot.creationPending])

  const closeRunner = useCallback((id: string): void => {
    // Only the one runner can be closed; releasing the slot frees "Runner 1"
    // for a future creation. Close safety (never stopping an active workflow) is
    // enforced by the caller (WorkspaceTabs disables the control while unsafe).
    dispatchSlot({ type: 'close' })

    setRunnerConfigs((current) => {
      if (!(id in current)) {
        return current
      }

      const next = { ...current }
      delete next[id]
      return next
    })

    setActiveWorkspaceId((activeId) => (activeId === id ? 'dashboard' : activeId))
    setLastActiveRunnerId((current) => (current === id ? null : current))
    setEngineOwnerId((current) => (current === id ? null : current))
  }, [])

  const updateRunnerConfig = useCallback(
    (id: string, patch: Partial<RunnerConfig>): void => {
      setRunnerConfigs((current) => {
        const existing = current[id]

        if (existing === undefined) {
          return current
        }

        return { ...current, [id]: { ...existing, ...patch } }
      })
    },
    [],
  )

  const claimEngine = useCallback((id: string): void => {
    setEngineOwnerId(id)
  }, [])

  const getRunnerName = useCallback(
    (id: string): string | null =>
      runners.find((runner) => runner.id === id)?.name ?? null,
    [runners],
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      runners,
      runnerConfigs,
      activeWorkspaceId,
      lastActiveRunnerId,
      engineOwnerId,
      logsFilterIntent,
      setActiveWorkspace,
      openLogs,
      createRunner,
      closeRunner,
      updateRunnerConfig,
      claimEngine,
      getRunnerName,
    }),
    [
      runners,
      runnerConfigs,
      activeWorkspaceId,
      lastActiveRunnerId,
      engineOwnerId,
      logsFilterIntent,
      setActiveWorkspace,
      openLogs,
      createRunner,
      closeRunner,
      updateRunnerConfig,
      claimEngine,
      getRunnerName,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}
