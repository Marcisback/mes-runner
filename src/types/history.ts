import type { WorkflowMode } from './eolRunner'

export type HistoryOutcome = 'completed' | 'needs_review'
export type HistoryRangePreset = 'this_week' | 'last_week' | 'custom'
export type HistoryRunStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'disconnected'
  | 'error'

export interface HistoryHealth {
  available: boolean
  message: string | null
}

export interface WeeklyHistorySummary {
  weekStart: string
  weekEnd: string
  total: number
  completed: number
  needsReview: number
  byMode: Record<'MRI' | 'MRI_FAIL' | 'EOL', number>
}

export interface HistoryDateSummary {
  date: string
  total: number
}

export interface HistoryDatesRequest {
  startDate: string
  endDate: string
  preset?: HistoryRangePreset
}

export interface HistoryResult {
  id: number
  assetId: string
  mode: WorkflowMode
  outcome: HistoryOutcome
  reason: string | null
  startedAt: string
  finishedAt: string
}

export interface HistoryRangeRequest {
  startDate: string
  endDate: string
  preset?: HistoryRangePreset
  search?: string
  mode?: WorkflowMode | 'all'
  outcome?: HistoryOutcome | 'all'
  limit?: number
  offset?: number
}

export interface HistoryDateRequest {
  date: string
  search?: string
  mode?: WorkflowMode | 'all'
  outcome?: HistoryOutcome | 'all'
  limit?: number
  offset?: number
}

export interface HistoryRangeResult {
  startDate: string
  endDate: string
  total: number
  completed: number
  needsReview: number
  byMode: Record<'MRI' | 'MRI_FAIL' | 'EOL', number>
  results: HistoryResult[]
  limit: number
  offset: number
}

export interface HistoryAssetIdsRequest {
  startDate: string
  endDate: string
  preset?: HistoryRangePreset
  search?: string
  mode?: WorkflowMode | 'all'
  outcome?: HistoryOutcome | 'all'
}

export interface HistoryAssetIdsResult {
  assetIds: string[]
  complete: boolean
}

export type HistoryResponse<T> =
  | { ok: true; data: T; health: HistoryHealth }
  | { ok: false; data: null; health: HistoryHealth; error: string }

export interface HistoryApi {
  getWeeklySummary(): Promise<HistoryResponse<WeeklyHistorySummary>>
  getHistoryDates(
    request: HistoryDatesRequest,
  ): Promise<HistoryResponse<HistoryDateSummary[]>>
  getHistoryForDate(
    request: HistoryDateRequest,
  ): Promise<HistoryResponse<HistoryRangeResult>>
  getHistoryRange(
    request: HistoryRangeRequest,
  ): Promise<HistoryResponse<HistoryRangeResult>>
  getHistoryAssetIds(
    request: HistoryAssetIdsRequest,
  ): Promise<HistoryResponse<HistoryAssetIdsResult>>
  onHistoryChanged(listener: () => void): () => void
}
