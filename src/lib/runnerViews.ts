import type {
  RunnerId,
  RunnerRemovedEvent,
  RunnerSnapshot,
} from '../types/eolRunner'
import type { RunnerTab } from '../types/workspace'

export function runnerTabsFromSnapshots(
  snapshots: Partial<Record<RunnerId, RunnerSnapshot>>,
): RunnerTab[] {
  return Object.values(snapshots)
    .filter((value): value is RunnerSnapshot => value !== undefined)
    .sort((left, right) => left.slot - right.slot)
    .map((runner) => ({ id: runner.runnerId, name: runner.label }))
}

export function applyRunnerSnapshot(
  snapshots: Partial<Record<RunnerId, RunnerSnapshot>>,
  incoming: RunnerSnapshot,
): Partial<Record<RunnerId, RunnerSnapshot>> {
  const current = snapshots[incoming.runnerId]
  if (
    current !== undefined &&
    (current.sessionGeneration > incoming.sessionGeneration ||
      (current.sessionGeneration === incoming.sessionGeneration &&
        current.snapshotRevision > incoming.snapshotRevision))
  ) return snapshots
  return { ...snapshots, [incoming.runnerId]: incoming }
}

export function applyRunnerRemoval(
  snapshots: Partial<Record<RunnerId, RunnerSnapshot>>,
  event: RunnerRemovedEvent,
): Partial<Record<RunnerId, RunnerSnapshot>> {
  const current = snapshots[event.runnerId]
  if (
    current === undefined ||
    current.sessionGeneration !== event.sessionGeneration
  ) return snapshots
  const next = { ...snapshots }
  delete next[event.runnerId]
  return next
}
