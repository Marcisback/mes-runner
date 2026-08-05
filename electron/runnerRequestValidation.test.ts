import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseRunnerStartRequest,
  RUNNER_REQUEST_LIMITS,
} from './runnerRequestValidation.ts'

test('runner start validation accepts a bounded typed request', () => {
  const parsed = parseRunnerStartRequest({
    assetsText: 'IT100\nIT100\n# comment\nIT200',
    mode: 'MRI_FAIL',
    repairOutcome: 'failed',
    repairLocator: 'REPAIR-1',
    moveToRepairLocator: 'MOVE-1',
  })
  assert.deepEqual(parsed?.assets, ['IT100', 'IT200'])
  assert.equal(parsed?.options.mode, 'MRI_FAIL')
})

test('runner start validation rejects malformed enums and payload shapes', () => {
  assert.equal(parseRunnerStartRequest(null), null)
  assert.equal(parseRunnerStartRequest({ assetsText: 'IT100', mode: 'unknown' }), null)
  assert.equal(parseRunnerStartRequest({
    assetsText: 'IT100',
    mode: 'MRI',
    repairOutcome: 'unknown',
  }), null)
  assert.equal(parseRunnerStartRequest({ assetsText: 100 }), null)
})

test('runner start validation rejects unbounded queues and locators', () => {
  assert.equal(parseRunnerStartRequest({
    assetsText: 'x'.repeat(RUNNER_REQUEST_LIMITS.assetTextLength + 1),
  }), null)
  assert.equal(parseRunnerStartRequest({
    assetsText: Array.from(
      { length: RUNNER_REQUEST_LIMITS.assetsPerRun + 1 },
      (_, index) => `IT${index}`,
    ).join('\n'),
  }), null)
  assert.equal(parseRunnerStartRequest({
    assetsText: 'IT100',
    repairLocator: 'x'.repeat(RUNNER_REQUEST_LIMITS.locatorLength + 1),
  }), null)
})
