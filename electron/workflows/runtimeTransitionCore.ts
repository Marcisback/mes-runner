export interface TransitionWindow {
  startedAt: number
  deadline: number
}

export function suspendTransitionWindow<T extends TransitionWindow>(
  transition: T,
  durationMs: number,
): T {
  return {
    ...transition,
    startedAt: transition.startedAt + durationMs,
    deadline: transition.deadline + durationMs,
  }
}
