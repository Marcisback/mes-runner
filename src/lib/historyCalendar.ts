import type { HistoryRangePreset } from '../types/history'

export interface LocalCalendarRange {
  startDate: string
  endDate: string
  startUtc: string
  endUtc: string
}

export function resolveHistoryPresetRange(
  preset: Exclude<HistoryRangePreset, 'custom'>,
  now = new Date(),
): LocalCalendarRange {
  const mondayOffset = now.getDay() === 0 ? -6 : 1 - now.getDay()
  const thisMonday = localMidnight(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + mondayOffset,
  )
  const start = preset === 'this_week'
    ? thisMonday
    : addLocalCalendarDays(thisMonday, -7)
  const exclusiveEnd = addLocalCalendarDays(start, 7)
  const inclusiveEnd = addLocalCalendarDays(exclusiveEnd, -1)
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(inclusiveEnd),
    startUtc: start.toISOString(),
    endUtc: exclusiveEnd.toISOString(),
  }
}

export function localRangeUtcBounds(
  startDate: string,
  endDate: string,
): { start: string; end: string } {
  const start = parseLocalDate(startDate)
  const inclusiveEnd = parseLocalDate(endDate)
  return {
    start: start.toISOString(),
    end: addLocalCalendarDays(inclusiveEnd, 1).toISOString(),
  }
}

export function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return localMidnight(year, month - 1, day)
}

function addLocalCalendarDays(date: Date, days: number): Date {
  return localMidnight(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function localMidnight(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 0, 0, 0, 0)
}

