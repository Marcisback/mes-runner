import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RendererSecurityPolicy {
  devServerOrigin: string | null
  rendererEntryPath: string
}

const MAX_CLIPBOARD_TEXT_LENGTH = 200_000

interface IpcSenderLike {
  sender: { mainFrame: unknown }
  senderFrame: { url: string } | null
}

export function createRendererSecurityPolicy(
  appRoot: string,
  devServerUrl: string | undefined,
): RendererSecurityPolicy {
  return {
    devServerOrigin: parseOrigin(devServerUrl),
    rendererEntryPath: path.resolve(appRoot, 'dist', 'index.html'),
  }
}

export function isAllowedRendererUrl(
  value: string,
  policy: RendererSecurityPolicy,
): boolean {
  try {
    const candidate = new URL(value)
    if (policy.devServerOrigin !== null) {
      return candidate.origin === policy.devServerOrigin
    }
    return candidate.protocol === 'file:' &&
      path.resolve(fileURLToPath(candidate)) === policy.rendererEntryPath
  } catch {
    return false
  }
}

export function isTrustedIpcSender(
  event: IpcSenderLike,
  policy: RendererSecurityPolicy,
): boolean {
  return event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame &&
    isAllowedRendererUrl(event.senderFrame.url, policy)
}

export function parseClipboardText(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLIPBOARD_TEXT_LENGTH
    ? value
    : null
}

function parseOrigin(value: string | undefined): string | null {
  if (value === undefined) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null
  } catch {
    return null
  }
}
