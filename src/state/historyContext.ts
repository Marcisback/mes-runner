import { createContext, useContext } from 'react'
import type {
  HistoryHealth,
  WeeklyHistorySummary,
} from '../types/history'

export interface HistoryContextValue {
  weekly: WeeklyHistorySummary | null
  health: HistoryHealth
  loading: boolean
  revision: number
  refresh(): Promise<void>
}

export const HistoryContext = createContext<HistoryContextValue | null>(null)

export function useHistory(): HistoryContextValue {
  const value = useContext(HistoryContext)
  if (value === null) throw new Error('useHistory must be used within HistoryProvider.')
  return value
}
