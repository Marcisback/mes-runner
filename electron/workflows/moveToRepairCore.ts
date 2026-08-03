export interface MoveToRepairBundleCandidate {
  id: string
  inputId: string
  confirmMoveId: string
  depth: number
  hasExactHeading: boolean
  inputKind: 'locator' | 'asset' | 'other'
  inputVisible: boolean
  inputEnabled: boolean
  inputEditable: boolean
  inputPlaceholder: string
  confirmMoveVisible: boolean
  confirmMoveEnabled: boolean
  confirmMoveName: string
}

export interface MoveToRepairBundleResolution {
  rawCandidateCount: number
  uniqueInputCount: number
  deduplicatedBundleCount: number
  selected: MoveToRepairBundleCandidate | null
  ambiguityReason: string | null
}

export interface MoveToRepairExecutionState {
  locatorSource: 'configured' | 'asset' | 'other'
  locatorEnteredInScanLocator: boolean
  typedSequentially: boolean
  usedDirectFill: boolean
  pressSequentiallyCallCount: number
  keyDelayMs: number
  typedCharacterCount: number
  configuredLocatorLength: number
  protectedInputsUnchanged: boolean
  autocompleteCheckedDuringTyping: boolean
  suggestionAppeared: boolean
  exactSuggestionAppeared: boolean
  exactSuggestionSelected: boolean
  trustedClickAttempted: boolean
  keyboardFallbackVerifiedHighlight: boolean
  dropdownClosedAfterSelection: boolean
  confirmMoveEnabledAfterSelection: boolean
  stageAdvancedAfterConfirm: boolean
}

export interface MoveToRepairExecutionDecision {
  safeToComplete: boolean
  needsReviewReason: string | null
}

export interface ScanLocatorPollSample {
  visibleCandidates: number
  enabledCandidates: number
  editableCandidates: number
  confirmMoveEnabled: boolean
}

export interface ScanLocatorPollDecision {
  status: 'waiting' | 'resolved' | 'needs-review' | 'ambiguous'
  trustedTypingAllowed: boolean
  pollsBeforeResolved: number | null
  reason: string | null
}

export interface SuggestionRowSample {
  id: string
  text: string
  visible: boolean
}

export interface SuggestionMatchDecision {
  selectedId: string | null
  visibleRowCount: number
  firstLineMatchCount: number
  secondaryMetadataDetected: boolean
  ambiguityReason: string | null
}

export function resolveMoveToRepairBundleCandidate(
  candidates: MoveToRepairBundleCandidate[],
): MoveToRepairBundleResolution {
  const actionable = candidates.filter(
    (candidate) =>
      candidate.hasExactHeading &&
      candidate.inputKind === 'locator' &&
      candidate.inputVisible &&
      candidate.inputEnabled &&
      candidate.inputEditable &&
      /^Scan locator$/i.test(candidate.inputPlaceholder) &&
      candidate.confirmMoveVisible &&
      /^Confirm move$/i.test(candidate.confirmMoveName),
  )
  const uniqueInputs = new Set(actionable.map((candidate) => candidate.inputId))

  if (uniqueInputs.size > 1) {
    return {
      rawCandidateCount: candidates.length,
      uniqueInputCount: uniqueInputs.size,
      deduplicatedBundleCount: uniqueInputs.size,
      selected: null,
      ambiguityReason: 'multiple visible Scan locator inputs',
    }
  }

  const bundles = new Map<string, MoveToRepairBundleCandidate>()

  for (const candidate of actionable) {
    const key = `${candidate.inputId}:${candidate.confirmMoveId}`
    const existing = bundles.get(key)

    if (existing === undefined || candidate.depth > existing.depth) {
      bundles.set(key, candidate)
    }
  }

  const deduplicated = [...bundles.values()]

  if (deduplicated.length > 1) {
    return {
      rawCandidateCount: candidates.length,
      uniqueInputCount: uniqueInputs.size,
      deduplicatedBundleCount: deduplicated.length,
      selected: null,
      ambiguityReason: 'multiple Move-to-Repair bundles',
    }
  }

  return {
    rawCandidateCount: candidates.length,
    uniqueInputCount: uniqueInputs.size,
    deduplicatedBundleCount: deduplicated.length,
    selected: deduplicated[0] ?? null,
    ambiguityReason: null,
  }
}

export function evaluateScanLocatorPolling(
  samples: ScanLocatorPollSample[],
  timeoutExpired: boolean,
): ScanLocatorPollDecision {
  let stableVisiblePolls = 0
  let renderedAt: number | null = null

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]

    if (sample.visibleCandidates > 1) {
      return {
        status: 'ambiguous',
        trustedTypingAllowed: false,
        pollsBeforeResolved: null,
        reason: 'multiple visible Scan locator inputs',
      }
    }

    if (sample.visibleCandidates === 0) {
      stableVisiblePolls = 0
      continue
    }

    stableVisiblePolls += 1

    if (stableVisiblePolls >= 2 && renderedAt === null) {
      renderedAt = index + 1
    }

    if (
      renderedAt !== null &&
      sample.enabledCandidates === 1 &&
      sample.editableCandidates === 1
    ) {
      return {
        status: 'resolved',
        trustedTypingAllowed: true,
        pollsBeforeResolved: index + 1,
        reason: null,
      }
    }
  }

  if (timeoutExpired) {
    return {
      status: 'needs-review',
      trustedTypingAllowed: false,
      pollsBeforeResolved: null,
      reason: 'Scan locator did not resolve before timeout',
    }
  }

  return {
    status: 'waiting',
    trustedTypingAllowed: false,
    pollsBeforeResolved: null,
    reason: null,
  }
}

export function resolveSuggestionByFirstLine(
  rows: SuggestionRowSample[],
  configuredLocator: string,
): SuggestionMatchDecision {
  const visibleRows = rows.filter((row) => row.visible)
  const matches: SuggestionRowSample[] = []
  let secondaryMetadataDetected = false

  for (const row of visibleRows) {
    const lines = getNormalizedNonEmptyLines(row.text)
    const firstLine = lines[0] ?? ''

    if (lines.length > 1) {
      secondaryMetadataDetected = true
    }

    if (firstLine === configuredLocator.trim()) {
      matches.push(row)
    }
  }

  if (matches.length > 1) {
    return {
      selectedId: null,
      visibleRowCount: visibleRows.length,
      firstLineMatchCount: matches.length,
      secondaryMetadataDetected,
      ambiguityReason: 'multiple suggestions matched the configured locator',
    }
  }

  return {
    selectedId: matches[0]?.id ?? null,
    visibleRowCount: visibleRows.length,
    firstLineMatchCount: matches.length,
    secondaryMetadataDetected,
    ambiguityReason: null,
  }
}

export function canUseKeyboardFallback(
  firstVisibleFirstLine: string,
  highlightedFirstLine: string,
  configuredLocator: string,
): boolean {
  const expected = configuredLocator.trim()
  return firstVisibleFirstLine.trim() === expected && highlightedFirstLine.trim() === expected
}

export function evaluateMoveToRepairExecution(
  state: MoveToRepairExecutionState,
): MoveToRepairExecutionDecision {
  if (state.locatorSource !== 'configured') {
    return {
      safeToComplete: false,
      needsReviewReason: 'configured Move-to-Repair locator was not used',
    }
  }

  if (
    !state.typedSequentially ||
    state.usedDirectFill ||
    state.pressSequentiallyCallCount !== 1 ||
    state.keyDelayMs !== 10
  ) {
    return {
      safeToComplete: false,
      needsReviewReason: 'locator was not typed sequentially',
    }
  }

  if (state.typedCharacterCount !== state.configuredLocatorLength) {
    return {
      safeToComplete: false,
      needsReviewReason: 'configured locator was not fully typed',
    }
  }

  if (!state.locatorEnteredInScanLocator || !state.protectedInputsUnchanged) {
    return {
      safeToComplete: false,
      needsReviewReason: 'wrong input target detected',
    }
  }

  if (!state.autocompleteCheckedDuringTyping) {
    return {
      safeToComplete: false,
      needsReviewReason: 'autocomplete was not checked during typing',
    }
  }

  if (!state.suggestionAppeared) {
    return {
      safeToComplete: false,
      needsReviewReason: 'no locator suggestion appeared',
    }
  }

  if (!state.exactSuggestionAppeared) {
    return {
      safeToComplete: false,
      needsReviewReason: 'exact locator suggestion did not appear',
    }
  }

  if (!state.exactSuggestionSelected) {
    return {
      safeToComplete: false,
      needsReviewReason: 'exact locator suggestion was not selected',
    }
  }

  if (!state.trustedClickAttempted && !state.keyboardFallbackVerifiedHighlight) {
    return {
      safeToComplete: false,
      needsReviewReason: 'suggestion selection was not trusted',
    }
  }

  if (!state.dropdownClosedAfterSelection) {
    return {
      safeToComplete: false,
      needsReviewReason: 'dropdown did not close after selection',
    }
  }

  if (!state.confirmMoveEnabledAfterSelection) {
    return {
      safeToComplete: false,
      needsReviewReason: 'Confirm move remained disabled',
    }
  }

  if (!state.stageAdvancedAfterConfirm) {
    return {
      safeToComplete: false,
      needsReviewReason: 'Move-to-Repair advancement was not verified',
    }
  }

  return {
    safeToComplete: true,
    needsReviewReason: null,
  }
}

function getNormalizedNonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
}
