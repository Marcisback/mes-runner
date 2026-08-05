import {
  AssetSkipError,
  NeedsReviewError,
  WorkflowInvariantError,
} from './errors'
import { completeFailureReasonDialog } from './failureDialog'
import { selectRepairLocatorByKeyboard } from './locatorSelector'
import { completeMoveToRepair, validateMoveToRepairLocator } from './moveToRepair'
import { closePopupIfPresent } from './popupHandler'
import {
  clickWithSettles,
  countVisible,
  isLocatorEditable,
  isLocatorEnabled,
  isLocatorVisible,
  popupAwareWait,
  scopedWait,
  sleepWithCheckpoint,
  typeAndSubmit,
} from './primitives'
import {
  findConfirmMoveButton,
  findConfirmRepairButton,
  findConfirmWipe,
  findInitialScanner,
  findRepairFailedButton,
  findRepairInput,
  findRepairLocatorInput,
  findRepairSection,
  hasVisibleAssetErrorDialog,
  inspectInitialScanner,
} from './stateDetectors'
import {
  WORKFLOW_RECOVERY_LIMITS,
} from './transitionRecoveryCore'
import {
  decideQueueHandoff,
  isQueueHandoffAcknowledgementStage,
} from './queueHandoffCore'
import {
  observeWorkflowStage,
  probeStageControls,
  type WorkflowStageSnapshot,
} from './deterministicStages'
import { activateSemanticAction } from './semanticActions'
import {
  isSlowPassiveProbe,
  resolveStageLoopIteration,
  shouldTimeoutPendingAction,
  stabilizeMriCompletion,
  type MesWorkflowStage,
  type StageLoopAction,
} from './deterministicStageCore'
import { BoundedObservationGate } from './passiveObservationCore'
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
  await runDeterministicWorkflow(context, 'EOL')

  return {
    mode: 'EOL',
    signal: 'Confirm wipe cleared and the initial scanner returned enabled.',
    terminalStage: 'eol-completed',
  }
}

async function runMriPassWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  await runDeterministicWorkflow(context, 'MRI')

  return {
    mode: 'MRI',
    signal: 'Move to storage became stably visible after Confirm diagnostic.',
    terminalStage: 'mri-completed',
  }
}

async function runMriFailWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  validateMoveToRepairLocator(context, context.options.moveToRepairLocator)
  await runDeterministicWorkflow(context, 'MRI_FAIL')

  return {
    mode: 'MRI_FAIL',
    signal: 'Confirm move cleared after verified Move to Repair selection.',
    terminalStage: 'move-to-repair-completed',
  }
}

async function runDeterministicWorkflow(
  context: AssetWorkflowContext,
  mode: 'EOL' | 'MRI' | 'MRI_FAIL',
): Promise<void> {
  await runStageLoop(context, mode)
}

interface StageLoopPendingAction {
  action: StageLoopAction
  startedAt: number
  deadline: number
  retryCount: number
  lastStage: MesWorkflowStage
}

class RuntimeTargetChangedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeTargetChangedError'
  }
}

async function runStageLoop(
  context: AssetWorkflowContext,
  mode: 'EOL' | 'MRI' | 'MRI_FAIL',
): Promise<void> {
  let submissionOwned = false
  let pending: StageLoopPendingAction | null = null
  let enterRetries = 0
  let lastStage: MesWorkflowStage | null = null
  let lastDecisionKey = ''
  let lastSlowProbeKey = ''
  let mriCompletionObservations = 0
  let unrecognizedDeadline = Date.now() + WORKFLOW_TIMEOUTS.defaultMs
  let handoffDeadline = Date.now() + WORKFLOW_TIMEOUTS.defaultMs
  let handoffWaitingLogged = false
  let handoffSubmissionPending = false
  let lastObservationStartedKey = ''
  let lastObservationCompletedKey = ''
  let lastObservationTimeoutGeneration = 0
  let expectedFailureDialogLogged = false
  let reservedFailureDialogLogged = false
  let mountingFailureDialogLogged = false
  let recognizedFailureDialogLogged = false
  const observationGate = new BoundedObservationGate<WorkflowStageSnapshot>(
    WORKFLOW_TIMEOUTS.passiveObservationHardMs,
  )

  for (;;) {
    const checkpointStartedAt = Date.now()
    await context.checkpoint()
    const suspendedMs = Date.now() - checkpointStartedAt
    if (suspendedMs > WORKFLOW_TIMEOUTS.stopPollMs * 2) {
      unrecognizedDeadline += suspendedMs
      handoffDeadline += suspendedMs
      if (pending !== null) pending.deadline += suspendedMs
    }
    const expectsFailureDialog = mode === 'MRI_FAIL' && pending?.action === 'fail-diagnostic'
    const failureDialogClassificationDeadline = expectsFailureDialog && pending !== null
      ? pending.startedAt + WORKFLOW_TIMEOUTS.failureDialogMountMs
      : null
    if (expectsFailureDialog && !expectedFailureDialogLogged) {
      context.log('info', 'Expected failure dialog pending.')
      expectedFailureDialogLogged = true
    }
    const popupResult = await closePopupIfPresent(
      context,
      failureDialogClassificationDeadline === null
        ? null
        : {
            expectedWorkflowDialog: 'failure-reason',
            classificationDeadline: failureDialogClassificationDeadline,
          },
    )
    if (popupResult === 'closed') continue
    if (popupResult === 'security') {
      await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.recoveryPollMs)
      continue
    }
    if (popupResult === 'workflow-owned' || popupResult === 'workflow-mounting') {
      if (!reservedFailureDialogLogged) {
        context.log('info', 'Workflow dialog reserved from generic popup handling.', {
          reason: 'classification=failure-reason',
        })
        reservedFailureDialogLogged = true
      }
      if (popupResult === 'workflow-mounting' && !mountingFailureDialogLogged) {
        context.log('info', 'Failure dialog mounting.')
        mountingFailureDialogLogged = true
      }
    }
    if (popupResult === 'classification-expired') {
      context.log('error', 'Workflow dialog classification expired.', {
        reason: 'Expected failure-reason dialog did not become identifiable.',
      })
      throw new NeedsReviewError(
        'Expected failure-reason dialog did not become identifiable before timeout.',
      )
    }

    const observationDiagnosticKey = `${pending?.action ?? 'none'}:${lastStage ?? 'none'}`
    if (observationDiagnosticKey !== lastObservationStartedKey) {
      context.log('info', 'Passive observation started.', {
        reason: `pending=${pending?.action ?? 'none'}`,
      })
      lastObservationStartedKey = observationDiagnosticKey
    }
    const observationStartedAt = Date.now()
    const observation = await observationGate.observe(
      () => observeWorkflowStage(context, mode),
    )
    const staleDiscardCount = observationGate.consumeStaleDiscardCount()
    if (staleDiscardCount > 0) {
      context.log('warning', 'Stale observation discarded.', {
        reason: `count=${staleDiscardCount}`,
      })
    }
    if (observation.kind === 'hard-timeout') {
      if (observation.generation !== lastObservationTimeoutGeneration) {
        context.log('warning', 'Passive observation hard timeout.', {
          reason: [
            `generation=${observation.generation}`,
            `durationMs=${Date.now() - observationStartedAt}`,
            `pending=${pending?.action ?? 'none'}`,
          ].join('; '),
        })
        lastObservationTimeoutGeneration = observation.generation
      }
      await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.recoveryPollMs)
      continue
    }
    const snapshot = observation.value
    if (snapshot.stage === 'failure-dialog' && !recognizedFailureDialogLogged) {
      context.log('info', 'Failure dialog recognized.')
      recognizedFailureDialogLogged = true
    }
    if (observationDiagnosticKey !== lastObservationCompletedKey) {
      context.log('info', 'Passive observation completed.', {
        reason: [
          `generation=${observation.generation}`,
          `durationMs=${snapshot.durationMs}`,
          `stage=${snapshot.stage}`,
          `pending=${pending?.action ?? 'none'}`,
        ].join('; '),
      })
      lastObservationCompletedKey = observationDiagnosticKey
    }
    if (isSlowPassiveProbe(snapshot.durationMs)) {
      context.log('warning', 'Slow passive workflow observation.', {
        reason: `durationMs=${snapshot.durationMs}`,
      })
    }
    const slowProbes = [
      ['start', snapshot.start.durationMs],
      ['wipe', snapshot.wipe.durationMs],
      ['diagnostic', snapshot.diagnostic.durationMs],
    ] as const
    const slowProbeKey = slowProbes
      .filter(([, duration]) => isSlowPassiveProbe(duration))
      .map(([name, duration]) => `${name}:${duration}`)
      .join(',')
    if (slowProbeKey !== '' && slowProbeKey !== lastSlowProbeKey) {
      context.log('warning', 'Slow individual workflow probe.', {
        reason: slowProbeKey,
      })
    }
    lastSlowProbeKey = slowProbeKey

    const handoff = context.getQueueHandoff()
    if (!submissionOwned && handoff !== null) {
      if (snapshot.stage === 'mri-completed') {
        const initial = snapshot.initial
        const scannerState = initial.state === 'initial-unexpected'
          ? 'unexpected-value'
          : initial.state === 'initial-empty' &&
              initial.locator !== null &&
              initial.enabled &&
              await isLocatorEditable(initial.locator)
            ? 'actionable-empty'
            : 'temporarily-unavailable'
        const handoffDecision = decideQueueHandoff(
          handoff,
          true,
          scannerState,
          Date.now() >= handoffDeadline,
        )
        if (handoffDecision.kind === 'wait') {
          if (!handoffWaitingLogged) {
            context.log('info', 'Queue handoff waiting for global scanner.', {
              reason: handoffDecision.reason,
            })
            handoffWaitingLogged = true
          }
          await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.recoveryPollMs)
          continue
        }
        if (handoffDecision.kind === 'reject') {
          context.clearQueueHandoff(handoffDecision.reason)
          throw new NeedsReviewError(handoffDecision.reason)
        }
        if (initial.locator === null) {
          throw new RuntimeTargetChangedError('Queue handoff scanner changed before submission.')
        }
        context.setStep('Submit Asset')
        context.log('info', 'Queue handoff scanner resolved.')
        await typeStageAndSubmit(context, initial.locator, () => {
          if (!context.consumeQueueHandoff()) {
            throw new NeedsReviewError('Terminal receipt changed before submission dispatch.')
          }
        })
        context.log('info', 'Queue handoff asset submission dispatched.')
        submissionOwned = true
        handoffSubmissionPending = true
        pending = createStageLoopPending('submit-asset', snapshot.stage, 0)
        continue
      }
      context.clearQueueHandoff(
        snapshot.stage === 'landing'
          ? 'Authorized terminal cleared before queue handoff; clean landing will be used.'
          : 'Authorized terminal was replaced by another MES workflow state.',
      )
    }

    const stabilizedCompletion = stabilizeMriCompletion(
      snapshot.stage,
      mriCompletionObservations,
    )
    let stage = stabilizedCompletion.stage
    const completionStabilizing = stabilizedCompletion.stabilizing
    mriCompletionObservations = stabilizedCompletion.consecutiveObservations
    if (snapshot.stage === 'mri-completed') {
      if (pending !== null) {
        context.log('info', 'Terminal evidence observed during pending action.', {
          reason: `action=${pending.action}; stage=mri-completed; elapsedMs=${Date.now() - pending.startedAt}`,
        })
      }
      if (completionStabilizing) {
        context.log('info', 'Completion stabilization observation.', {
          reason: `pending=${pending?.action ?? 'none'}; evidence=move-to-storage`,
        })
      }
    }
    if (mode === 'EOL' && stage === 'landing' && pending?.action === 'confirm-wipe') {
      stage = 'eol-completed'
    }

    if (stage !== lastStage) {
      context.log('info', `Stage changed: ${lastStage ?? 'none'} -> ${stage}`, {
        reason: formatSnapshotEvidence(snapshot, pending),
      })
      lastStage = stage
      lastDecisionKey = ''
      unrecognizedDeadline = Date.now() + WORKFLOW_TIMEOUTS.defaultMs
    }

    if (!submissionOwned && snapshot.activeWorkflowPresent) {
      throw new NeedsReviewError(
        'MES already has an active workflow. Finish or exit it before starting another asset.',
      )
    }

    const iteration = resolveStageLoopIteration(
      mode,
      stage,
      submissionOwned,
      pending?.action ?? null,
    )
    const handoffAcknowledged = !handoffSubmissionPending ||
      isQueueHandoffAcknowledgementStage(stage)
    if (pending !== null && iteration.acknowledged && handoffAcknowledged) {
      const acceptedAfterDeadline = Date.now() >= pending.deadline
      context.log('info', 'Postcondition observed.', {
        reason: `action=${pending.action}; stage=${stage}; elapsedMs=${Date.now() - pending.startedAt}`,
      })
      if (acceptedAfterDeadline) {
        context.log('warning', 'Postcondition accepted after nominal deadline.', {
          reason: `action=${pending.action}; stage=${stage}; elapsedMs=${Date.now() - pending.startedAt}`,
        })
      }
      context.log('info', `Action acknowledged: ${pending.action}`)
      if (pending.action === 'fail-diagnostic' && stage === 'failure-dialog') {
        context.log('info', 'fail-diagnostic acknowledged by failure-dialog.')
      }
      context.completeStep(stageLoopActionLabel(pending.action))
      if (pending.action === 'submit-asset' || pending.action === 'press-enter') {
        context.log('info', `Submission acknowledged by stage: ${stage}`)
        if (handoffSubmissionPending) {
          context.log('info', 'Queue handoff postcondition acknowledged.', {
            reason: `observedStage=${stage}`,
          })
          handoffSubmissionPending = false
        }
      }
      pending = null
    }

    if (pending !== null) {
      pending.lastStage = stage
      const elapsed = Date.now() - pending.startedAt
      if (completionStabilizing) continue
      if (
        pending.action === 'submit-asset' &&
        stage === 'asset-retained' &&
        Date.now() >= pending.deadline &&
        enterRetries < WORKFLOW_RECOVERY_LIMITS.assetSubmissionEnterRetries
      ) {
        try {
          await dispatchStageLoopAction(context, mode, 'press-enter')
        } catch (error: unknown) {
          if (error instanceof RuntimeTargetChangedError) {
            context.log('info', 'Enter retry target changed; re-observing MES.')
            continue
          }
          throw error
        }
        enterRetries += 1
        pending = createStageLoopPending('press-enter', stage, enterRetries)
        context.log('warning', 'Asset submission Enter retried.', {
          reason: `retry=${enterRetries}/${WORKFLOW_RECOVERY_LIMITS.assetSubmissionEnterRetries}`,
        })
        continue
      }
      if (shouldTimeoutPendingAction(false, completionStabilizing, Date.now() >= pending.deadline)) {
        context.log('error', `Action timed out: ${pending.action}`, {
          reason: `lastStage=${stage}; elapsedMs=${elapsed}`,
        })
        if (pending.action === 'submit-asset' || pending.action === 'press-enter') {
          throw new NeedsReviewError(
            stage === 'asset-retained'
              ? 'Asset submission Enter retry limit was exhausted.'
              : 'MES did not expose the submitted asset workflow before timeout.',
          )
        }
        if (pending.action === 'fail-diagnostic') {
          context.log('error', 'Workflow dialog classification expired.', {
            reason: 'Expected failure-reason dialog did not appear before transition timeout.',
          })
          throw new NeedsReviewError(
            'Expected failure-reason dialog did not appear before transition timeout.',
          )
        }
        throw new NeedsReviewError(`MES did not confirm ${pending.action} before timeout.`)
      }
      await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.recoveryPollMs)
      continue
    }

    const decision = iteration.decision
    const decisionKey = `${stage}:${decision.kind}:${'action' in decision ? decision.action : decision.reason}`
    if (decisionKey !== lastDecisionKey) {
      context.log(decision.kind === 'needs-review' ? 'error' : 'info', `Decision: ${
        'action' in decision ? decision.action : decision.kind
      }`, { reason: decision.reason })
      lastDecisionKey = decisionKey
    }

    if (decision.kind === 'complete') {
      if (mode === 'EOL') await verifyEolCompletion(context)
      return
    }
    if (decision.kind === 'needs-review') throw new NeedsReviewError(decision.reason)
    if (decision.kind === 'wait') {
      if (Date.now() >= unrecognizedDeadline) {
        throw new NeedsReviewError(`MES remained at ${stage} without a safe action before timeout.`)
      }
      await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.recoveryPollMs)
      continue
    }

    let dispatchOutcome: StageActionDispatchOutcome
    try {
      dispatchOutcome = await dispatchStageLoopAction(context, mode, decision.action)
    } catch (error: unknown) {
      if (error instanceof RuntimeTargetChangedError) {
        context.log('info', 'Action target changed; re-observing MES.', {
          reason: error.message,
        })
        lastDecisionKey = ''
        continue
      }
      throw error
    }
    if (dispatchOutcome === 'already-advanced') {
      lastDecisionKey = ''
      continue
    }
    if (decision.action === 'complete-move-to-repair') {
      await verifyMoveToRepairCompletion(context)
      context.completeStep(stageLoopActionLabel(decision.action))
      return
    }
    if (decision.action === 'submit-asset') submissionOwned = true
    pending = createStageLoopPending(decision.action, stage, 0)
    context.log('info', `Action dispatched: ${decision.action}`, {
      reason: `deadlineMs=${pending.deadline - pending.startedAt}`,
    })
  }
}

function createStageLoopPending(
  action: StageLoopAction,
  stage: MesWorkflowStage,
  retryCount: number,
): StageLoopPendingAction {
  const timeout = action === 'confirm-wipe'
    ? WORKFLOW_TIMEOUTS.wipeTransitionMs
    : WORKFLOW_TIMEOUTS.defaultMs
  const startedAt = Date.now()
  return {
    action: action === 'press-enter' ? 'submit-asset' : action,
    startedAt,
    deadline: startedAt + timeout,
    retryCount,
    lastStage: stage,
  }
}

async function dispatchStageLoopAction(
  context: AssetWorkflowContext,
  mode: 'EOL' | 'MRI' | 'MRI_FAIL',
  action: StageLoopAction,
): Promise<StageActionDispatchOutcome> {
  const label = stageLoopActionLabel(action)
  context.setStep(label)
  context.log('info', `Action started: ${action}`)
  try {
    let outcome: StageActionDispatchOutcome = 'dispatched'
    switch (action) {
      case 'submit-asset': {
        const snapshot = await observeWorkflowStage(context, mode)
        const initial = snapshot.initial
        if (
          snapshot.stage !== 'landing' ||
          initial.locator === null ||
          !initial.enabled ||
          !(await isLocatorEditable(initial.locator))
        ) throw new RuntimeTargetChangedError('Clean landing changed before submission.')
        context.log('info', 'Target resolved: initial-scanner')
        await typeStageAndSubmit(context, initial.locator)
        break
      }
      case 'press-enter': {
        const initial = await inspectInitialScanner(context.page, context.assetId)
        if (initial.state !== 'initial-asset' || initial.locator === null || !initial.enabled) {
          throw new RuntimeTargetChangedError('Retained asset changed before Enter recovery.')
        }
        context.log('info', 'Target resolved: retained-initial-scanner')
        await initial.locator.focus()
        await context.page.keyboard.press('Enter')
        break
      }
      case 'click-start':
      case 'confirm-wipe':
      case 'confirm-diagnostic':
      case 'fail-diagnostic': {
        outcome = await activateSemanticAction(context, mode, action)
        break
      }
      case 'scan-wipe-asset':
        await scanScopedStage(context, 'Wipe', mode)
        break
      case 'scan-diagnostic-asset':
        await scanScopedStage(context, 'Diagnostic', mode)
        break
      case 'complete-failure-dialog':
        await completeFailureReasonDialog(context)
        break
      case 'complete-move-to-repair':
        await completeMoveToRepair(context, context.options.moveToRepairLocator)
        break
    }
    if (outcome === 'dispatched') context.log('info', 'Input action dispatched.')
    return outcome
  } catch (error: unknown) {
    context.log('error', 'Workflow step failed.', {
      errorClass: error instanceof Error ? error.name : 'WorkflowError',
      reason: error instanceof Error ? error.message : 'workflow-error',
    })
    throw error
  }
}

async function scanScopedStage(
  context: AssetWorkflowContext,
  stage: 'Wipe' | 'Diagnostic',
  mode: 'EOL' | 'MRI' | 'MRI_FAIL',
): Promise<void> {
  const action = mode === 'MRI_FAIL' ? 'fail' : 'pass'
  const probe = await probeStageControls(context, stage, action)
  const expected = stage === 'Wipe' ? 'wipe-scan-ready' : 'diagnostic-scan-ready'
  if (probe.state !== expected || probe.scanner === null) {
    throw new RuntimeTargetChangedError(`${stage} scanner changed before scanning.`)
  }
  context.log('info', `Target resolved: scoped-${stage.toLowerCase()}-scanner`)
  await typeStageAndSubmit(context, probe.scanner)
}

async function typeStageAndSubmit(
  context: AssetWorkflowContext,
  scanner: import('playwright-core').Locator,
  beforeSubmit?: () => void,
): Promise<void> {
  await context.checkpoint()
  await scanner.scrollIntoViewIfNeeded()
  if (
    !(await isLocatorVisible(scanner)) ||
    !(await isLocatorEnabled(scanner)) ||
    !(await isLocatorEditable(scanner))
  ) throw new RuntimeTargetChangedError('Scoped scanner is no longer actionable.')
  await scanner.click()
  await scanner.fill('')
  await scanner.pressSequentially(context.assetId, { delay: 10 })
  if ((await scanner.inputValue()) !== context.assetId) {
    throw new WorkflowInvariantError('Scoped scanner did not retain the current asset.')
  }
  beforeSubmit?.()
  await context.page.keyboard.press('Enter')
  await sleepWithCheckpoint(context, 400)
}

function stageLoopActionLabel(action: StageLoopAction): string {
  const labels: Record<StageLoopAction, string> = {
    'submit-asset': 'Submit Asset',
    'press-enter': 'Submit Asset',
    'click-start': 'Start Workflow',
    'scan-wipe-asset': 'Wipe Scan',
    'confirm-wipe': 'Confirm Wipe',
    'scan-diagnostic-asset': 'Diagnostic Scan',
    'confirm-diagnostic': 'Confirm Diagnostic',
    'fail-diagnostic': 'Diagnostic Failed',
    'complete-failure-dialog': 'Failure dialog',
    'complete-move-to-repair': 'Move to Repair',
  }
  return labels[action]
}

type StageActionDispatchOutcome = 'dispatched' | 'already-advanced'

function formatSnapshotEvidence(
  snapshot: WorkflowStageSnapshot,
  pending: StageLoopPendingAction | null,
): string {
  const active = snapshot.stage.startsWith('diagnostic') ? snapshot.diagnostic : snapshot.wipe
  const prefix = snapshot.stage.startsWith('diagnostic') ? 'diagnostic' : 'wipe'
  return [
    `${prefix}HeadingMatches=${active.evidence.headingMatchCount}`,
    `${prefix}ScannerCandidates=${active.evidence.scannerCandidateCount}`,
    `${prefix}Bundles=${active.evidence.sectionCandidateCount}`,
    `${prefix}ScannerVisible=${active.evidence.scannerVisible}`,
    `${prefix}ScannerEnabled=${active.evidence.scannerEnabled}`,
    `${prefix}ScannerEditable=${active.evidence.scannerEditable}`,
    `${prefix}ScannerValue=${active.evidence.scannerValue === 'different' ? 'other' : active.evidence.scannerValue}`,
    `${prefix === 'wipe' ? 'confirmWipe' : 'diagnosticAction'}Matches=${active.evidence.buttonCandidateCount}`,
    `${prefix === 'wipe' ? 'confirmWipe' : 'diagnosticAction'}Enabled=${active.evidence.buttonEnabled}`,
    `ignoredTimelineLabels=${active.evidence.ignoredTimelineLabelCount}`,
    `deduplicatedAncestorCandidates=${active.evidence.deduplicatedAncestorCandidateCount}`,
    `resolutionStrategy=${active.evidence.resolutionStrategy}`,
    `moveToRepairHeadingMatches=${snapshot.moveToRepair.headingMatchCount}`,
    `moveToRepairLocatorCandidates=${snapshot.moveToRepair.locatorCandidateCount}`,
    `confirmMoveMatches=${snapshot.moveToRepair.confirmMoveMatchCount}`,
    `moveToRepairBundles=${snapshot.moveToRepair.bundleCount}`,
    `ignoredGenericLocatorInputs=${snapshot.moveToRepair.ignoredGenericLocatorInputCount}`,
    `ignoredTimelineRepairLabels=${snapshot.moveToRepair.ignoredTimelineRepairLabelCount}`,
    `moveToRepairResolutionStrategy=${snapshot.moveToRepair.resolutionStrategy}`,
    `startTargets=${snapshot.start.candidateCount}`,
    `pending=${pending?.action ?? 'none'}`,
    `transitionElapsedMs=${pending === null ? 0 : Date.now() - pending.startedAt}`,
    `observationDurationMs=${snapshot.durationMs}`,
  ].join('; ')
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
      terminalStage: 'repair-completed',
    }
  }

  await runWorkflowStep(context, 'Repair confirmed outcome', async () => {
    await completeRepairConfirmed(context)
  })
  return {
    mode: 'REPAIR',
    signal: 'Confirm Repair cleared after repair confirmation.',
    terminalStage: 'repair-completed',
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
  completeOnDispatch = true,
): Promise<T> {
  context.setStep(step)

  try {
    const result = await action()
    context.log('info', 'Input action dispatched.')
    if (completeOnDispatch) context.completeStep(step)
    return result
  } catch (error: unknown) {
    context.log('error', 'Workflow step failed.', {
      errorClass: error instanceof Error ? error.name : 'WorkflowError',
      reason: error instanceof Error ? error.message : 'workflow-error',
    })
    throw error
  }
}
