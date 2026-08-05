import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRunnerRemoval,
  applyRunnerSnapshot,
  runnerTabsFromSnapshots,
} from './runnerViews.ts'
import type { RunnerSnapshot } from '../types/eolRunner.ts'

function snapshot(slot: 1 | 2 | 3): RunnerSnapshot {
  return {
    runnerId: `runner-${slot}`,
    slot,
    label: `Runner ${slot}`,
    sessionGeneration: slot,
    snapshotRevision: 1,
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

test('stale updates and removals cannot mutate a replacement runner session', () => {
  const replacement = { ...snapshot(2), sessionGeneration: 7 }
  const stale = { ...snapshot(2), sessionGeneration: 6, label: 'Stale Runner 2' }
  const current = { 'runner-2': replacement }

  assert.equal(applyRunnerSnapshot(current, stale), current)
  assert.equal(applyRunnerSnapshot(current, {
    ...replacement,
    snapshotRevision: replacement.snapshotRevision - 1,
  }), current)
  assert.equal(applyRunnerRemoval(current, {
    runnerId: 'runner-2',
    sessionGeneration: 6,
  }), current)
  assert.deepEqual(applyRunnerRemoval(current, {
    runnerId: 'runner-2',
    sessionGeneration: 7,
  }), {})
})

test('removing a main-process snapshot removes its renderer tab', () => {
  assert.deepEqual(runnerTabsFromSnapshots({ 'runner-2': snapshot(2) }), [
    { id: 'runner-2', name: 'Runner 2' },
  ])
  assert.deepEqual(runnerTabsFromSnapshots({}), [])
})
