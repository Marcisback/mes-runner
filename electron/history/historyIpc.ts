import { BrowserWindow, ipcMain } from 'electron'
import type { HistoryResponse } from '../../src/types/history'
import { HISTORY_IPC_CHANNELS } from './historyChannels'
import { LocalHistoryStore } from './historyStore'
import { isTrustedIpcSender, type RendererSecurityPolicy } from '../ipcSecurity.ts'
import {
  parseHistoryAssetIdsRequest,
  parseHistoryDateRequest,
  parseHistoryDatesRequest,
  parseHistoryRangeRequest,
} from './historyValidation'

let registered = false

export function registerHistoryIpc(
  store: LocalHistoryStore,
  policy: RendererSecurityPolicy,
): void {
  if (registered) return
  registered = true

  ipcMain.handle(HISTORY_IPC_CHANNELS.weeklySummary, (event) =>
    isTrustedIpcSender(event, policy) ? store.getWeeklySummary() : invalidRequest(store))
  ipcMain.handle(HISTORY_IPC_CHANNELS.dates, (event, payload: unknown) => {
    if (!isTrustedIpcSender(event, policy)) return invalidRequest(store)
    const request = parseHistoryDatesRequest(payload)
    return request === null
      ? invalidRequest(store)
      : store.getHistoryDates(request)
  })
  ipcMain.handle(HISTORY_IPC_CHANNELS.forDate, (event, payload: unknown) => {
    if (!isTrustedIpcSender(event, policy)) return invalidRequest(store)
    const request = parseHistoryDateRequest(payload)
    return request === null
      ? invalidRequest(store)
      : store.getHistoryRange(request)
  })
  ipcMain.handle(HISTORY_IPC_CHANNELS.range, (event, payload: unknown) => {
    if (!isTrustedIpcSender(event, policy)) return invalidRequest(store)
    const request = parseHistoryRangeRequest(payload)
    return request === null
      ? invalidRequest(store)
      : store.getHistoryRange(request)
  })
  ipcMain.handle(HISTORY_IPC_CHANNELS.assetIds, (event, payload: unknown) => {
    if (!isTrustedIpcSender(event, policy)) return invalidRequest(store)
    const request = parseHistoryAssetIdsRequest(payload)
    return request === null
      ? invalidRequest(store)
      : store.getHistoryAssetIds(request)
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
