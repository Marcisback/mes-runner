import type { Locator } from 'playwright-core'
import { NeedsReviewError, WorkflowInvariantError } from './errors.ts'
import {
  clickWithSettles,
  isLocatorEnabled,
  isLocatorVisible,
  scopedWait,
  uniqueVisible,
  singleVisibleOrNull,
  uniqueVisibleEnabled,
  waitScopedVisibleAndEnabled,
} from './primitives.ts'
import { type WorkflowRuntime } from './types.ts'

const FAILURE_DIALOG_TIMEOUT_MS = 10_000
const FAILURE_OPTION_TIMEOUT_MS = 8_000
const FAILURE_REASON_LABEL = 'Phone - Display'

export async function completeFailureReasonDialog(
  runtime: WorkflowRuntime,
): Promise<void> {
  runtime.log('info', 'Failure dialog interaction started.')
  const dialog = await scopedWait(
    runtime,
    'failure reason dialog',
    () => findFailureReasonDialog(runtime),
    FAILURE_DIALOG_TIMEOUT_MS,
  )
  runtime.log('info', 'Failure dialog resolved.')

  const combobox = await scopedWait(
    runtime,
    'failure reason combobox',
    () => resolveFailureCombobox(dialog).catch(() => null),
    FAILURE_DIALOG_TIMEOUT_MS,
  )

  if (!(await isLocatorEnabled(combobox))) {
    throw new WorkflowInvariantError('Failure reason combobox is disabled.')
  }

  const expanded = await combobox.getAttribute('aria-expanded').catch(() => null)

  if (expanded !== 'true') {
    await combobox.scrollIntoViewIfNeeded()
    await combobox.focus()
    await runtime.page.keyboard.press('Space')
    await scopedWait(
      runtime,
      'expanded failure reason combobox',
      async () =>
        (await combobox.getAttribute('aria-expanded').catch(() => null)) === 'true'
          ? combobox
          : null,
      FAILURE_DIALOG_TIMEOUT_MS,
    )
  }
  runtime.log('info', 'Owned failure listbox opened.')

  const option = await scopedWait(
    runtime,
    'Phone - Display failure option',
    () => findFailureOption(runtime, combobox),
    FAILURE_OPTION_TIMEOUT_MS,
  )

  if (!(await isFailureOptionSelected(option))) {
    await clickWithSettles(runtime, option, 75, 300)
  }

  await scopedWait(
    runtime,
    'selected Phone - Display failure option while listbox is open',
    async () => ((await isFailureOptionSelected(option)) ? option : null),
    FAILURE_OPTION_TIMEOUT_MS,
  )
  runtime.log('info', 'Phone - Display selected.', {
    reason: FAILURE_REASON_LABEL,
  })

  const confirmButton = await scopedWait(
    runtime,
    'Confirm failure button',
    () => uniqueVisible(dialog.locator('button[aria-label="Confirm failure"]'), 'Confirm failure button').catch(() => null),
    FAILURE_DIALOG_TIMEOUT_MS,
  )

  await transitionFocusToConfirmFailure(runtime, dialog, combobox, confirmButton)

  const enabledConfirm = await waitScopedVisibleAndEnabled(
    runtime,
    confirmButton,
    'enabled Confirm failure button',
    FAILURE_DIALOG_TIMEOUT_MS,
  )
  runtime.log('info', 'Confirm Failure enabled.')

  await enabledConfirm.press('Enter')
  runtime.log('info', 'Confirm Failure activated.')

  await scopedWait(
    runtime,
    'failure reason dialog to close',
    async () => ((await findFailureReasonDialog(runtime)) === null ? true : null),
    FAILURE_DIALOG_TIMEOUT_MS,
  )
  runtime.log('info', 'Failure dialog completed.')
}

async function resolveFailureCombobox(dialog: Locator): Promise<Locator> {
  const chooseCombobox = dialog.getByRole('combobox', {
    name: /Choose one or more/i,
  })
  const chooseCount = await chooseCombobox.count().catch(() => 0)

  if (chooseCount === 1 && await isLocatorVisible(chooseCombobox)) {
    return chooseCombobox
  }

  return uniqueVisibleEnabled(
    dialog.locator('button[role="combobox"][aria-haspopup="listbox"]'),
    'failure reason combobox',
  )
}

async function findFailureReasonDialog(
  runtime: WorkflowRuntime,
): Promise<Locator | null> {
  const roleDialog = await singleVisibleOrNull(
    runtime.page.locator('[role="dialog"]').filter({
      hasText: 'Select failure reason',
    }),
    'failure reason dialog',
  )

  if (roleDialog !== null) {
    return roleDialog
  }

  return null
}

async function findFailureOption(
  runtime: WorkflowRuntime,
  combobox: Locator,
): Promise<Locator | null> {
  const listbox = await resolveOwnedFailureListbox(runtime, combobox)
  const optionSelector =
    `[role="option"][data-logging-label="${FAILURE_REASON_LABEL}"]`

  return uniqueVisibleEnabled(
    listbox.locator(optionSelector),
    'Phone - Display failure option',
  ).catch(() => null)
}

async function transitionFocusToConfirmFailure(
  runtime: WorkflowRuntime,
  dialog: Locator,
  combobox: Locator,
  confirmButton: Locator,
): Promise<void> {
  runtime.log('info', 'Focus transition started.')
  await combobox.focus()

  for (let index = 0; index < 10; index += 1) {
    if (await isLocatorFocused(confirmButton)) {
      break
    }

    await runtime.page.keyboard.press('Tab')
    await runtime.page.waitForTimeout(75)

    if (!(await isLocatorVisible(dialog))) {
      runtime.log('error', 'Unexpected parent dialog dismissal.', {
        errorClass: 'NeedsReviewError',
        reason: 'Failure dialog closed before Confirm Failure activation.',
      })
      throw new NeedsReviewError('Failure dialog closed before Confirm Failure activation.')
    }
  }

  if (!(await isLocatorFocused(confirmButton))) {
    await confirmButton.focus()
  }

  await scopedWait(
    runtime,
    'Confirm Failure focus',
    async () => ((await isLocatorFocused(confirmButton)) ? confirmButton : null),
    2_000,
  )
  runtime.log('info', 'Confirm Failure focused.')

  const closed = await waitForListboxClosed(runtime, combobox, 2_000)

  if (!closed) {
    throw new NeedsReviewError('Failure reason listbox could not be proven closed.')
  }

  runtime.log('info', 'Failure listbox closed.')

  if (!(await isLocatorVisible(dialog))) {
    runtime.log('error', 'Unexpected parent dialog dismissal.', {
      errorClass: 'NeedsReviewError',
      reason: 'Failure dialog closed before Confirm Failure activation.',
    })
    throw new NeedsReviewError('Failure dialog closed before Confirm Failure activation.')
  }
  runtime.log('info', 'Parent failure dialog remained open.')

  if (!(await isFailureReasonStillSelected(runtime, dialog, combobox))) {
    throw new NeedsReviewError('Phone - Display selection disappeared before confirmation.')
  }
  runtime.log('info', 'Selection persisted after listbox close.')
}

async function isFailureReasonStillSelected(
  runtime: WorkflowRuntime,
  dialog: Locator,
  combobox: Locator,
): Promise<boolean> {
  const comboboxText = await combobox.innerText().catch(() => '')

  if (comboboxText.includes(FAILURE_REASON_LABEL)) {
    return true
  }

  const dialogChip = dialog.getByText(FAILURE_REASON_LABEL, { exact: true })

  if (await isLocatorVisible(dialogChip)) {
    return true
  }

  const listboxId = await getOwnedListboxId(combobox)

  if (listboxId === null || listboxId.trim().length === 0) {
    return false
  }

  const option = runtime.page
    .locator(`#${escapeCssId(listboxId)}`)
    .locator(`[role="option"][data-logging-label="${FAILURE_REASON_LABEL}"]`)
  const count = await option.count().catch(() => 0)

  for (let index = 0; index < count; index += 1) {
    if (await isFailureOptionSelected(option.nth(index))) {
      return true
    }
  }

  return false
}

async function waitForListboxClosed(
  runtime: WorkflowRuntime,
  combobox: Locator,
  timeoutMs: number,
): Promise<boolean> {
  return scopedWait(
    runtime,
    'failure reason listbox to close',
    async () => ((await isFailureListboxClosed(runtime, combobox)) ? true : null),
    timeoutMs,
  )
    .then(() => true)
    .catch(() => false)
}

async function isFailureListboxClosed(
  runtime: WorkflowRuntime,
  combobox: Locator,
): Promise<boolean> {
  const expanded = await combobox.getAttribute('aria-expanded').catch(() => null)
  const listboxId = await getOwnedListboxId(combobox)

  if (expanded === 'true') {
    return false
  }

  if (listboxId === null || listboxId.trim().length === 0) {
    return expanded === 'false'
  }

  const listbox = runtime.page.locator(`#${escapeCssId(listboxId)}`)
  return !(await isLocatorVisible(listbox))
}

async function resolveOwnedFailureListbox(
  runtime: WorkflowRuntime,
  combobox: Locator,
): Promise<Locator> {
  const listboxId = await getOwnedListboxId(combobox)

  if (listboxId === null || listboxId.trim().length === 0) {
    throw new WorkflowInvariantError(
      'Failure reason combobox does not own a listbox.',
    )
  }

  return uniqueVisible(
    runtime.page.locator(`#${escapeCssId(listboxId)}`),
    'owned failure reason listbox',
  )
}

async function getOwnedListboxId(combobox: Locator): Promise<string | null> {
  return (
    (await combobox.getAttribute('aria-controls').catch(() => null)) ??
    (await combobox.getAttribute('aria-owns').catch(() => null))
  )
}

async function isLocatorFocused(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((node) => document.activeElement === node)
    .catch(() => false)
}

async function isFailureOptionSelected(option: Locator): Promise<boolean> {
  const ariaSelected = await option.getAttribute('aria-selected').catch(() => null)

  if (ariaSelected === 'true') {
    return true
  }

  const checkbox = option.locator('input[type="checkbox"]')
  const checkboxCount = await checkbox.count().catch(() => 0)

  if (checkboxCount === 0) {
    return false
  }

  if (checkboxCount > 1) {
    throw new WorkflowInvariantError(
      'Phone - Display option resolved multiple selection checkboxes.',
    )
  }

  return checkbox.isChecked().catch(() => false)
}

function escapeCssId(id: string): string {
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}
