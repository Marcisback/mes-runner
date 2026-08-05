import type { Locator, Page } from 'playwright-core'
import {
  isLocatorEnabled,
  isLocatorVisible,
  singleVisibleEnabledOrNull,
  singleVisibleOrNull,
  visibleMatches,
} from './primitives'
import { WorkflowInvariantError } from './errors'
import { SELECTORS } from './types'

const CONTAINER_SELECTOR =
  "section, form, article, [role='region'], [role='group'], div"

export async function findInitialScanner(page: Page): Promise<Locator | null> {
  return singleVisibleEnabledOrNull(
    page.getByPlaceholder(SELECTORS.firstScanText),
    'initial asset scanner',
  )
}

export async function inspectInitialScanner(
  page: Page,
  expectedAssetId: string,
): Promise<{
  state: 'initial-empty' | 'initial-asset' | 'initial-unexpected' | 'ambiguous'
  locator: Locator | null
  candidateCount: number
  enabled: boolean
}> {
  const matches = await visibleMatches(page.getByPlaceholder(SELECTORS.firstScanText))

  if (matches.length !== 1) {
    return {
      state: 'ambiguous',
      locator: null,
      candidateCount: matches.length,
      enabled: false,
    }
  }

  const locator = matches[0]
  const value = await locator.inputValue().catch(() => null)
  const enabled = await isLocatorEnabled(locator)

  if (value === null) {
    return { state: 'ambiguous', locator: null, candidateCount: 1, enabled }
  }

  if (value === expectedAssetId) {
    return { state: 'initial-asset', locator, candidateCount: 1, enabled }
  }

  if (value.trim().length === 0) {
    return { state: 'initial-empty', locator, candidateCount: 1, enabled }
  }

  return { state: 'initial-unexpected', locator, candidateCount: 1, enabled }
}

export async function findConfirmWipe(page: Page): Promise<Locator | null> {
  return singleVisibleEnabledOrNull(
    page.getByRole('button', { name: SELECTORS.confirmWipeText }),
    'Confirm Wipe button',
  )
}

export async function findRepairSection(page: Page): Promise<Locator | null> {
  const sections = page
    .locator(CONTAINER_SELECTOR)
    .filter({ hasText: /\bRepair\b/i })
    .filter({ hasText: /\bStarted\b/i })

  return singleVisibleOrNull(sections, 'Repair Started section')
}

export async function findRepairInput(page: Page): Promise<Locator | null> {
  const repairSection = await findRepairSection(page)

  if (repairSection === null) return null

  const inputs = repairSection.getByPlaceholder(/^Scan asset tag or serial number$/i)
  const count = await inputs.count().catch(() => 0)
  const matches: Locator[] = []

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index)
    const placeholder = await input.getAttribute('placeholder').catch(() => null)

    if (
      placeholder !== null &&
      /^Scan asset tag or serial number$/i.test(placeholder) &&
      (await isLocatorVisible(input)) &&
      (await isLocatorEnabled(input))
    ) matches.push(input)
  }

  if (matches.length !== 1) {
    throw new WorkflowInvariantError(
      `Repair asset scanner resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0]
}

export async function findRepairLocatorInput(page: Page): Promise<Locator | null> {
  const inputs = page.locator('input[role="combobox"][aria-autocomplete="list"]')
  const count = await inputs.count().catch(() => 0)
  const matches: Locator[] = []

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index)
    const placeholder = await input.getAttribute('placeholder').catch(() => null)
    const isAssetScanner =
      placeholder !== null && /^Scan asset tag or serial number$/i.test(placeholder)

    if (
      !isAssetScanner &&
      (await isLocatorVisible(input)) &&
      (await isLocatorEnabled(input))
    ) matches.push(input)
  }

  if (matches.length !== 1) {
    throw new WorkflowInvariantError(
      `Repair locator input resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0]
}

export async function findRepairFailedButton(
  page: Page,
  requireEnabled: boolean,
): Promise<Locator | null> {
  const repairSection = await findRepairSection(page)

  if (repairSection === null) return null

  const button = await singleVisibleOrNull(repairSection.getByRole('button', {
    name: SELECTORS.repairFailedText,
  }), 'Repair Failed button')

  if (button === null || (requireEnabled && !(await isLocatorEnabled(button)))) {
    return null
  }

  return button
}

export async function findConfirmRepairButton(
  page: Page,
  requireEnabled: boolean,
): Promise<Locator | null> {
  const repairSection = await findRepairSection(page)

  if (repairSection === null) return null

  const button = await singleVisibleOrNull(repairSection.getByRole('button', {
    name: SELECTORS.confirmRepairText,
  }), 'Confirm Repair button')

  if (button === null || (requireEnabled && !(await isLocatorEnabled(button)))) {
    return null
  }

  return button
}

export async function findConfirmMoveButton(page: Page): Promise<Locator | null> {
  return singleVisibleOrNull(
    page.getByRole('button', { name: /^Confirm move$/i }),
    'Confirm Move button',
  )
}

export async function hasVisibleAssetErrorDialog(page: Page): Promise<boolean> {
  const dialogs = page.locator('[role="dialog"]')
  const count = await dialogs.count().catch(() => 0)

  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index)

    if (!(await isLocatorVisible(dialog))) continue

    const text = await dialog.innerText().catch(() => '')

    if (
      /No order found for the scanned asset|Would you like to create a new order|Asset Tag\/Serial Number Not Found|not found\. Please verify and try again|Failed to retrieve order|Failed to execute instruction|Query Error/i.test(
        text,
      )
    ) return true
  }

  return false
}
