import type { Frame, Locator, Page } from 'playwright-core'
import { NeedsReviewError, WorkflowInvariantError } from './errors'
import {
  clickWithSettles,
  delay,
  isLocatorEditable,
  isLocatorEnabled,
  isLocatorVisible,
  scopedWait,
  sleepWithCheckpoint,
  uniqueVisible,
  waitScopedVisibleAndEnabled,
  visibleMatches,
  visibleEnabledMatches,
} from './primitives'
import { closePopupIfPresent } from './popupHandler'
import { type WorkflowRuntime } from './types'

const MOVE_TO_REPAIR_TIMEOUT_MS = 10_000
const MOVE_TO_REPAIR_RENDER_POLL_MS = 250
const MOVE_TO_REPAIR_FOCUS_TIMEOUT_MS = 1_500
const MOVE_TO_REPAIR_KEY_DELAY_MS = 10
const MOVE_TO_REPAIR_AUTOCOMPLETE_DEBOUNCE_MS = 250
const MOVE_TO_REPAIR_SUGGESTION_WAIT_MS = 5_000
const SCAN_LOCATOR_PLACEHOLDER = /^Scan locator$/i
const ASSET_SCANNER_PLACEHOLDER =
  /Scan the asset tag|serial number to get started|Scan asset tag or serial number/i

interface MoveToRepairTarget {
  region: Locator
  input: Locator
  confirmMove: Locator
}

interface ProtectedInputSnapshot {
  label: string
  locator: Locator
  value: string
}

interface ScanLocatorResolution {
  input: Locator
  frameName: string
  elapsedMs: number
}

interface ScanLocatorDiagnostics {
  frameName: string
  totalInputs: number
  inputsWithPlaceholder: number
  exactMatches: number
  attachedMatches: number
  visibleMatches: number
  enabledMatches: number
  editableMatches: number
  headings: string[]
  moveToRepairVisible: boolean
}

interface SuggestionResolution {
  row: Locator
  rowCount: number
  firstLineMatchCount: number
  secondaryMetadataDetected: boolean
}

export async function completeMoveToRepair(
  runtime: WorkflowRuntime,
  repairLocation: string,
): Promise<void> {
  const location = validateMoveToRepairLocator(runtime, repairLocation)

  runtime.log('info', 'Target resolution started.', {
    reason: 'Move-to-Repair Scan locator',
  })
  const target = await scopedWait(
    runtime,
    'Move to Repair location input',
    () => resolveMoveToRepairTarget(runtime),
    MOVE_TO_REPAIR_TIMEOUT_MS,
  )
  runtime.log('info', 'Move-to-Repair locator resolved.', {
    reason: await formatTargetMetadata(target.input, 'Move to Repair'),
  })

  const protectedInputsBefore = await readProtectedInputSnapshot(runtime)
  const suggestion = await enterRepairLocation(
    runtime,
    target,
    location,
    protectedInputsBefore,
  )

  if (suggestion === null) {
    runtime.log('error', 'Move-to-Repair suggestion timed out.', {
      errorClass: 'NeedsReviewError',
      reason: 'No locator suggestion appeared.',
    })
    throw new NeedsReviewError('No Move-to-Repair locator suggestion appeared.')
  }

  runtime.log('info', 'Suggestion appeared.', {
    reason: 'Move-to-Repair locator suggestion',
  })
  await selectRepairLocationSuggestion(runtime, target, suggestion, location)
  await assertProtectedInputsUnchanged(runtime, protectedInputsBefore)
  await waitForRepairLocationListboxClosed(runtime, target)

  await scopedWait(
    runtime,
    'committed Move to Repair location',
    async () =>
      (await isRepairLocationSelectionCommitted(target.input, location))
        ? target.input
        : null,
    MOVE_TO_REPAIR_TIMEOUT_MS,
  )
  runtime.log('info', 'Locator value verified.', {
    reason: 'Scan locator contains configured locator',
  })

  const enabledConfirmMove = await waitScopedVisibleAndEnabled(
    runtime,
    target.confirmMove,
    'enabled Move-to-Repair Confirm move button',
    MOVE_TO_REPAIR_TIMEOUT_MS,
  ).catch((error: unknown) => {
    runtime.log('error', 'Confirm move remained disabled.', {
      errorClass: 'NeedsReviewError',
      reason: error instanceof Error ? error.message : 'Confirm move disabled',
    })
    throw new NeedsReviewError('Confirm move did not enable after locator selection.')
  })
  runtime.log('info', 'Confirm Move enabled.')

  await clickWithSettles(runtime, enabledConfirmMove, 75, 300)
  runtime.log('info', 'Confirm Move activated.')

  await scopedWait(
    runtime,
    'Move to Repair advancement',
    async () =>
      (await isLocatorVisible(target.region)) &&
      (await isLocatorVisible(target.confirmMove))
        ? null
        : true,
    MOVE_TO_REPAIR_TIMEOUT_MS,
  )
  runtime.log('info', 'Move-to-Repair advancement verified.')
}

async function enterRepairLocation(
  runtime: WorkflowRuntime,
  target: MoveToRepairTarget,
  location: string,
  protectedInputsBefore: ProtectedInputSnapshot[],
): Promise<Locator | null> {
  await assertNotAssetScanner(target.input)
  await focusMoveToRepairInput(runtime, target.input)
  await clearInputWithKeyboard(runtime)
  await assertProtectedInputsUnchanged(runtime, protectedInputsBefore)
  await focusMoveToRepairInput(runtime, target.input)
  runtime.log('info', 'Trusted locator typing started.', {
    reason: `characters=${location.length}`,
  })

  const typingStartedAt = Date.now()
  let autocompleteOpened = false
  let exactSuggestion: SuggestionResolution | null = null

  await runtime.checkpoint()
  await target.input.pressSequentially(location, {
    delay: MOVE_TO_REPAIR_KEY_DELAY_MS,
  })
  await assertProtectedInputsUnchanged(runtime, protectedInputsBefore)

  const typingDurationMs = Date.now() - typingStartedAt
  runtime.log('info', 'Trusted locator typing completed.', {
    reason: `characters=${location.length}; durationMs=${typingDurationMs}`,
  })
  runtime.log('info', 'Typing duration.', {
    reason: `durationMs=${typingDurationMs}`,
  })
  await sleepWithCheckpoint(runtime, MOVE_TO_REPAIR_AUTOCOMPLETE_DEBOUNCE_MS)

  await scopedWait(
    runtime,
    'Move-to-Repair exact input value',
    async () => {
      const value = await target.input.inputValue().catch(() => '')
      return value === location ? target.input : null
    },
    MOVE_TO_REPAIR_TIMEOUT_MS,
  )
  runtime.log('info', 'Locator entered and verified.', {
    reason: 'Scan locator contains configured locator',
  })

  exactSuggestion = await scopedWait(
    runtime,
    'exact Move-to-Repair locator suggestion',
    async () => {
      const listbox = await findRepairLocationListbox(runtime, target)

      if (listbox === null) {
        return null
      }

      if (!autocompleteOpened) {
        runtime.log('info', 'Autocomplete appeared.')
      }
      autocompleteOpened = true
      return findExactRepairLocationSuggestion(listbox, location)
    },
    MOVE_TO_REPAIR_SUGGESTION_WAIT_MS,
  ).catch(() => null)

  if (exactSuggestion !== null) {
    runtime.log('info', 'Visible suggestion row count.', {
      reason: `rows=${exactSuggestion.rowCount}`,
    })
    runtime.log('info', 'Suggestion first-line match count.', {
      reason: `matches=${exactSuggestion.firstLineMatchCount}`,
    })
    if (exactSuggestion.secondaryMetadataDetected) {
      runtime.log('info', 'Secondary suggestion metadata detected.')
    }
    runtime.log('info', 'Exact locator suggestion found.', {
      reason: `charactersEntered=${location.length}`,
    })
    runtime.log('info', 'Exact locator suggestion resolved by first line.')
  }

  if (!autocompleteOpened) {
    throw new NeedsReviewError('Move-to-Repair locator autocomplete never appeared.')
  }

  if (exactSuggestion === null) {
    throw new NeedsReviewError('Exact Move-to-Repair locator suggestion never appeared.')
  }

  return exactSuggestion.row
}

async function focusMoveToRepairInput(
  runtime: WorkflowRuntime,
  input: Locator,
): Promise<void> {
  await input.scrollIntoViewIfNeeded()
  await assertNotAssetScanner(input)
  await input.click()
  await input.focus()

  await scopedWait(
    runtime,
    'focused Move to Repair input',
    async () =>
      (await input.evaluate((node) => document.activeElement === node))
        ? input
        : null,
    MOVE_TO_REPAIR_FOCUS_TIMEOUT_MS,
  )
}

async function isRepairLocationSelectionCommitted(
  input: Locator,
  location: string,
): Promise<boolean> {
  const value = await input.inputValue().catch(() => '')

  return value.includes(location)
}

async function resolveMoveToRepairTarget(
  runtime: WorkflowRuntime,
): Promise<MoveToRepairTarget | null> {
  runtime.log('info', 'Move-to-Repair resolution started.')
  const resolution = await waitForStableScanLocatorRendered(runtime)
  const input = resolution.input

  runtime.log('info', 'Scan locator appeared after transition.', {
    reason: `elapsedMs=${resolution.elapsedMs}; frame=${resolution.frameName}`,
  })
  runtime.log('info', 'Stable visibility confirmed.', {
    reason: 'Scan locator visible across consecutive polls',
  })

  await waitForScanLocatorEnabledEditable(runtime, input)
  runtime.log('info', 'Enabled/editable confirmed.')
  runtime.log('info', 'Trusted typing path entered.')

  const region = await resolveNearestMoveToRepairRegion(runtime, input)
  const confirmMove = await resolveConfirmMoveButton(runtime, region)
  const initiallyEnabled = await isLocatorEnabled(confirmMove)

  await assertNotAssetScanner(input)
  runtime.log('info', 'Confirm move initial enabled state.', {
    reason: initiallyEnabled ? 'enabled' : 'disabled',
  })
  runtime.log('info', 'Move-to-Repair bundle resolved.', {
    reason: 'unique Scan locator input with nearest Move to repair panel',
  })

  return {
    region,
    input,
    confirmMove,
  }
}

async function waitForStableScanLocatorRendered(
  runtime: WorkflowRuntime,
): Promise<ScanLocatorResolution> {
  const startedAt = Date.now()
  let attempt = 0
  let previousFrameName: string | null = null
  let previousVisibleCount = 0

  while (Date.now() - startedAt < MOVE_TO_REPAIR_TIMEOUT_MS) {
    attempt += 1
    await runtime.checkpoint()
    await runtime.ensurePageReady()
    await closePopupIfPresent(runtime)

    const elapsedMs = Date.now() - startedAt
    const pageDiagnostics = await collectScanLocatorDiagnostics(runtime.page)
    const mainVisible = await getVisibleScanLocatorMatches(runtime.page)

    if (mainVisible.length > 1) {
      throw new WorkflowInvariantError(
        `Move-to-Repair Scan locator resolved ${mainVisible.length} visible candidates; expected exactly one.`,
      )
    }

    if (mainVisible.length === 1) {
      const frameName = sanitizeFrameName(runtime.page.mainFrame().name())

      if (previousFrameName === frameName && previousVisibleCount === 1) {
        return {
          input: mainVisible[0],
          frameName,
          elapsedMs,
        }
      }

      previousFrameName = frameName
      previousVisibleCount = 1
      await delay(MOVE_TO_REPAIR_RENDER_POLL_MS)
      continue
    }

    const frameResolution = await resolveScanLocatorFromChildFrames(runtime.page)

    if (frameResolution.kind === 'ambiguous') {
      throw new WorkflowInvariantError(frameResolution.reason)
    }

    if (frameResolution.kind === 'found') {
      if (
        previousFrameName === frameResolution.frameName &&
        previousVisibleCount === 1
      ) {
        return {
          input: frameResolution.input,
          frameName: frameResolution.frameName,
          elapsedMs,
        }
      }

      previousFrameName = frameResolution.frameName
      previousVisibleCount = 1
      await delay(MOVE_TO_REPAIR_RENDER_POLL_MS)
      continue
    }

    previousFrameName = null
    previousVisibleCount = 0
    logScanLocatorRetry(runtime, attempt, elapsedMs, pageDiagnostics)
    await delay(MOVE_TO_REPAIR_RENDER_POLL_MS)
  }

  throw new NeedsReviewError(
    'Move-to-Repair Scan locator did not render before timeout.',
  )
}

async function waitForScanLocatorEnabledEditable(
  runtime: WorkflowRuntime,
  input: Locator,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < MOVE_TO_REPAIR_TIMEOUT_MS) {
    await runtime.checkpoint()
    await runtime.ensurePageReady()
    await closePopupIfPresent(runtime)

    if (
      (await isLocatorVisible(input)) &&
      (await isLocatorEnabled(input)) &&
      (await isLocatorEditable(input))
    ) {
      return
    }

    await delay(MOVE_TO_REPAIR_RENDER_POLL_MS)
  }

  throw new NeedsReviewError(
    'Move-to-Repair Scan locator did not become enabled and editable.',
  )
}

function logScanLocatorRetry(
  runtime: WorkflowRuntime,
  attempt: number,
  elapsedMs: number,
  diagnostics: ScanLocatorDiagnostics,
): void {
  runtime.log('info', 'Scan locator not rendered yet.', {
    reason: [
      `attempt=${attempt}`,
      `elapsedMs=${elapsedMs}`,
      `frame=${diagnostics.frameName}`,
      `totalInputs=${diagnostics.totalInputs}`,
      `inputsWithPlaceholder=${diagnostics.inputsWithPlaceholder}`,
      `rawExactMatches=${diagnostics.exactMatches}`,
      `attachedMatches=${diagnostics.attachedMatches}`,
      `visibleMatches=${diagnostics.visibleMatches}`,
      `enabledMatches=${diagnostics.enabledMatches}`,
      `editableMatches=${diagnostics.editableMatches}`,
      `headings=${diagnostics.headings.join('|') || '-'}`,
      `moveToRepairVisible=${diagnostics.moveToRepairVisible}`,
    ].join('; '),
  })
}

async function getVisibleScanLocatorMatches(
  pageOrFrame: Page | Frame,
): Promise<Locator[]> {
  const candidates = pageOrFrame.locator('input[placeholder="Scan locator"]')
  const count = await candidates.count().catch(() => 0)
  const matches: Locator[] = []

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index)

    if (await isLocatorVisible(candidate)) {
      matches.push(candidate)
    }
  }

  return matches
}

async function resolveScanLocatorFromChildFrames(
  page: Page,
): Promise<
  | { kind: 'none' }
  | { kind: 'found'; input: Locator; frameName: string }
  | { kind: 'ambiguous'; reason: string }
> {
  const frameMatches: Array<{ input: Locator; frameName: string }> = []

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue
    }

    const matches = await getVisibleScanLocatorMatches(frame)

    if (matches.length > 1) {
      return {
        kind: 'ambiguous',
        reason: `Move-to-Repair Scan locator resolved ${matches.length} visible candidates in frame ${sanitizeFrameName(frame.name())}; expected exactly one.`,
      }
    }

    if (matches.length === 1) {
      frameMatches.push({
        input: matches[0],
        frameName: sanitizeFrameName(frame.name()),
      })
    }
  }

  if (frameMatches.length > 1) {
    return {
      kind: 'ambiguous',
      reason: `Move-to-Repair Scan locator resolved ${frameMatches.length} visible frame candidates; expected exactly one.`,
    }
  }

  const match = frameMatches[0]

  if (match === undefined) {
    return { kind: 'none' }
  }

  return {
    kind: 'found',
    input: match.input,
    frameName: match.frameName,
  }
}

async function collectScanLocatorDiagnostics(
  pageOrFrame: Page | Frame,
): Promise<ScanLocatorDiagnostics> {
  const inputCount = await pageOrFrame.locator('input').count().catch(() => 0)
  const placeholderCount = await pageOrFrame
    .locator('input[placeholder]')
    .count()
    .catch(() => 0)
  const exact = pageOrFrame.locator('input[placeholder="Scan locator"]')
  const exactCount = await exact.count().catch(() => 0)
  let visibleCount = 0
  let enabledCount = 0
  let editableCount = 0

  for (let index = 0; index < exactCount; index += 1) {
    const candidate = exact.nth(index)

    if (await isLocatorVisible(candidate)) {
      visibleCount += 1
    }

    if (await isLocatorEnabled(candidate)) {
      enabledCount += 1
    }

    if (await isLocatorEditable(candidate)) {
      editableCount += 1
    }
  }

  return {
    frameName: getPageOrFrameName(pageOrFrame),
    totalInputs: inputCount,
    inputsWithPlaceholder: placeholderCount,
    exactMatches: exactCount,
    attachedMatches: exactCount,
    visibleMatches: visibleCount,
    enabledMatches: enabledCount,
    editableMatches: editableCount,
    headings: await getVisibleWorkflowHeadings(pageOrFrame),
    moveToRepairVisible: await isMoveToRepairTextVisible(pageOrFrame),
  }
}

async function getVisibleWorkflowHeadings(
  pageOrFrame: Page | Frame,
): Promise<string[]> {
  const headings = pageOrFrame.locator('h1, h2, h3, h4, h5, h6, [role="heading"]')
  const count = await headings.count().catch(() => 0)
  const visibleHeadings: string[] = []

  for (let index = 0; index < Math.min(count, 20); index += 1) {
    const heading = headings.nth(index)

    if (!(await isLocatorVisible(heading))) {
      continue
    }

    const text = normalizeSuggestionText(await heading.innerText().catch(() => ''))

    if (text.length > 0) {
      visibleHeadings.push(text.slice(0, 80))
    }
  }

  return visibleHeadings
}

async function isMoveToRepairTextVisible(pageOrFrame: Page | Frame): Promise<boolean> {
  return isLocatorVisible(pageOrFrame.getByText(/^Move to repair$/i))
}

function getPageOrFrameName(pageOrFrame: Page | Frame): string {
  if ('mainFrame' in pageOrFrame) {
    return sanitizeFrameName(pageOrFrame.mainFrame().name())
  }

  return sanitizeFrameName(pageOrFrame.name())
}

function sanitizeFrameName(name: string): string {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 80) : 'main'
}

async function resolveNearestMoveToRepairRegion(
  runtime: WorkflowRuntime,
  input: Locator,
): Promise<Locator> {
  const region = input.locator(
    'xpath=ancestor::*[.//*[normalize-space(.)="Move to repair"] and .//button[normalize-space(.)="Confirm move" or @aria-label="Confirm move"]][1]',
  )
  const count = await region.count().catch(() => 0)

  if (count !== 1 || !(await isLocatorVisible(region))) {
    runtime.log('error', 'Move-to-Repair bundle rejection.', {
      errorClass: 'WorkflowInvariantError',
      reason: `Nearest Move to repair ancestor candidates=${count}`,
    })
    throw new WorkflowInvariantError(
      'Move-to-Repair nearest panel could not be resolved.',
    )
  }

  runtime.log('info', 'Nearest Move to repair ancestor found.', {
    reason: 'selectedPanel=nearest matching ancestor',
  })
  return region
}

async function resolveConfirmMoveButton(
  runtime: WorkflowRuntime,
  region: Locator,
): Promise<Locator> {
  const candidates = region.getByRole('button', { name: /^Confirm move$/i })
  const matches = await visibleMatches(candidates)

  runtime.log('info', 'Confirm move role/name candidates found.', {
    reason: `visible=${matches.length}`,
  })

  if (matches.length !== 1) {
    runtime.log('error', 'Move-to-Repair bundle rejection.', {
      errorClass: 'WorkflowInvariantError',
      reason: `Confirm move resolved ${matches.length} visible candidates; expected exactly one.`,
    })
    throw new WorkflowInvariantError(
      `Move-to-Repair Confirm move resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0]
}

async function findExactRepairLocationSuggestion(
  listbox: Locator,
  location: string,
): Promise<SuggestionResolution | null> {
  const options = listbox.locator('[role="option"]')
  const count = await options.count().catch(() => 0)
  const matches: Locator[] = []
  let visibleRowCount = 0
  let firstLineMatchCount = 0
  let secondaryMetadataDetected = false

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index)

    if (!(await isLocatorVisible(option))) {
      continue
    }

    visibleRowCount += 1
    const lines = getNormalizedNonEmptyLines(
      await option.innerText().catch(() => ''),
    )
    const firstLine = lines[0] ?? ''

    if (lines.length > 1) {
      secondaryMetadataDetected = true
    }

    if (firstLine === location) {
      firstLineMatchCount += 1
      matches.push(option)
      continue
    }

    const exactChild = option.getByText(location, { exact: true })
    const exactChildMatches = await visibleMatches(exactChild)

    if (exactChildMatches.length > 0) {
      firstLineMatchCount += 1
      matches.push(option)
    }
  }

  if (matches.length > 1) {
    throw new WorkflowInvariantError(
      `Move-to-Repair suggestion resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  const row = matches[0]

  if (row === undefined) {
    return null
  }

  return {
    row,
    rowCount: visibleRowCount,
    firstLineMatchCount,
    secondaryMetadataDetected,
  }
}

async function findRepairLocationListbox(
  runtime: WorkflowRuntime,
  target: MoveToRepairTarget,
): Promise<Locator | null> {
  const listboxId =
    (await target.input.getAttribute('aria-controls').catch(() => null)) ??
    (await target.input.getAttribute('aria-owns').catch(() => null))

  if (listboxId !== null && listboxId.length > 0) {
    const listbox = await uniqueVisible(
      runtime.page.locator(`#${escapeCssId(listboxId)}`),
      'owned Move-to-Repair suggestion listbox',
    ).catch(() => null)

    if (listbox === null) {
      return null
    }

    return listbox
  }

  const scopedListboxes = await visibleMatches(target.region.locator('[role="listbox"]'))

  if (scopedListboxes.length === 0) {
    return null
  }

  if (scopedListboxes.length > 1) {
    throw new WorkflowInvariantError(
      `Move-to-Repair suggestion listbox resolved ${scopedListboxes.length} candidates; expected exactly one.`,
    )
  }

  return scopedListboxes[0]
}

async function selectRepairLocationSuggestion(
  runtime: WorkflowRuntime,
  target: MoveToRepairTarget,
  suggestion: Locator,
  location: string,
): Promise<void> {
  await focusMoveToRepairInput(runtime, target.input)

  if (!(await isLocatorVisible(suggestion))) {
    throw new NeedsReviewError('Move-to-Repair locator suggestion disappeared before selection.')
  }

  runtime.log('info', 'Suggestion click started.')
  const clicked = await clickWithSettles(runtime, suggestion, 50, 300)
    .then(() => true)
    .catch(() => false)

  if (!clicked) {
    await selectRepairLocationSuggestionWithKeyboard(runtime, target, location)
  }

  runtime.log('info', 'Exact suggestion selected.')
  await sleepWithCheckpoint(runtime, 300)
}

async function selectRepairLocationSuggestionWithKeyboard(
  runtime: WorkflowRuntime,
  target: MoveToRepairTarget,
  location: string,
): Promise<void> {
  const listbox = await findRepairLocationListbox(runtime, target)

  if (listbox === null) {
    throw new NeedsReviewError(
      'Move-to-Repair suggestion listbox disappeared before keyboard fallback.',
    )
  }

  const options = await visibleMatches(listbox.locator('[role="option"]'))
  const firstOption = options[0]

  if (firstOption === undefined) {
    throw new NeedsReviewError('Move-to-Repair suggestion listbox had no visible options.')
  }

  if ((await getSuggestionFirstLine(firstOption)) !== location) {
    throw new NeedsReviewError(
      'Move-to-Repair keyboard fallback first suggestion did not match.',
    )
  }

  await focusMoveToRepairInput(runtime, target.input)
  await runtime.page.keyboard.press('ArrowDown')

  const activeOption = await resolveActiveDescendantOption(runtime, target.input)

  if (activeOption === null || (await getSuggestionFirstLine(activeOption)) !== location) {
    throw new NeedsReviewError(
      'Move-to-Repair keyboard fallback highlighted the wrong suggestion.',
    )
  }

  await runtime.page.keyboard.press('Enter')
}

async function resolveActiveDescendantOption(
  runtime: WorkflowRuntime,
  input: Locator,
): Promise<Locator | null> {
  const activeId = await input.getAttribute('aria-activedescendant').catch(() => null)

  if (activeId === null || activeId.trim().length === 0) {
    return null
  }

  const active = runtime.page.locator(`#${escapeCssId(activeId)}`)

  return (await isLocatorVisible(active)) ? active : null
}

async function waitForRepairLocationListboxClosed(
  runtime: WorkflowRuntime,
  target: MoveToRepairTarget,
): Promise<void> {
  await scopedWait(
    runtime,
    'Move-to-Repair suggestion dropdown to close',
    async () =>
      (await findRepairLocationListbox(runtime, target)) === null ? true : null,
    MOVE_TO_REPAIR_TIMEOUT_MS,
  ).catch(() => {
    throw new NeedsReviewError(
      'Move-to-Repair locator dropdown did not close after suggestion selection.',
    )
  })
  runtime.log('info', 'Dropdown closed.')
}

async function assertNotAssetScanner(input: Locator): Promise<void> {
  const placeholder = await input.getAttribute('placeholder').catch(() => null)

  if (placeholder === null || !SCAN_LOCATOR_PLACEHOLDER.test(placeholder)) {
    throw new WorkflowInvariantError(
      'Wrong input target rejected: Move-to-Repair target is not Scan locator.',
    )
  }

  if (ASSET_SCANNER_PLACEHOLDER.test(placeholder)) {
    throw new WorkflowInvariantError(
      'Wrong input target rejected: Move-to-Repair target is an asset scanner.',
    )
  }
}

async function clearInputWithKeyboard(runtime: WorkflowRuntime): Promise<void> {
  await runtime.page.keyboard.press('Meta+A')
  await runtime.page.keyboard.press('Backspace')
  await sleepWithCheckpoint(runtime, 100)
}

async function readProtectedInputSnapshot(
  runtime: WorkflowRuntime,
): Promise<ProtectedInputSnapshot[]> {
  const scanners = runtime.page.getByPlaceholder(ASSET_SCANNER_PLACEHOLDER)
  const matches = await visibleEnabledMatches(scanners)
  const snapshots: ProtectedInputSnapshot[] = []

  for (let index = 0; index < matches.length; index += 1) {
    const locator = matches[index]
    const placeholder = await locator.getAttribute('placeholder').catch(() => null)
    const value = await locator.inputValue().catch(() => '')

    snapshots.push({
      label: `${placeholder ?? 'asset scanner'}#${index}`,
      locator,
      value,
    })
  }

  return snapshots
}

async function assertProtectedInputsUnchanged(
  runtime: WorkflowRuntime,
  before: ProtectedInputSnapshot[],
): Promise<void> {
  for (const snapshot of before) {
    const after = await snapshot.locator.inputValue().catch(() => snapshot.value)

    if (after !== snapshot.value) {
      runtime.log('error', 'Wrong input target detected.', {
        errorClass: 'NeedsReviewError',
        reason: 'Protected asset scanner changed during Move-to-Repair locator entry.',
      })
      throw new NeedsReviewError('Wrong input target detected')
    }
  }
}

async function formatTargetMetadata(
  input: Locator,
  workflowRegion: string,
): Promise<string> {
  const placeholder = await input.getAttribute('placeholder').catch(() => null)
  const role = await input.getAttribute('role').catch(() => null)
  const accessibleName = await input.getAttribute('aria-label').catch(() => null)

  return [
    `placeholder=${placeholder ?? '-'}`,
    `role=${role ?? '-'}`,
    `name=${accessibleName ?? '-'}`,
    `scope=${workflowRegion}`,
  ].join('; ')
}

function escapeCssId(id: string): string {
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

export function validateMoveToRepairLocator(
  runtime: WorkflowRuntime,
  repairLocation: string,
): string {
  const location = repairLocation.trim()

  if (location.length === 0) {
    runtime.log('error', 'Move-to-Repair configured locator invalid.', {
      errorClass: 'NeedsReviewError',
      reason: 'configured locator is empty',
    })
    throw new NeedsReviewError('Move-to-Repair locator is empty.')
  }

  runtime.log('info', 'Move-to-Repair configured locator validated.', {
    reason: `characters=${location.length}`,
  })
  return location
}

function normalizeSuggestionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function getNormalizedNonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeSuggestionText(line))
    .filter((line) => line.length > 0)
}

async function getSuggestionFirstLine(option: Locator): Promise<string> {
  return getNormalizedNonEmptyLines(await option.innerText().catch(() => ''))[0] ?? ''
}
