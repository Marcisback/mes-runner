import type { Locator } from 'playwright-core'
import { AssetSkipError } from './errors'
import { isLocatorVisible } from './primitives'
import type { WorkflowRuntime } from './types'

const POPUP_RULES: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /No order found for the scanned asset|Would you like to create a new order/i,
    reason: 'No Order Found',
  },
  {
    pattern:
      /Asset Tag\/Serial Number Not Found|not found\. Please verify and try again|Failed to retrieve order/i,
    reason: 'Asset Not Found',
  },
  {
    pattern: /Failed to execute instruction/i,
    reason: 'Failed Instruction',
  },
  {
    pattern: /Query Error/i,
    reason: 'Query Error',
  },
]

const CLOSE_BUTTON_TEXT = /^(Close|Dismiss|Done|Cancel)$/i

export function mapPopupTextToReason(text: string): string | null {
  return POPUP_RULES.find((rule) => rule.pattern.test(text))?.reason ?? null
}

export async function closePopupIfPresent(
  runtime: WorkflowRuntime,
): Promise<'none' | 'closed'> {
  const dialogs = runtime.page.locator('[role="dialog"]')
  const count = await dialogs.count().catch(() => 0)

  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index)

    if (!(await isLocatorVisible(dialog))) {
      continue
    }

    runtime.log('info', 'Popup dialog detected.')
    const text = await dialog.innerText().catch(() => '')
    const reason = mapPopupTextToReason(text)

    if (reason !== null) {
      runtime.log('warning', 'Popup matched a known asset error.', {
        errorClass: 'AssetSkipError',
        reason,
      })
      await clickDialogCloseControl(dialog)
      runtime.log('info', 'Known asset-error dialog closed.', { reason })
      await runtime.page.waitForTimeout(800)
      throw new AssetSkipError(reason)
    }

    if (await clickDialogCloseControl(dialog)) {
      runtime.log('warning', 'Unmatched dialog closed with a safe close control.')
      await runtime.page.waitForTimeout(500)
      return 'closed'
    }
  }

  return 'none'
}

async function clickDialogCloseControl(dialog: Locator): Promise<boolean> {
  const buttons = dialog.getByRole('button')
  const count = await buttons.count().catch(() => 0)

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index)

    if (!(await isLocatorVisible(button))) {
      continue
    }

    const text = await button.innerText().catch(() => '')

    if (CLOSE_BUTTON_TEXT.test(text.trim())) {
      await button.click()
      return true
    }
  }

  return false
}
