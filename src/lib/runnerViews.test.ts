import assert from 'node:assert/strict'
import test from 'node:test'
import { runnerTabsFromSnapshots } from './runnerViews.ts'
import type { RunnerSnapshot } from '../types/eolRunner.ts'

function snapshot(slot: 1 | 2 | 3): RunnerSnapshot {
  return {
    runnerId: `runner-${slot}`,
    slot,
    label: `Runner ${slot}`,
    pageGeneration: slot,
    workflow: {
      state: 'idle', mode: 'EOL', modeLabel: 'EOL', assets: [],
      currentAssetId: null, total: 0, completed: 0, skipped: 0,
      needsReview: 0, errorMessage: null, diagnostics: [],
    },
  }
}

test('renderer tabs are ordered projections of authoritative runner snapshots', () => {
  const tabs = runnerTabsFromSnapshots({
    'runner-3': snapshot(3),
    'runner-1': snapshot(1),
  })
  assert.deepEqual(tabs, [
    { id: 'runner-1', name: 'Runner 1' },
    { id: 'runner-3', name: 'Runner 3' },
  ])
})

test('removing a main-process snapshot removes its renderer tab', () => {
  assert.deepEqual(runnerTabsFromSnapshots({ 'runner-2': snapshot(2) }), [
    { id: 'runner-2', name: 'Runner 2' },
  ])
  assert.deepEqual(runnerTabsFromSnapshots({}), [])
})
