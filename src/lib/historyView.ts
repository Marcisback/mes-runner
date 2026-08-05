import type {
  HistoryAssetIdsResult,
  HistoryDateSummary,
  HistoryOutcome,
  HistoryRangeRequest,
  HistoryRangePreset,
  HistoryResponse,
} from '../types/history'
import type { WorkflowMode } from '../types/eolRunner'
import { resolveHistoryPresetRange } from './historyCalendar.ts'

export interface ActiveHistoryRange {
  preset: HistoryRangePreset
  startDate: string
  endDate: string
}

export interface CopyAssetIdsResult {
  ok: boolean
  count: number
  message: string
}

export interface HistoryFilterValues {
  search: string
  mode: WorkflowMode | 'all'
  outcome: HistoryOutcome | 'all'
}

export function resolveActiveHistoryRange(
  preset: HistoryRangePreset,
  customStart: string,
  customEnd: string,
  now = new Date(),
): ActiveHistoryRange {
  if (preset === 'custom') {
    return { preset, startDate: customStart, endDate: customEnd }
  }
  const range = resolveHistoryPresetRange(preset, now)
  return { preset, startDate: range.startDate, endDate: range.endDate }
}

export function dateBelongsToRange(
  date: string,
  range: Pick<ActiveHistoryRange, 'startDate' | 'endDate'>,
): boolean {
  return date >= range.startDate && date <= range.endDate
}

export function selectDateWithinRange(
  selectedDate: string | null,
  range: Pick<ActiveHistoryRange, 'startDate' | 'endDate'>,
): string | null {
  return selectedDate !== null && dateBelongsToRange(selectedDate, range)
    ? selectedDate
    : null
}

export function buildFilteredHistoryRequest(
  range: ActiveHistoryRange,
  selectedDate: string | null,
  filters: HistoryFilterValues,
): HistoryRangeRequest {
  const activeDate = selectDateWithinRange(selectedDate, range)
  return {
    preset: activeDate === null ? range.preset : 'custom',
    startDate: activeDate ?? range.startDate,
    endDate: activeDate ?? range.endDate,
    ...filters,
  }
}

export function normalizeHistoryDates(
  dates: HistoryDateSummary[],
  range: Pick<ActiveHistoryRange, 'startDate' | 'endDate'>,
): HistoryDateSummary[] {
  return dates
    .filter((item) => dateBelongsToRange(item.date, range))
    .sort((left, right) => right.date.localeCompare(left.date))
}

export function formatAssetIdsForClipboard(assetIds: string[]): {
  text: string
  count: number
} {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of assetIds) {
    const assetId = value.trim().toUpperCase()
    if (assetId === '' || seen.has(assetId)) continue
    seen.add(assetId)
    normalized.push(assetId)
  }
  return { text: normalized.join('\n'), count: normalized.length }
}

export function canCopyHistoryAssetIds(
  total: number,
  loading: boolean,
  hasError: boolean,
  copying: boolean,
): boolean {
  return total > 0 && !loading && !hasError && !copying
}

export async function copyFilteredAssetIds(
  load: () => Promise<HistoryResponse<HistoryAssetIdsResult>>,
  writeText: (text: string) => Promise<boolean>,
): Promise<CopyAssetIdsResult> {
  try {
    const response = await load()
    if (!response.ok) return copyFailure()
    if (!response.data.complete) {
      return {
        ok: false,
        count: 0,
        message: 'Too many matching assets. Narrow the History filters before copying.',
      }
    }
    const formatted = formatAssetIdsForClipboard(response.data.assetIds)
    if (formatted.count === 0) return copyFailure()
    if (!await writeText(formatted.text)) return copyFailure()
    return {
      ok: true,
      count: formatted.count,
      message: `${formatted.count} ${formatted.count === 1 ? 'Asset ID' : 'Asset IDs'} copied`,
    }
  } catch {
    return copyFailure()
  }
}

function copyFailure(): CopyAssetIdsResult {
  return {
    ok: false,
    count: 0,
    message: 'Asset IDs could not be copied.',
  }
}
