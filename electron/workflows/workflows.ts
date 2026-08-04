import {
  AssetSkipError,
  BrowserDisconnectedError,
  NeedsReviewError,
  StopRequestedError,
  WorkflowInvariantError,
} from './errors'
import { completeFailureReasonDialog } from './failureDialog'
import { selectRepairLocatorByKeyboard } from './locatorSelector'
import { completeMoveToRepair, validateMoveToRepairLocator } from './moveToRepair'
import { closePopupIfPresent } from './popupHandler'
import {
  clickWithSettles,
  countVisible,
  isLocatorEnabled,
  isLocatorVisible,
  popupAwareWait,
  scopedWait,
  sleepWithCheckpoint,
  typeAndSubmit,
} from './primitives'
import {
  findConfirmDiagnostic,
  findConfirmMoveButton,
  findConfirmRepairButton,
  findConfirmWipe,
  findDiagnosticFailedButton,
  findInitialScanner,
  findMriConfirmDiagnostic,
  findMriConfirmWipe,
  findRepairFailedButton,
  findRepairInput,
  findRepairLocatorInput,
  findRepairSection,
  findStartButton,
  findStepScanner,
  hasVisibleAssetErrorDialog,
  inspectInitialScanner,
} from './stateDetectors'
import {
  WORKFLOW_RECOVERY_LIMITS,
} from './transitionRecoveryCore'
import { observeMesState } from './mesRuntimeState'
import {
  reconcileRuntimeState,
  type RuntimeAction,
  type RuntimeDecision,
  type RuntimeRetryCounters,
  type WorkflowConfirmedStage,
  type WorkflowExpectedStage,
} from './runtimeReconciliation'
import {
  WORKFLOW_TIMEOUTS,
  type AssetWorkflowContext,
  type CompletionSignal,
  type WorkflowRuntime,
} from './types'

export async function processAssetWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  switch (context.options.mode) {
    case 'EOL':
      return runEolWorkflow(context)
    case 'MRI':
      return runMriPassWorkflow(context)
    case 'MRI_FAIL':
      return runMriFailWorkflow(context)
    case 'REPAIR':
      return runRepairWorkflow(context)
  }
}

async function runEolWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  await runStateAwareWorkflow(context, 'EOL')

  return {
    mode: 'EOL',
    signal: 'Confirm wipe cleared and the initial scanner returned enabled.',
  }
}

async function runMriPassWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  await runStateAwareWorkflow(context, 'MRI')

  return {
    mode: 'MRI',
    signal:
      'Confirm diagnostic cleared and the initial scanner returned enabled.',
  }
}

async function runMriFailWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  validateMoveToRepairLocator(context, context.options.moveToRepairLocator)
  await runStateAwareWorkflow(context, 'MRI_FAIL')

  return {
    mode: 'MRI_FAIL',
    signal: 'Confirm move cleared after verified Move to Repair selection.',
  }
}

interface RuntimeProgress {
  expectedStage: WorkflowExpectedStage
  lastConfirmedStage: WorkflowConfirmedStage
  pendingAction: RuntimeAction | null
  retries: RuntimeRetryCounters
  transitionDeadline: number
}

class RuntimeTargetChangedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeTargetChangedError'
  }
}

async function runStateAwareWorkflow(
  context: AssetWorkflowContext,
  mode: 'EOL' | 'MRI' | 'MRI_FAIL',
): Promise<void> {
  const progress: RuntimeProgress = {
    expectedStage: 'asset-submission',
    lastConfirmedStage: 'none',
    pendingAction: null,
    retries: { assetEnter: 0, confirmWipe: 0, transitionTimedOut: false },
    transitionDeadline: Date.now() + WORKFLOW_TIMEOUTS.startRecoveryCycleMs,
  }
  let lastDiagnosticKey: string | null = null

  for (;;) {
    const checkpointStartedAt = Date.now()
    await context.checkpoint()
    const checkpointWaitMs = Date.now() - checkpointStartedAt
    if (checkpointWaitMs > WORKFLOW_TIMEOUTS.stopPollMs * 2) {
      progress.transitionDeadline += checkpointWaitMs
    }
    const observation = await observeMesState(context)
    progress.retries.transitionTimedOut = Date.now() >= progress.transitionDeadline
    const decision = reconcileRuntimeState({
      mode,
      observation,
      expectedStage: progress.expectedStage,
      lastConfirmedStage: progress.lastConfirmedStage,
      pendingAction: progress.pendingAction,
      retries: progress.retries,
      interruption: {
        paused: false,
        stopRequested: context.isStopRequested(),
        authenticationRequired: false,
        browserDisconnected: false,
      },
    })
    const diagnosticKey = `${observation.state}:${progress.expectedStage}:${progress.lastConfirmedStage}:${decision.kind}`
    if (diagnosticKey !== lastDiagnosticKey) {
      logRuntimeDecision(context, observation.state, progress, decision)
      lastDiagnosticKey = diagnosticKey
    }

    if (decision.kind === 'wait' || decision.kind === 'paused') {
      if (progress.retries.transitionTimedOut && decision.kind === 'wait') {
        throw new NeedsReviewError(
          `Timed out while ${decision.reason.toLowerCase()}`,
        )
      }
      await sleepRuntimePoll(context, progress)
      continue
    }
    if (decision.kind === 'skip-forward') {
      progress.expectedStage = decision.expectedStage
      progress.lastConfirmedStage = decision.confirmedStage
      progress.pendingAction = null
      progress.retries.transitionTimedOut = false
      progress.transitionDeadline = transitionDeadlineFor(progress.expectedStage)
      continue
    }
    if (decision.kind === 'complete') {
      confirmPendingCompletion(progress)
      await verifyWorkflowCompletion(context, mode)
      return
    }
    if (decision.kind === 'needs-review') throw new NeedsReviewError(decision.reason)
    if (decision.kind === 'stopped') throw new StopRequestedError(decision.reason)
    if (decision.kind === 'disconnected') throw new BrowserDisconnectedError(decision.reason)
    if (decision.kind === 'authentication-required') {
      await sleepRuntimePoll(context, progress)
      continue
    }

    try {
      await executeRuntimeAction(context, decision.action)
    } catch (error: unknown) {
      if (error instanceof RuntimeTargetChangedError) {
        context.log('info', 'Action target changed; re-observing MES.', {
          reason: error.message,
        })
        lastDiagnosticKey = null
        continue
      }
      throw error
    }
    advanceAfterAction(progress, decision)
    lastDiagnosticKey = null
  }
}

async function sleepRuntimePoll(
  context: AssetWorkflowContext,
  progress: RuntimeProgress,
): Promise<void> {
  const startedAt = Date.now()
  await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.recoveryPollMs)
  const excessWaitMs = Date.now() - startedAt - WORKFLOW_TIMEOUTS.recoveryPollMs
  if (excessWaitMs > WORKFLOW_TIMEOUTS.stopPollMs * 2) {
    progress.transitionDeadline += excessWaitMs
  }
}

async function executeRuntimeAction(
  context: AssetWorkflowContext,
  action: RuntimeAction,
): Promise<void> {
  await runWorkflowStep(context, runtimeActionLabel(action), async () => {
    switch (action) {
      case 'submit-asset': {
        const scanner = await findInitialScanner(context.page)
        if (scanner === null) throw new RuntimeTargetChangedError('Initial scanner changed before submission.')
        await typeAndSubmit(context, scanner, context.assetId)
        return
      }
      case 'press-enter': {
        const scanner = await inspectInitialScanner(context.page, context.assetId)
        if (scanner.state !== 'initial-asset' || scanner.locator === null || !scanner.enabled) {
          throw new RuntimeTargetChangedError('Initial scanner changed before Enter recovery.')
        }
        await scanner.locator.focus()
        await context.page.keyboard.press('Enter')
        return
      }
      case 'click-start': {
        const start = await findStartButton(context.page)
        if (start === null) throw new RuntimeTargetChangedError('Start changed before activation.')
        await clickWithSettles(context, start, 150, 350)
        return
      }
      case 'scan-wipe': {
        const scanner = await findStepScanner(context, 'Wipe')
        if (scanner === null) throw new RuntimeTargetChangedError('Wipe scanner changed before scanning.')
        await typeAndSubmit(context, scanner, context.assetId)
        return
      }
      case 'confirm-wipe': {
        const confirm = await findMriConfirmWipe(context)
        if (confirm === null) throw new RuntimeTargetChangedError('Confirm Wipe changed before activation.')
        await clickWithSettles(context, confirm, 75, 300)
        await sleepWithCheckpoint(context, 1_000)
        return
      }
      case 'scan-diagnostic': {
        const scanner = await findStepScanner(context, 'Diagnostic')
        if (scanner === null) throw new RuntimeTargetChangedError('Diagnostic scanner changed before scanning.')
        await typeAndSubmit(context, scanner, context.assetId)
        return
      }
      case 'confirm-diagnostic': {
        const confirm = await findMriConfirmDiagnostic(context)
        if (confirm === null) throw new RuntimeTargetChangedError('Confirm Diagnostic changed before activation.')
        await clickWithSettles(context, confirm, 75, 300)
        await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.mriFinalSettleMs)
        return
      }
      case 'click-diagnostic-failed': {
        const failed = await findDiagnosticFailedButton(context)
        if (failed === null) throw new RuntimeTargetChangedError('Diagnostic Failed changed before activation.')
        await clickWithSettles(context, failed, 75, 300)
        return
      }
      case 'complete-failure-dialog':
        await completeFailureReasonDialog(context)
        return
      case 'complete-move-to-repair':
        await completeMoveToRepair(context, context.options.moveToRepairLocator)
        return
      case 'handle-business-error':
        await closePopupIfPresent(context)
        return
    }
  })
}

function advanceAfterAction(progress: RuntimeProgress, decision: Extract<RuntimeDecision, { kind: 'act' | 'retry-transition' }>): void {
  const action = decision.action
  const existingDeadline = progress.transitionDeadline
  progress.pendingAction = action
  progress.retries.transitionTimedOut = false

  switch (action) {
    case 'submit-asset':
    case 'press-enter':
      progress.expectedStage = 'start'
      if (action === 'press-enter') progress.retries.assetEnter += 1
      break
    case 'click-start':
      progress.expectedStage = 'wipe-scan'
      progress.lastConfirmedStage = 'asset-submitted'
      break
    case 'scan-wipe':
      progress.expectedStage = 'wipe-confirm'
      break
    case 'confirm-wipe':
      progress.expectedStage = 'wipe-transition'
      progress.lastConfirmedStage = 'wipe-scanned'
      if (decision.kind === 'retry-transition') progress.retries.confirmWipe += 1
      break
    case 'scan-diagnostic':
      progress.expectedStage = 'diagnostic-action'
      break
    case 'confirm-diagnostic':
      progress.expectedStage = 'diagnostic-transition'
      progress.lastConfirmedStage = 'diagnostic-scanned'
      break
    case 'click-diagnostic-failed':
      progress.expectedStage = 'failure-dialog'
      progress.lastConfirmedStage = 'diagnostic-scanned'
      break
    case 'complete-failure-dialog':
      progress.expectedStage = 'move-to-repair'
      progress.lastConfirmedStage = 'diagnostic-failed'
      break
    case 'complete-move-to-repair':
      progress.expectedStage = 'completion'
      progress.lastConfirmedStage = 'move-confirmed'
      progress.pendingAction = null
      break
    case 'handle-business-error':
      progress.pendingAction = null
      break
  }

  progress.transitionDeadline =
    action === 'confirm-wipe' && decision.kind === 'retry-transition'
      ? existingDeadline
      : transitionDeadlineFor(progress.expectedStage)
}

function confirmPendingCompletion(progress: RuntimeProgress): void {
  if (progress.pendingAction === 'confirm-wipe') {
    progress.lastConfirmedStage = 'wipe-confirmed'
  } else if (progress.pendingAction === 'confirm-diagnostic') {
    progress.lastConfirmedStage = 'diagnostic-confirmed'
  }
  progress.pendingAction = null
}

function transitionDeadlineFor(stage: WorkflowExpectedStage): number {
  const timeout = stage === 'wipe-transition'
    ? WORKFLOW_TIMEOUTS.wipeTransitionMs
    : WORKFLOW_TIMEOUTS.defaultMs
  return Date.now() + timeout
}

function runtimeActionLabel(action: RuntimeAction): string {
  return action.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

function logRuntimeDecision(
  context: AssetWorkflowContext,
  observedState: string,
  progress: RuntimeProgress,
  decision: RuntimeDecision,
): void {
  const action = 'action' in decision ? decision.action : 'none'
  context.log(decision.kind === 'needs-review' ? 'error' : 'info', 'Runtime state reconciled.', {
    reason: [
      `observed=${observedState}`,
      `expected=${progress.expectedStage}`,
      `lastConfirmed=${progress.lastConfirmedStage}`,
      `pending=${progress.pendingAction ?? 'none'}`,
      `decision=${decision.kind}`,
      `action=${action}`,
      `assetEnterRetry=${progress.retries.assetEnter}/${WORKFLOW_RECOVERY_LIMITS.assetSubmissionEnterRetries}`,
      `confirmWipeRetry=${progress.retries.confirmWipe}/${WORKFLOW_RECOVERY_LIMITS.confirmWipeRetries}`,
      `reason=${decision.reason}`,
    ].join('; '),
  })
}

async function verifyWorkflowCompletion(
  context: WorkflowRuntime,
  mode: 'EOL' | 'MRI' | 'MRI_FAIL',
): Promise<void> {
  if (mode === 'EOL') {
    await verifyEolCompletion(context)
    return
  }

  if (mode === 'MRI') {
    await verifyMriPassCompletion(context)
    return
  }

  await verifyMoveToRepairCompletion(context)
}

async function runRepairWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  await runWorkflowStep(context, 'Repair entry detection', async () => {
    await closePopupIfPresent(context)

    const landingScan = await findInitialScanner(context.page)

    if (landingScan !== null) {
      await typeAndSubmit(context, landingScan, context.assetId)
      await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.repairSettleMs)
      await closePopupIfPresent(context)
    }
  })

  const stage = await waitForRepairEntryStage(context)
  let locatorSelected = false

  if (stage === 'moveToRepair') {
    await runWorkflowStep(context, 'Repair move to repair', async () => {
      await completeMoveToRepair(context, context.options.repairLocator)
      locatorSelected = true
      await waitForRepairStartedStage(context)
    })
  }

  if (!locatorSelected) {
    await runWorkflowStep(context, 'Repair locator selection', async () => {
      const locatorInput = await scopedWait(
        context,
        'Repair Started locator input',
        () => findRepairLocatorInput(context.page),
        WORKFLOW_TIMEOUTS.defaultMs,
      )
      await selectRepairLocatorByKeyboard(
        context,
        locatorInput,
        context.options.repairLocator,
      )
    })
  }

  await runWorkflowStep(context, 'Repair asset scan', async () => {
    const repairInput = await findRepairInput(context.page)

    if (repairInput !== null) {
      await typeAndSubmit(context, repairInput, context.assetId)
      await closePopupIfPresent(context)
    }
  })

  if (context.options.repairOutcome === 'failed') {
    await runWorkflowStep(context, 'Repair failed outcome', async () => {
      await completeRepairFailed(context)
    })
    return {
      mode: 'REPAIR',
      signal:
        'Failure dialog closed and optional Confirm Repair either cleared or was absent.',
    }
  }

  await runWorkflowStep(context, 'Repair confirmed outcome', async () => {
    await completeRepairConfirmed(context)
  })
  return {
    mode: 'REPAIR',
    signal: 'Confirm Repair cleared after repair confirmation.',
  }
}

async function completeRepairConfirmed(
  context: AssetWorkflowContext,
): Promise<void> {
  const confirmRepair = await popupAwareWait(
    context,
    'Confirm Repair button',
    () => findConfirmRepairButton(context.page, true),
    WORKFLOW_TIMEOUTS.defaultMs,
  )

  await clickWithSettles(context, confirmRepair, 75, 300)
  await waitForConfirmRepairToClear(context)
}

async function completeRepairFailed(
  context: AssetWorkflowContext,
): Promise<void> {
  const repairFailed = await popupAwareWait(
    context,
    'Repair Failed button',
    () => findRepairFailedButton(context.page, true),
    WORKFLOW_TIMEOUTS.defaultMs,
  )

  await clickWithSettles(context, repairFailed, 75, 300)
  await completeFailureReasonDialog(context)

  const optionalConfirm = await waitForOptionalConfirmRepair(context)

  if (optionalConfirm !== null) {
    await clickWithSettles(context, optionalConfirm, 75, 300)
    await waitForConfirmRepairToClear(context)
  }
}

async function waitForRepairEntryStage(
  context: AssetWorkflowContext,
): Promise<'moveToRepair' | 'repairStarted'> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < WORKFLOW_TIMEOUTS.defaultMs) {
    await context.checkpoint()
    await closePopupIfPresent(context)

    if ((await findConfirmMoveButton(context.page)) !== null) {
      return 'moveToRepair'
    }

    if (
      (await findRepairSection(context.page)) !== null &&
      (await findRepairFailedButton(context.page, false)) !== null
    ) {
      return 'repairStarted'
    }

    await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.repairStagePollMs)
  }

  throw new WorkflowInvariantError(
    'Repair stage not found (neither Move to Repair nor Repair Started).',
  )
}

async function waitForRepairStartedStage(
  context: AssetWorkflowContext,
): Promise<void> {
  await popupAwareWait(
    context,
    'Repair Started stage',
    async () =>
      (await findRepairSection(context.page)) !== null &&
      (await findRepairFailedButton(context.page, false)) !== null
        ? true
        : null,
    WORKFLOW_TIMEOUTS.defaultMs,
  )
}

async function waitForOptionalConfirmRepair(
  context: AssetWorkflowContext,
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < WORKFLOW_TIMEOUTS.repairOptionalConfirmMs) {
    await context.checkpoint()
    await closePopupIfPresent(context)

    const confirmRepair = await findConfirmRepairButton(context.page, true)

    if (confirmRepair !== null) {
      return confirmRepair
    }

    await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.repairStagePollMs)
  }

  return null
}

async function waitForConfirmRepairToClear(
  context: AssetWorkflowContext,
): Promise<void> {
  await scopedWait(
    context,
    'Confirm Repair to clear',
    async () =>
      (await findConfirmRepairButton(context.page, false)) === null ? true : null,
    WORKFLOW_TIMEOUTS.repairAdvanceMs,
  )
}

async function verifyEolCompletion(
  context: WorkflowRuntime,
): Promise<void> {
  await verifySafeInitialState(context, async () => {
    const confirmWipe = await findConfirmWipe(context.page)
    return confirmWipe === null
  })
}

async function verifyMriPassCompletion(
  context: WorkflowRuntime,
): Promise<void> {
  await verifySafeInitialState(context, async () => {
    const confirmDiagnostic = await findConfirmDiagnostic(context.page)
    return confirmDiagnostic === null
  })
}

async function verifyMoveToRepairCompletion(
  context: WorkflowRuntime,
): Promise<void> {
  await scopedWait(
    context,
    'Move to Repair completion',
    async () => {
      await context.ensurePageReady()
      return (await findConfirmMoveButton(context.page)) === null ? true : null
    },
    WORKFLOW_TIMEOUTS.completionVerificationMs,
  )
}

async function verifySafeInitialState(
  context: WorkflowRuntime,
  confirmationCleared: () => Promise<boolean>,
): Promise<void> {
  try {
    await popupAwareWait(
      context,
      'safe initial state',
      async () => {
        await context.ensurePageReady()

        if (await hasVisibleAssetErrorDialog(context.page)) {
          return null
        }

        if (!(await confirmationCleared())) {
          return null
        }

        const initialScanner = await findInitialScanner(context.page)
        return initialScanner !== null ? true : null
      },
      WORKFLOW_TIMEOUTS.completionVerificationMs,
    )
  } catch (error: unknown) {
    if (error instanceof AssetSkipError) {
      throw error
    }

    throw new NeedsReviewError('Completion could not be verified.')
  }
}

export async function getVisibleActionCount(context: WorkflowRuntime): Promise<number> {
  return countVisible(context.page.locator('button, [role="button"]'))
}

export async function isActionable(locator: import('playwright-core').Locator): Promise<boolean> {
  return (await isLocatorVisible(locator)) && (await isLocatorEnabled(locator))
}

async function runWorkflowStep<T>(
  context: AssetWorkflowContext,
  step: string,
  action: () => Promise<T>,
): Promise<T> {
  context.setStep(step)

  try {
    const result = await action()
    context.completeStep(step)
    return result
  } catch (error: unknown) {
    context.log('error', 'Workflow step failed.', {
      errorClass: error instanceof Error ? error.name : 'WorkflowError',
      reason: error instanceof Error ? error.message : 'workflow-error',
    })
    throw error
  }
}
