import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  HistoryDateSummary,
  HistoryHealth,
  WeeklyHistorySummary,
} from '../types/history'
import { HistoryContext, type HistoryContextValue } from './historyContext'

const INITIAL_HEALTH: HistoryHealth = { available: true, message: null }

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [weekly, setWeekly] = useState<WeeklyHistorySummary | null>(null)
  const [dates, setDates] = useState<HistoryDateSummary[]>([])
  const [health, setHealth] = useState<HistoryHealth>(INITIAL_HEALTH)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [weeklyResponse, datesResponse] = await Promise.all([
        window.mesHistory.getWeeklySummary(),
        window.mesHistory.getHistoryDates(),
      ])
      setHealth(weeklyResponse.health)
      if (weeklyResponse.ok) setWeekly(weeklyResponse.data)
      if (datesResponse.ok) setDates(datesResponse.data)
      if (!weeklyResponse.ok) setWeekly(null)
      if (!datesResponse.ok) setDates([])
    } catch {
      setWeekly(null)
      setDates([])
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
    () => ({ weekly, dates, health, loading, revision, refresh }),
    [weekly, dates, health, loading, revision, refresh],
  )

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
}
