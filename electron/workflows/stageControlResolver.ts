import type { Locator } from 'playwright-core'
import {
  resolveStageControlState,
  type MesWorkflowStage,
  type StageControlEvidence,
} from './deterministicStageCore.ts'
import type { AssetWorkflowContext } from './types.ts'
import { WORKFLOW_TIMEOUTS } from './types.ts'

export interface StageControlProbe {
  state: MesWorkflowStage
  evidence: StageControlEvidence
  scanner: Locator | null
  button: Locator | null
  durationMs: number
}

async function isLocatorVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false)
}

async function isLocatorEnabled(locator: Locator): Promise<boolean> {
  return locator.isEnabled({ timeout: WORKFLOW_TIMEOUTS.semanticProbeMs }).catch(() => false)
}

async function isLocatorEditable(locator: Locator): Promise<boolean> {
  return locator.isEditable({ timeout: WORKFLOW_TIMEOUTS.semanticProbeMs }).catch(() => false)
}

async function visibleMatches(locator: Locator): Promise<Locator[]> {
  const count = await locator.count().catch(() => 0)
  const matches: Locator[] = []
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await isLocatorVisible(candidate)) matches.push(candidate)
  }
  return matches
}

export async function probeStageControls(
  context: AssetWorkflowContext,
  stage: 'Wipe' | 'Diagnostic',
  action: 'pass' | 'fail' = 'pass',
): Promise<StageControlProbe> {
  const startedAt = Date.now()
  const textLabels = await visibleMatches(
    context.page.getByText(new RegExp(`^${stage}$`, 'i'), { exact: true }),
  )
  const buttonName = stage === 'Wipe'
    ? /^Confirm\s+wipe$/i
    : action === 'pass' ? /^Confirm\s+diagnostic$/i : /^Diagnostic failed$/i
  const scannerCandidates = await visibleMatches(
    context.page.getByPlaceholder(/^Scan asset tag or serial number$/i),
  )
  const bundles: Array<{ panel: Locator; scanner: Locator; headings: Locator[]; buttons: Locator[] }> = []
  let ancestorCandidateCount = 0

  for (const scanner of scannerCandidates) {
    const ancestorSelector = stageBundleAncestorSelector(stage)
    const ancestors = scanner.locator(ancestorSelector)
    ancestorCandidateCount += await ancestors.count().catch(() => 0)
    const panel = scanner.locator(`${ancestorSelector}[1]`)
    if ((await panel.count().catch(() => 0)) !== 1 || !(await isLocatorVisible(panel))) continue

    const scopedScanners = await visibleMatches(
      panel.getByPlaceholder(/^Scan asset tag or serial number$/i),
    )
    if (scopedScanners.length !== 1) continue
    const headings = await visibleMatches(
      panel.getByRole('heading', { name: new RegExp(`^${stage}$`, 'i'), exact: true }),
    )
    const associatedButtons = await visibleMatches(
      stage === 'Wipe'
        ? panel.getByRole('button', { name: /^Confirm\s+wipe$/i, exact: true })
        : panel.getByRole('button', {
            name: /^Confirm\s+diagnostic$|^Diagnostic failed$/i,
            exact: true,
          }),
    )
    const buttons = await visibleMatches(
      action === 'fail'
        ? panel.locator('button[aria-label="Diagnostic failed"]')
        : panel.getByRole('button', { name: buttonName, exact: true }),
    )
    if (headings.length === 1 && associatedButtons.length >= 1) {
      bundles.push({ panel, scanner, headings, buttons })
    }
  }

  const deduplicatedAncestorCandidateCount = Math.max(0, ancestorCandidateCount - bundles.length)
  const ignoredTimelineLabelCount = Math.max(
    0,
    textLabels.length - bundles.reduce((count, bundle) => count + bundle.headings.length, 0),
  )
  if (bundles.length > 1) {
    return probeResult(
      'ambiguous',
      bundles.length,
      bundles.length,
      null,
      null,
      startedAt,
      textLabels.length,
      ignoredTimelineLabelCount,
      deduplicatedAncestorCandidateCount,
    )
  }
  const match = bundles[0]
  if (match === undefined) {
    return probeResult(
      'unknown',
      0,
      0,
      null,
      null,
      startedAt,
      textLabels.length,
      ignoredTimelineLabelCount,
      deduplicatedAncestorCandidateCount,
    )
  }
  const buttons = match.buttons
  const value = await match.scanner.inputValue({
    timeout: WORKFLOW_TIMEOUTS.semanticProbeMs,
  }).catch(() => null)
  const normalized = value?.trim() ?? null
  const evidence: StageControlEvidence = {
    sectionCandidateCount: bundles.length,
    scannerCandidateCount: bundles.length,
    scannerValue: value === null
      ? 'unreadable'
      : normalized === '' ? 'empty' : normalized === context.assetId ? 'current' : 'different',
    scannerVisible: await isLocatorVisible(match.scanner),
    scannerEnabled: await isLocatorEnabled(match.scanner),
    scannerEditable: await isLocatorEditable(match.scanner),
    buttonCandidateCount: buttons.length,
    buttonEnabled: buttons.length === 1 &&
      await buttons[0].getAttribute('aria-disabled', {
        timeout: WORKFLOW_TIMEOUTS.semanticProbeMs,
      }).catch(() => 'true') !== 'true' &&
      await isLocatorEnabled(buttons[0]),
    headingMatchCount: textLabels.length,
    ignoredTimelineLabelCount,
    deduplicatedAncestorCandidateCount,
    resolutionStrategy: 'nearest-actionable-control-bundle',
  }
  return {
    state: resolveStageControlState(stage, evidence, action),
    evidence,
    scanner: match.scanner,
    button: buttons.length === 1 ? buttons[0] : null,
    durationMs: Date.now() - startedAt,
  }
}

function stageBundleAncestorSelector(
  stage: 'Wipe' | 'Diagnostic',
): string {
  const heading = `(.//h1|.//h2|.//h3|.//h4|.//h5|.//h6|.//*[@role="heading"])[normalize-space(.)="${stage}"]`
  const button = stage === 'Wipe'
    ? './/button[normalize-space(.)="Confirm wipe" or @aria-label="Confirm wipe"]'
    : './/button[normalize-space(.)="Confirm diagnostic" or @aria-label="Confirm diagnostic" or @aria-label="Diagnostic failed" or normalize-space(.)="Diagnostic failed"]'
  return `xpath=ancestor::*[${heading} and ${button}]`
}

function probeResult(
  state: MesWorkflowStage,
  sectionCandidateCount: number,
  scannerCandidateCount: number,
  scanner: Locator | null,
  button: Locator | null,
  startedAt: number,
  headingMatchCount = 0,
  ignoredTimelineLabelCount = 0,
  deduplicatedAncestorCandidateCount = 0,
): StageControlProbe {
  return {
    state,
    evidence: {
      sectionCandidateCount,
      scannerCandidateCount,
      scannerValue: 'unreadable',
      scannerVisible: false,
      scannerEnabled: false,
      scannerEditable: false,
      buttonCandidateCount: 0,
      buttonEnabled: false,
      headingMatchCount,
      ignoredTimelineLabelCount,
      deduplicatedAncestorCandidateCount,
      resolutionStrategy: 'nearest-actionable-control-bundle',
    },
    scanner,
    button,
    durationMs: Date.now() - startedAt,
  }
}
