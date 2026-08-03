import { type BrowserWindow } from 'electron'
import { type Page } from 'playwright-core'
import { EOL_RUNNER_IPC_CHANNELS } from './eolRunnerChannels'
import { ManagedChromeController } from './managedChromeController'
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
import type {
  EolAssetResult,
  EolAssetErrorDetails,
  EolRunnerSnapshot,
  EolRunnerState,
  RepairOutcome,
  RunnerDiagnosticEvent,
  RunnerDiagnosticSeverity,
  WorkflowMode,
} from '../src/types/eolRunner'
import {
  DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  DEFAULT_REPAIR_LOCATOR,
  WORKFLOW_LABELS,
} from '../src/types/eolRunner'

export class EolRunner {
  private snapshot: EolRunnerSnapshot = createEmptySnapshot()
  private runInProgress: Promise<void> | null = null
  private pauseRequested = false
  private stopRequested = false
  private diagnostics: RunnerDiagnosticEvent[] = []
  private nextDiagnosticId = 1
  private currentStep: string | null = null
  private lastCompletedStep: string | null = null

  constructor(
    private readonly hostWindow: BrowserWindow,
    private readonly managedChrome: ManagedChromeController,
  ) {}

  getSnapshot(): EolRunnerSnapshot {
    return this.snapshot
  }

  async start(payload: unknown): Promise<EolRunnerSnapshot> {
    if (this.runInProgress !== null && isActiveRunnerState(this.snapshot.state)) {
      return this.setError('A workflow runner is already active.')
    }

    const request = parseStartRequest(payload)
    const assets = parseAssets(request.assetsText)

    if (assets.length === 0) {
      return this.setError('Enter at least one asset ID before starting.')
    }

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
    return this.setState('paused')
  }

  async resume(): Promise<EolRunnerSnapshot> {
    if (this.snapshot.state !== 'paused') {
      return this.snapshot
    }

    this.pauseRequested = false
    return this.setState('running')
  }

  async stop(): Promise<EolRunnerSnapshot> {
    if (!isActiveRunnerState(this.snapshot.state)) {
      return this.snapshot
    }

    this.stopRequested = true

    if (this.snapshot.currentAssetId === null) {
      return this.setState('completed')
    }

    return this.setState('stopping')
  }

  private async runSequentially(options: WorkflowOptions): Promise<void> {
    try {
      for (const asset of this.snapshot.assets) {
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
      this.setError(getSafeErrorMessage(error))
    } finally {
      this.snapshot = { ...this.snapshot, currentAssetId: null }
      this.emitSnapshot()
    }
  }

  private async runAsset(
    asset: EolAssetResult,
    options: WorkflowOptions,
  ): Promise<boolean> {
    const page = this.getReadyPage()

    if (page === null) {
      this.updateAsset(asset.id, 'needs-review', this.getUnavailableReason())
      this.setState('stopping', 'Managed Chrome is unavailable.')
      return false
    }

    this.snapshot = { ...this.snapshot, currentAssetId: asset.id }
    this.currentStep = null
    this.lastCompletedStep = null
    this.updateAsset(asset.id, 'running', null)
    this.logDiagnostic('info', 'Asset started.', { assetId: asset.id })

    const runtime = this.createWorkflowContext(page, asset.id, options)

    try {
      await processAssetWorkflow(runtime)
      this.updateAsset(asset.id, 'completed', null)
      this.logDiagnostic('info', 'Asset completed.', { assetId: asset.id })
      await sleepWithCheckpoint(runtime, WORKFLOW_TIMEOUTS.betweenAssetSuccessMs)
      return true
    } catch (error: unknown) {
      if (error instanceof StopRequestedError) {
        this.setState('completed')
        return false
      }

      if (error instanceof AssetSkipError) {
        this.updateAsset(asset.id, 'skipped', error.reason, error)
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
        const reason = sanitizeWorkflowReason(error)
        this.updateAsset(asset.id, 'needs-review', reason, error)
        this.logDiagnostic('error', 'Asset needs review.', {
          assetId: asset.id,
          errorClass: error instanceof Error ? error.name : 'WorkflowError',
          reason,
        })
        this.setState('stopping', getSafeErrorMessage(error))
        return false
      }

      this.updateAsset(asset.id, 'needs-review', 'unexpected-error', error)
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
    return {
      page,
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
    }
  }

  private async waitAtCheckpoint(): Promise<void> {
    while (this.pauseRequested && !this.stopRequested) {
      await delay(WORKFLOW_TIMEOUTS.stopPollMs)
    }

    if (this.stopRequested && this.snapshot.currentAssetId === null) {
      throw new StopRequestedError()
    }

    await this.ensurePageReady()
  }

  private async ensurePageReady(): Promise<void> {
    const page = this.getReadyPage()

    if (page === null) {
      const lifecycle = this.managedChrome.getState().lifecycle

      if (
        lifecycle === 'authentication-required' ||
        lifecycle === 'launching-authentication' ||
        lifecycle === 'authenticating' ||
        lifecycle === 'resuming-headless'
      ) {
        this.logDiagnostic('warning', 'Authentication transition detected.')
        throw new AuthenticationRequiredError()
      }

      this.logDiagnostic('error', 'Browser disconnected or unavailable.')
      throw new BrowserDisconnectedError()
    }

    await ensureConnected(page)
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
    if (this.hostWindow.isDestroyed()) {
      return
    }

    this.hostWindow.webContents.send(
      EOL_RUNNER_IPC_CHANNELS.snapshotChanged,
      this.snapshot,
    )
  }
}

function parseStartRequest(payload: unknown): {
  assetsText: string
  options: WorkflowOptions
} {
  if (typeof payload === 'string') {
    return {
      assetsText: payload,
      options: createWorkflowOptions({ mode: 'EOL' }),
    }
  }

  if (!isRecord(payload)) {
    return {
      assetsText: '',
      options: createWorkflowOptions({ mode: 'EOL' }),
    }
  }

  return {
    assetsText: typeof payload.assetsText === 'string' ? payload.assetsText : '',
    options: createWorkflowOptions(payload),
  }
}

export function parseAssets(text: string): string[] {
  const seen = new Set<string>()
  const assets: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const asset = line.trim()

    if (asset.length === 0 || asset.startsWith('#') || seen.has(asset)) {
      continue
    }

    seen.add(asset)
    assets.push(asset)
  }

  return assets
}

function createWorkflowOptions(payload: Record<string, unknown>): WorkflowOptions {
  const mode = parseWorkflowMode(payload.mode)
  const repairOutcome = parseRepairOutcome(payload.repairOutcome)
  const repairLocator = parseNonEmptyString(
    payload.repairLocator,
    DEFAULT_REPAIR_LOCATOR,
  )
  const moveToRepairLocator = parseNonEmptyString(
    payload.moveToRepairLocator,
    DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  )

  return {
    mode,
    repairOutcome,
    repairLocator,
    moveToRepairLocator,
  }
}

function parseWorkflowMode(value: unknown): WorkflowMode {
  return value === 'MRI' ||
    value === 'MRI_FAIL' ||
    value === 'REPAIR'
    ? value
    : 'EOL'
}

function parseRepairOutcome(value: unknown): RepairOutcome {
  return value === 'failed' ? 'failed' : 'confirmed'
}

function parseNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback
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
  return message
    .replace(/https?:\/\/[^\s]+/g, (url) => {
      try {
        const parsed = new URL(url)
        return `${parsed.origin}${parsed.pathname}`
      } catch {
        return '[url]'
      }
    })
    .replace(/\/Users\/[^\s]+/g, '[local-path]')
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
    return error.reason
  }

  if (error instanceof WorkflowInvariantError) {
    return error.reason
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message.replace(/https?:\/\/\S+/g, '[url]')
  }

  return 'Workflow runner failed unexpectedly.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
