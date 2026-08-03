import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateFailureDialogTransition,
  type FailureDialogTransitionState,
} from './failureDialogCore.ts'

function state(
  override: Partial<FailureDialogTransitionState> = {},
): FailureDialogTransitionState {
  return {
    visibleDialogCount: 1,
    visibleConfirmButtonCount: 1,
    optionSelected: true,
    listboxOpenAfterSelection: true,
    focusTransitionAttempted: true,
    confirmFocused: true,
    listboxClosedAfterFocus: true,
    parentDialogVisibleAfterFocus: true,
    selectionVisibleAfterFocus: true,
    confirmEnabled: true,
    ...override,
  }
}

test('selecting Phone - Display allows Enter after safe focus transition', () => {
  const result = evaluateFailureDialogTransition(state())
  assert.equal(result.okToPressEnter, true)
  assert.equal(result.reason, null)
})

test('dropdown remains open after selection before focus transition', () => {
  const result = evaluateFailureDialogTransition(
    state({ focusTransitionAttempted: false }),
  )
  assert.equal(result.okToPressEnter, false)
  assert.equal(result.reason, 'Confirm Failure was not focused')
})

test('focus transition must close only the dropdown', () => {
  const result = evaluateFailureDialogTransition(
    state({ listboxClosedAfterFocus: false }),
  )
  assert.equal(result.okToPressEnter, false)
  assert.equal(result.reason, 'owned listbox remained open')
})

test('parent dialog must stay open after focus transition', () => {
  const result = evaluateFailureDialogTransition(
    state({ parentDialogVisibleAfterFocus: false }),
  )
  assert.equal(result.okToPressEnter, false)
  assert.equal(result.reason, 'parent failure dialog dismissed prematurely')
})

test('selection must persist after listbox closes', () => {
  const result = evaluateFailureDialogTransition(
    state({ selectionVisibleAfterFocus: false }),
  )
  assert.equal(result.okToPressEnter, false)
  assert.equal(result.reason, 'Phone - Display selection disappeared')
})

test('Confirm Failure receives Enter only when focused and enabled', () => {
  const notFocused = evaluateFailureDialogTransition(
    state({ confirmFocused: false }),
  )
  const disabled = evaluateFailureDialogTransition(
    state({ confirmEnabled: false }),
  )

  assert.equal(notFocused.okToPressEnter, false)
  assert.equal(notFocused.reason, 'Confirm Failure was not focused')
  assert.equal(disabled.okToPressEnter, false)
  assert.equal(disabled.reason, 'Confirm Failure is not enabled')
})

test('premature parent-dialog closure fails safely', () => {
  const result = evaluateFailureDialogTransition(
    state({ parentDialogVisibleAfterFocus: false }),
  )
  assert.equal(result.okToPressEnter, false)
})

test('missing selection fails safely', () => {
  const result = evaluateFailureDialogTransition(state({ optionSelected: false }))
  assert.equal(result.okToPressEnter, false)
  assert.equal(result.reason, 'Phone - Display selection is missing')
})

test('multiple dialogs or buttons fail closed', () => {
  const dialogs = evaluateFailureDialogTransition(
    state({ visibleDialogCount: 2 }),
  )
  const buttons = evaluateFailureDialogTransition(
    state({ visibleConfirmButtonCount: 2 }),
  )

  assert.equal(dialogs.okToPressEnter, false)
  assert.equal(dialogs.reason, 'failure dialog count must be exactly one')
  assert.equal(buttons.okToPressEnter, false)
  assert.equal(buttons.reason, 'Confirm Failure count must be exactly one')
})
