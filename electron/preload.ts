import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { MANAGED_CHROME_IPC_CHANNELS } from './managedChromeChannels'
import { EOL_RUNNER_IPC_CHANNELS } from './eolRunnerChannels'
import { HISTORY_IPC_CHANNELS } from './history/historyChannels'
import type {
  EolRunnerApi,
  EolRunnerSnapshot,
  RunnerId,
  RunnerOperationResult,
  RunnerRemovedEvent,
  RunnerSnapshot,
  WorkflowMode,
} from '../src/types/eolRunner'
import type {
  ManagedChromeApi,
  ManagedChromeFrame,
  ManagedChromeState,
  ManagedChromeViewport,
} from '../src/types/managedChrome'
import type {
  HistoryApi,
  HistoryDateRequest,
  HistoryDateSummary,
  HistoryRangeRequest,
  HistoryRangeResult,
  HistoryResponse,
  WeeklyHistorySummary,
} from '../src/types/history'
import { CLIPBOARD_WRITE_TEXT_CHANNEL } from './clipboardChannels.ts'

type ManagedChromeInvokeChannel =
  | typeof MANAGED_CHROME_IPC_CHANNELS.launch
  | typeof MANAGED_CHROME_IPC_CHANNELS.openLoginWindow
  | typeof MANAGED_CHROME_IPC_CHANNELS.authenticationComplete
  | typeof MANAGED_CHROME_IPC_CHANNELS.cancelAuthentication
  | typeof MANAGED_CHROME_IPC_CHANNELS.stop
  | typeof MANAGED_CHROME_IPC_CHANNELS.getState

const managedChromeApi: ManagedChromeApi = {
  async launch() {
    return invokeState(MANAGED_CHROME_IPC_CHANNELS.launch)
  },
  async openLoginWindow() {
    return invokeState(MANAGED_CHROME_IPC_CHANNELS.openLoginWindow)
  },
  async authenticationComplete() {
    return invokeState(MANAGED_CHROME_IPC_CHANNELS.authenticationComplete)
  },
  async cancelAuthentication() {
    return invokeState(MANAGED_CHROME_IPC_CHANNELS.cancelAuthentication)
  },
  async stop() {
    return invokeState(MANAGED_CHROME_IPC_CHANNELS.stop)
  },
  async getState() {
    return invokeState(MANAGED_CHROME_IPC_CHANNELS.getState)
  },
  async selectRunnerStream(runnerId) {
    return Boolean(await ipcRenderer.invoke(MANAGED_CHROME_IPC_CHANNELS.selectRunnerStream, runnerId))
  },
  mouseMove(runnerId, point) {
    sendPoint(MANAGED_CHROME_IPC_CHANNELS.mouseMove, runnerId, point)
  },
  mouseClick(runnerId, point) {
    sendPoint(MANAGED_CHROME_IPC_CHANNELS.mouseClick, runnerId, point)
  },
  mouseWheel(runnerId, input) {
    if (!isPoint(input) || !isFiniteNumber(input.deltaX) || !isFiniteNumber(input.deltaY)) {
      return
    }

    ipcRenderer.send(MANAGED_CHROME_IPC_CHANNELS.mouseWheel, {
      runnerId,
      value: { x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY },
    })
  },
  keyDown(runnerId, input) {
    sendKey(MANAGED_CHROME_IPC_CHANNELS.keyDown, runnerId, input)
  },
  keyUp(runnerId, input) {
    sendKey(MANAGED_CHROME_IPC_CHANNELS.keyUp, runnerId, input)
  },
  insertText(runnerId, text) {
    if (typeof text === 'string' && text.length > 0 && text.length <= 128) {
      ipcRenderer.send(MANAGED_CHROME_IPC_CHANNELS.insertText, { runnerId, value: text })
    }
  },
  onStateChanged(listener) {
    const wrappedListener = (
      _event: IpcRendererEvent,
      payload: unknown,
    ): void => {
      const state = parseManagedChromeState(payload)

      if (state !== null) {
        listener(state)
      }
    }

    ipcRenderer.on(
      MANAGED_CHROME_IPC_CHANNELS.stateChanged,
      wrappedListener,
    )

    return () => {
      ipcRenderer.off(
        MANAGED_CHROME_IPC_CHANNELS.stateChanged,
        wrappedListener,
      )
    }
  },
  onFrame(listener) {
    let framePort: MessagePort | null = null
    const wrappedListener = (event: IpcRendererEvent): void => {
      framePort?.close()
      framePort = event.ports[0] ?? null

      if (framePort === null) {
        return
      }

      framePort.onmessage = (messageEvent) => {
        const frame = parseManagedChromeFrame(messageEvent.data)

        if (frame !== null) {
          listener(frame)
        }
      }

      framePort.start()
    }

    ipcRenderer.on(MANAGED_CHROME_IPC_CHANNELS.framePort, wrappedListener)
    ipcRenderer.send(MANAGED_CHROME_IPC_CHANNELS.connectFramePort)

    return () => {
      ipcRenderer.off(MANAGED_CHROME_IPC_CHANNELS.framePort, wrappedListener)
      framePort?.close()
      framePort = null
    }
  },
}

contextBridge.exposeInMainWorld('managedChrome', managedChromeApi)

const eolRunnerApi: EolRunnerApi = {
  async createRunner() {
    return invokeRunnerResult(EOL_RUNNER_IPC_CHANNELS.create)
  },
  async closeRunner(runnerId) {
    const result: unknown = await ipcRenderer.invoke(EOL_RUNNER_IPC_CHANNELS.close, runnerId)
    if (isRecord(result) && result.ok === true && result.value === runnerId) {
      return { ok: true, value: runnerId }
    }
    return parseRunnerError(result)
  },
  async listRunners() {
    const result: unknown = await ipcRenderer.invoke(EOL_RUNNER_IPC_CHANNELS.list)
    return Array.isArray(result)
      ? result.map(parseRunnerSnapshot).filter((value): value is RunnerSnapshot => value !== null)
      : []
  },
  async getRunner(runnerId) {
    return invokeRunnerResult(EOL_RUNNER_IPC_CHANNELS.get, runnerId)
  },
  async startEol(runnerId, request) {
    return invokeRunnerResult(EOL_RUNNER_IPC_CHANNELS.start, {
      runnerId,
      request: parseEolStartRequest(request),
    })
  },
  async pauseEol(runnerId) {
    return invokeRunnerResult(EOL_RUNNER_IPC_CHANNELS.pause, { runnerId })
  },
  async resumeEol(runnerId) {
    return invokeRunnerResult(EOL_RUNNER_IPC_CHANNELS.resume, { runnerId })
  },
  async stopEol(runnerId) {
    return invokeRunnerResult(EOL_RUNNER_IPC_CHANNELS.stop, { runnerId })
  },
  onEolSnapshotChanged(listener) {
    const wrappedListener = (
      _event: IpcRendererEvent,
      payload: unknown,
    ): void => {
      const snapshot = parseRunnerSnapshot(payload)

      if (snapshot !== null) {
        listener(snapshot)
      }
    }

    ipcRenderer.on(EOL_RUNNER_IPC_CHANNELS.snapshotChanged, wrappedListener)

    return () => {
      ipcRenderer.off(EOL_RUNNER_IPC_CHANNELS.snapshotChanged, wrappedListener)
    }
  },
  onRunnerRemoved(listener) {
    const wrappedListener = (_event: IpcRendererEvent, payload: unknown): void => {
      const removed = parseRunnerRemovedEvent(payload)
      if (removed !== null) listener(removed)
    }
    ipcRenderer.on(EOL_RUNNER_IPC_CHANNELS.removed, wrappedListener)
    return () => ipcRenderer.off(EOL_RUNNER_IPC_CHANNELS.removed, wrappedListener)
  },
}

contextBridge.exposeInMainWorld('eolRunner', eolRunnerApi)

const historyApi: HistoryApi = {
  async getWeeklySummary() {
    return invokeHistory<WeeklyHistorySummary>(HISTORY_IPC_CHANNELS.weeklySummary)
  },
  async getHistoryDates() {
    return invokeHistory<HistoryDateSummary[]>(HISTORY_IPC_CHANNELS.dates)
  },
  async getHistoryForDate(request) {
    return invokeHistory<HistoryRangeResult>(
      HISTORY_IPC_CHANNELS.forDate,
      sanitizeHistoryDateRequest(request),
    )
  },
  async getHistoryRange(request) {
    return invokeHistory<HistoryRangeResult>(
      HISTORY_IPC_CHANNELS.range,
      sanitizeHistoryRangeRequest(request),
    )
  },
  onHistoryChanged(listener) {
    const wrappedListener = (): void => listener()
    ipcRenderer.on(HISTORY_IPC_CHANNELS.changed, wrappedListener)
    return () => ipcRenderer.off(HISTORY_IPC_CHANNELS.changed, wrappedListener)
  },
}

contextBridge.exposeInMainWorld('mesHistory', historyApi)

contextBridge.exposeInMainWorld('mesClipboard', {
  async writeText(text: string): Promise<boolean> {
    return Boolean(await ipcRenderer.invoke(CLIPBOARD_WRITE_TEXT_CHANNEL, text))
  },
})

async function invokeState(
  channel: ManagedChromeInvokeChannel,
  payload?: unknown,
): Promise<ManagedChromeState> {
  const result: unknown = await ipcRenderer.invoke(channel, payload)
  return parseManagedChromeState(result) ?? {
    lifecycle: 'error',
    errorMessage: 'Managed Chrome returned an invalid state.',
    generation: 0,
    viewport: { width: 1600, height: 1000 },
  }
}

async function invokeHistory<T>(
  channel: string,
  payload?: unknown,
): Promise<HistoryResponse<T>> {
  const response: unknown = await ipcRenderer.invoke(channel, payload)
  if (
    isRecord(response) &&
    typeof response.ok === 'boolean' &&
    isRecord(response.health) &&
    typeof response.health.available === 'boolean' &&
    (response.health.message === null || typeof response.health.message === 'string')
  ) {
    return response as unknown as HistoryResponse<T>
  }
  return {
    ok: false,
    data: null,
    health: { available: false, message: 'Local history is unavailable.' },
    error: 'Local history returned an invalid response.',
  }
}

function sanitizeHistoryDateRequest(request: HistoryDateRequest): HistoryDateRequest {
  return {
    date: request.date,
    search: request.search,
    mode: request.mode,
    outcome: request.outcome,
    limit: request.limit,
    offset: request.offset,
  }
}

function sanitizeHistoryRangeRequest(request: HistoryRangeRequest): HistoryRangeRequest {
  return {
    startDate: request.startDate,
    endDate: request.endDate,
    preset: request.preset,
    search: request.search,
    mode: request.mode,
    outcome: request.outcome,
    limit: request.limit,
    offset: request.offset,
  }
}

function parseManagedChromeState(
  payload: unknown,
): ManagedChromeState | null {
  if (!isRecord(payload) || !isLifecycleState(payload.lifecycle)) {
    return null
  }

  if (
    payload.errorMessage !== null &&
    typeof payload.errorMessage !== 'string'
  ) {
    return null
  }

  const viewport = parseViewport(payload.viewport)

  if (
    typeof payload.generation !== 'number' ||
    !Number.isFinite(payload.generation) ||
    viewport === null
  ) {
    return null
  }

  return {
    lifecycle: payload.lifecycle,
    errorMessage: payload.errorMessage,
    generation: payload.generation,
    viewport,
  }
}

function parseManagedChromeFrame(
  payload: unknown,
): ManagedChromeFrame | null {
  if (
    !isRecord(payload) ||
    !isRunnerId(payload.runnerId) ||
    typeof payload.generation !== 'number' ||
    typeof payload.streamGeneration !== 'number' ||
    typeof payload.frameId !== 'number' ||
    !(payload.data instanceof ArrayBuffer) ||
    !Number.isFinite(payload.generation) ||
    !Number.isFinite(payload.streamGeneration) ||
    !Number.isFinite(payload.frameId)
  ) {
    return null
  }

  const viewport = parseViewport(payload.viewport)

  if (
    viewport === null ||
    (payload.mimeType !== 'image/jpeg' && payload.mimeType !== 'image/png')
  ) {
    return null
  }

  return {
    runnerId: payload.runnerId,
    generation: payload.generation,
    streamGeneration: payload.streamGeneration,
    frameId: payload.frameId,
    mimeType: payload.mimeType,
    data: payload.data,
    viewport,
  }
}

function parseViewport(value: unknown): ManagedChromeViewport | null {
  if (
    !isRecord(value) ||
    !isFinitePositiveNumber(value.width) ||
    !isFinitePositiveNumber(value.height)
  ) {
    return null
  }

  return {
    width: value.width,
    height: value.height,
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  )
}

function sendPoint(
  channel:
    | typeof MANAGED_CHROME_IPC_CHANNELS.mouseMove
    | typeof MANAGED_CHROME_IPC_CHANNELS.mouseClick,
  runnerId: RunnerId,
  point: unknown,
): void {
  if (isPoint(point)) {
    ipcRenderer.send(channel, { runnerId, value: { x: point.x, y: point.y } })
  }
}

function sendKey(
  channel:
    | typeof MANAGED_CHROME_IPC_CHANNELS.keyDown
    | typeof MANAGED_CHROME_IPC_CHANNELS.keyUp,
  runnerId: RunnerId,
  input: unknown,
): void {
  if (!isRecord(input) || typeof input.key !== 'string') {
    return
  }

  const key = input.key.trim()

  if (key.length > 0 && key.length <= 40) {
    ipcRenderer.send(channel, { runnerId, value: { key } })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLifecycleState(
  value: unknown,
): value is ManagedChromeState['lifecycle'] {
  return (
    value === 'stopped' ||
    value === 'launching-headless' ||
    value === 'loading' ||
    value === 'streaming' ||
    value === 'authentication-required' ||
    value === 'launching-authentication' ||
    value === 'authenticating' ||
    value === 'resuming-headless' ||
    value === 'disconnected' ||
    value === 'compliance-blocked' ||
    value === 'error'
  )
}

async function invokeRunnerResult(
  channel: string,
  payload?: unknown,
): Promise<RunnerOperationResult<RunnerSnapshot>> {
  const result: unknown = await ipcRenderer.invoke(channel, payload)
  if (isRecord(result) && result.ok === true) {
    const snapshot = parseRunnerSnapshot(result.value)
    if (snapshot !== null) return { ok: true, value: snapshot }
  }
  return parseRunnerError(result)
}

function parseRunnerError<T>(result: unknown): RunnerOperationResult<T> {
  if (
    isRecord(result) &&
    result.ok === false &&
    isRecord(result.error) &&
    (result.error.code === 'capacity-reached' ||
      result.error.code === 'not-found' ||
      result.error.code === 'creation-failed') &&
    typeof result.error.message === 'string'
  ) {
    return result as RunnerOperationResult<T>
  }
  return { ok: false, error: { code: 'creation-failed', message: 'Runner returned an invalid response.' } }
}

function parseRunnerSnapshot(payload: unknown): RunnerSnapshot | null {
  if (
    !isRecord(payload) ||
    !isRunnerId(payload.runnerId) ||
    (payload.slot !== 1 && payload.slot !== 2 && payload.slot !== 3) ||
    typeof payload.label !== 'string' ||
    !isFiniteNonNegativeNumber(payload.sessionGeneration) ||
    !isFiniteNonNegativeNumber(payload.snapshotRevision) ||
    !isFiniteNonNegativeNumber(payload.pageGeneration)
  ) return null
  const workflow = parseEolSnapshot(payload.workflow)
  return workflow === null ? null : {
    runnerId: payload.runnerId,
    slot: payload.slot,
    label: payload.label,
    sessionGeneration: payload.sessionGeneration,
    snapshotRevision: payload.snapshotRevision,
    pageGeneration: payload.pageGeneration,
    workflow,
  }
}

function parseRunnerRemovedEvent(payload: unknown): RunnerRemovedEvent | null {
  return isRecord(payload) &&
    isRunnerId(payload.runnerId) &&
    isFiniteNonNegativeNumber(payload.sessionGeneration)
    ? {
        runnerId: payload.runnerId,
        sessionGeneration: payload.sessionGeneration,
      }
    : null
}

function isRunnerId(value: unknown): value is RunnerId {
  return value === 'runner-1' || value === 'runner-2' || value === 'runner-3'
}

function parseEolSnapshot(payload: unknown): EolRunnerSnapshot | null {
  if (
    !isRecord(payload) ||
    !isEolRunnerState(payload.state) ||
    !isWorkflowMode(payload.mode) ||
    typeof payload.modeLabel !== 'string' ||
    !Array.isArray(payload.assets) ||
    (payload.currentAssetId !== null &&
      typeof payload.currentAssetId !== 'string') ||
    !isFiniteNonNegativeNumber(payload.total) ||
    !isFiniteNonNegativeNumber(payload.completed) ||
    !isFiniteNonNegativeNumber(payload.skipped) ||
    !isFiniteNonNegativeNumber(payload.needsReview) ||
    (payload.errorMessage !== null && typeof payload.errorMessage !== 'string') ||
    !Array.isArray(payload.diagnostics)
  ) {
    return null
  }

  const assets = payload.assets.map(parseEolAsset).filter((asset) => asset !== null)

  if (assets.length !== payload.assets.length) {
    return null
  }

  const diagnostics = payload.diagnostics
    .map(parseDiagnosticEvent)
    .filter((event) => event !== null)

  if (diagnostics.length !== payload.diagnostics.length) {
    return null
  }

  return {
    state: payload.state,
    mode: payload.mode,
    modeLabel: payload.modeLabel,
    assets,
    currentAssetId: payload.currentAssetId,
    total: payload.total,
    completed: payload.completed,
    skipped: payload.skipped,
    needsReview: payload.needsReview,
    errorMessage: payload.errorMessage,
    diagnostics,
  }
}

function parseEolAsset(value: unknown): EolRunnerSnapshot['assets'][number] | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isEolAssetState(value.state) ||
    (value.reason !== null && typeof value.reason !== 'string') ||
    (value.errorDetails !== null && parseErrorDetails(value.errorDetails) === null)
  ) {
    return null
  }

  return {
    id: value.id,
    state: value.state,
    reason: value.reason,
    errorDetails:
      value.errorDetails === null ? null : parseErrorDetails(value.errorDetails),
  }
}

function parseDiagnosticEvent(
  value: unknown,
): EolRunnerSnapshot['diagnostics'][number] | null {
  if (
    !isRecord(value) ||
    !isFiniteNonNegativeNumber(value.id) ||
    typeof value.timestamp !== 'string' ||
    !isDiagnosticSeverity(value.severity) ||
    !isEolRunnerState(value.runnerState) ||
    !isWorkflowMode(value.workflowMode) ||
    (value.currentStep !== null && typeof value.currentStep !== 'string') ||
    typeof value.message !== 'string' ||
    (value.errorClass !== null && typeof value.errorClass !== 'string') ||
    (value.reason !== null && typeof value.reason !== 'string') ||
    (value.assetId !== null && typeof value.assetId !== 'string')
  ) {
    return null
  }

  return {
    id: value.id,
    timestamp: value.timestamp,
    severity: value.severity,
    runnerState: value.runnerState,
    workflowMode: value.workflowMode,
    currentStep: value.currentStep,
    message: value.message,
    errorClass: value.errorClass,
    reason: value.reason,
    assetId: value.assetId,
  }
}

function parseErrorDetails(
  value: unknown,
): EolRunnerSnapshot['assets'][number]['errorDetails'] {
  if (
    !isRecord(value) ||
    !isWorkflowMode(value.workflowMode) ||
    (value.lastCompletedStep !== null &&
      typeof value.lastCompletedStep !== 'string') ||
    (value.failingStep !== null && typeof value.failingStep !== 'string') ||
    typeof value.errorClass !== 'string' ||
    typeof value.sanitizedMessage !== 'string' ||
    typeof value.timestamp !== 'string'
  ) {
    return null
  }

  return {
    workflowMode: value.workflowMode,
    lastCompletedStep: value.lastCompletedStep,
    failingStep: value.failingStep,
    errorClass: value.errorClass,
    sanitizedMessage: value.sanitizedMessage,
    timestamp: value.timestamp,
  }
}

function isEolRunnerState(value: unknown): value is EolRunnerSnapshot['state'] {
  return (
    value === 'idle' ||
    value === 'running' ||
    value === 'paused' ||
    value === 'stopping' ||
    value === 'completed' ||
    value === 'error'
  )
}

function isEolAssetState(
  value: unknown,
): value is EolRunnerSnapshot['assets'][number]['state'] {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'skipped' ||
    value === 'needs-review'
  )
}

function isWorkflowMode(value: unknown): value is WorkflowMode {
  return (
    value === 'EOL' ||
    value === 'MRI' ||
    value === 'MRI_FAIL' ||
    value === 'REPAIR'
  )
}

function isDiagnosticSeverity(value: unknown): value is EolRunnerSnapshot['diagnostics'][number]['severity'] {
  return value === 'info' || value === 'warning' || value === 'error'
}

function parseEolStartRequest(value: unknown): unknown {
  if (!isRecord(value)) return null
  return {
    assetsText: value.assetsText,
    mode: value.mode,
    repairOutcome: value.repairOutcome,
    repairLocator: value.repairLocator,
    moveToRepairLocator: value.moveToRepairLocator,
  }
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
