import { isLocatorEnabled, visibleMatches } from './primitives'
import {
  hasVisibleAssetErrorDialog,
  inspectInitialScanner,
  inspectActiveWorkflowAsset,
  inspectStepState,
} from './stateDetectors'
import type { AssetWorkflowContext } from './types'
import {
  resolveObservedState,
  type MesObservedState,
} from './mesRuntimeStateCore'
import type { ActiveWorkflowAssetRelation } from './activeWorkflowAssetCore'

export type { MesObservedState } from './mesRuntimeStateCore'

export interface MesObservationMetadata {
  initialScanner: 'absent' | 'empty' | 'expected-asset' | 'unexpected-value' | 'unreadable'
  initialScannerEnabled: boolean
  startAvailable: boolean
  startTargetCount: number
  wipeTargetCount: number
  diagnosticTargetCount: number
  wipeInputActionable: boolean
  wipeActionActionable: boolean
  wipeInputMatchesAsset: boolean
  diagnosticInputActionable: boolean
  diagnosticPassActionable: boolean
  diagnosticFailActionable: boolean
  diagnosticInputMatchesAsset: boolean
  failureDialogCount: number
  moveToRepairCount: number
  activeWorkflowPresent: boolean
  completionProcessing: boolean
  activeWorkflowAssetRelation: ActiveWorkflowAssetRelation
  activeWorkflowAssetTagResolved: boolean
  activeWorkflowAssetTagCandidateCount: number
  activeWorkflowAssetFieldContainerCount: number
  activeWorkflowAssetValidValueCandidateCount: number
  activeWorkflowAssetResolutionStrategy: 'asset-information-field-row'
  activeStates: MesObservedState[]
}

export interface MesObservation {
  state: MesObservedState
  metadata: MesObservationMetadata
}

export async function observeMesState(
  context: AssetWorkflowContext,
): Promise<MesObservation> {
  await context.ensurePageReady()

  try {
    const initial = await inspectInitialScanner(context.page, context.assetId)
    const startMatches = await visibleMatches(
      context.page.getByRole('button', { name: /^Start$/i }),
    )
    const wipe = await inspectStepState(context, 'Wipe', context.assetId)
    const diagnostic = await inspectStepState(context, 'Diagnostic', context.assetId)
    const failureDialogCount = await countFailureDialogs(context)
    const moveToRepairCount = await countMoveToRepairTargets(context)
    const businessError = await hasVisibleAssetErrorDialog(context.page)
    const activeWorkflowAsset = await inspectActiveWorkflowAsset(
      context.page,
      context.assetId,
    )
    const activeStates: MesObservedState[] = []

    if (startMatches.length === 1 && await isLocatorEnabled(startMatches[0])) {
      activeStates.push('start-ready')
    }
    if (wipe !== null) {
      activeStates.push(
        wipe.inputActionable || wipe.passActionable
          ? 'wipe-ready'
          : 'wipe-processing',
      )
    }
    if (diagnostic !== null) {
      activeStates.push(
        diagnostic.inputActionable ||
          diagnostic.passActionable ||
          diagnostic.failActionable
          ? 'diagnostic-ready'
          : 'diagnostic-processing',
      )
    }
    if (failureDialogCount === 1) activeStates.push('failure-dialog')
    if (moveToRepairCount === 1) activeStates.push('move-to-repair')

    const activeWorkflowPresent = activeWorkflowAsset.activeWorkflowDetected ||
      startMatches.length > 0 ||
      wipe !== null ||
      diagnostic !== null ||
      failureDialogCount > 0 ||
      moveToRepairCount > 0
    const activeWorkflowAssetRelation =
      activeWorkflowPresent && activeWorkflowAsset.relation === 'none'
        ? 'unknown'
        : activeWorkflowAsset.relation
    const completionProcessing =
      activeStates.includes('wipe-processing') ||
      activeStates.includes('diagnostic-processing')

    const metadata: MesObservationMetadata = {
      initialScanner: mapInitialScanner(initial.state, initial.candidateCount),
      initialScannerEnabled: initial.enabled,
      startAvailable: activeStates.includes('start-ready'),
      startTargetCount: startMatches.length,
      wipeTargetCount: wipe === null ? 0 : 1,
      diagnosticTargetCount: diagnostic === null ? 0 : 1,
      wipeInputActionable: wipe?.inputActionable ?? false,
      wipeActionActionable: wipe?.passActionable ?? false,
      wipeInputMatchesAsset: wipe?.inputMatchesAsset ?? false,
      diagnosticInputActionable: diagnostic?.inputActionable ?? false,
      diagnosticPassActionable: diagnostic?.passActionable ?? false,
      diagnosticFailActionable: diagnostic?.failActionable ?? false,
      diagnosticInputMatchesAsset: diagnostic?.inputMatchesAsset ?? false,
      failureDialogCount,
      moveToRepairCount,
      activeWorkflowPresent,
      completionProcessing,
      activeWorkflowAssetRelation,
      activeWorkflowAssetTagResolved: activeWorkflowAsset.assetTagResolved,
      activeWorkflowAssetTagCandidateCount: activeWorkflowAsset.assetTagCandidateCount,
      activeWorkflowAssetFieldContainerCount: activeWorkflowAsset.fieldContainerCount,
      activeWorkflowAssetValidValueCandidateCount: activeWorkflowAsset.validValueCandidateCount,
      activeWorkflowAssetResolutionStrategy: activeWorkflowAsset.strategy,
      activeStates,
    }

    return {
      state: resolveObservedState({
        activeStates,
        startCount: startMatches.length,
        failureDialogCount,
        moveToRepairCount,
        businessError,
        initialState: initial.state,
        initialCandidateCount: initial.candidateCount,
        initialEnabled: initial.enabled,
        activeWorkflowPresent,
        completionProcessing,
        activeWorkflowAssetRelation,
        assetTagCandidateCount: activeWorkflowAsset.assetTagCandidateCount,
      }),
      metadata,
    }
  } catch (error: unknown) {
    if (error instanceof Error && /resolved \d+ candidates|multiple/i.test(error.message)) {
      return { state: 'ambiguous', metadata: emptyObservationMetadata() }
    }
    throw error
  }
}

function mapInitialScanner(
  state: 'initial-empty' | 'initial-asset' | 'initial-unexpected' | 'ambiguous',
  candidateCount: number,
): MesObservationMetadata['initialScanner'] {
  if (candidateCount === 0) return 'absent'
  switch (state) {
    case 'initial-empty': return 'empty'
    case 'initial-asset': return 'expected-asset'
    case 'initial-unexpected': return 'unexpected-value'
    case 'ambiguous': return 'unreadable'
  }
}

async function countFailureDialogs(context: AssetWorkflowContext): Promise<number> {
  const matches = await visibleMatches(
    context.page.locator('[role="dialog"]').filter({
      hasText: 'Select failure reason',
    }),
  )
  return matches.length
}

async function countMoveToRepairTargets(
  context: AssetWorkflowContext,
): Promise<number> {
  let count = 0

  for (const frame of context.page.frames()) {
    const inputs = await visibleMatches(
      frame.locator('input[placeholder="Scan locator"]'),
    )
    const buttons = await visibleMatches(
      frame.getByRole('button', { name: /^Confirm move$/i }),
    )
    if (inputs.length > 1 || buttons.length > 1) return 2
    if (inputs.length === 1 && buttons.length === 1) count += 1
  }

  return count
}

function emptyObservationMetadata(): MesObservationMetadata {
  return {
    initialScanner: 'unreadable',
    initialScannerEnabled: false,
    startAvailable: false,
    startTargetCount: 0,
    wipeTargetCount: 0,
    diagnosticTargetCount: 0,
    wipeInputActionable: false,
    wipeActionActionable: false,
    wipeInputMatchesAsset: false,
    diagnosticInputActionable: false,
    diagnosticPassActionable: false,
    diagnosticFailActionable: false,
    diagnosticInputMatchesAsset: false,
    failureDialogCount: 0,
    moveToRepairCount: 0,
    activeWorkflowPresent: false,
    completionProcessing: false,
    activeWorkflowAssetRelation: 'none',
    activeWorkflowAssetTagResolved: false,
    activeWorkflowAssetTagCandidateCount: 0,
    activeWorkflowAssetFieldContainerCount: 0,
    activeWorkflowAssetValidValueCandidateCount: 0,
    activeWorkflowAssetResolutionStrategy: 'asset-information-field-row',
    activeStates: [],
  }
}
