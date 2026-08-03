import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EolRunnerSnapshot } from '../types/eolRunner'
import { WORKFLOW_LABELS } from '../types/eolRunner'
import type { ManagedChromeState } from '../types/managedChrome'
import { EngineContext, type EngineContextValue } from './engineContext'

/**
 * Owns the single subscriptions to the singleton automation engine
 * (`window.eolRunner`) and managed Chrome lifecycle (`window.managedChrome`
 * state). Mounted once at the application root, it broadcasts the shared engine
 * snapshot and Chrome state to every view — the Dashboard, workspace tabs, the
 * status bar, and the runner workspace — so no view ever opens a duplicate
 * subscription, and switching tabs never re-subscribes or resets engine state.
 *
 * Frame streaming (`onFrame`) is intentionally NOT handled here; it stays with
 * the single mounted stream surface that owns the drawing canvas.
 */

const INITIAL_CHROME_STATE: ManagedChromeState = {
  lifecycle: 'stopped',
  errorMessage: null,
  generation: 0,
  viewport: { width: 1600, height: 1000 },
}

const INITIAL_SNAPSHOT: EolRunnerSnapshot = {
  state: 'idle',
  mode: 'EOL',
  modeLabel: WORKFLOW_LABELS.EOL,
  assets: [],
  currentAssetId: null,
  total: 0,
  completed: 0,
  skipped: 0,
  needsReview: 0,
  errorMessage: null,
  diagnostics: [],
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<EolRunnerSnapshot>(INITIAL_SNAPSHOT)
  const [chromeState, setChromeState] =
    useState<ManagedChromeState>(INITIAL_CHROME_STATE)

  useEffect(() => {
    let mounted = true

    window.eolRunner.getEolSnapshot().then((current) => {
      if (mounted) {
        setSnapshot(current)
      }
    })

    const unsubscribe = window.eolRunner.onEolSnapshotChanged(setSnapshot)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let mounted = true

    window.managedChrome.getState().then((current) => {
      if (mounted) {
        setChromeState(current)
      }
    })

    const unsubscribe = window.managedChrome.onStateChanged(setChromeState)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const value = useMemo<EngineContextValue>(
    () => ({ snapshot, chromeState }),
    [snapshot, chromeState],
  )

  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  )
}
