import type {
  HistoryDateRequest,
  HistoryOutcome,
  HistoryRangeRequest,
} from '../../src/types/history'
import type { WorkflowMode } from '../../src/types/eolRunner'
import {
  localRangeUtcBounds,
  resolveHistoryPresetRange,
} from '../../src/lib/historyCalendar.ts'
import type { HistoryRangePreset } from '../../src/types/history'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MODES: ReadonlySet<string> = new Set(['EOL', 'MRI', 'MRI_FAIL', 'REPAIR'])
const OUTCOMES: ReadonlySet<string> = new Set(['completed', 'needs_review'])
const PRESETS: ReadonlySet<string> = new Set(['this_week', 'last_week', 'custom'])
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500
const MAX_RANGE_DAYS = 366

export interface ValidatedHistoryRange {
  startDate: string
  endDate: string
  search: string
  mode: WorkflowMode | null
  outcome: HistoryOutcome | null
  limit: number
  offset: number
  preset: HistoryRangePreset | null
}

export function parseHistoryDateRequest(value: unknown): ValidatedHistoryRange | null {
  if (!isRecord(value) || !isValidLocalDate(value.date)) return null
  return parseRangeFields(value, value.date, value.date)
}

export function parseHistoryRangeRequest(value: unknown): ValidatedHistoryRange | null {
  if (
    !isRecord(value) ||
    !isValidLocalDate(value.startDate) ||
    !isValidLocalDate(value.endDate) ||
    value.startDate > value.endDate ||
    daysBetween(value.startDate, value.endDate) > MAX_RANGE_DAYS
  ) return null
  const preset = value.preset === undefined ? null : value.preset
  if (preset !== null && (typeof preset !== 'string' || !PRESETS.has(preset))) return null
  if (preset === 'this_week' || preset === 'last_week') {
    const expected = resolveHistoryPresetRange(preset)
    if (value.startDate !== expected.startDate || value.endDate !== expected.endDate) return null
  }
  return parseRangeFields(value, value.startDate, value.endDate)
}

export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function localDateBounds(date: string): { start: string; end: string } {
  return localRangeUtcBounds(date, date)
}

export function localRangeBounds(startDate: string, endDate: string): {
  start: string
  end: string
} {
  return localRangeUtcBounds(startDate, endDate)
}

export function currentLocalWeek(now = new Date()): {
  startDate: string
  endDate: string
  start: string
  end: string
} {
  const week = resolveHistoryPresetRange('this_week', now)
  return {
    startDate: week.startDate,
    endDate: week.endDate,
    start: week.startUtc,
    end: week.endUtc,
  }
}

function parseRangeFields(
  value: Record<string, unknown>,
  startDate: string,
  endDate: string,
): ValidatedHistoryRange | null {
  const search = value.search === undefined ? '' : value.search
  const mode = value.mode === undefined || value.mode === 'all' ? null : value.mode
  const outcome = value.outcome === undefined || value.outcome === 'all'
    ? null
    : value.outcome
  const limit = value.limit === undefined ? DEFAULT_LIMIT : value.limit
  const offset = value.offset === undefined ? 0 : value.offset
  const preset = value.preset === undefined ? null : value.preset
  if (
    typeof search !== 'string' || search.length > 128 ||
    (mode !== null && (typeof mode !== 'string' || !MODES.has(mode))) ||
    (outcome !== null && (typeof outcome !== 'string' || !OUTCOMES.has(outcome))) ||
    !Number.isInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > MAX_LIMIT ||
    !Number.isInteger(offset) || typeof offset !== 'number' || offset < 0 || offset > 100_000
  ) return null
  return {
    startDate,
    endDate,
    search: search.trim().toUpperCase(),
    mode: mode as WorkflowMode | null,
    outcome: outcome as HistoryOutcome | null,
    limit,
    offset,
    preset: preset as HistoryRangePreset | null,
  }
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export type { HistoryDateRequest, HistoryRangeRequest }
