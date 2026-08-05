import type { Locator } from 'playwright-core'
import { AssetSkipError } from './errors.ts'
import { isLocatorVisible } from './primitives.ts'
import type { WorkflowRuntime } from './types.ts'
import {
  classifyVisibleDialog,
  mapBusinessDialogText,
  type DialogOwnershipDecision,
  type ExpectedWorkflowDialog,
} from './dialogOwnershipCore.ts'

const CLOSE_BUTTON_TEXT = /^(Close|Dismiss|Done|Cancel)$/i

export function mapPopupTextToReason(text: string): string | null {
  return mapBusinessDialogText(text)
}

export type PopupHandlingResult =
  | 'none'
  | 'closed'
  | 'security'
  | 'workflow-owned'
  | 'workflow-mounting'
  | 'classification-expired'

export interface PopupOwnershipContext {
  expectedWorkflowDialog: ExpectedWorkflowDialog
  classificationDeadline: number
}

export async function closePopupIfPresent(
  runtime: WorkflowRuntime,
  ownership: PopupOwnershipContext | null = null,
): Promise<PopupHandlingResult> {
  const dialogs = runtime.page.locator('[role="dialog"]')
  const count = await dialogs.count().catch(() => 0)
  const classified: Array<{
    dialog: Locator
    decision: DialogOwnershipDecision
  }> = []

  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index)

    if (!(await isLocatorVisible(dialog))) {
      continue
    }

    const text = await dialog.innerText().catch(() => '')
    classified.push({
      dialog,
      decision: classifyVisibleDialog(
        text,
        ownership?.expectedWorkflowDialog ?? null,
        Date.now(),
        ownership?.classificationDeadline ?? null,
      ),
    })
  }

  if (classified.some(({ decision }) => decision.kind === 'authentication')) {
    runtime.log('warning', 'Authentication/security dialog reserved from generic popup handling.')
    return 'security'
  }

  const business = classified.find(
    (entry): entry is typeof entry & {
      decision: Extract<DialogOwnershipDecision, { kind: 'business-error' }>
    } => entry.decision.kind === 'business-error',
  )
  if (business !== undefined) {
    runtime.log('info', 'Popup dialog detected.')
    runtime.log('warning', 'Popup matched a known asset error.', {
      errorClass: 'AssetSkipError',
      reason: business.decision.reason,
    })
    await clickDialogCloseControl(business.dialog)
    runtime.log('info', 'Known asset-error dialog closed.', {
      reason: business.decision.reason,
    })
    await runtime.page.waitForTimeout(800)
    throw new AssetSkipError(business.decision.reason)
  }

  if (classified.some(({ decision }) => decision.kind === 'workflow-owned')) {
    return 'workflow-owned'
  }
  if (classified.some(({ decision }) => decision.kind === 'workflow-mounting')) {
    return 'workflow-mounting'
  }
  if (classified.some(({ decision }) => decision.kind === 'classification-expired')) {
    return 'classification-expired'
  }

  for (const { dialog } of classified) {
    runtime.log('info', 'Popup dialog detected.')
    if (!(await clickDialogCloseControl(dialog))) continue
    runtime.log('warning', 'Unmatched dialog closed with a safe close control.')
    await runtime.page.waitForTimeout(500)
    return 'closed'
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
