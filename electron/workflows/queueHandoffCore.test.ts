import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RuntimeQueueHandoff,
  createQueueHandoffAuthorization,
  decideQueueHandoff,
  isQueueHandoffAcknowledgementStage,
} from './queueHandoffCore.ts'
import {
  resolveStageLoopIteration,
  type MesWorkflowStage,
  type StageLoopAction,
} from './deterministicStageCore.ts'

const session = { browserGeneration: 7, pageGeneration: 3 }

test('mode-valid MRI completion authorizes exactly one next queue submission', () => {
  const handoff = new RuntimeQueueHandoff()

  assert.deepEqual(handoff.authorize('MRI', 'mri-completed', session, 1234), {
    previousMode: 'MRI',
    terminalStage: 'mri-completed',
    browserGeneration: 7,
    pageGeneration: 3,
    confirmedTimestamp: 1234,
    consumed: false,
  })
  assert.equal(handoff.consume(session), true)
  assert.equal(handoff.consume(session), false)
  assert.equal(handoff.peek(), null)
})

test('receipt survives queue exhaustion but is created only for MRI terminal completion', () => {
  assert.notEqual(createQueueHandoffAuthorization('MRI', 'mri-completed', session), null)
  assert.equal(createQueueHandoffAuthorization('EOL', 'eol-completed', session), null)
  assert.equal(
    createQueueHandoffAuthorization('MRI_FAIL', 'move-to-repair-completed', session),
    null,
  )
})

test('authorized terminal handoff submits only through an actionable empty scanner', () => {
  const authorization = createQueueHandoffAuthorization('MRI', 'mri-completed', session)

  assert.deepEqual(
    decideQueueHandoff(authorization, true, 'actionable-empty', false),
    { kind: 'submit' },
  )
  assert.equal(
    decideQueueHandoff(authorization, true, 'temporarily-unavailable', false).kind,
    'wait',
  )
  assert.deepEqual(
    decideQueueHandoff(authorization, true, 'temporarily-unavailable', true),
    {
      kind: 'reject',
      reason: 'The global scanner did not become actionable before timeout.',
    },
  )
})

test('cold terminal screen and unsafe scanner evidence fail closed', () => {
  assert.equal(
    decideQueueHandoff(null, true, 'actionable-empty', false).kind,
    'reject',
  )
  const authorization = createQueueHandoffAuthorization('MRI', 'mri-completed', session)
  assert.equal(
    decideQueueHandoff(authorization, false, 'actionable-empty', false).kind,
    'reject',
  )
  assert.equal(
    decideQueueHandoff(authorization, true, 'unexpected-value', false).kind,
    'reject',
  )
})

test('Start, Wipe, and Diagnostic stages acknowledge a handoff submission', () => {
  const stages: MesWorkflowStage[] = [
    'start-ready',
    'wipe-scan-ready',
    'diagnostic-scan-ready',
    'diagnostic-pass-ready',
  ]

  for (const stage of stages) {
    assert.equal(isQueueHandoffAcknowledgementStage(stage), true)
    assert.equal(
      resolveStageLoopIteration('MRI', stage, true, 'submit-asset').acknowledged,
      true,
    )
  }
})

test('still-mounted previous MRI terminal does not acknowledge handoff submission', () => {
  assert.equal(isQueueHandoffAcknowledgementStage('mri-completed'), false)
  assert.equal(isQueueHandoffAcknowledgementStage('transitioning'), false)
})

test('two-asset MRI handoff acknowledges at Wipe and selects the next safe action', () => {
  const handoff = new RuntimeQueueHandoff()
  handoff.authorize('MRI', 'mri-completed', session)

  assert.equal(
    decideQueueHandoff(handoff.peek(), true, 'actionable-empty', false).kind,
    'submit',
  )
  assert.equal(handoff.consume(), true)

  const iteration = resolveStageLoopIteration(
    'MRI',
    'wipe-scan-ready',
    true,
    'submit-asset',
  )
  assert.equal(iteration.acknowledged, true)
  assert.deepEqual(iteration.decision, {
    kind: 'act',
    action: 'scan-wipe-asset',
    reason: 'Scoped Wipe scanner is actionable.',
  })
  assert.equal(handoff.peek(), null)
})

test('pending postconditions prevent duplicate handoff and stage actions', () => {
  const dispatched: StageLoopAction[] = ['submit-asset']
  const staleTerminal = resolveStageLoopIteration(
    'MRI',
    'mri-completed',
    true,
    'submit-asset',
  )
  if (staleTerminal.decision.kind === 'act') dispatched.push(staleTerminal.decision.action)

  const pendingWipeScan = resolveStageLoopIteration(
    'MRI',
    'wipe-scan-ready',
    true,
    'scan-wipe-asset',
  )
  if (pendingWipeScan.decision.kind === 'act') dispatched.push(pendingWipeScan.decision.action)

  assert.deepEqual(dispatched, ['submit-asset'])
})

test('MRI terminal completion never dispatches Storage or Confirm Move actions', () => {
  const iteration = resolveStageLoopIteration('MRI', 'mri-completed', true, null)

  assert.equal(iteration.decision.kind, 'complete')
  assert.equal('action' in iteration.decision, false)
})

test('stop, authentication, and disconnect invalidation clear handoff ownership', () => {
  for (const interruption of ['stop', 'authentication', 'disconnect']) {
    const handoff = new RuntimeQueueHandoff()
    handoff.authorize('MRI', 'mri-completed', session)
    assert.equal(handoff.clear(), true, interruption)
    assert.equal(handoff.peek(), null, interruption)
  }
})

test('mode changes preserve a matching session receipt for a later MRI Fail run', () => {
  const handoff = new RuntimeQueueHandoff()
  handoff.authorize('MRI', 'mri-completed', session, 1234)

  assert.equal(handoff.peek(session)?.previousMode, 'MRI')
  assert.equal(
    decideQueueHandoff(handoff.peek(session), true, 'actionable-empty', false).kind,
    'submit',
  )
  assert.equal(handoff.consume(session), true)
  const staleTerminal = resolveStageLoopIteration(
    'MRI_FAIL',
    'mri-completed',
    true,
    'submit-asset',
  )
  assert.equal(staleTerminal.acknowledged, true)
  assert.equal(isQueueHandoffAcknowledgementStage('mri-completed'), false)

  const iteration = resolveStageLoopIteration(
    'MRI_FAIL',
    'wipe-scan-ready',
    true,
    'submit-asset',
  )
  assert.equal(iteration.acknowledged, true)
  assert.equal(iteration.decision.kind, 'act')
  if (iteration.decision.kind === 'act') {
    assert.equal(iteration.decision.action, 'scan-wipe-asset')
  }
  assert.equal(handoff.peek(session), null)
})

test('browser or page generation change invalidates the terminal receipt', () => {
  const handoff = new RuntimeQueueHandoff()
  handoff.authorize('MRI', 'mri-completed', session)
  assert.equal(handoff.peek({ ...session, browserGeneration: 8 }), null)

  handoff.authorize('MRI', 'mri-completed', session)
  assert.equal(handoff.peek({ ...session, pageGeneration: 4 }), null)
})
