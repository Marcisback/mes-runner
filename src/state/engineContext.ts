import { createContext, useContext } from 'react'
import type { RunnerId, RunnerSnapshot } from '../types/eolRunner'
import type { ManagedChromeState } from '../types/managedChrome'

export interface EngineContextValue {
  runners: Partial<Record<RunnerId, RunnerSnapshot>>
  chromeState: ManagedChromeState
}

export const EngineContext = createContext<EngineContextValue | null>(null)

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext)
  if (value === null) throw new Error('useEngine must be used within an EngineProvider.')
  return value
}
