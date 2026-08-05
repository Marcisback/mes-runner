import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RunnerId, RunnerSnapshot } from '../types/eolRunner'
import type { ManagedChromeState } from '../types/managedChrome'
import { EngineContext, type EngineContextValue } from './engineContext'

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
      setRunners(Object.fromEntries(snapshots.map((snapshot) => [snapshot.runnerId, snapshot])))
    })
    const unsubscribeUpdated = window.eolRunner.onEolSnapshotChanged((snapshot) => {
      setRunners((current) => ({ ...current, [snapshot.runnerId]: snapshot }))
    })
    const unsubscribeRemoved = window.eolRunner.onRunnerRemoved((runnerId) => {
      setRunners((current) => {
        const next = { ...current }
        delete next[runnerId]
        return next
      })
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
