import { type Page } from 'playwright-core'
import { LocalHistoryStore } from './history/historyStore'
import { toHistoryOutcome } from './history/historyOutcome'
import type { RunnerBrowserAccess } from './runnerBrowserAccess'
import {
  AssetSkipError,
  AuthenticationRequiredError,
  BrowserDisconnectedError,
  NeedsReviewError,
  StopRequestedError,
  WorkflowInvariantError,
  isBrowserDisconnectedDiagnostic,
  sanitizeWorkflowReason,
} from './workflows/errors'
import { ensureConnected, sleepWithCheckpoint } from './workflows/primitives'
import {
  WORKFLOW_TIMEOUTS,
  type AssetWorkflowContext,
  type WorkflowOptions,
} from './workflows/types'
import { processAssetWorkflow } from './workflows/workflows'
import {
  RuntimeQueueHandoff,
} from './workflows/queueHandoffCore'
import type {
  EolAssetResult,
  EolAssetErrorDetails,
  EolRunnerSnapshot,
  EolRunnerState,
  RunnerDiagnosticEvent,
  RunnerDiagnosticSeverity,
} from '../src/types/eolRunner'
import { parseRunnerStartRequest } from './runnerRequestValidation.ts'
import { sanitizeSensitiveText } from './sanitize.ts'
import { WORKFLOW_LABELS } from '../src/types/eolRunner'

export class EolRunner {
  private readonly managedChrome: RunnerBrowserAccess
  private readonly historyStore: LocalHistoryStore
  private readonly runnerLabel: string
  private readonly onSnapshot: (snapshot: EolRunnerSnapshot) => void
  private snapshot: EolRunnerSnapshot = createEmptySnapshot()
  private runInProgress: Promise<void> | null = null
  private pauseRequested = false
  private stopRequested = false
  private diagnostics: RunnerDiagnosticEvent[] = []
  private nextDiagnosticId = 1
  private currentStep: string | null = null
  private lastCompletedStep: string | null = null
  private authenticationWaitLogged = false
  private readonly queueHandoff = new RuntimeQueueHandoff()
  private historyRunId: number | null = null
  private historyRunFinalStatus: 'completed' | 'stopped' | 'disconnected' | 'error' = 'completed'
  private readonly unsubscribeInvalidation: () => void

  constructor(
    managedChrome: RunnerBrowserAccess,
    historyStore: LocalHistoryStore,
    runnerLabel: string,
    onSnapshot: (snapshot: EolRunnerSnapshot) => void,
  ) {
    this.managedChrome = managedChrome
    this.historyStore = historyStore
    this.runnerLabel = runnerLabel
    this.onSnapshot = onSnapshot
    this.unsubscribeInvalidation = this.managedChrome.onAutomationSessionInvalidated((reason) => {
      this.clearQueueHandoff(reason)
    })
  }

  getSnapshot(): EolRunnerSnapshot {
    return this.snapshot
  }

  async dispose(): Promise<void> {
    this.unsubscribeInvalidation()
    if (this.runInProgress !== null) {
      this.stopRequested = true
      this.historyRunFinalStatus = 'stopped'
    }
    await this.runInProgress?.catch(() => undefined)
    await this.finalizeHistoryRun()
  }

  async start(payload: unknown): Promise<EolRunnerSnapshot> {
    if (this.runInProgress !== null && isActiveRunnerState(this.snapshot.state)) {
      return this.setError('A workflow runner is already active.')
    }

    const request = parseRunnerStartRequest(payload)
    if (request === null) return this.setError('The run configuration was invalid.')
    const { assets } = request

    const page = this.getReadyPage()

    if (page === null) {
      return this.setError(
        'MES must be streaming and authenticated before starting automation.',
      )
    }

    this.pauseRequested = false
    this.stopRequested = false
    this.diagnostics = []
    this.currentStep = null
    this.lastCompletedStep = null
    this.authenticationWaitLogged = false
    this.snapshot = {
      state: 'running',
      mode: request.options.mode,
      modeLabel: WORKFLOW_LABELS[request.options.mode],
      assets: assets.map((id) => ({
        id,
        state: 'pending',
        reason: null,
        errorDetails: null,
      })),
      currentAssetId: null,
      total: assets.length,
      completed: 0,
      skipped: 0,
      needsReview: 0,
      errorMessage: null,
      diagnostics: this.diagnostics,
    }
    this.logDiagnostic('info', 'Run started.')
    this.historyRunFinalStatus = 'completed'
    this.historyRunId = await this.historyStore.createRun(
      request.options.mode,
      new Date().toISOString(),
      this.runnerLabel,
    )
    if (this.historyRunId === null) {
      this.logPersistenceUnavailable('Run history could not be started.')
    }
    const terminalReceipt = this.getValidQueueHandoff()
    if (terminalReceipt !== null) {
      this.logDiagnostic('info', 'New run started with owned terminal receipt.', {
        reason: `previousMode=${terminalReceipt.previousMode}; terminalStage=${terminalReceipt.terminalStage}`,
      })
    }
    this.emitSnapshot()

    this.runInProgress = this.runSequentially(request.options)
    void this.runInProgress.finally(() => {
      this.runInProgress = null
    })

    return this.snapshot
  }

  async pause(): Promise<EolRunnerSnapshot> {
    if (this.snapshot.state !== 'running') {
      return this.snapshot
    }

    this.pauseRequested = true
    this.logDiagnostic('info', 'Runner paused; pending transition deadline suspended.')
    return this.setState('paused')
  }

  async resume(): Promise<EolRunnerSnapshot> {
    if (this.snapshot.state !== 'paused') {
      return this.snapshot
    }

    this.pauseRequested = false
    this.logDiagnostic('info', 'Runner resumed; MES state will be re-observed.')
    return this.setState('running')
  }

  async stop(): Promise<EolRunnerSnapshot> {
    if (!isActiveRunnerState(this.snapshot.state)) {
      return this.snapshot
    }

    this.stopRequested = true
    this.historyRunFinalStatus = 'stopped'
    this.clearQueueHandoff('Stop Safely invalidated the queue handoff.')
    this.logDiagnostic('info', 'Stop Safely requested; no new workflow action will begin.')

    if (this.snapshot.currentAssetId === null) {
      return this.setState('completed')
    }

    return this.setState('stopping')
  }

  private async runSequentially(options: WorkflowOptions): Promise<void> {
    try {
      for (let index = 0; index < this.snapshot.assets.length; index += 1) {
        const asset = this.snapshot.assets[index]
        if (this.stopRequested) {
          this.logDiagnostic('info', 'Run stopped before next asset.')
          this.setState('completed')
          return
        }

        await this.waitAtCheckpoint()

        if (this.stopRequested) {
          this.logDiagnostic('info', 'Run stopped at queue checkpoint.')
          this.setState('completed')
          return
        }

        const continueQueue = await this.runAsset(asset, options)

        if (!continueQueue) {
          return
        }
      }

      this.setState('completed')
      this.logDiagnostic('info', 'Run completed.')
    } catch (error: unknown) {
      if (error instanceof StopRequestedError) {
        this.logDiagnostic('info', 'Run stopped by request.', {
          errorClass: error.name,
        })
        this.setState('completed')
        return
      }

      this.logDiagnostic('error', 'Unexpected runner error.', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        reason: sanitizeWorkflowReason(error),
      })
      this.historyRunFinalStatus = 'error'
      this.setError(getSafeErrorMessage(error))
    } finally {
      await this.finalizeHistoryRun()
      this.snapshot = { ...this.snapshot, currentAssetId: null }
      this.emitSnapshot()
    }
  }

  private async runAsset(
    asset: EolAssetResult,
    options: WorkflowOptions,
  ): Promise<boolean> {
    const assetStartedAt = new Date().toISOString()
    const page = this.getReadyPage()

    if (page === null) {
      this.clearQueueHandoff('Browser unavailability invalidated the queue handoff.')
      const reason = this.getUnavailableReason()
      this.updateAsset(asset.id, 'needs-review', reason)
      this.historyRunFinalStatus = reason === 'browser-disconnected' ? 'disconnected' : 'error'
      await this.persistAssetResult(asset.id, 'needs-review', reason, assetStartedAt)
      this.setState('stopping', 'Managed Chrome is unavailable.')
      return false
    }

    this.snapshot = { ...this.snapshot, currentAssetId: asset.id }
    this.currentStep = null
    this.lastCompletedStep = null
    this.updateAsset(asset.id, 'running', null)
    this.logDiagnostic('info', 'Asset started.', { assetId: asset.id })
    const queueHandoff = this.getValidQueueHandoff()
    if (queueHandoff !== null) {
      this.logDiagnostic('info', 'Next asset started with authorized terminal handoff.', {
        reason: `previousMode=${queueHandoff.previousMode}; terminalStage=${queueHandoff.terminalStage}`,
      })
    }

    const runtime = this.createWorkflowContext(page, asset.id, options)

    try {
      const completion = await processAssetWorkflow(runtime)
      this.updateAsset(asset.id, 'completed', null)
      await this.persistAssetResult(asset.id, 'completed', null, assetStartedAt)
      this.logDiagnostic('info', 'Asset completed.', { assetId: asset.id })
      const identity = this.managedChrome.getAutomationSessionIdentity()
      const authorization = identity === null
        ? null
        : this.queueHandoff.authorize(
            completion.mode,
            completion.terminalStage,
            identity,
          )
      if (authorization !== null) {
        this.logDiagnostic('info', 'Terminal receipt recorded.', {
          reason: [
            `previousMode=${authorization.previousMode}`,
            `terminalStage=${authorization.terminalStage}`,
            `browserGeneration=${authorization.browserGeneration}`,
            `pageGeneration=${authorization.pageGeneration}`,
          ].join('; '),
        })
      }
      await sleepWithCheckpoint(runtime, WORKFLOW_TIMEOUTS.betweenAssetSuccessMs)
      return true
    } catch (error: unknown) {
      if (error instanceof StopRequestedError) {
        this.clearQueueHandoff('Stop Safely invalidated the queue handoff.')
        this.updateAsset(asset.id, 'needs-review', 'stopped', error)
        this.historyRunFinalStatus = 'stopped'
        await this.persistAssetResult(asset.id, 'needs-review', 'stopped', assetStartedAt)
        this.logDiagnostic('warning', 'Asset stopped at a safe action boundary.', {
          assetId: asset.id,
          errorClass: error.name,
          reason: 'stopped',
        })
        this.setState('completed')
        return false
      }

      if (error instanceof AssetSkipError) {
        this.clearQueueHandoff('Asset skip invalidated the queue handoff.')
        this.updateAsset(asset.id, 'skipped', error.reason, error)
        await this.persistAssetResult(asset.id, 'skipped', error.reason, assetStartedAt)
        this.logDiagnostic('warning', 'Asset skipped.', {
          assetId: asset.id,
          errorClass: error.name,
          reason: error.reason,
        })
        await sleepWithCheckpoint(runtime, WORKFLOW_TIMEOUTS.afterAssetSkipMs)
        return !this.stopRequested
      }

      if (
        error instanceof NeedsReviewError ||
        error instanceof WorkflowInvariantError ||
        error instanceof AuthenticationRequiredError ||
        error instanceof BrowserDisconnectedError ||
        isBrowserDisconnectedDiagnostic(error)
      ) {
        this.clearQueueHandoff('Workflow error invalidated the queue handoff.')
        const reason = sanitizeWorkflowReason(error)
        this.updateAsset(asset.id, 'needs-review', reason, error)
        this.historyRunFinalStatus =
          error instanceof BrowserDisconnectedError || isBrowserDisconnectedDiagnostic(error)
            ? 'disconnected'
            : 'error'
        await this.persistAssetResult(asset.id, 'needs-review', reason, assetStartedAt)
        this.logDiagnostic('error', 'Asset needs review.', {
          assetId: asset.id,
          errorClass: error instanceof Error ? error.name : 'WorkflowError',
          reason,
        })
        this.setState('stopping', getSafeErrorMessage(error))
        return false
      }

      this.updateAsset(asset.id, 'needs-review', 'unexpected-error', error)
      this.historyRunFinalStatus = 'error'
      await this.persistAssetResult(
        asset.id,
        'needs-review',
        'unexpected-error',
        assetStartedAt,
      )
      this.clearQueueHandoff('Unexpected error invalidated the queue handoff.')
      this.logDiagnostic('error', 'Unexpected asset error.', {
        assetId: asset.id,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        reason: sanitizeWorkflowReason(error),
      })
      throw error
    } finally {
      this.snapshot = { ...this.snapshot, currentAssetId: null }
      this.recalculateCounts()
      this.emitSnapshot()
    }
  }

  private createWorkflowContext(
    page: Page,
    assetId: string,
    options: WorkflowOptions,
  ): AssetWorkflowContext {
    const getCurrentPage = () => this.getReadyPage() ?? page
    return {
      get page() {
        return getCurrentPage()
      },
      assetId,
      options,
      checkpoint: () => this.waitAtCheckpoint(),
      isStopRequested: () => this.stopRequested,
      ensurePageReady: () => this.ensurePageReady(),
      setStep: (step) => {
        this.currentStep = step
        this.logDiagnostic('info', 'Workflow step started.')
      },
      completeStep: (step) => {
        this.lastCompletedStep = step
        this.currentStep = null
        this.logDiagnostic('info', 'Workflow step completed.')
      },
      log: (severity, message, details) => {
        this.logDiagnostic(severity, message, details)
      },
      getQueueHandoff: () => this.getValidQueueHandoff(),
      consumeQueueHandoff: () => {
        const identity = this.managedChrome.getAutomationSessionIdentity()
        if (identity === null || !this.queueHandoff.consume(identity)) return false
        this.logDiagnostic('info', 'Terminal receipt consumed.')
        return true
      },
      clearQueueHandoff: (reason) => this.clearQueueHandoff(reason),
    }
  }

  private async waitAtCheckpoint(): Promise<void> {
    while (this.pauseRequested && !this.stopRequested) {
      await delay(WORKFLOW_TIMEOUTS.stopPollMs)
    }

    if (this.stopRequested) {
      throw new StopRequestedError()
    }

    await this.ensurePageReady()
  }

  private async ensurePageReady(): Promise<void> {
    for (;;) {
      const page = this.getReadyPage()

      if (page !== null) {
        if (this.authenticationWaitLogged) {
          this.logDiagnostic('info', 'Authentication completed; re-observing MES state.')
          this.authenticationWaitLogged = false
        }
        await ensureConnected(page)
        return
      }

      const lifecycle = this.managedChrome.getState().lifecycle

      if (
        lifecycle === 'authentication-required' ||
        lifecycle === 'launching-authentication' ||
        lifecycle === 'authenticating' ||
        lifecycle === 'resuming-headless'
      ) {
        this.clearQueueHandoff('Authentication interrupted queue handoff ownership.')
        if (!this.authenticationWaitLogged) {
          this.logDiagnostic('warning', 'Authentication transition detected; workflow is waiting.')
          this.authenticationWaitLogged = true
        }
        if (this.stopRequested) throw new StopRequestedError()
        await delay(WORKFLOW_TIMEOUTS.stopPollMs)
        continue
      }

      this.logDiagnostic('error', 'Browser disconnected or unavailable.')
      this.clearQueueHandoff('Browser disconnection invalidated the queue handoff.')
      throw new BrowserDisconnectedError()
    }
  }

  private getReadyPage(): Page | null {
    return this.managedChrome.getAutomationPage()
  }

  private getUnavailableReason(): string {
    const lifecycle = this.managedChrome.getState().lifecycle

    if (
      lifecycle === 'authentication-required' ||
      lifecycle === 'launching-authentication' ||
      lifecycle === 'authenticating' ||
      lifecycle === 'resuming-headless'
    ) {
      return 'authentication-required'
    }

    return 'browser-disconnected'
  }

  private clearQueueHandoff(reason: string): void {
    if (!this.queueHandoff.clear()) return
    this.logDiagnostic('warning', 'Terminal receipt invalidated.', { reason })
  }

  private async persistAssetResult(
    assetId: string,
    state: EolAssetResult['state'],
    reason: string | null,
    startedAt: string,
  ): Promise<void> {
    const outcome = toHistoryOutcome(state)
    if (this.historyRunId === null || outcome === null) return
    await this.historyStore.recordAssetResult({
      runId: this.historyRunId,
      assetId,
      mode: this.snapshot.mode,
      outcome,
      reason: reason === null
        ? null
        : sanitizeDiagnosticMessage(reason).slice(0, 2_000),
      startedAt,
      finishedAt: new Date().toISOString(),
    })
    if (!this.historyStore.getHealth().available) {
      this.logPersistenceUnavailable('Final asset history could not be saved.')
    }
  }

  private async finalizeHistoryRun(): Promise<void> {
    const runId = this.historyRunId
    this.historyRunId = null
    if (runId === null) return
    await this.historyStore.finalizeRun(
      runId,
      this.historyRunFinalStatus,
      new Date().toISOString(),
    )
    if (!this.historyStore.getHealth().available) {
      this.logPersistenceUnavailable('Run history could not be finalized.')
    }
  }

  private logPersistenceUnavailable(message: string): void {
    this.logDiagnostic('warning', message, {
      errorClass: 'HistoryPersistenceError',
      reason: 'Local history is unavailable; automation was not retried.',
    })
  }

  private getValidQueueHandoff(): ReturnType<RuntimeQueueHandoff['peek']> {
    const identity = this.managedChrome.getAutomationSessionIdentity()
    if (identity === null) return null
    const hadReceipt = this.queueHandoff.peek() !== null
    const receipt = this.queueHandoff.peek(identity)
    if (hadReceipt && receipt === null) {
      this.logDiagnostic('warning', 'Terminal receipt invalidated.', {
        reason: 'Controlled browser or page generation no longer matches.',
      })
    }
    return receipt
  }

  private updateAsset(
    id: string,
    state: EolAssetResult['state'],
    reason: string | null,
    error?: unknown,
  ): void {
    const details =
      state === 'skipped' || state === 'needs-review'
        ? this.createErrorDetails(error, reason)
        : null

    this.snapshot = {
      ...this.snapshot,
      assets: this.snapshot.assets.map((asset) =>
        asset.id === id ? { ...asset, state, reason, errorDetails: details } : asset,
      ),
    }
    this.recalculateCounts()
    this.emitSnapshot()
  }

  private recalculateCounts(): void {
    this.snapshot = {
      ...this.snapshot,
      completed: this.snapshot.assets.filter(
        (asset) => asset.state === 'completed',
      ).length,
      skipped: this.snapshot.assets.filter(
        (asset) => asset.state === 'skipped',
      ).length,
      needsReview: this.snapshot.assets.filter(
        (asset) => asset.state === 'needs-review',
      ).length,
    }
  }

  private setState(
    state: EolRunnerState,
    errorMessage: string | null = null,
  ): EolRunnerSnapshot {
    this.snapshot = { ...this.snapshot, state, errorMessage }
    this.emitSnapshot()
    return this.snapshot
  }

  private setError(message: string): EolRunnerSnapshot {
    this.logDiagnostic('error', message)
    return this.setState('error', message)
  }

  private createErrorDetails(
    error: unknown,
    fallbackReason: string | null,
  ): EolAssetErrorDetails {
    return {
      workflowMode: this.snapshot.mode,
      lastCompletedStep: this.lastCompletedStep,
      failingStep: this.currentStep,
      errorClass: error instanceof Error ? error.name : 'WorkflowError',
      sanitizedMessage:
        fallbackReason ?? sanitizeWorkflowReason(error) ?? 'workflow-error',
      timestamp: new Date().toISOString(),
    }
  }

  private logDiagnostic(
    severity: RunnerDiagnosticSeverity,
    message: string,
    details: {
      errorClass?: string
      reason?: string
      assetId?: string
    } = {},
  ): void {
    const event: RunnerDiagnosticEvent = {
      id: this.nextDiagnosticId,
      timestamp: new Date().toISOString(),
      severity,
      runnerState: this.snapshot.state,
      workflowMode: this.snapshot.mode,
      currentStep: this.currentStep,
      message: sanitizeDiagnosticMessage(message),
      errorClass: details.errorClass ?? null,
      reason: details.reason === undefined ? null : sanitizeDiagnosticMessage(details.reason),
      assetId: details.assetId ?? this.snapshot.currentAssetId,
    }

    this.nextDiagnosticId += 1
    this.diagnostics = [...this.diagnostics, event].slice(-500)
    this.snapshot = { ...this.snapshot, diagnostics: this.diagnostics }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.onSnapshot(this.snapshot)
  }
}

function createEmptySnapshot(): EolRunnerSnapshot {
  return {
    state: 'idle',
    mode: 'EOL',
    modeLabel: WORKFLOW_LABELS.EOL,
    assets: [],
    currentAssetId: null,
    total: 0,
    completed: 0,
    skipped: 0,
    needsReview: 0,
    errorMessage: null,
    diagnostics: [],
  }
}

function sanitizeDiagnosticMessage(message: string): string {
  return sanitizeSensitiveText(message)
}

function isActiveRunnerState(state: EolRunnerState): boolean {
  return state === 'running' || state === 'paused' || state === 'stopping'
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof AuthenticationRequiredError) {
    return 'MES authentication is required before continuing automation.'
  }

  if (error instanceof BrowserDisconnectedError || isBrowserDisconnectedDiagnostic(error)) {
    return 'Managed Chrome disconnected during automation.'
  }

  if (error instanceof NeedsReviewError) {
    return sanitizeDiagnosticMessage(error.reason).slice(0, 2_000)
  }

  if (error instanceof WorkflowInvariantError) {
    return sanitizeDiagnosticMessage(error.reason).slice(0, 2_000)
  }

  if (error instanceof Error && error.message.length > 0) {
    return sanitizeDiagnosticMessage(error.message).slice(0, 2_000)
  }

  return 'Workflow runner failed unexpectedly.'
}


async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
