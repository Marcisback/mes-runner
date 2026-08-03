import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { EolRunner } from './eolRunner'
import { EOL_RUNNER_IPC_CHANNELS } from './eolRunnerChannels'
import { ManagedChromeController } from './managedChromeController'
import { MANAGED_CHROME_IPC_CHANNELS } from './managedChromeChannels'

const controllers = new Map<number, ManagedChromeController>()
const eolRunners = new Map<number, EolRunner>()
let registered = false
let eolRegistered = false

export function registerManagedChromeWindow(
  hostWindow: BrowserWindow,
): ManagedChromeController {
  const controller = new ManagedChromeController(hostWindow)
  const eolRunner = new EolRunner(hostWindow, controller)
  controllers.set(hostWindow.id, controller)
  eolRunners.set(hostWindow.id, eolRunner)

  hostWindow.once('close', () => {
    void controller.dispose()
  })

  hostWindow.once('closed', () => {
    controllers.delete(hostWindow.id)
    eolRunners.delete(hostWindow.id)
  })

  registerManagedChromeIpc()
  registerEolRunnerIpc()

  return controller
}

function registerManagedChromeIpc(): void {
  if (registered) {
    return
  }

  registered = true

  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.launch, async (event) => {
    return getController(event)?.launch() ?? null
  })

  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.openLoginWindow, async (event) => {
    return getController(event)?.openLoginWindow() ?? null
  })

  ipcMain.handle(
    MANAGED_CHROME_IPC_CHANNELS.authenticationComplete,
    async (event) => {
      return getController(event)?.authenticationComplete() ?? null
    },
  )

  ipcMain.handle(
    MANAGED_CHROME_IPC_CHANNELS.cancelAuthentication,
    async (event) => {
      return getController(event)?.cancelAuthentication() ?? null
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.connectFramePort,
    (event) => {
      getController(event)?.connectFramePort()
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.setViewport,
    (event, payload: unknown) => {
      void getController(event)?.setViewport(payload).catch(() => undefined)
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.mouseMove,
    (event, payload: unknown) => {
      void getController(event)?.mouseMove(payload).catch(() => undefined)
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.mouseClick,
    (event, payload: unknown) => {
      void getController(event)?.mouseClick(payload).catch(() => undefined)
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.mouseWheel,
    (event, payload: unknown) => {
      void getController(event)?.mouseWheel(payload).catch(() => undefined)
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.keyDown,
    (event, payload: unknown) => {
      void getController(event)?.keyDown(payload).catch(() => undefined)
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.keyUp,
    (event, payload: unknown) => {
      void getController(event)?.keyUp(payload).catch(() => undefined)
    },
  )

  ipcMain.on(
    MANAGED_CHROME_IPC_CHANNELS.insertText,
    (event, payload: unknown) => {
      void getController(event)?.insertText(payload).catch(() => undefined)
    },
  )

  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.getState, (event) => {
    return getController(event)?.getState() ?? null
  })

  ipcMain.handle(MANAGED_CHROME_IPC_CHANNELS.stop, async (event) => {
    return getController(event)?.stop() ?? null
  })
}

function registerEolRunnerIpc(): void {
  if (eolRegistered) {
    return
  }

  eolRegistered = true

  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.start, async (event, payload: unknown) => {
    return getEolRunner(event)?.start(payload) ?? null
  })

  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.pause, async (event) => {
    return getEolRunner(event)?.pause() ?? null
  })

  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.resume, async (event) => {
    return getEolRunner(event)?.resume() ?? null
  })

  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.stop, async (event) => {
    return getEolRunner(event)?.stop() ?? null
  })

  ipcMain.handle(EOL_RUNNER_IPC_CHANNELS.getSnapshot, (event) => {
    return getEolRunner(event)?.getSnapshot() ?? null
  })
}

function getController(
  event: IpcMainEvent | IpcMainInvokeEvent,
): ManagedChromeController | null {
  const hostWindow = BrowserWindow.fromWebContents(event.sender)

  if (hostWindow === null) {
    return null
  }

  return controllers.get(hostWindow.id) ?? null
}

function getEolRunner(
  event: IpcMainEvent | IpcMainInvokeEvent,
): EolRunner | null {
  const hostWindow = BrowserWindow.fromWebContents(event.sender)

  if (hostWindow === null) {
    return null
  }

  return eolRunners.get(hostWindow.id) ?? null
}
