import { formatErrorDetails } from './diagnostics.ts'
import type { EolRunnerSnapshot, WorkflowMode } from '../types/eolRunner'
import { WORKFLOW_LABELS } from '../types/eolRunner.ts'

/**
 * Pure presentation model for the Logs workspace.
 *
 * The only source of truth is the current in-memory engine snapshot — the same
 * data behind the Dashboard counts and the Needs Review summary. Nothing here is
 * persisted; when a persisted history source is added later it can produce
 * `AssetLogEntry[]` and everything downstream (filtering, sorting, table,
 * drawer) keeps working unchanged.
 *
 * All logic is side-effect-free so it can be unit-tested without React.
 */

export type LogResult = 'completed' | 'skipped' | 'needs-review'

export interface AssetLogEntry {
  /** Stable per runner+asset id, so rerenders/navigation never duplicate rows. */
  id: string
  assetId: string
  mode: WorkflowMode
  runnerId: string
  runnerName: string
  result: LogResult
  /** Epoch ms, only when a real event time is available (never render time). */
  timestamp?: number
  reason?: string
  /** Human-readable, sanitized error/review detail for display. */
  details?: string
  /** Clipboard-safe error detail (asset ids/paths redacted). */
  detailsForCopy?: string
}

export type LogResultFilter = LogResult | 'all'
export type LogModeFilter = WorkflowMode | 'all'

export interface LogFilters {
  search: string
  mode: LogModeFilter
  result: LogResultFilter
  runnerId: string
}

export const EMPTY_LOG_FILTERS: LogFilters = {
  search: '',
  mode: 'all',
  result: 'all',
  runnerId: 'all',
}

export interface LogSummary {
  total: number
  completed: number
  skipped: number
  needsReview: number
}

export interface FilterOption<T extends string = string> {
  value: T
  label: string
}

export const MODE_FILTER_OPTIONS: FilterOption<LogModeFilter>[] = [
  { value: 'all', label: 'All modes' },
  { value: 'EOL', label: WORKFLOW_LABELS.EOL },
  { value: 'MRI', label: WORKFLOW_LABELS.MRI },
  { value: 'MRI_FAIL', label: WORKFLOW_LABELS.MRI_FAIL },
  { value: 'REPAIR', label: WORKFLOW_LABELS.REPAIR },
]

export const RESULT_FILTER_OPTIONS: FilterOption<LogResultFilter>[] = [
  { value: 'all', label: 'All results' },
  { value: 'completed', label: 'Completed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'needs-review', label: 'Needs review' },
]

const LOGGABLE_STATES: ReadonlySet<string> = new Set([
  'completed',
  'skipped',
  'needs-review',
])

/**
 * Normalizes the engine snapshot's asset results into log entries. Timestamps
 * come from real event data (asset error details, else the most recent
 * diagnostic mentioning the asset); when neither exists the timestamp is left
 * unavailable rather than faked.
 */
export function normalizeLogEntries(
  snapshot: EolRunnerSnapshot,
  runnerId: string,
  runnerName: string,
): AssetLogEntry[] {
  const lastDiagnosticTime = new Map<string, string>()
  for (const event of snapshot.diagnostics) {
    if (event.assetId !== null) {
      lastDiagnosticTime.set(event.assetId, event.timestamp)
    }
  }

  const entries: AssetLogEntry[] = []

  for (const asset of snapshot.assets) {
    if (!LOGGABLE_STATES.has(asset.state)) {
      continue
    }

    const result = asset.state as LogResult
    const iso =
      asset.errorDetails?.timestamp ?? lastDiagnosticTime.get(asset.id) ?? null
    const parsed = iso !== null ? Date.parse(iso) : Number.NaN

    entries.push({
      id: `${runnerId}:${asset.id}`,
      assetId: asset.id,
      mode: snapshot.mode,
      runnerId,
      runnerName,
      result,
      timestamp: Number.isFinite(parsed) ? parsed : undefined,
      reason: asset.reason ?? undefined,
      details:
        asset.errorDetails !== null
          ? formatErrorDetails(asset, false)
          : undefined,
      detailsForCopy:
        asset.errorDetails !== null
          ? formatErrorDetails(asset, true)
          : undefined,
    })
  }

  return entries
}

/** Trim + case-fold so asset-ID search is consistent and case-insensitive. */
export function normalizeAssetQuery(value: string): string {
  return value.trim().toUpperCase()
}

export function filterLogEntries(
  entries: AssetLogEntry[],
  filters: LogFilters,
): AssetLogEntry[] {
  const query = normalizeAssetQuery(filters.search)

  return entries.filter((entry) => {
    if (filters.mode !== 'all' && entry.mode !== filters.mode) {
      return false
    }
    if (filters.result !== 'all' && entry.result !== filters.result) {
      return false
    }
    if (filters.runnerId !== 'all' && entry.runnerId !== filters.runnerId) {
      return false
    }
    if (query !== '' && !normalizeAssetQuery(entry.assetId).includes(query)) {
      return false
    }
    return true
  })
}

/** Newest first. Entries without a timestamp sort last, preserving input order. */
export function sortLogEntriesNewestFirst(
  entries: AssetLogEntry[],
): AssetLogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const at = a.entry.timestamp
      const bt = b.entry.timestamp

      if (at === undefined && bt === undefined) {
        return a.index - b.index
      }
      if (at === undefined) {
        return 1
      }
      if (bt === undefined) {
        return -1
      }
      if (bt !== at) {
        return bt - at
      }
      return a.index - b.index
    })
    .map((wrapped) => wrapped.entry)
}

export function summarizeLog(entries: AssetLogEntry[]): LogSummary {
  let completed = 0
  let skipped = 0
  let needsReview = 0

  for (const entry of entries) {
    if (entry.result === 'completed') {
      completed += 1
    } else if (entry.result === 'skipped') {
      skipped += 1
    } else {
      needsReview += 1
    }
  }

  return { total: entries.length, completed, skipped, needsReview }
}

export function hasActiveFilters(filters: LogFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.mode !== 'all' ||
    filters.result !== 'all' ||
    filters.runnerId !== 'all'
  )
}

/** Distinct runners present in the entries, for the Runner filter. */
export function runnerFilterOptions(
  entries: AssetLogEntry[],
  fallback: FilterOption,
): FilterOption[] {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    if (!seen.has(entry.runnerId)) {
      seen.set(entry.runnerId, entry.runnerName)
    }
  }

  const options: FilterOption[] = [{ value: 'all', label: 'All runners' }]

  if (seen.size === 0) {
    options.push(fallback)
    return options
  }

  for (const [value, label] of seen) {
    options.push({ value, label })
  }

  return options
}

const RESULT_LABEL: Record<LogResult, string> = {
  completed: 'Completed',
  skipped: 'Skipped',
  'needs-review': 'Needs review',
}

export function resultLabel(result: LogResult): string {
  return RESULT_LABEL[result]
}

const SHORT_MODE_LABEL: Record<WorkflowMode, string> = {
  EOL: 'EOL',
  MRI: 'MRI',
  MRI_FAIL: 'MRI FAIL',
  REPAIR: 'Repair',
}

/** Compact mode label for the dense activity table. */
export function shortModeLabel(mode: WorkflowMode): string {
  return SHORT_MODE_LABEL[mode]
}

/** Short local time (session only — no date, since history is not persisted). */
export function formatLogTime(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return '—'
  }

  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
