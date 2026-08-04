import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WORKFLOW_RECOVERY_LIMITS,
  decideStartRecovery,
  decideWipeRecovery,
  type ReconciledWorkflowState,
} from './transitionRecoveryCore.ts'

function runStart(states: ReconciledWorkflowState[]): string[] {
  let retries = 0
  const actions: string[] = []

  for (const state of states) {
    const decision = decideStartRecovery(state, retries)
    actions.push(decision)
    if (decision === 'press-enter') retries += 1
    if (decision !== 'wait' && decision !== 'press-enter') break
  }

  return actions
}

function runWipe(states: ReconciledWorkflowState[]): string[] {
  let retries = 0
  const actions: string[] = []

  for (const state of states) {
    const decision = decideWipeRecovery(state, retries)
    actions.push(decision)
    if (decision === 'retry-confirm') retries += 1
    if (decision !== 'wait' && decision !== 'retry-confirm') break
  }

  return actions
}

test('asset remains in scanner and Enter succeeds on the second attempt', () => {
  assert.deepEqual(runStart(['initial-asset', 'start-available']), [
    'press-enter',
    'click-start',
  ])
})

test('asset submission stops after two Enter recovery attempts', () => {
  assert.deepEqual(
    runStart(['initial-asset', 'initial-asset', 'initial-asset']),
    ['press-enter', 'press-enter', 'fail'],
  )
  assert.equal(WORKFLOW_RECOVERY_LIMITS.assetSubmissionEnterRetries, 2)
})

test('delayed Start rendering waits without repeating submission', () => {
  assert.deepEqual(runStart(['start-available']), ['click-start'])
})

test('already advanced MES stages never repeat asset submission', () => {
  assert.deepEqual(runStart(['wipe-processing']), ['continue-wipe'])
  assert.deepEqual(runStart(['diagnostic']), ['continue-diagnostic'])
  assert.deepEqual(runStart(['completed']), ['continue-completed'])
})

test('unexpected, empty, and ambiguous initial scanners fail closed', () => {
  assert.equal(decideStartRecovery('initial-unexpected', 0), 'fail')
  assert.equal(decideStartRecovery('initial-empty', 0), 'fail')
  assert.equal(decideStartRecovery('ambiguous', 0), 'fail')
})

test('late Diagnostic advances without a Confirm Wipe retry', () => {
  assert.deepEqual(runWipe(['wipe-processing', 'wipe-processing', 'diagnostic']), [
    'wait',
    'wait',
    'continue-diagnostic',
  ])
})

test('busy Wipe never clicks confirmation again', () => {
  assert.deepEqual(runWipe(['wipe-processing', 'wipe-processing']), ['wait', 'wait'])
})

test('unchanged actionable Wipe gets one safe retry and advances', () => {
  assert.deepEqual(runWipe(['wipe-actionable', 'diagnostic']), [
    'retry-confirm',
    'continue-diagnostic',
  ])
})

test('Confirm Wipe retry limit waits for advancement then exhausts at timeout', () => {
  assert.deepEqual(runWipe(['wipe-actionable', 'wipe-actionable']), [
    'retry-confirm',
    'wait',
  ])
  assert.equal(decideWipeRecovery('wipe-actionable', 1, true), 'fail')
  assert.equal(WORKFLOW_RECOVERY_LIMITS.confirmWipeRetries, 1)
})

test('completion advances and ambiguous recovery fails closed', () => {
  assert.equal(decideWipeRecovery('completed', 0), 'continue-completed')
  assert.equal(decideWipeRecovery('ambiguous', 0), 'fail')
})

test('popup, authentication, disconnect, pause, and stop interruptions propagate', async () => {
  const interruptions = [
    new Error('known-popup'),
    new Error('authentication-required'),
    new Error('browser-disconnected'),
    new Error('paused'),
    new Error('stop-requested'),
  ]

  for (const interruption of interruptions) {
    await assert.rejects(
      async () => {
        throw interruption
      },
      interruption,
    )
  }
})
