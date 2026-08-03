export interface FailureDialogTransitionState {
  visibleDialogCount: number
  visibleConfirmButtonCount: number
  optionSelected: boolean
  listboxOpenAfterSelection: boolean
  focusTransitionAttempted: boolean
  confirmFocused: boolean
  listboxClosedAfterFocus: boolean
  parentDialogVisibleAfterFocus: boolean
  selectionVisibleAfterFocus: boolean
  confirmEnabled: boolean
}

export interface FailureDialogTransitionDecision {
  okToPressEnter: boolean
  reason: string | null
}

export function evaluateFailureDialogTransition(
  state: FailureDialogTransitionState,
): FailureDialogTransitionDecision {
  if (state.visibleDialogCount !== 1) {
    return {
      okToPressEnter: false,
      reason: 'failure dialog count must be exactly one',
    }
  }

  if (state.visibleConfirmButtonCount !== 1) {
    return {
      okToPressEnter: false,
      reason: 'Confirm Failure count must be exactly one',
    }
  }

  if (!state.optionSelected) {
    return {
      okToPressEnter: false,
      reason: 'Phone - Display selection is missing',
    }
  }

  if (!state.listboxOpenAfterSelection) {
    return {
      okToPressEnter: false,
      reason: 'owned listbox was not open after selection',
    }
  }

  if (!state.focusTransitionAttempted || !state.confirmFocused) {
    return {
      okToPressEnter: false,
      reason: 'Confirm Failure was not focused',
    }
  }

  if (!state.listboxClosedAfterFocus) {
    return {
      okToPressEnter: false,
      reason: 'owned listbox remained open',
    }
  }

  if (!state.parentDialogVisibleAfterFocus) {
    return {
      okToPressEnter: false,
      reason: 'parent failure dialog dismissed prematurely',
    }
  }

  if (!state.selectionVisibleAfterFocus) {
    return {
      okToPressEnter: false,
      reason: 'Phone - Display selection disappeared',
    }
  }

  if (!state.confirmEnabled) {
    return {
      okToPressEnter: false,
      reason: 'Confirm Failure is not enabled',
    }
  }

  return {
    okToPressEnter: true,
    reason: null,
  }
}
