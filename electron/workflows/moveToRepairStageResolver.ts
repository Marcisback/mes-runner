import type { Locator } from 'playwright-core'
import type { AssetWorkflowContext } from './types.ts'

export interface MoveToRepairStageProbe {
  state: 'none' | 'ready' | 'ambiguous'
  bundleCount: number
  headingMatchCount: number
  locatorCandidateCount: number
  confirmMoveMatchCount: number
  ignoredGenericLocatorInputCount: number
  ignoredTimelineRepairLabelCount: number
  deduplicatedAncestorCandidateCount: number
  resolutionStrategy: 'nearest-actionable-control-bundle'
  durationMs: number
}

export async function probeMoveToRepairStage(
  context: AssetWorkflowContext,
): Promise<MoveToRepairStageProbe> {
  const startedAt = Date.now()
  const [headingLabels, locatorCandidates, confirmMoveCandidates, timelineLabels] = await Promise.all([
    visibleMatches(context.page.getByText(/^Move to repair$/i, { exact: true })),
    visibleMatches(context.page.locator('input[placeholder="Scan locator"]')),
    visibleMatches(context.page.getByRole('button', { name: /^Confirm move$/i, exact: true })),
    visibleMatches(context.page.getByText(/^(Repair|Move instruction)$/i, { exact: true })),
  ])
  const bundles: Array<{ panel: Locator; input: Locator; button: Locator }> = []
  let ancestorCandidateCount = 0
  let conflictingBundle = false

  for (const input of locatorCandidates) {
    const ancestors = input.locator(MOVE_TO_REPAIR_ANCESTOR_SELECTOR)
    ancestorCandidateCount += await ancestors.count().catch(() => 0)
    const panel = input.locator(`${MOVE_TO_REPAIR_ANCESTOR_SELECTOR}[1]`)
    if ((await panel.count().catch(() => 0)) !== 1 || !(await isVisible(panel))) continue

    const scopedInputs = await visibleMatches(panel.locator('input[placeholder="Scan locator"]'))
    const scopedHeadings = await visibleMatches(
      panel.getByRole('heading', { name: /^Move to repair$/i, exact: true }),
    )
    const scopedButtons = await visibleMatches(
      panel.getByRole('button', { name: /^Confirm move$/i, exact: true }),
    )
    if (scopedInputs.length > 1 || scopedHeadings.length > 1 || scopedButtons.length > 1) {
      conflictingBundle = true
      continue
    }
    if (scopedInputs.length === 1 && scopedHeadings.length === 1 && scopedButtons.length === 1) {
      bundles.push({ panel, input, button: scopedButtons[0] })
    }
  }

  const state = conflictingBundle || bundles.length > 1
    ? 'ambiguous'
    : bundles.length === 1 ? 'ready' : 'none'
  return {
    state,
    bundleCount: state === 'ambiguous' ? Math.max(2, bundles.length) : bundles.length,
    headingMatchCount: headingLabels.length,
    locatorCandidateCount: locatorCandidates.length,
    confirmMoveMatchCount: confirmMoveCandidates.length,
    ignoredGenericLocatorInputCount: Math.max(0, locatorCandidates.length - bundles.length),
    ignoredTimelineRepairLabelCount: timelineLabels.length,
    deduplicatedAncestorCandidateCount: Math.max(0, ancestorCandidateCount - bundles.length),
    resolutionStrategy: 'nearest-actionable-control-bundle',
    durationMs: Date.now() - startedAt,
  }
}

const MOVE_TO_REPAIR_ANCESTOR_SELECTOR =
  'xpath=ancestor::*[(.//h1|.//h2|.//h3|.//h4|.//h5|.//h6|.//*[@role="heading"])[normalize-space(.)="Move to repair"] and .//button[normalize-space(.)="Confirm move" or @aria-label="Confirm move"]]'

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false)
}

async function visibleMatches(locator: Locator): Promise<Locator[]> {
  const count = await locator.count().catch(() => 0)
  const matches: Locator[] = []
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await isVisible(candidate)) matches.push(candidate)
  }
  return matches
}
