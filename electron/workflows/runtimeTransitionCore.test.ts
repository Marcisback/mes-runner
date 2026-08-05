import test from 'node:test'
import assert from 'node:assert/strict'
import { suspendTransitionWindow } from './runtimeTransitionCore.ts'

test('pause shifts the transition window without consuming its timeout budget', () => {
  const transition = suspendTransitionWindow(
    { startedAt: 1_000, deadline: 16_000, action: 'submit-asset' },
    5_000,
  )
  assert.deepEqual(transition, {
    startedAt: 6_000,
    deadline: 21_000,
    action: 'submit-asset',
  })
  assert.equal(transition.deadline - transition.startedAt, 15_000)
})
