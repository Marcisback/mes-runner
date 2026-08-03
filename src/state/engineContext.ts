import { createContext, useContext } from 'react'
import type { EolRunnerSnapshot } from '../types/eolRunner'
import type { ManagedChromeState } from '../types/managedChrome'

/**
 * Context definition and consumer hook for the shared engine state. Kept
 * separate from the provider component so each module has a single kind of
 * export (component vs. hook/const), which keeps React Fast Refresh happy.
 */
export interface EngineContextValue {
  snapshot: EolRunnerSnapshot
  chromeState: ManagedChromeState
}

export const EngineContext = createContext<EngineContextValue | null>(null)

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext)

  if (value === null) {
    throw new Error('useEngine must be used within an EngineProvider.')
  }

  return value
}
