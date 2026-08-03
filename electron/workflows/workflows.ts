import { AssetSkipError, NeedsReviewError, WorkflowInvariantError } from './errors'
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
} from './stateDetectors'
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
  await startAsset(context)
  await runWipePass(context)
  await verifyWorkflowCompletion(context, 'EOL')

  return {
    mode: 'EOL',
    signal: 'Confirm wipe cleared and the initial scanner returned enabled.',
  }
}

async function runMriPassWorkflow(
  context: AssetWorkflowContext,
): Promise<CompletionSignal> {
  await startAsset(context)
  await runWipePass(context)
  await runDiagnosticPass(context)
  await verifyWorkflowCompletion(context, 'MRI')

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
  await startAsset(context)
  await runWipePass(context)
  await scanDiagnosticAsset(context)
  await completeDiagnosticFailure(context)
  await moveToRepair(context, context.options.moveToRepairLocator)
  await verifyWorkflowCompletion(context, 'MRI_FAIL')

  return {
    mode: 'MRI_FAIL',
    signal: 'Confirm move cleared after verified Move to Repair selection.',
  }
}

async function startAsset(
  context: AssetWorkflowContext,
): Promise<void> {
  await runWorkflowStep(context, 'Start asset: initial scan', async () => {
    await closePopupIfPresent(context)

    const scan1 = await popupAwareWait(
      context,
      'initial scanner',
      () => findInitialScanner(context.page),
      WORKFLOW_TIMEOUTS.initialScannerMs,
    )
    await typeAndSubmit(context, scan1, context.assetId)
    await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.mriShortDelayMs)
    await closePopupIfPresent(context)
  })

  await runWorkflowStep(context, 'Start asset: start', async () => {
    const startButton = await popupAwareWait(
      context,
      'Start button',
      () => findStartButton(context.page),
      WORKFLOW_TIMEOUTS.startButtonMs,
    )
    await clickWithSettles(context, startButton, 150, 350)
    await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.mriShortDelayMs)
  })
}

async function runWipePass(
  context: AssetWorkflowContext,
): Promise<void> {
  await runWorkflowStep(context, 'Wipe pass', async () => {
    const wipeScan = await waitForMriStepInput(context, 'Wipe')
    await typeAndSubmit(context, wipeScan, context.assetId)

    const confirmWipe = await popupAwareWait(
      context,
      'Confirm wipe button',
      () => findMriConfirmWipe(context),
      WORKFLOW_TIMEOUTS.confirmWipeMs,
    )
    await clickWithSettles(context, confirmWipe, 75, 300)
    await closePopupIfPresent(context)
  })
}

async function scanDiagnosticAsset(
  context: AssetWorkflowContext,
): Promise<void> {
  await runWorkflowStep(context, 'Diagnostic scan', async () => {
    const diagnosticScan = await waitForMriStepInput(context, 'Diagnostic')
    await typeAndSubmit(context, diagnosticScan, context.assetId)
  })
}

async function runDiagnosticPass(
  context: AssetWorkflowContext,
): Promise<void> {
  await scanDiagnosticAsset(context)

  await runWorkflowStep(context, 'Diagnostic pass', async () => {
    const confirmDiagnostic = await popupAwareWait(
      context,
      'Confirm diagnostic button',
      () => findMriConfirmDiagnostic(context),
      WORKFLOW_TIMEOUTS.confirmDiagnosticMs,
    )
    await clickWithSettles(context, confirmDiagnostic, 75, 300)
    await sleepWithCheckpoint(context, WORKFLOW_TIMEOUTS.mriFinalSettleMs)
    await closePopupIfPresent(context)
  })
}

async function completeDiagnosticFailure(
  context: AssetWorkflowContext,
): Promise<void> {
  await runWorkflowStep(context, 'Diagnostic failed action', async () => {
    const failedButton = await scopedWait(
      context,
      'Diagnostic failed button',
      () => findDiagnosticFailedButton(context),
      WORKFLOW_TIMEOUTS.defaultMs,
    )
    await clickWithSettles(context, failedButton, 75, 300)
  })

  await runWorkflowStep(context, 'Failure reason dialog', async () => {
    await completeFailureReasonDialog(context)
  })
}

async function moveToRepair(
  context: AssetWorkflowContext,
  locator: string,
): Promise<void> {
  await runWorkflowStep(context, 'Move to repair', async () => {
    await completeMoveToRepair(context, locator)
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

async function waitForMriStepInput(
  context: AssetWorkflowContext,
  stepName: 'Wipe' | 'Diagnostic',
) {
  return popupAwareWait(
    context,
    `${stepName} scanner`,
    () => findStepScanner(context, stepName),
    WORKFLOW_TIMEOUTS.defaultMs,
  )
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
