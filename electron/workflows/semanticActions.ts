import type { Locator } from 'playwright-core'
import {
  AssetSkipError,
  AuthenticationRequiredError,
  BrowserDisconnectedError,
  NeedsReviewError,
  StopRequestedError,
} from './errors.ts'
import {
  closePopupIfPresent,
  type PopupHandlingResult,
} from './popupHandler.ts'
import { clickWithSettles, sleepWithCheckpoint } from './primitives.ts'
import {
  observeWorkflowStage,
  probeStageControls,
  probeStartButton,
  type WorkflowStageSnapshot,
} from './deterministicStages.ts'
import {
  decideSemanticTarget,
  TargetInstabilityDeduplicator,
  type SemanticActivationAction,
} from './semanticActionCore.ts'
import { WORKFLOW_RECOVERY_LIMITS } from './transitionRecoveryCore.ts'
import type { AssetWorkflowContext } from './types.ts'
import type { StageLoopMode } from './deterministicStageCore.ts'

export interface SemanticActionDependencies {
  observe(context: AssetWorkflowContext, mode: StageLoopMode): Promise<WorkflowStageSnapshot>
  resolveStart(context: AssetWorkflowContext): ReturnType<typeof probeStartButton>
  resolveStage: typeof probeStageControls
  closePopup(context: AssetWorkflowContext): Promise<PopupHandlingResult>
  click(
    context: AssetWorkflowContext,
    locator: Locator,
    action: SemanticActivationAction,
  ): Promise<void>
  backoff(context: AssetWorkflowContext): Promise<void>
}

const DEFAULT_DEPENDENCIES: SemanticActionDependencies = {
  observe: observeWorkflowStage,
  resolveStart: probeStartButton,
  resolveStage: probeStageControls,
  closePopup: closePopupIfPresent,
  click: (context, locator, action) => action === 'click-start'
    ? clickWithSettles(context, locator, 150, 350)
    : clickWithSettles(context, locator, 75, 300),
  backoff: (context) => sleepWithCheckpoint(
    context,
    WORKFLOW_RECOVERY_LIMITS.semanticTargetBackoffMs,
  ),
}

export async function activateSemanticAction(
  context: AssetWorkflowContext,
  mode: StageLoopMode,
  action: SemanticActivationAction,
  dependencies: SemanticActionDependencies = DEFAULT_DEPENDENCIES,
): Promise<'dispatched' | 'already-advanced'> {
  const diagnostics = new TargetInstabilityDeduplicator(
    WORKFLOW_RECOVERY_LIMITS.targetDiagnosticDedupMs,
  )
  for (
    let attempt = 1;
    attempt <= WORKFLOW_RECOVERY_LIMITS.semanticTargetAttempts;
    attempt += 1
  ) {
    await context.checkpoint()
    if (await dependencies.closePopup(context) !== 'none') {
      logInstability(context, diagnostics, action, 'Popup interrupted semantic resolution.')
      await dependencies.backoff(context)
      continue
    }
    const snapshot = await dependencies.observe(context, mode)
    const decision = decideSemanticTarget(mode, action, snapshot.stage)
    if (decision.kind === 'advanced') {
      flushSuppressed(context, diagnostics, action)
      context.log('info', 'Action already advanced before activation.', {
        reason: `action=${action}; stage=${snapshot.stage}`,
      })
      return 'already-advanced'
    }
    if (decision.kind === 'unsafe') {
      flushSuppressed(context, diagnostics, action)
      context.log('error', 'Action target changed semantically.', {
        reason: `action=${action}; ${decision.reason}`,
      })
      throw new NeedsReviewError(decision.reason)
    }
    if (decision.kind === 'temporarily-unavailable') {
      logInstability(context, diagnostics, action, decision.reason)
      await retryOrExhaust(context, dependencies, action, attempt, diagnostics)
      continue
    }

    const target = await resolveFreshTarget(context, action, dependencies)
    if (target.kind === 'unsafe') {
      flushSuppressed(context, diagnostics, action)
      context.log('error', 'Action target changed semantically.', {
        reason: `action=${action}; ${target.reason}`,
      })
      throw new NeedsReviewError(target.reason)
    }
    if (target.kind === 'unavailable') {
      logInstability(context, diagnostics, action, target.reason)
      await retryOrExhaust(context, dependencies, action, attempt, diagnostics)
      continue
    }

    if (await dependencies.closePopup(context) !== 'none') {
      logInstability(context, diagnostics, action, 'Popup appeared before activation.')
      await retryOrExhaust(context, dependencies, action, attempt, diagnostics)
      continue
    }
    await context.checkpoint()
    context.log('info', 'Action semantic target re-resolved.', { reason: `action=${action}` })
    context.log('info', 'DOM replacement accepted.', {
      reason: `action=${action}; semantic invariants verified`,
    })
    try {
      await dependencies.click(context, target.locator, action)
    } catch (error: unknown) {
      if (
        error instanceof StopRequestedError ||
        error instanceof AuthenticationRequiredError ||
        error instanceof BrowserDisconnectedError ||
        error instanceof AssetSkipError ||
        error instanceof NeedsReviewError
      ) throw error
      logInstability(context, diagnostics, action, 'Fresh semantic target changed during activation.')
      await retryOrExhaust(context, dependencies, action, attempt, diagnostics)
      continue
    }
    flushSuppressed(context, diagnostics, action)
    return 'dispatched'
  }
  throw new NeedsReviewError(`Semantic target instability exhausted for ${action}.`)
}

type FreshTarget =
  | { kind: 'ready'; locator: Locator }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'unsafe'; reason: string }

async function resolveFreshTarget(
  context: AssetWorkflowContext,
  action: SemanticActivationAction,
  dependencies: SemanticActionDependencies,
): Promise<FreshTarget> {
  if (action === 'click-start') {
    const start = await dependencies.resolveStart(context)
    if (start.candidateCount > 1) {
      return { kind: 'unsafe', reason: 'Multiple Start targets are visible.' }
    }
    return start.locator === null
      ? { kind: 'unavailable', reason: 'Start is temporarily unavailable.' }
      : { kind: 'ready', locator: start.locator }
  }
  const stage = action === 'confirm-wipe' ? 'Wipe' : 'Diagnostic'
  const diagnosticAction = action === 'fail-diagnostic' ? 'fail' : 'pass'
  const probe = await dependencies.resolveStage(context, stage, diagnosticAction)
  const expected = action === 'confirm-wipe'
    ? 'wipe-confirm-ready'
    : action === 'confirm-diagnostic' ? 'diagnostic-pass-ready' : 'diagnostic-fail-ready'
  if (probe.state === 'ambiguous' || probe.evidence.sectionCandidateCount > 1) {
    return { kind: 'unsafe', reason: `Multiple ${stage} action targets are visible.` }
  }
  if (probe.state !== expected || probe.button === null) {
    return {
      kind: 'unavailable',
      reason: `${stage} semantic action is temporarily unavailable.`,
    }
  }
  return { kind: 'ready', locator: probe.button }
}

function logInstability(
  context: AssetWorkflowContext,
  diagnostics: TargetInstabilityDeduplicator,
  action: SemanticActivationAction,
  reason: string,
): void {
  const result = diagnostics.record(`${action}:${reason}`, Date.now())
  if (result.summarizedCount > 0) logSuppressed(context, action, result.summarizedCount)
  if (result.emit) {
    context.log('warning', 'Action target temporarily unavailable.', {
      reason: `action=${action}; ${reason}`,
    })
  }
}

async function retryOrExhaust(
  context: AssetWorkflowContext,
  dependencies: SemanticActionDependencies,
  action: SemanticActivationAction,
  attempt: number,
  diagnostics: TargetInstabilityDeduplicator,
): Promise<void> {
  if (attempt >= WORKFLOW_RECOVERY_LIMITS.semanticTargetAttempts) {
    flushSuppressed(context, diagnostics, action)
    context.log('error', 'Target-instability exhausted.', {
      reason: `action=${action}; attempts=${attempt}`,
    })
    throw new NeedsReviewError(`Semantic target instability exhausted for ${action}.`)
  }
  context.log('info', 'Target-instability retry.', {
    reason: `action=${action}; attempt=${attempt}/${WORKFLOW_RECOVERY_LIMITS.semanticTargetAttempts}`,
  })
  await dependencies.backoff(context)
}

function flushSuppressed(
  context: AssetWorkflowContext,
  diagnostics: TargetInstabilityDeduplicator,
  action: SemanticActivationAction,
): void {
  const count = diagnostics.flush()
  if (count > 0) logSuppressed(context, action, count)
}

function logSuppressed(
  context: AssetWorkflowContext,
  action: SemanticActivationAction,
  count: number,
): void {
  context.log('info', 'Repeated target-instability diagnostics suppressed.', {
    reason: `count=${count}; action=${action}`,
  })
}
