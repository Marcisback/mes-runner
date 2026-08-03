import type {
  EolRunnerSnapshot,
  RunnerDiagnosticSeverity,
  WorkflowMode,
} from '../types/eolRunner'
import type { RunnerStatus } from '../types/workspace'

/**
 * Pure, side-effect-free derivations that turn the single engine snapshot into
 * the presentation shapes the Dashboard renders. No historical persistence
 * exists yet, so every value reflects the current in-memory engine session and
 * empty states are honest.
 */

export interface TodayProgress {
  completed: number
  total: number
  percent: number
  categories: CategoryTotal[]
  hasData: boolean
}

export interface CategoryTotal {
  key: 'MRI_PASS' | 'MRI_FAIL' | 'EOL'
  label: string
  count: number
  tone: 'success' | 'danger' | 'neutral'
}

export interface NeedsReviewItem {
  assetId: string
  mode: WorkflowMode
  modeLabel: string
  runnerName: string | null
  timestamp: string | null
  reason: string | null
  status: 'needs-review'
}

export interface RecentActivityItem {
  id: number
  severity: RunnerDiagnosticSeverity
  mode: WorkflowMode
  assetId: string | null
  message: string
  timestamp: string
}

/**
 * Derives today's progress from the current run. Category buckets attribute the
 * completed count to the snapshot's active mode (the only mode with results in
 * this session); the others honestly show zero.
 */
export function deriveTodayProgress(snapshot: EolRunnerSnapshot): TodayProgress {
  const { completed, total, mode } = snapshot
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  const categories: CategoryTotal[] = [
    {
      key: 'MRI_PASS',
      label: 'MRI PASS',
      count: mode === 'MRI' ? completed : 0,
      tone: 'success',
    },
    {
      key: 'MRI_FAIL',
      label: 'MRI FAIL',
      count: mode === 'MRI_FAIL' ? completed : 0,
      tone: 'danger',
    },
    {
      key: 'EOL',
      label: 'EOL',
      count: mode === 'EOL' ? completed : 0,
      tone: 'neutral',
    },
  ]

  return {
    completed,
    total,
    percent,
    categories,
    hasData: total > 0,
  }
}

/**
 * Maps the runner that owns the engine to its live status. Every other runner
 * is idle because only one run can execute at a time.
 */
export function deriveRunnerStatus(
  runnerId: string,
  engineOwnerId: string | null,
  snapshot: EolRunnerSnapshot,
): RunnerStatus {
  if (runnerId !== engineOwnerId) {
    return 'idle'
  }

  switch (snapshot.state) {
    case 'running':
    case 'stopping':
      return 'running'
    case 'paused':
      return 'paused'
    case 'error':
      return 'error'
    case 'completed':
    case 'idle':
      return snapshot.needsReview > 0 ? 'needs-review' : 'idle'
  }
}

/** True when the owner runner has an in-progress engine run. */
export function isEngineActive(snapshot: EolRunnerSnapshot): boolean {
  return (
    snapshot.state === 'running' ||
    snapshot.state === 'paused' ||
    snapshot.state === 'stopping'
  )
}

export function deriveNeedsReviewItems(
  snapshot: EolRunnerSnapshot,
  ownerRunnerName: string | null,
): NeedsReviewItem[] {
  return snapshot.assets
    .filter((asset) => asset.state === 'needs-review')
    .map((asset) => ({
      assetId: asset.id,
      mode: snapshot.mode,
      modeLabel: snapshot.modeLabel,
      runnerName: ownerRunnerName,
      timestamp: asset.errorDetails?.timestamp ?? null,
      reason: asset.reason,
      status: 'needs-review' as const,
    }))
}

export function deriveRecentActivity(
  snapshot: EolRunnerSnapshot,
  limit: number,
): RecentActivityItem[] {
  return snapshot.diagnostics
    .slice(-limit)
    .reverse()
    .map((event) => ({
      id: event.id,
      severity: event.severity,
      mode: event.workflowMode,
      assetId: event.assetId,
      message: event.message,
      timestamp: event.timestamp,
    }))
}

/** Formats an ISO timestamp as a short local time (e.g. "9:40 AM"). */
export function formatClockTime(isoTimestamp: string | null): string {
  if (isoTimestamp === null) {
    return '—'
  }

  const date = new Date(isoTimestamp)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Formats today's date as a short label (e.g. "August 3"). */
export function formatTodayLabel(now: Date): string {
  return now.toLocaleDateString([], { month: 'long', day: 'numeric' })
}
