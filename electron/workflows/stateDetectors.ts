import type { Locator, Page } from 'playwright-core'
import {
  isLocatorEnabled,
  isLocatorVisible,
  singleVisibleEnabledOrNull,
  singleVisibleOrNull,
  visibleMatches,
} from './primitives'
import { SELECTORS } from './types'
import { WorkflowInvariantError } from './errors'
import type { WorkflowRuntime } from './types'
import type { ReconciledWorkflowState } from './transitionRecoveryCore'
import {
  resolveActiveWorkflowAsset,
  isValidAssetId,
  type ActiveWorkflowAssetResolution,
  type LabeledAssetField,
} from './activeWorkflowAssetCore'

const CONTAINER_SELECTOR =
  "section, form, article, [role='region'], [role='group'], div"

export async function inspectActiveWorkflowAsset(
  page: Page,
  expectedAssetId: string,
): Promise<ActiveWorkflowAssetResolution & { activeWorkflowDetected: boolean }> {
  const informationTitles = await visibleMatches(
    page.getByText(/^Asset Information$/i, { exact: true }),
  )
  const contextTitles = informationTitles.length === 0
    ? await visibleMatches(page.getByText(/^Context$/i, { exact: true }))
    : []
  const titles = informationTitles.length > 0 ? informationTitles : contextTitles
  const regions: Locator[] = []

  for (const title of titles) {
    const region = title.locator(
      'xpath=ancestor::*[.//*[normalize-space(.)="Asset tag" or normalize-space(.)="Asset tag:"]][1]',
    )
    if ((await region.count().catch(() => 0)) === 1 && await isLocatorVisible(region)) {
      regions.push(region)
    }
  }

  const activeWorkflowDetected = titles.length > 0
  const fields: LabeledAssetField[] = []

  if (regions.length === 1) {
    const labels = await visibleMatches(
      regions[0].getByText(/^Asset tag:?$/i, { exact: true }),
    )
    for (const label of labels) {
      fields.push({
        label: (await label.textContent().catch(() => null)) ?? 'Asset tag',
        ...await readLabeledAssetTagField(label),
      })
    }
  } else if (regions.length > 1) {
    fields.push(
      { label: 'Asset tag', values: [], fieldContainerResolved: false },
      { label: 'Asset tag', values: [], fieldContainerResolved: false },
    )
  }

  return {
    activeWorkflowDetected,
    ...resolveActiveWorkflowAsset(activeWorkflowDetected, fields, expectedAssetId),
  }
}

async function readLabeledAssetTagField(
  label: Locator,
): Promise<Pick<LabeledAssetField, 'values' | 'fieldContainerResolved'>> {
  const containers = label.locator(
    'xpath=ancestor::*[self::div or self::li or self::tr or self::dl or self::section or @role="row" or @role="group"]',
  )
  const containerCount = Math.min(await containers.count().catch(() => 0), 6)

  for (let index = 0; index < containerCount; index += 1) {
    const container = containers.nth(index)
    if (!(await isLocatorVisible(container))) continue
    const candidates = await visibleMatches(
      container.locator('a, [role="link"], dd, td, span, p'),
    )
    const values: string[] = []
    for (const candidate of candidates) {
      const value = await readLocatorValue(candidate)
      if (value !== null && isValidAssetId(value)) values.push(value)
    }
    const sibling = await singleVisibleOrNull(
      label.locator('xpath=following-sibling::*[1]'),
      'Asset tag adjacent value',
    )
    if (sibling !== null) {
      const value = await readLocatorValue(sibling)
      if (value !== null && isValidAssetId(value)) values.push(value)
    }
    if (values.length > 0) {
      return { values, fieldContainerResolved: true }
    }
  }

  return { values: [], fieldContainerResolved: false }
}

async function readLocatorValue(locator: Locator): Promise<string | null> {
  const inputValue = await locator.inputValue().catch(() => null)
  if (inputValue !== null) return inputValue
  return locator.textContent().catch(() => null)
}

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

export async function reconcileWorkflowState(
  runtime: WorkflowRuntime,
  expectedAssetId: string,
  initialEmptyMeansCompleted: boolean,
): Promise<{ state: ReconciledWorkflowState; locator: Locator | null }> {
  await runtime.ensurePageReady()

  const start = await findStartButton(runtime.page)
  const wipe = await inspectStepState(runtime, 'Wipe', expectedAssetId)
  const diagnostic = await inspectStepState(runtime, 'Diagnostic', expectedAssetId)
  const initial = await inspectInitialScanner(runtime.page, expectedAssetId)
  const recognized = [start !== null, wipe !== null, diagnostic !== null].filter(Boolean).length

  if (recognized > 1 || initial.candidateCount > 1) {
    return { state: 'ambiguous', locator: null }
  }

  if (diagnostic !== null) {
    return { state: 'diagnostic', locator: diagnostic.input }
  }

  if (wipe !== null) {
    return {
      state: wipe.inputActionable || wipe.passActionable
        ? 'wipe-actionable'
        : 'wipe-processing',
      locator: wipe.button,
    }
  }

  if (start !== null) {
    return { state: 'start-available', locator: start }
  }

  if (
    initial.state === 'initial-empty' &&
    initial.enabled &&
    initialEmptyMeansCompleted
  ) {
    return { state: 'completed', locator: initial.locator }
  }

  return initial
}

export async function inspectStepState(
  runtime: WorkflowRuntime,
  stepName: 'Wipe' | 'Diagnostic',
  expectedAssetId?: string,
): Promise<{
  input: Locator
  button: Locator
  inputActionable: boolean
  passActionable: boolean
  failActionable: boolean
  inputMatchesAsset: boolean
} | null> {
  const inputCandidates = runtime.page.getByPlaceholder(/^Scan asset tag or serial number$/i)
  const inputCount = await inputCandidates.count().catch(() => 0)
  const matches: Array<{
    input: Locator
    button: Locator
    inputActionable: boolean
    passActionable: boolean
    failActionable: boolean
    inputMatchesAsset: boolean
  }> = []
  const buttonName = stepName === 'Wipe'
    ? SELECTORS.confirmWipeText
    : /Confirm\s+diagnostic|Diagnostic failed/i

  for (let index = 0; index < inputCount; index += 1) {
    const input = inputCandidates.nth(index)
    if (!(await isLocatorVisible(input))) continue

    const panel = input.locator(
      `xpath=ancestor::*[.//*[normalize-space(.)="${stepName}"] and .//button][1]`,
    )
    if ((await panel.count().catch(() => 0)) !== 1 || !(await isLocatorVisible(panel))) continue

    const buttons = await visibleMatches(panel.getByRole('button', { name: buttonName }))
    if (buttons.length === 0) continue
    if (stepName === 'Wipe' && buttons.length > 1) {
      throw new WorkflowInvariantError(
        `Wipe recovery state resolved ${buttons.length} Confirm Wipe buttons; expected exactly one.`,
      )
    }
    const button = buttons[0]
    const passButton = stepName === 'Wipe'
      ? button
      : await singleVisibleOrNull(
          panel.getByRole('button', { name: SELECTORS.confirmDiagnosticText }),
          'Diagnostic pass action',
        )
    const failButton = stepName === 'Diagnostic'
      ? await singleVisibleOrNull(
          panel.locator('button[aria-label="Diagnostic failed"]'),
          'Diagnostic fail action',
        )
      : null
    matches.push({
      input,
      button,
      inputActionable: await isLocatorEnabled(input),
      passActionable: passButton !== null && await isLocatorEnabled(passButton),
      failActionable: failButton !== null && await isLocatorEnabled(failButton),
      inputMatchesAsset: expectedAssetId !== undefined &&
        (await input.inputValue().catch(() => null)) === expectedAssetId,
    })
  }

  if (matches.length > 1) {
    throw new WorkflowInvariantError(
      `${stepName} recovery state resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0] ?? null
}

export async function findStartButton(page: Page): Promise<Locator | null> {
  return singleVisibleEnabledOrNull(
    page.getByRole('button', { name: SELECTORS.startButtonText }),
    'Start button',
  )
}

export async function findConfirmWipe(page: Page): Promise<Locator | null> {
  return singleVisibleEnabledOrNull(
    page.getByRole('button', { name: SELECTORS.confirmWipeText }),
    'Confirm Wipe button',
  )
}

export async function findConfirmDiagnostic(page: Page): Promise<Locator | null> {
  return singleVisibleEnabledOrNull(
    page.getByRole('button', { name: SELECTORS.confirmDiagnosticText }),
    'Confirm Diagnostic button',
  )
}

export async function findStepScanner(
  runtime: WorkflowRuntime,
  stepName: 'Wipe' | 'Diagnostic',
): Promise<Locator | null> {
  const bundle = await findMriStepBundle(runtime, stepName)

  return bundle?.input ?? null
}

export async function findMriStepBundle(
  runtime: WorkflowRuntime,
  stepName: 'Wipe' | 'Diagnostic',
): Promise<{ panel: Locator; input: Locator; button: Locator } | null> {
  const page = runtime.page
  const buttonPredicate =
    stepName === 'Wipe'
      ? 'contains(normalize-space(.), "Confirm wipe") or contains(@aria-label, "Confirm wipe")'
      : 'contains(normalize-space(.), "Confirm diagnostic") or contains(@aria-label, "Confirm diagnostic") or @aria-label="Diagnostic failed"'
  const inputCandidates = page.getByPlaceholder(/^Scan asset tag or serial number$/i)
  const rawContainerCount = await page
    .locator(CONTAINER_SELECTOR)
    .filter({ hasText: new RegExp(`^\\s*${stepName}\\s*$`, 'i') })
    .count()
    .catch(() => 0)
  const inputCount = await inputCandidates.count().catch(() => 0)
  const bundles: Array<{ panel: Locator; input: Locator; button: Locator }> = []

  for (let index = 0; index < inputCount; index += 1) {
    const input = inputCandidates.nth(index)

    if (!(await isLocatorVisible(input)) || !(await isLocatorEnabled(input))) {
      continue
    }

    const placeholder = await input.getAttribute('placeholder').catch(() => null)

    if (placeholder === null || !/^Scan asset tag or serial number$/i.test(placeholder)) {
      continue
    }

    const panel = input.locator(
      `xpath=ancestor::*[.//*[normalize-space(.)="${stepName}"] and .//button[${buttonPredicate}]][1]`,
    )

    if ((await panel.count().catch(() => 0)) !== 1 || !(await isLocatorVisible(panel))) {
      continue
    }

    const buttons = await visibleMatches(panel.locator(`xpath=.//button[${buttonPredicate}]`))

    if (buttons.length === 0) {
      continue
    }

    if (stepName === 'Wipe' && buttons.length > 1) {
      throw new WorkflowInvariantError(
        `Wipe associated Confirm wipe button resolved ${buttons.length} candidates; expected exactly one.`,
      )
    }

    bundles.push({ panel, input, button: buttons[0] })
  }

  const deduped = await dedupeBundlesByPanel(bundles)
  runtime.log('info', 'Workflow section resolved.', {
    reason: [
      `stage=${stepName}`,
      `rawContainerCandidates=${rawContainerCount}`,
      `uniqueActionableControls=${bundles.length}`,
      `deduplicatedBundles=${deduped.length}`,
      `button=${stepName === 'Wipe' ? 'Confirm wipe' : 'Confirm diagnostic/Diagnostic failed'}`,
      'inputPlaceholder=Scan asset tag or serial number',
      'selectedPanel=nearest matching ancestor',
    ].join('; '),
  })

  if (deduped.length > 1) {
    runtime.log('error', 'Workflow section ambiguity.', {
      errorClass: 'WorkflowInvariantError',
      reason: `${stepName} has multiple genuinely actionable panels.`,
    })
    throw new WorkflowInvariantError(
      `${stepName} workflow section resolved ${deduped.length} actionable bundles; expected exactly one.`,
    )
  }

  return deduped[0] ?? null
}

export async function findMriConfirmWipe(
  runtime: WorkflowRuntime,
): Promise<Locator | null> {
  const bundle = await findMriStepBundle(runtime, 'Wipe')

  if (bundle === null) {
    return null
  }

  return singleVisibleEnabledOrNull(
    bundle.panel.getByRole('button', { name: SELECTORS.confirmWipeText }),
    'MRI Wipe Confirm Wipe button',
  )
}

export async function findMriConfirmDiagnostic(
  runtime: WorkflowRuntime,
): Promise<Locator | null> {
  const bundle = await findMriStepBundle(runtime, 'Diagnostic')

  if (bundle === null) {
    return null
  }

  return singleVisibleEnabledOrNull(
    bundle.panel.getByRole('button', { name: SELECTORS.confirmDiagnosticText }),
    'MRI Diagnostic Confirm Diagnostic button',
  )
}

export async function findDiagnosticFailedButton(
  runtime: WorkflowRuntime,
): Promise<Locator | null> {
  const diagnosticSection = await findMriStepBundle(runtime, 'Diagnostic')

  if (diagnosticSection === null) {
    return null
  }

  return singleVisibleEnabledOrNull(
    diagnosticSection.panel.locator('button[aria-label="Diagnostic failed"]'),
    'Diagnostic Failed button',
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

  if (repairSection === null) {
    return null
  }

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
    ) {
      matches.push(input)
    }
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
    ) {
      matches.push(input)
    }
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

  if (repairSection === null) {
    return null
  }

  const button = await singleVisibleOrNull(repairSection.getByRole('button', {
    name: SELECTORS.repairFailedText,
  }), 'Repair Failed button')

  if (button === null) {
    return null
  }

  if (requireEnabled && !(await isLocatorEnabled(button))) {
    return null
  }

  return button
}

export async function findConfirmRepairButton(
  page: Page,
  requireEnabled: boolean,
): Promise<Locator | null> {
  const repairSection = await findRepairSection(page)

  if (repairSection === null) {
    return null
  }

  const button = await singleVisibleOrNull(repairSection.getByRole('button', {
    name: SELECTORS.confirmRepairText,
  }), 'Confirm Repair button')

  if (button === null) {
    return null
  }

  if (requireEnabled && !(await isLocatorEnabled(button))) {
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

    if (!(await isLocatorVisible(dialog))) {
      continue
    }

    const text = await dialog.innerText().catch(() => '')

    if (
      /No order found for the scanned asset|Would you like to create a new order|Asset Tag\/Serial Number Not Found|not found\. Please verify and try again|Failed to retrieve order|Failed to execute instruction|Query Error/i.test(
        text,
      )
    ) {
      return true
    }
  }

  return false
}

async function dedupeBundlesByPanel(
  bundles: Array<{ panel: Locator; input: Locator; button: Locator }>,
): Promise<Array<{ panel: Locator; input: Locator; button: Locator }>> {
  return bundles
}
