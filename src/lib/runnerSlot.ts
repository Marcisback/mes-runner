import type { RunnerTab } from '../types/workspace'

/**
 * Runner-slot model.
 *
 * The backend supports exactly ONE managed Chrome runner (a singleton engine +
 * a single Playwright page). The UI must represent that honestly: there is at
 * most one runner workspace, always labelled "Runner 1". This module is the pure
 * state machine behind that rule — no React, no IPC — so the slot behavior can
 * be unit-tested in isolation.
 *
 * Key properties enforced here:
 * - The visible runner is derived from actual availability, never from a
 *   monotonically increasing "times the button was pressed" counter.
 * - Creation is a two-step request → success so a failed/cancelled attempt
 *   consumes no slot, and concurrent requests cannot create duplicates.
 * - Closing releases the slot; the next creation is "Runner 1" again.
 */

/** Stable internal identifier for the single runner workspace. */
export const RUNNER_ID = 'runner-1'
/** Visible label for the single runner workspace. */
export const RUNNER_NAME = 'Runner 1'

export interface RunnerSlotState {
  /** The one runner, or null when no runner exists. */
  runner: RunnerTab | null
  /** True while a creation request is in flight (before it succeeds/fails). */
  creationPending: boolean
}

export const INITIAL_RUNNER_SLOT: RunnerSlotState = {
  runner: null,
  creationPending: false,
}

export type RunnerSlotAction =
  | { type: 'request-create' }
  | { type: 'create-succeeded' }
  | { type: 'create-cancelled' }
  | { type: 'close' }

export function runnerSlotReducer(
  state: RunnerSlotState,
  action: RunnerSlotAction,
): RunnerSlotState {
  switch (action.type) {
    case 'request-create':
      // Only start a creation when the slot is free and nothing is pending.
      // This is what prevents duplicate tabs from rapid/repeated clicks.
      if (state.runner !== null || state.creationPending) {
        return state
      }
      return { runner: null, creationPending: true }

    case 'create-succeeded':
      // The slot is only allocated once creation actually succeeds.
      if (!state.creationPending) {
        return state
      }
      return {
        runner: { id: RUNNER_ID, name: RUNNER_NAME },
        creationPending: false,
      }

    case 'create-cancelled':
      // A failed/rejected/cancelled attempt consumes no slot.
      if (!state.creationPending) {
        return state
      }
      return { runner: state.runner, creationPending: false }

    case 'close':
      // Releasing the slot; the next creation will be "Runner 1" again.
      return { runner: null, creationPending: false }

    default:
      return state
  }
}

/** True when a runner workspace currently exists. */
export function hasRunner(state: RunnerSlotState): boolean {
  return state.runner !== null
}

/** The real runner count: 0 or 1. Never derived from a press counter. */
export function runnerCount(state: RunnerSlotState): number {
  return state.runner !== null ? 1 : 0
}

/**
 * The Dashboard header action reflects intent: create when none exists, focus
 * ("open") the existing runner otherwise.
 */
export function runnerActionLabel(
  state: RunnerSlotState,
): 'Create Runner' | 'Open Runner' {
  return state.runner !== null ? 'Open Runner' : 'Create Runner'
}
