import type { Page } from 'playwright-core'
import type { StageControlEvidence } from './deterministicStageCore.ts'

export interface PassiveStageSnapshot {
  startCount: number
  startActionable: boolean
  wipe: StageControlEvidence
  diagnostic: StageControlEvidence
  initial: {
    state: 'initial-empty' | 'initial-asset' | 'initial-unexpected' | 'ambiguous'
    candidateCount: number
    enabled: boolean
    editable: boolean
  }
  failureDialogCount: number
  moveToRepair: {
    state: 'none' | 'ready' | 'ambiguous'
    bundleCount: number
    headingMatchCount: number
    locatorCandidateCount: number
    confirmMoveMatchCount: number
    ignoredGenericLocatorInputCount: number
    ignoredTimelineRepairLabelCount: number
    deduplicatedAncestorCandidateCount: number
  }
  mriCompletionCount: number
  activeWorkflowPresent: boolean
}

export async function capturePassiveStageSnapshot(
  page: Page,
  assetId: string,
  diagnosticAction: 'pass' | 'fail',
): Promise<PassiveStageSnapshot> {
  return page.evaluate(({ expectedAsset, diagnosticMode }) => {
    const normalize = (value: string | null | undefined): string => (value ?? '').trim()
    const equals = (value: string | null | undefined, expected: string): boolean =>
      normalize(value).toLowerCase() === expected.toLowerCase()
    const visible = (element: Element): boolean => {
      if (!element.isConnected) return false
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false
      }
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const enabled = (element: Element): boolean => {
      const control = element as HTMLInputElement | HTMLButtonElement
      return !control.disabled && element.getAttribute('aria-disabled') !== 'true'
    }
    const editable = (input: HTMLInputElement): boolean => enabled(input) && !input.readOnly
    const exactText = (element: Element, text: string): boolean => equals(element.textContent, text)
    const headings = (root: ParentNode, text: string): Element[] =>
      Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
        .filter((element) => visible(element) && exactText(element, text))
    const buttons = (root: ParentNode, names: string[]): HTMLButtonElement[] =>
      Array.from(root.querySelectorAll('button,[role="button"]'))
        .filter((element): element is HTMLButtonElement => {
          if (!visible(element)) return false
          const name = normalize(element.getAttribute('aria-label') ?? element.textContent)
          return names.some((expected) => name.toLowerCase() === expected.toLowerCase())
        })
    const allExactLabels = (text: string): number =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],span,div,li'))
        .filter((element) => visible(element) && exactText(element, text)).length

    const stageEvidence = (
      stage: 'Wipe' | 'Diagnostic',
      action: 'pass' | 'fail',
    ): StageControlEvidence => {
      const scannerCandidates = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[placeholder="Scan asset tag or serial number"]'),
      ).filter(visible)
      const associatedNames = stage === 'Wipe'
        ? ['Confirm wipe']
        : ['Confirm diagnostic', 'Diagnostic failed']
      const actionNames = stage === 'Wipe'
        ? ['Confirm wipe']
        : action === 'fail' ? ['Diagnostic failed'] : ['Confirm diagnostic']
      const bundles: Array<{
        scanner: HTMLInputElement
        actionButtons: HTMLButtonElement[]
      }> = []
      let ancestorCandidates = 0

      for (const scanner of scannerCandidates) {
        let ancestor = scanner.parentElement
        let nearest: Element | null = null
        while (ancestor !== null) {
          if (
            visible(ancestor) &&
            headings(ancestor, stage).length > 0 &&
            buttons(ancestor, associatedNames).length > 0
          ) {
            ancestorCandidates += 1
            if (nearest === null) nearest = ancestor
          }
          ancestor = ancestor.parentElement
        }
        if (nearest === null) continue
        const scopedScanners = Array.from(
          nearest.querySelectorAll<HTMLInputElement>('input[placeholder="Scan asset tag or serial number"]'),
        ).filter(visible)
        if (scopedScanners.length !== 1) continue
        bundles.push({ scanner, actionButtons: buttons(nearest, actionNames) })
      }

      const headingMatchCount = allExactLabels(stage)
      const ignoredTimelineLabelCount = Math.max(0, headingMatchCount - bundles.length)
      const base: StageControlEvidence = {
        sectionCandidateCount: bundles.length,
        scannerCandidateCount: bundles.length,
        scannerValue: 'unreadable',
        scannerVisible: false,
        scannerEnabled: false,
        scannerEditable: false,
        buttonCandidateCount: 0,
        buttonEnabled: false,
        headingMatchCount,
        ignoredTimelineLabelCount,
        deduplicatedAncestorCandidateCount: Math.max(0, ancestorCandidates - bundles.length),
        resolutionStrategy: 'nearest-actionable-control-bundle',
      }
      if (bundles.length !== 1) return base
      const bundle = bundles[0]
      const value = normalize(bundle.scanner.value)
      return {
        ...base,
        scannerValue: value === ''
          ? 'empty'
          : value === expectedAsset ? 'current' : 'different',
        scannerVisible: true,
        scannerEnabled: enabled(bundle.scanner),
        scannerEditable: editable(bundle.scanner),
        buttonCandidateCount: bundle.actionButtons.length,
        buttonEnabled: bundle.actionButtons.length === 1 && enabled(bundle.actionButtons[0]),
      }
    }

    const moveLocatorCandidates = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[placeholder="Scan locator"]'),
    ).filter(visible)
    const moveBundles: Element[] = []
    let moveAncestorCandidates = 0
    for (const input of moveLocatorCandidates) {
      let ancestor = input.parentElement
      let nearest: Element | null = null
      while (ancestor !== null) {
        if (
          visible(ancestor) &&
          headings(ancestor, 'Move to repair').length === 1 &&
          buttons(ancestor, ['Confirm move']).length === 1
        ) {
          moveAncestorCandidates += 1
          if (nearest === null) nearest = ancestor
        }
        ancestor = ancestor.parentElement
      }
      if (nearest !== null) moveBundles.push(nearest)
    }
    const uniqueMoveBundles = Array.from(new Set(moveBundles))
    const moveAmbiguous = uniqueMoveBundles.length > 1

    const initialCandidates = Array.from(document.querySelectorAll<HTMLInputElement>(
      'input[placeholder="Scan the asset tag or serial number to get started"]',
    )).filter(visible)
    const initial = initialCandidates[0]
    const initialValue = initial === undefined ? null : normalize(initial.value)
    const initialState = initialCandidates.length !== 1 || initialValue === null
      ? 'ambiguous'
      : initialValue === ''
        ? 'initial-empty'
        : initialValue === expectedAsset ? 'initial-asset' : 'initial-unexpected'
    const startCandidates = Array.from(document.querySelectorAll<HTMLElement>(
      'button[role="button"][aria-label="Start"][data-logging-label="Start"]',
    )).filter(visible)
    const startActionable = startCandidates.length === 1 && enabled(startCandidates[0])
    const failureDialogCount = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter((element) => visible(element) && normalize(element.textContent).includes('Select failure reason'))
      .length
    const mriCompletionCount = headings(document, 'Move to storage').length
    const moveToRepairHeadingMatches = allExactLabels('Move to repair')
    const confirmMoveMatches = buttons(document, ['Confirm move']).length
    const timelineRepairLabels = allExactLabels('Repair') + allExactLabels('Move instruction')
    const wipe = stageEvidence('Wipe', 'pass')
    const diagnostic = stageEvidence('Diagnostic', diagnosticMode)
    const moveToRepair = {
      state: moveAmbiguous ? 'ambiguous' as const
        : uniqueMoveBundles.length === 1 ? 'ready' as const : 'none' as const,
      bundleCount: moveAmbiguous ? Math.max(2, uniqueMoveBundles.length) : uniqueMoveBundles.length,
      headingMatchCount: moveToRepairHeadingMatches,
      locatorCandidateCount: moveLocatorCandidates.length,
      confirmMoveMatchCount: confirmMoveMatches,
      ignoredGenericLocatorInputCount: Math.max(0, moveLocatorCandidates.length - uniqueMoveBundles.length),
      ignoredTimelineRepairLabelCount: timelineRepairLabels,
      deduplicatedAncestorCandidateCount: Math.max(0, moveAncestorCandidates - uniqueMoveBundles.length),
    }
    const activeWorkflowPresent = startCandidates.length > 0 ||
      wipe.sectionCandidateCount > 0 ||
      diagnostic.sectionCandidateCount > 0 ||
      failureDialogCount > 0 ||
      moveToRepair.bundleCount > 0 ||
      mriCompletionCount > 0

    return {
      startCount: startCandidates.length,
      startActionable,
      wipe,
      diagnostic,
      initial: {
        state: initialState,
        candidateCount: initialCandidates.length,
        enabled: initial !== undefined && enabled(initial),
        editable: initial !== undefined && editable(initial),
      },
      failureDialogCount,
      moveToRepair,
      mriCompletionCount,
      activeWorkflowPresent,
    }
  }, { expectedAsset: assetId, diagnosticMode: diagnosticAction })
}
