import { clipboard, ipcMain } from 'electron'
import {
  isTrustedIpcSender,
  parseClipboardText,
  type RendererSecurityPolicy,
} from './ipcSecurity.ts'
import { CLIPBOARD_WRITE_TEXT_CHANNEL } from './clipboardChannels.ts'

let registered = false

export function registerClipboardIpc(policy: RendererSecurityPolicy): void {
  if (registered) return
  registered = true
  ipcMain.handle(CLIPBOARD_WRITE_TEXT_CHANNEL, (event, payload: unknown) => {
    const text = parseClipboardText(payload)
    if (!isTrustedIpcSender(event, policy) || text === null) return false
    clipboard.writeText(text)
    return true
  })
}
