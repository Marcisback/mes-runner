import type {
  EolRunnerSnapshot,
  RunnerDiagnosticSeverity,
  WorkflowMode,
} from '../types/eolRunner'
import type { RunnerStatus } from '../types/workspace'

export interface RecentActivityItem {
  id: number
  severity: RunnerDiagnosticSeverity
  mode: WorkflowMode
  assetId: string | null
  message: string
  timestamp: string
}

export function deriveRunnerStatus(
  snapshot: EolRunnerSnapshot,
): RunnerStatus {
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
