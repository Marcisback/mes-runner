import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INITIAL_RUNNER_SLOT,
  RUNNER_ID,
  RUNNER_NAME,
  hasRunner,
  runnerActionLabel,
  runnerCount,
  runnerSlotReducer,
  type RunnerSlotState,
} from './runnerSlot.ts'

/** Applies a sequence of actions to the initial slot state. */
function apply(
  ...actions: Parameters<typeof runnerSlotReducer>[1][]
): RunnerSlotState {
  return actions.reduce(runnerSlotReducer, INITIAL_RUNNER_SLOT)
}

test('starts with no runner and reports zero', () => {
  assert.equal(INITIAL_RUNNER_SLOT.runner, null)
  assert.equal(runnerCount(INITIAL_RUNNER_SLOT), 0)
  assert.equal(hasRunner(INITIAL_RUNNER_SLOT), false)
  assert.equal(runnerActionLabel(INITIAL_RUNNER_SLOT), 'Create Runner')
})

test('first successful creation produces Runner 1', () => {
  const state = apply({ type: 'request-create' }, { type: 'create-succeeded' })

  assert.deepEqual(state.runner, { id: RUNNER_ID, name: RUNNER_NAME })
  assert.equal(state.runner?.name, 'Runner 1')
  assert.equal(state.creationPending, false)
  assert.equal(runnerCount(state), 1)
  assert.equal(runnerActionLabel(state), 'Open Runner')
})

test('repeated request-create while pending does not create duplicates', () => {
  const pending = apply({ type: 'request-create' })
  assert.equal(pending.creationPending, true)
  assert.equal(pending.runner, null)

  // A second request while pending is a no-op (same state reference).
  const stillPending = runnerSlotReducer(pending, { type: 'request-create' })
  assert.equal(stillPending, pending)

  const created = runnerSlotReducer(stillPending, { type: 'create-succeeded' })
  assert.equal(runnerCount(created), 1)
})

test('request-create after Runner 1 exists never creates Runner 2+', () => {
  const created = apply({ type: 'request-create' }, { type: 'create-succeeded' })

  // Any further create attempts are rejected; the slot stays at exactly one.
  const again = runnerSlotReducer(created, { type: 'request-create' })
  assert.equal(again, created)
  assert.equal(runnerCount(again), 1)

  const andSucceed = runnerSlotReducer(again, { type: 'create-succeeded' })
  assert.equal(runnerCount(andSucceed), 1)
  assert.equal(andSucceed.runner?.id, RUNNER_ID)
})

test('closing an idle Runner 1 releases the slot', () => {
  const created = apply({ type: 'request-create' }, { type: 'create-succeeded' })
  const closed = runnerSlotReducer(created, { type: 'close' })

  assert.equal(closed.runner, null)
  assert.equal(closed.creationPending, false)
  assert.equal(runnerCount(closed), 0)
})

test('recreating after a safe close produces Runner 1 again (no counter)', () => {
  const recreated = apply(
    { type: 'request-create' },
    { type: 'create-succeeded' },
    { type: 'close' },
    { type: 'request-create' },
    { type: 'create-succeeded' },
  )

  assert.deepEqual(recreated.runner, { id: RUNNER_ID, name: RUNNER_NAME })
  assert.equal(recreated.runner?.name, 'Runner 1')
  assert.equal(runnerCount(recreated), 1)
})

test('cancelled creation consumes no slot', () => {
  const cancelled = apply(
    { type: 'request-create' },
    { type: 'create-cancelled' },
  )

  assert.equal(cancelled.runner, null)
  assert.equal(cancelled.creationPending, false)
  assert.equal(runnerCount(cancelled), 0)

  // And a subsequent real creation still yields Runner 1.
  const created = runnerSlotReducer(
    runnerSlotReducer(cancelled, { type: 'request-create' }),
    { type: 'create-succeeded' },
  )
  assert.equal(created.runner?.name, 'Runner 1')
})

test('create-succeeded without a pending request is a no-op', () => {
  const state = runnerSlotReducer(INITIAL_RUNNER_SLOT, {
    type: 'create-succeeded',
  })
  assert.equal(state, INITIAL_RUNNER_SLOT)
  assert.equal(runnerCount(state), 0)
})

test('create-cancelled without a pending request is a no-op', () => {
  const state = runnerSlotReducer(INITIAL_RUNNER_SLOT, {
    type: 'create-cancelled',
  })
  assert.equal(state, INITIAL_RUNNER_SLOT)
})

test('runner count is 0 or 1 across a full lifecycle, never higher', () => {
  let state = INITIAL_RUNNER_SLOT
  const script: Parameters<typeof runnerSlotReducer>[1][] = [
    { type: 'request-create' },
    { type: 'request-create' },
    { type: 'create-succeeded' },
    { type: 'request-create' },
    { type: 'create-succeeded' },
    { type: 'close' },
    { type: 'request-create' },
    { type: 'create-succeeded' },
  ]

  for (const action of script) {
    state = runnerSlotReducer(state, action)
    assert.ok(runnerCount(state) <= 1, 'runner count must never exceed 1')
  }

  assert.equal(state.runner?.name, 'Runner 1')
})
