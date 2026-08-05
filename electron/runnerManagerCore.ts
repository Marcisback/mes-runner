import type { RunnerId, RunnerSlot } from '../src/types/eolRunner'

export function runnerIdForSlot(slot: RunnerSlot): RunnerId {
  return `runner-${slot}` as RunnerId
}

export function lowestAvailableRunnerSlot(
  runnerIds: ReadonlySet<RunnerId>,
): RunnerSlot | null {
  for (const slot of [1, 2, 3] as const) {
    if (!runnerIds.has(runnerIdForSlot(slot))) return slot
  }
  return null
}

export function isRunnerId(value: unknown): value is RunnerId {
  return value === 'runner-1' || value === 'runner-2' || value === 'runner-3'
}

export function isCurrentRunnerStream(
  selectedRunnerId: RunnerId | null,
  currentStreamGeneration: number,
  frameRunnerId: RunnerId,
  frameStreamGeneration: number,
): boolean {
  return selectedRunnerId === frameRunnerId &&
    currentStreamGeneration === frameStreamGeneration
}
