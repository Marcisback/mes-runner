import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveWorkflowSectionBundle,
  type WorkflowSectionCandidate,
} from './sectionResolverCore.ts'

function candidate(
  override: Partial<WorkflowSectionCandidate> = {},
): WorkflowSectionCandidate {
  return {
    id: 'panel',
    stageName: 'Wipe',
    inputId: 'wipe-input',
    buttonId: 'confirm-wipe',
    depth: 1,
    hasExactStageLabel: true,
    inputKind: 'asset',
    inputVisible: true,
    inputEnabled: true,
    inputLabel: 'Asset tag or serial number',
    inputPlaceholder: 'Scan asset tag or serial number',
    buttonVisible: true,
    buttonEnabled: true,
    ...override,
  }
}

test('one logical panel with nested ancestors resolves to one bundle', () => {
  const result = resolveWorkflowSectionBundle(
    [
      candidate({ id: 'outer', depth: 1 }),
      candidate({ id: 'middle', depth: 2 }),
      candidate({ id: 'inner', depth: 3 }),
    ],
    'Wipe',
  )

  assert.equal(result.rawContainerCandidateCount, 3)
  assert.equal(result.uniqueActionableControlCount, 3)
  assert.equal(result.deduplicatedBundleCount, 1)
  assert.equal(result.selected?.id, 'inner')
})

test('two genuinely actionable Wipe panels fail closed', () => {
  const result = resolveWorkflowSectionBundle(
    [
      candidate({ id: 'panel-a', inputId: 'input-a', buttonId: 'button-a' }),
      candidate({ id: 'panel-b', inputId: 'input-b', buttonId: 'button-b' }),
    ],
    'Wipe',
  )

  assert.equal(result.selected, null)
  assert.equal(result.deduplicatedBundleCount, 2)
  assert.equal(result.ambiguityReason, 'multiple actionable workflow panels')
})

test('top scanner plus Wipe scanner selects only the Wipe scanner', () => {
  const result = resolveWorkflowSectionBundle(
    [
      candidate({
        id: 'top-scanner',
        hasExactStageLabel: false,
        inputId: 'top-input',
        buttonId: 'none',
      }),
      candidate({ id: 'wipe-panel' }),
    ],
    'Wipe',
  )

  assert.equal(result.deduplicatedBundleCount, 1)
  assert.equal(result.selected?.id, 'wipe-panel')
})

test('asset and locator inputs are not confused', () => {
  const result = resolveWorkflowSectionBundle(
    [
      candidate({
        id: 'locator-panel',
        inputKind: 'locator',
        inputLabel: 'Locator',
        inputPlaceholder: 'Scan locator',
      }),
      candidate({ id: 'asset-panel' }),
    ],
    'Wipe',
  )

  assert.equal(result.deduplicatedBundleCount, 1)
  assert.equal(result.selected?.id, 'asset-panel')
})

test('hidden duplicate panels are ignored', () => {
  const result = resolveWorkflowSectionBundle(
    [
      candidate({ id: 'hidden-panel', inputVisible: false }),
      candidate({ id: 'visible-panel' }),
    ],
    'Wipe',
  )

  assert.equal(result.deduplicatedBundleCount, 1)
  assert.equal(result.selected?.id, 'visible-panel')
})

test('disabled Confirm wipe is not considered actionable', () => {
  const result = resolveWorkflowSectionBundle(
    [candidate({ id: 'disabled-button', buttonEnabled: false })],
    'Wipe',
  )

  assert.equal(result.selected, null)
  assert.equal(result.deduplicatedBundleCount, 0)
})
