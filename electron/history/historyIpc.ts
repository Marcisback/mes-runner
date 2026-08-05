import { BrowserWindow, ipcMain } from 'electron'
import type { HistoryResponse } from '../../src/types/history'
import { HISTORY_IPC_CHANNELS } from './historyChannels'
import { LocalHistoryStore } from './historyStore'
import {
  parseHistoryDateRequest,
  parseHistoryRangeRequest,
} from './historyValidation'

let registered = false

export function registerHistoryIpc(store: LocalHistoryStore): void {
  if (registered) return
  registered = true

  ipcMain.handle(HISTORY_IPC_CHANNELS.weeklySummary, () => store.getWeeklySummary())
  ipcMain.handle(HISTORY_IPC_CHANNELS.dates, () => store.getHistoryDates())
  ipcMain.handle(HISTORY_IPC_CHANNELS.forDate, (_event, payload: unknown) => {
    const request = parseHistoryDateRequest(payload)
    return request === null
      ? invalidRequest(store)
      : store.getHistoryRange(request)
  })
  ipcMain.handle(HISTORY_IPC_CHANNELS.range, (_event, payload: unknown) => {
    const request = parseHistoryRangeRequest(payload)
    return request === null
      ? invalidRequest(store)
      : store.getHistoryRange(request)
  })

  store.onChanged(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(HISTORY_IPC_CHANNELS.changed)
    }
  })
}

function invalidRequest<T>(store: LocalHistoryStore): HistoryResponse<T> {
  return {
    ok: false,
    data: null,
    health: store.getHealth(),
    error: 'The history request was invalid.',
  }
}

