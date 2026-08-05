import type { RunnerId, RunnerSnapshot } from '../types/eolRunner'
import type { RunnerTab } from '../types/workspace'

export function runnerTabsFromSnapshots(
  snapshots: Partial<Record<RunnerId, RunnerSnapshot>>,
): RunnerTab[] {
  return Object.values(snapshots)
    .filter((value): value is RunnerSnapshot => value !== undefined)
    .sort((left, right) => left.slot - right.slot)
    .map((runner) => ({ id: runner.runnerId, name: runner.label }))
}
