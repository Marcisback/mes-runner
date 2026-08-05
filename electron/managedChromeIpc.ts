import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import type { RunnerId } from '../src/types/eolRunner'
import { EOL_RUNNER_IPC_CHANNELS } from './eolRunnerChannels'
import type { LocalHistoryStore } from './history/historyStore'
import { MANAGED_CHROME_IPC_CHANNELS } from './managedChromeChannels'
import { ManagedChromeController } from './managedChromeController'
import { RunnerManager } from './runnerManager'
import { EolRunner } from './eolRunner'
import { isRunnerId } from './runnerManagerCore'
import {
  isTrustedIpcSender,
  type RendererSecurityPolicy,
} from './ipcSecurity.ts'

const controllers = new Map<number, ManagedChromeController>()
const runnerManagers = new Map<number, RunnerManager>()
let registered = false
let securityPolicy: RendererSecurityPolicy | null = null

export function registerManagedChromeWindow(
  hostWindow: BrowserWindow,
  historyStore: LocalHistoryStore,
  policy: RendererSecurityPolicy,
): ManagedChromeController {
  securityPolicy ??= policy
  const controller = new ManagedChromeController(hostWindow)
  const manager = new RunnerManager(
    hostWindow,
    controller,
    (access, label, onSnapshot) =>
      new EolRunner(access, historyStore, label, onSnapshot),
  )
  controllers.set(hostWindow.id, controller)
  runnerManagers.set(hostWindow.id, manager)

  hostWindow.once('close', () => {
    void manager.dispose().then(() => controller.dispose())
  })
  hostWindow.once('closed', () => {
    controllers.delete(hostWindow.id)
    runnerManagers.delete(hostWindow.id)
  })

  registerIpc()
  return controller
}

export async function disposeManagedChromeWindows(): Promise<void> {
  await Promise.allSettled(
    [...runnerManagers.values()].map((manager) => manager.dispose()),
  )
  await Promise.allSettled(
    [...controllers.values()].map((controller) => controller.dispose()),
  )
}

function registerIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.launch, (event) =>
    getController(event)?.launch() ?? null)
  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.openLoginWindow, (event) =>
    getController(event)?.openLoginWindow() ?? null)
  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.authenticationComplete, async (event) =>
    getController(event)?.authenticationComplete() ?? null)
  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.cancelAuthentication, (event) =>
    getController(event)?.cancelAuthentication() ?? null)
  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.getState, (event) =>
    getController(event)?.getState() ?? null)
  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.stop, async (event) => {
    await getRunnerManager(event)?.closeAll()
    return getController(event)?.stop() ?? null
  })
  ipcMain.handle(
    MANAGED_CHROME_IPC_CHANNELS.selectRunnerStream,
    (event, payload: unknown) => {
      if (payload === null) return getRunnerManager(event)?.selectStream(null) ?? false
      const runnerId = parseRunnerId(payload)
      return runnerId === null
        ? false
        : getRunnerManager(event)?.selectStream(runnerId) ?? false
    },
  )

  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.connectFramePort, (event) => {
    getController(event)?.connectFramePort()
  })
  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.mouseMove, (event, payload) => {
    forwardInput(event, payload, (controller, runnerId, value) => controller.mouseMove(runnerId, value))
  })
  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.mouseClick, (event, payload) => {
    forwardInput(event, payload, (controller, runnerId, value) => controller.mouseClick(runnerId, value))
  })
  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.mouseWheel, (event, payload) => {
    forwardInput(event, payload, (controller, runnerId, value) => controller.mouseWheel(runnerId, value))
  })
  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.keyDown, (event, payload) => {
    forwardInput(event, payload, (controller, runnerId, value) => controller.keyDown(runnerId, value))
  })
  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.keyUp, (event, payload) => {
    forwardInput(event, payload, (controller, runnerId, value) => controller.keyUp(runnerId, value))
  })
  ipcMain.on(MANAGED_CHROME_IPC_CHANNELS.insertText, (event, payload) => {
    forwardInput(event, payload, (controller, runnerId, value) => controller.insertText(runnerId, value))
  })

  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.create, (event) =>
    getRunnerManager(event)?.create() ?? null)
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.close, (event, payload) => {
    const runnerId = parseRunnerId(payload)
    return runnerId === null ? null : getRunnerManager(event)?.close(runnerId) ?? null
  })
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.list, (event) =>
    getRunnerManager(event)?.list() ?? [])
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.get, (event, payload) => {
    const runnerId = parseRunnerId(payload)
    return runnerId === null ? null : getRunnerManager(event)?.get(runnerId) ?? null
  })
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.start, (event, payload) =>
    routeRunnerCommand(event, payload, 'start'))
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.pause, (event, payload) =>
    routeRunnerCommand(event, payload, 'pause'))
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.resume, (event, payload) =>
    routeRunnerCommand(event, payload, 'resume'))
  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.stop, (event, payload) =>
    routeRunnerCommand(event, payload, 'stop'))
}

function routeRunnerCommand(
  event: IpcMainInvokeEvent,
  payload: unknown,
  operation: 'start' | 'pause' | 'resume' | 'stop',
) {
  if (!isRecord(payload)) return null
  const runnerId = parseRunnerId(payload.runnerId)
  const manager = getRunnerManager(event)
  if (runnerId === null || manager === null) return null
  return operation === 'start'
    ? manager.start(runnerId, payload.request)
    : manager[operation](runnerId)
}

function forwardInput(
  event: IpcMainEvent,
  payload: unknown,
  action: (
    controller: ManagedChromeController,
    runnerId: RunnerId,
    value: unknown,
  ) => Promise<void>,
): void {
  const scoped = parseRunnerPayload(payload)
  const controller = getController(event)
  const manager = getRunnerManager(event)
  if (
    scoped === null ||
    controller === null ||
    manager === null ||
    !manager.has(scoped.runnerId)
  ) return
  void action(controller, scoped.runnerId, scoped.value).catch(() => undefined)
}

function parseRunnerPayload(value: unknown): { runnerId: RunnerId; value: unknown } | null {
  if (!isRecord(value)) return null
  const runnerId = parseRunnerId(value.runnerId)
  return runnerId === null ? null : { runnerId, value: value.value }
}

function parseRunnerId(value: unknown): RunnerId | null {
  return isRunnerId(value) ? value : null
}

function getController(event: IpcMainEvent | IpcMainInvokeEvent): ManagedChromeController | null {
  const hostWindow = getTrustedHostWindow(event)
  return hostWindow === null ? null : controllers.get(hostWindow.id) ?? null
}

function getRunnerManager(event: IpcMainEvent | IpcMainInvokeEvent): RunnerManager | null {
  const hostWindow = getTrustedHostWindow(event)
  return hostWindow === null ? null : runnerManagers.get(hostWindow.id) ?? null
}

function getTrustedHostWindow(
  event: IpcMainEvent | IpcMainInvokeEvent,
): BrowserWindow | null {
  if (securityPolicy === null || !isTrustedIpcSender(event, securityPolicy)) return null
  return BrowserWindow.fromWebContents(event.sender)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
