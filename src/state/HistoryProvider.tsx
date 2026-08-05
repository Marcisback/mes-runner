import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  HistoryHealth,
  WeeklyHistorySummary,
} from '../types/history'
import { HistoryContext, type HistoryContextValue } from './historyContext'

const INITIAL_HEALTH: HistoryHealth = { available: true, message: null }

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [weekly, setWeekly] = useState<WeeklyHistorySummary | null>(null)
  const [health, setHealth] = useState<HistoryHealth>(INITIAL_HEALTH)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const weeklyResponse = await window.mesHistory.getWeeklySummary()
      setHealth(weeklyResponse.health)
      if (weeklyResponse.ok) setWeekly(weeklyResponse.data)
      if (!weeklyResponse.ok) setWeekly(null)
    } catch {
      setWeekly(null)
      setHealth({ available: false, message: 'Local history is unavailable.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.mesHistory.onHistoryChanged(() => {
      setRevision((value) => value + 1)
      void refresh()
    })
  }, [refresh])

  const value = useMemo<HistoryContextValue>(
    () => ({ weekly, health, loading, revision, refresh }),
    [weekly, health, loading, revision, refresh],
  )

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
}
