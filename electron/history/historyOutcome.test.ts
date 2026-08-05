import assert from 'node:assert/strict'
import test from 'node:test'
import { toHistoryOutcome } from './historyOutcome.ts'

test('only completed and needs-review states are persisted historically', () => {
  assert.equal(toHistoryOutcome('completed'), 'completed')
  assert.equal(toHistoryOutcome('needs-review'), 'needs_review')
  assert.equal(toHistoryOutcome('skipped'), null)
  assert.equal(toHistoryOutcome('running'), null)
  assert.equal(toHistoryOutcome('pending'), null)
})

