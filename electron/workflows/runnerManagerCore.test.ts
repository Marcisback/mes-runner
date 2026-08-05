import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isRunnerId,
  isCurrentRunnerStream,
  lowestAvailableRunnerSlot,
  runnerIdForSlot,
} from '../runnerManagerCore.ts'
import type { RunnerId } from '../../src/types/eolRunner.ts'

test('allocates Runner 1, Runner 2, and Runner 3 then rejects capacity', () => {
  const ids = new Set<RunnerId>()
  for (const expected of [1, 2, 3] as const) {
    const slot = lowestAvailableRunnerSlot(ids)
    assert.equal(slot, expected)
    ids.add(runnerIdForSlot(expected))
  }
  assert.equal(lowestAvailableRunnerSlot(ids), null)
})

test('only the selected stream generation accepts frames and manual input ownership', () => {
  assert.equal(isCurrentRunnerStream('runner-2', 8, 'runner-2', 8), true)
  assert.equal(isCurrentRunnerStream('runner-2', 8, 'runner-1', 8), false)
  assert.equal(isCurrentRunnerStream('runner-2', 8, 'runner-2', 7), false)
})

test('failed creation consumes no slot and closing reuses the lowest slot', () => {
  const ids = new Set<RunnerId>(['runner-1', 'runner-3'])
  assert.equal(lowestAvailableRunnerSlot(ids), 2)
  ids.add('runner-2')
  ids.delete('runner-2')
  assert.equal(lowestAvailableRunnerSlot(ids), 2)
})

test('runner IDs accept only the three managed slots', () => {
  assert.equal(isRunnerId('runner-1'), true)
  assert.equal(isRunnerId('runner-4'), false)
})
