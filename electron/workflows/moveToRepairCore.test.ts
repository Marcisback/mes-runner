import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canUseKeyboardFallback,
  evaluateMoveToRepairExecution,
  evaluateScanLocatorPolling,
  resolveSuggestionByFirstLine,
  resolveMoveToRepairBundleCandidate,
  type MoveToRepairBundleCandidate,
  type MoveToRepairExecutionState,
  type ScanLocatorPollSample,
} from './moveToRepairCore.ts'

function candidate(
  override: Partial<MoveToRepairBundleCandidate> = {},
): MoveToRepairBundleCandidate {
  return {
    id: 'move-panel',
    inputId: 'scan-locator',
    confirmMoveId: 'confirm-move',
    depth: 1,
    hasExactHeading: true,
    inputKind: 'locator',
    inputVisible: true,
    inputEnabled: true,
    inputEditable: true,
    inputPlaceholder: 'Scan locator',
    confirmMoveVisible: true,
    confirmMoveEnabled: false,
    confirmMoveName: 'Confirm move',
    ...override,
  }
}

function execution(
  override: Partial<MoveToRepairExecutionState> = {},
): MoveToRepairExecutionState {
  return {
    locatorSource: 'configured',
    locatorEnteredInScanLocator: true,
    typedSequentially: true,
    usedDirectFill: false,
    pressSequentiallyCallCount: 1,
    keyDelayMs: 10,
    typedCharacterCount: 27,
    configuredLocatorLength: 27,
    protectedInputsUnchanged: true,
    autocompleteCheckedDuringTyping: true,
    suggestionAppeared: true,
    exactSuggestionAppeared: true,
    exactSuggestionSelected: true,
    trustedClickAttempted: true,
    keyboardFallbackVerifiedHighlight: false,
    dropdownClosedAfterSelection: true,
    confirmMoveEnabledAfterSelection: true,
    stageAdvancedAfterConfirm: true,
    ...override,
  }
}

function poll(
  override: Partial<ScanLocatorPollSample> = {},
): ScanLocatorPollSample {
  return {
    visibleCandidates: 0,
    enabledCandidates: 0,
    editableCandidates: 0,
    confirmMoveEnabled: false,
    ...override,
  }
}

test('visible Scan locator with initially disabled Confirm move resolves', () => {
  const result = resolveMoveToRepairBundleCandidate([candidate()])

  assert.equal(result.selected?.id, 'move-panel')
  assert.equal(result.selected?.confirmMoveEnabled, false)
  assert.equal(result.deduplicatedBundleCount, 1)
})

test('Confirm move exposed through visible text resolves', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({ confirmMoveName: 'Confirm move' }),
  ])

  assert.equal(result.selected?.confirmMoveName, 'Confirm move')
})

test('Confirm move exposed through aria-label accessible name resolves', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({ confirmMoveName: 'Confirm move' }),
  ])

  assert.equal(result.selected?.confirmMoveId, 'confirm-move')
})

test('top scanner and Scan locator visible together selects only Scan locator', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({
      id: 'top-scanner',
      inputId: 'top-input',
      inputKind: 'asset',
      inputPlaceholder: 'Scan the asset tag or serial number to get started',
    }),
    candidate({ id: 'move-panel' }),
  ])

  assert.equal(result.selected?.id, 'move-panel')
})

test('Wipe and Diagnostic asset inputs are excluded', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({
      id: 'wipe-input',
      inputId: 'wipe-input',
      inputKind: 'asset',
      inputPlaceholder: 'Scan asset tag or serial number',
    }),
    candidate({
      id: 'diagnostic-input',
      inputId: 'diagnostic-input',
      inputKind: 'asset',
      inputPlaceholder: 'Scan asset tag or serial number',
    }),
    candidate({ id: 'move-panel' }),
  ])

  assert.equal(result.selected?.id, 'move-panel')
})

test('nested ancestors around one bundle are deduplicated', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({ id: 'outer', depth: 1 }),
    candidate({ id: 'middle', depth: 2 }),
    candidate({ id: 'inner', depth: 3 }),
  ])

  assert.equal(result.deduplicatedBundleCount, 1)
  assert.equal(result.selected?.id, 'inner')
})

test('hidden stale Move-to-Repair panel is ignored', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({ id: 'hidden-panel', inputVisible: false }),
    candidate({ id: 'visible-panel' }),
  ])

  assert.equal(result.selected?.id, 'visible-panel')
})

test('two genuine visible Move-to-Repair bundles fail closed', () => {
  const result = resolveMoveToRepairBundleCandidate([
    candidate({ id: 'panel-a', inputId: 'input-a', confirmMoveId: 'button-a' }),
    candidate({ id: 'panel-b', inputId: 'input-b', confirmMoveId: 'button-b' }),
  ])

  assert.equal(result.selected, null)
  assert.equal(result.ambiguityReason, 'multiple visible Scan locator inputs')
})

test('configured Move-to-Repair locator is used', () => {
  const result = evaluateMoveToRepairExecution(execution())

  assert.equal(result.safeToComplete, true)
})

test('asset ID is never used as the locator', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ locatorSource: 'asset' }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(
    result.needsReviewReason,
    'configured Move-to-Repair locator was not used',
  )
})

test('locator is typed sequentially rather than filled', () => {
  const notSequential = evaluateMoveToRepairExecution(
    execution({ typedSequentially: false }),
  )
  const directFill = evaluateMoveToRepairExecution(
    execution({ usedDirectFill: true }),
  )

  assert.equal(notSequential.safeToComplete, false)
  assert.equal(notSequential.needsReviewReason, 'locator was not typed sequentially')
  assert.equal(directFill.safeToComplete, false)
  assert.equal(directFill.needsReviewReason, 'locator was not typed sequentially')
})

test('trusted sequential typing uses approximately 10 ms delay', () => {
  const result = evaluateMoveToRepairExecution(execution({ keyDelayMs: 50 }))

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'locator was not typed sequentially')
})

test('typing is performed in one pressSequentially call', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ pressSequentiallyCallCount: 27 }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'locator was not typed sequentially')
})

test('dropdown detection occurs during or after typing', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ autocompleteCheckedDuringTyping: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(
    result.needsReviewReason,
    'autocomplete was not checked during typing',
  )
})

test('locator entry must target only Scan locator', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ locatorEnteredInScanLocator: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'wrong input target detected')
})

test('only the exact configured suggestion is selected', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ exactSuggestionSelected: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(
    result.needsReviewReason,
    'exact locator suggestion was not selected',
  )
})

test('suggestion whose full text is only the locator matches', () => {
  const result = resolveSuggestionByFirstLine(
    [{ id: 'row-1', text: 'NEW102-SMOBILE1-TECH-09-F01', visible: true }],
    'NEW102-SMOBILE1-TECH-09-F01',
  )

  assert.equal(result.selectedId, 'row-1')
  assert.equal(result.firstLineMatchCount, 1)
  assert.equal(result.secondaryMetadataDetected, false)
})

test('suggestion whose first line is locator and second line is MPL matches', () => {
  const result = resolveSuggestionByFirstLine(
    [{ id: 'row-1', text: 'NEW102-SMOBILE1-TECH-09-F01\nMPL', visible: true }],
    'NEW102-SMOBILE1-TECH-09-F01',
  )

  assert.equal(result.selectedId, 'row-1')
  assert.equal(result.firstLineMatchCount, 1)
  assert.equal(result.secondaryMetadataDetected, true)
})

test('suggestion containing other secondary metadata matches by first line', () => {
  const result = resolveSuggestionByFirstLine(
    [
      {
        id: 'row-1',
        text: 'NEW102-SMOBILE1-TECH-09-F01\nSome other metadata',
        visible: true,
      },
    ],
    'NEW102-SMOBILE1-TECH-09-F01',
  )

  assert.equal(result.selectedId, 'row-1')
  assert.equal(result.secondaryMetadataDetected, true)
})

test('partial locator does not match', () => {
  const result = resolveSuggestionByFirstLine(
    [{ id: 'row-1', text: 'NEW102-SMOBILE1-TECH-09-F01\nMPL', visible: true }],
    'NEW102-SMOBILE1-TECH-09',
  )

  assert.equal(result.selectedId, null)
  assert.equal(result.firstLineMatchCount, 0)
})

test('two suggestions with the same first line fail closed', () => {
  const result = resolveSuggestionByFirstLine(
    [
      { id: 'row-1', text: 'NEW102-SMOBILE1-TECH-09-F01\nMPL', visible: true },
      { id: 'row-2', text: 'NEW102-SMOBILE1-TECH-09-F01\nOTHER', visible: true },
    ],
    'NEW102-SMOBILE1-TECH-09-F01',
  )

  assert.equal(result.selectedId, null)
  assert.equal(result.firstLineMatchCount, 2)
  assert.equal(
    result.ambiguityReason,
    'multiple suggestions matched the configured locator',
  )
})

test('correct row receives a trusted click', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ trustedClickAttempted: true }),
  )

  assert.equal(result.safeToComplete, true)
})

test('keyboard fallback verifies highlighted option before Enter', () => {
  assert.equal(
    canUseKeyboardFallback(
      'NEW102-SMOBILE1-TECH-09-F01',
      'NEW102-SMOBILE1-TECH-09-F01',
      'NEW102-SMOBILE1-TECH-09-F01',
    ),
    true,
  )
  assert.equal(
    canUseKeyboardFallback(
      'NEW102-SMOBILE1-TECH-09-F01',
      'OTHER',
      'NEW102-SMOBILE1-TECH-09-F01',
    ),
    false,
  )
})

test('Confirm move must enable after suggestion selection', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ confirmMoveEnabledAfterSelection: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'Confirm move remained disabled')
})

test('dropdown closure is verified', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ dropdownClosedAfterSelection: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'dropdown did not close after selection')
})

test('no suggestion causes a safe needs-review result', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ suggestionAppeared: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'no locator suggestion appeared')
})

test('missing exact suggestion causes a safe needs-review result', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ exactSuggestionAppeared: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(
    result.needsReviewReason,
    'exact locator suggestion did not appear',
  )
})

test('wrong input mutation causes a safe needs-review result', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ protectedInputsUnchanged: false }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(result.needsReviewReason, 'wrong input target detected')
})

test('typed character count must match configured locator length', () => {
  const result = evaluateMoveToRepairExecution(
    execution({ typedCharacterCount: 12 }),
  )

  assert.equal(result.safeToComplete, false)
  assert.equal(
    result.needsReviewReason,
    'configured locator was not fully typed',
  )
})

test('completion requires verified stage advancement', () => {
  const incomplete = evaluateMoveToRepairExecution(
    execution({ stageAdvancedAfterConfirm: false }),
  )
  const complete = evaluateMoveToRepairExecution(execution())

  assert.equal(incomplete.safeToComplete, false)
  assert.equal(
    incomplete.needsReviewReason,
    'Move-to-Repair advancement was not verified',
  )
  assert.equal(complete.safeToComplete, true)
})

test('zero candidates on initial polls followed by one visible candidate resolves', () => {
  const result = evaluateScanLocatorPolling(
    [
      poll(),
      poll(),
      poll({ visibleCandidates: 1 }),
      poll({
        visibleCandidates: 1,
        enabledCandidates: 1,
        editableCandidates: 1,
      }),
    ],
    false,
  )

  assert.equal(result.status, 'resolved')
  assert.equal(result.trustedTypingAllowed, true)
  assert.equal(result.pollsBeforeResolved, 4)
})

test('delayed Move-to-Repair rendering waits instead of failing immediately', () => {
  const result = evaluateScanLocatorPolling([poll(), poll()], false)

  assert.equal(result.status, 'waiting')
  assert.equal(result.trustedTypingAllowed, false)
})

test('visible candidate temporarily disabled before becoming enabled resolves', () => {
  const result = evaluateScanLocatorPolling(
    [
      poll({ visibleCandidates: 1 }),
      poll({ visibleCandidates: 1 }),
      poll({
        visibleCandidates: 1,
        enabledCandidates: 1,
        editableCandidates: 1,
      }),
    ],
    false,
  )

  assert.equal(result.status, 'resolved')
  assert.equal(result.pollsBeforeResolved, 3)
})

test('stable visible candidate is required before trusted typing', () => {
  const result = evaluateScanLocatorPolling(
    [
      poll({
        visibleCandidates: 1,
        enabledCandidates: 1,
        editableCandidates: 1,
      }),
    ],
    false,
  )

  assert.equal(result.status, 'waiting')
  assert.equal(result.trustedTypingAllowed, false)
})

test('persistent zero candidates timeout safely', () => {
  const result = evaluateScanLocatorPolling([poll(), poll(), poll()], true)

  assert.equal(result.status, 'needs-review')
  assert.equal(result.reason, 'Scan locator did not resolve before timeout')
})

test('multiple genuine visible candidates fail closed', () => {
  const result = evaluateScanLocatorPolling(
    [poll({ visibleCandidates: 2 })],
    false,
  )

  assert.equal(result.status, 'ambiguous')
  assert.equal(result.reason, 'multiple visible Scan locator inputs')
})

test('trusted typing begins only after render and enabled/editable resolution', () => {
  const waiting = evaluateScanLocatorPolling(
    [poll({ visibleCandidates: 1 }), poll({ visibleCandidates: 1 })],
    false,
  )
  const resolved = evaluateScanLocatorPolling(
    [
      poll({ visibleCandidates: 1 }),
      poll({ visibleCandidates: 1 }),
      poll({
        visibleCandidates: 1,
        enabledCandidates: 1,
        editableCandidates: 1,
      }),
    ],
    false,
  )

  assert.equal(waiting.trustedTypingAllowed, false)
  assert.equal(resolved.trustedTypingAllowed, true)
})

test('Confirm move disabled does not prevent locator entry resolution', () => {
  const result = evaluateScanLocatorPolling(
    [
      poll({ visibleCandidates: 1, confirmMoveEnabled: false }),
      poll({
        visibleCandidates: 1,
        enabledCandidates: 1,
        editableCandidates: 1,
        confirmMoveEnabled: false,
      }),
    ],
    false,
  )

  assert.equal(result.status, 'resolved')
  assert.equal(result.trustedTypingAllowed, true)
})
