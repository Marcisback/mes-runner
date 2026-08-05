import type { Page } from 'playwright-core'
import type {
  EolRunnerSnapshot,
  RunnerId,
  RunnerOperationResult,
  RunnerSlot,
  RunnerSnapshot,
} from '../src/types/eolRunner'
import type { ManagedChromeState } from '../src/types/managedChrome'
import { EOL_RUNNER_IPC_CHANNELS } from './eolRunnerChannels.ts'
import type { AutomationSessionIdentity } from './managedChromeController'
import type { RunnerBrowserAccess } from './runnerBrowserAccess'

import {
  lowestAvailableRunnerSlot,
  runnerIdForSlot,
} from './runnerManagerCore.ts'

export { MAX_RUNNERS } from './runnerManagerCore.ts'

interface ManagedBrowserForRunners {
  getState(): ManagedChromeState
  createRunnerPage(runnerId: RunnerId): Promise<Page>
  closeRunnerPage(runnerId: RunnerId): Promise<void>
  getAutomationPage(runnerId: RunnerId): Page | null
  getAutomationSessionIdentity(runnerId: RunnerId): AutomationSessionIdentity | null
  getRunnerPageGeneration(runnerId: RunnerId): number
  onAutomationSessionInvalidated(
    listener: (reason: string, runnerId: RunnerId | null) => void,
  ): () => void
  selectRunnerStream(runnerId: RunnerId | null): Promise<boolean>
}

interface RunnerSession {
  runnerId: RunnerId
  slot: RunnerSlot
  label: string
  workflow: RunnerWorkflow
}

export interface RunnerWorkflow {
  getSnapshot(): EolRunnerSnapshot
  start(payload: unknown): Promise<EolRunnerSnapshot>
  pause(): Promise<EolRunnerSnapshot>
  resume(): Promise<EolRunnerSnapshot>
  stop(): Promise<EolRunnerSnapshot>
  dispose(): Promise<void>
}

export type RunnerWorkflowFactory = (
  access: RunnerBrowserAccess,
  label: string,
  onSnapshot: (snapshot: EolRunnerSnapshot) => void,
) => RunnerWorkflow

interface RunnerEventHost {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export class RunnerManager {
  private readonly sessions = new Map<RunnerId, RunnerSession>()
  private disposed = false
  private readonly hostWindow: RunnerEventHost
  private readonly browser: ManagedBrowserForRunners
  private readonly workflowFactory: RunnerWorkflowFactory

  constructor(
    hostWindow: RunnerEventHost,
    browser: ManagedBrowserForRunners,
    workflowFactory: RunnerWorkflowFactory,
  ) {
    this.hostWindow = hostWindow
    this.browser = browser
    this.workflowFactory = workflowFactory
  }

  list(): RunnerSnapshot[] {
    return [...this.sessions.values()]
      .sort((left, right) => left.slot - right.slot)
      .map((session) => this.snapshot(session))
  }

  get(runnerId: RunnerId): RunnerOperationResult<RunnerSnapshot> {
    const session = this.sessions.get(runnerId)
    return session === undefined
      ? notFound()
      : { ok: true, value: this.snapshot(session) }
  }

  async create(): Promise<RunnerOperationResult<RunnerSnapshot>> {
    if (this.disposed) return creationFailed('Runner manager is shutting down.')
    const slot = lowestAvailableRunnerSlot(new Set(this.sessions.keys()))
    if (slot === null) {
      return {
        ok: false,
        error: {
          code: 'capacity-reached',
          message: 'MES Runner supports a maximum of three simultaneous runners.',
        },
      }
    }
    const runnerId = runnerIdForSlot(slot)
    try {
      await this.browser.createRunnerPage(runnerId)
      const label = `Runner ${slot}`
      const access = this.createBrowserAccess(runnerId)
      const workflow = this.workflowFactory(
        access,
        label,
        () => this.emitUpdated(runnerId),
      )
      const session: RunnerSession = { runnerId, slot, label, workflow }
      this.sessions.set(runnerId, session)
      const snapshot = this.snapshot(session)
      this.emitUpdated(runnerId)
      return { ok: true, value: snapshot }
    } catch {
      await this.browser.closeRunnerPage(runnerId).catch(() => undefined)
      return creationFailed('The runner page could not be created.')
    }
  }

  async close(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerId>> {
    const session = this.sessions.get(runnerId)
    if (session === undefined) return notFound()
    await session.workflow.stop()
    await session.workflow.dispose()
    await this.browser.closeRunnerPage(runnerId)
    this.sessions.delete(runnerId)
    this.emitRemoved(runnerId)
    return { ok: true, value: runnerId }
  }

  async start(runnerId: RunnerId, payload: unknown): Promise<RunnerOperationResult<RunnerSnapshot>> {
    return this.run(runnerId, (runner) => runner.start(payload))
  }

  async pause(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>> {
    return this.run(runnerId, (runner) => runner.pause())
  }

  async resume(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>> {
    return this.run(runnerId, (runner) => runner.resume())
  }

  async stop(runnerId: RunnerId): Promise<RunnerOperationResult<RunnerSnapshot>> {
    return this.run(runnerId, (runner) => runner.stop())
  }

  async selectStream(runnerId: RunnerId | null): Promise<boolean> {
    return runnerId === null
      ? this.browser.selectRunnerStream(null)
      : this.sessions.has(runnerId) && this.browser.selectRunnerStream(runnerId)
  }

  has(runnerId: RunnerId): boolean {
    return this.sessions.has(runnerId)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.closeAll()
  }

  async closeAll(): Promise<void> {
    const runnerIds = [...this.sessions.keys()]
    await Promise.all(runnerIds.map((runnerId) => this.close(runnerId)))
    await this.browser.selectRunnerStream(null)
  }

  private async run(
    runnerId: RunnerId,
    operation: (runner: RunnerWorkflow) => Promise<EolRunnerSnapshot>,
  ): Promise<RunnerOperationResult<RunnerSnapshot>> {
    const session = this.sessions.get(runnerId)
    if (session === undefined) return notFound()
    await operation(session.workflow)
    return { ok: true, value: this.snapshot(session) }
  }

  private createBrowserAccess(runnerId: RunnerId): RunnerBrowserAccess {
    return {
      getAutomationPage: () => this.browser.getAutomationPage(runnerId),
      getAutomationSessionIdentity: () =>
        this.browser.getAutomationSessionIdentity(runnerId),
      getState: () => this.browser.getState(),
      onAutomationSessionInvalidated: (listener) =>
        this.browser.onAutomationSessionInvalidated((reason, affectedRunnerId) => {
          if (affectedRunnerId === null || affectedRunnerId === runnerId) listener(reason)
        }),
    }
  }

  private snapshot(session: RunnerSession): RunnerSnapshot {
    return {
      runnerId: session.runnerId,
      slot: session.slot,
      label: session.label,
      pageGeneration: this.browser.getRunnerPageGeneration(session.runnerId),
      workflow: session.workflow.getSnapshot(),
    }
  }

  private emitUpdated(runnerId: RunnerId): void {
    if (this.hostWindow.isDestroyed()) return
    const session = this.sessions.get(runnerId)
    if (session === undefined) return
    this.hostWindow.webContents.send(
      EOL_RUNNER_IPC_CHANNELS.snapshotChanged,
      this.snapshot(session),
    )
  }

  private emitRemoved(runnerId: RunnerId): void {
    if (this.hostWindow.isDestroyed()) return
    this.hostWindow.webContents.send(EOL_RUNNER_IPC_CHANNELS.removed, runnerId)
  }
}

function notFound<T>(): RunnerOperationResult<T> {
  return { ok: false, error: { code: 'not-found', message: 'Runner not found.' } }
}

function creationFailed<T>(message: string): RunnerOperationResult<T> {
  return { ok: false, error: { code: 'creation-failed', message } }
}
