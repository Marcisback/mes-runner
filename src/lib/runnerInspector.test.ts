import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  assetsReadyLabel,
  clampInspectorWidth,
  deriveInspectorStatus,
  getRunControls,
  getRunSummary,
  getStartDisabledReason,
  getStreamToolbarControls,
  streamStatusLabel,
} from './runnerInspector.ts'
import type { EolRunnerSnapshot } from '../types/eolRunner.ts'

test('inspector status prioritizes run state over chrome lifecycle', () => {
  assert.equal(deriveInspectorStatus('running', 0, 'streaming'), 'RUNNING')
  assert.equal(deriveInspectorStatus('paused', 0, 'streaming'), 'PAUSED')
  assert.equal(deriveInspectorStatus('stopping', 0, 'streaming'), 'STOPPING')
  assert.equal(deriveInspectorStatus('error', 0, 'streaming'), 'ERROR')
})

test('inspector status reflects needs-review when a run has settled', () => {
  assert.equal(deriveInspectorStatus('completed', 2, 'streaming'), 'NEEDS REVIEW')
  assert.equal(deriveInspectorStatus('idle', 1, 'stopped'), 'NEEDS REVIEW')
})

test('inspector status falls back to chrome lifecycle when idle', () => {
  assert.equal(deriveInspectorStatus('idle', 0, 'streaming'), 'READY')
  assert.equal(deriveInspectorStatus('idle', 0, 'stopped'), 'IDLE')
  assert.equal(deriveInspectorStatus('idle', 0, 'disconnected'), 'IDLE')
  assert.equal(deriveInspectorStatus('idle', 0, 'loading'), 'LAUNCHING')
  assert.equal(
    deriveInspectorStatus('idle', 0, 'authentication-required'),
    'LAUNCHING',
  )
  assert.equal(deriveInspectorStatus('idle', 0, 'compliance-blocked'), 'ERROR')
  assert.equal(deriveInspectorStatus('completed', 0, 'streaming'), 'READY')
})

test('assets-ready label is singular for exactly one', () => {
  assert.equal(assetsReadyLabel(0), '0 assets ready')
  assert.equal(assetsReadyLabel(1), '1 asset ready')
  assert.equal(assetsReadyLabel(5), '5 assets ready')
})

test('start run is gated with an explanation, enabled only when ready', () => {
  assert.match(
    getStartDisabledReason({
      assetCount: 3,
      streamReady: false,
      engineBusyElsewhere: false,
      pending: false,
    }) ?? '',
    /Launch MES/,
  )
  assert.match(
    getStartDisabledReason({
      assetCount: 0,
      streamReady: true,
      engineBusyElsewhere: false,
      pending: false,
    }) ?? '',
    /at least one asset/,
  )
  assert.match(
    getStartDisabledReason({
      assetCount: 3,
      streamReady: true,
      engineBusyElsewhere: true,
      pending: false,
    }) ?? '',
    /in use/,
  )
  assert.equal(
    getStartDisabledReason({
      assetCount: 3,
      streamReady: true,
      engineBusyElsewhere: false,
      pending: false,
    }),
    null,
  )
})

test('stream toolbar controls are contextual', () => {
  assert.deepEqual(getStreamToolbarControls('stopped'), {
    showAuthenticate: false,
    showStopSession: false,
  })
  assert.deepEqual(getStreamToolbarControls('streaming'), {
    showAuthenticate: false,
    showStopSession: true,
  })
  assert.deepEqual(getStreamToolbarControls('authentication-required'), {
    showAuthenticate: true,
    showStopSession: true,
  })
})

test('run controls appear only in relevant states', () => {
  assert.deepEqual(getRunControls('idle'), ['start'])
  assert.deepEqual(getRunControls('completed'), ['start'])
  assert.deepEqual(getRunControls('error'), ['start'])
  assert.deepEqual(getRunControls('running'), ['pause', 'stop'])
  assert.deepEqual(getRunControls('paused'), ['resume', 'stop'])
  assert.deepEqual(getRunControls('stopping'), ['stop'])
})

test('stream status label reads MES OFFLINE when stopped', () => {
  assert.equal(streamStatusLabel('stopped'), 'MES OFFLINE')
  assert.equal(streamStatusLabel('streaming'), 'Streaming')
})

test('inspector width clamps to its bounds', () => {
  assert.equal(clampInspectorWidth(100), INSPECTOR_MIN_WIDTH)
  assert.equal(clampInspectorWidth(9999), INSPECTOR_MAX_WIDTH)
  assert.equal(clampInspectorWidth(380.6), 381)
  assert.equal(clampInspectorWidth(Number.NaN), INSPECTOR_MIN_WIDTH)
})

test('run summary derives from the snapshot, not the draft mode', () => {
  const snapshot: EolRunnerSnapshot = {
    state: 'running',
    mode: 'MRI',
    modeLabel: 'MRI',
    assets: [],
    currentAssetId: 'IT8109038',
    total: 50,
    completed: 30,
    skipped: 2,
    needsReview: 1,
    errorMessage: null,
    diagnostics: [],
  }

  assert.deepEqual(getRunSummary(snapshot), {
    current: 'IT8109038',
    completed: 30,
    total: 50,
    skipped: 2,
    needsReview: 1,
  })

  const idle = getRunSummary({ ...snapshot, currentAssetId: null })
  assert.equal(idle.current, '—')
})
