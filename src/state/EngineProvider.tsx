import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RunnerId, RunnerSnapshot } from '../types/eolRunner'
import type { ManagedChromeState } from '../types/managedChrome'
import { EngineContext, type EngineContextValue } from './engineContext'
import { applyRunnerRemoval, applyRunnerSnapshot } from '../lib/runnerViews.ts'

const INITIAL_CHROME_STATE: ManagedChromeState = {
  lifecycle: 'stopped',
  errorMessage: null,
  generation: 0,
  viewport: { width: 1600, height: 1000 },
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [runners, setRunners] = useState<Partial<Record<RunnerId, RunnerSnapshot>>>({})
  const [chromeState, setChromeState] = useState(INITIAL_CHROME_STATE)

  useEffect(() => {
    let mounted = true
    void window.eolRunner.listRunners().then((snapshots) => {
      if (!mounted) return
      setRunners((current) => snapshots.reduce(applyRunnerSnapshot, current))
    })
    const unsubscribeUpdated = window.eolRunner.onEolSnapshotChanged((snapshot) => {
      setRunners((current) => applyRunnerSnapshot(current, snapshot))
    })
    const unsubscribeRemoved = window.eolRunner.onRunnerRemoved((event) => {
      setRunners((current) => applyRunnerRemoval(current, event))
    })
    return () => {
      mounted = false
      unsubscribeUpdated()
      unsubscribeRemoved()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void window.managedChrome.getState().then((state) => {
      if (mounted) setChromeState(state)
    })
    const unsubscribe = window.managedChrome.onStateChanged(setChromeState)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const value = useMemo<EngineContextValue>(
    () => ({ runners, chromeState }),
    [runners, chromeState],
  )
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}
