import type { Locator } from 'playwright-core'
import {
  resolveSnapshotStage,
  resolveStageControlState,
  type MesWorkflowStage,
  type StageLoopMode,
} from './deterministicStageCore.ts'
import { capturePassiveStageSnapshot } from './passiveStageSnapshot.ts'
import type { StageControlProbe } from './stageControlResolver.ts'
import type { MoveToRepairStageProbe } from './moveToRepairStageResolver.ts'
import { WORKFLOW_TIMEOUTS, type AssetWorkflowContext } from './types.ts'

export { probeStageControls } from './stageControlResolver.ts'

export interface WorkflowStageSnapshot {
  stage: MesWorkflowStage
  start: Awaited<ReturnType<typeof probeStartButton>>
  wipe: StageControlProbe
  diagnostic: StageControlProbe
  initial: {
    state: 'initial-empty' | 'initial-asset' | 'initial-unexpected' | 'ambiguous'
    locator: Locator | null
    candidateCount: number
    enabled: boolean
    editable: boolean
  }
  failureDialogCount: number
  moveToRepairCount: number
  moveToRepair: MoveToRepairStageProbe
  mriCompletionCount: number
  activeWorkflowPresent: boolean
  durationMs: number
}

export async function observeWorkflowStage(
  context: AssetWorkflowContext,
  mode: StageLoopMode,
): Promise<WorkflowStageSnapshot> {
  const startedAt = Date.now()
  await context.ensurePageReady()
  const diagnosticAction = mode === 'MRI_FAIL' ? 'fail' : 'pass'
  const passive = await capturePassiveStageSnapshot(
    context.page,
    context.assetId,
    diagnosticAction,
  )
  const wipeState = resolveStageControlState('Wipe', passive.wipe)
  const diagnosticState = resolveStageControlState(
    'Diagnostic',
    passive.diagnostic,
    diagnosticAction,
  )
  const stage = resolveSnapshotStage({
    mode,
    startCount: passive.startCount,
    startActionable: passive.startActionable,
    wipe: wipeState,
    diagnostic: diagnosticState,
    initialState: passive.initial.state,
    initialCount: passive.initial.candidateCount,
    initialEnabled: passive.initial.enabled,
    failureDialogCount: passive.failureDialogCount,
    moveToRepairCount: passive.moveToRepair.bundleCount,
    mriCompletionCount: passive.mriCompletionCount,
    activeWorkflowPresent: passive.activeWorkflowPresent,
  })
  const durationMs = Date.now() - startedAt
  return {
    stage,
    start: {
      locator: passive.startCount === 1 && passive.startActionable
        ? context.page.locator(
            'button[role="button"][aria-label="Start"][data-logging-label="Start"]',
          )
        : null,
      candidateCount: passive.startCount,
      durationMs,
    },
    wipe: passiveProbe(wipeState, passive.wipe, durationMs),
    diagnostic: passiveProbe(diagnosticState, passive.diagnostic, durationMs),
    initial: {
      ...passive.initial,
      locator: passive.initial.candidateCount === 1
        ? context.page.getByPlaceholder(
            /^Scan the asset tag or serial number to get started$/i,
          )
        : null,
    },
    failureDialogCount: passive.failureDialogCount,
    moveToRepairCount: passive.moveToRepair.bundleCount,
    moveToRepair: {
      ...passive.moveToRepair,
      resolutionStrategy: 'nearest-actionable-control-bundle',
      durationMs,
    },
    mriCompletionCount: passive.mriCompletionCount,
    activeWorkflowPresent: passive.activeWorkflowPresent,
    durationMs,
  }
}

export async function probeStartButton(context: AssetWorkflowContext): Promise<{
  locator: Locator | null
  candidateCount: number
  durationMs: number
}> {
  const startedAt = Date.now()
  const candidates = context.page.locator(
    'button[role="button"][aria-label="Start"][data-logging-label="Start"]',
  )
  const count = await candidates.count().catch(() => 0)
  if (count !== 1) return { locator: null, candidateCount: count, durationMs: Date.now() - startedAt }
  const candidate = candidates.nth(0)
  const actionable = await candidate.getAttribute('aria-disabled', {
    timeout: WORKFLOW_TIMEOUTS.semanticProbeMs,
  }).catch(() => 'true') !== 'true' &&
    await candidate.isEnabled({ timeout: WORKFLOW_TIMEOUTS.semanticProbeMs }).catch(() => false)
  return {
    locator: actionable ? candidate : null,
    candidateCount: count,
    durationMs: Date.now() - startedAt,
  }
}

function passiveProbe(
  state: MesWorkflowStage,
  evidence: StageControlProbe['evidence'],
  durationMs: number,
): StageControlProbe {
  return { state, evidence, scanner: null, button: null, durationMs }
}
