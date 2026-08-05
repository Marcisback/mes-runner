import type {
  MesWorkflowStage,
  StageLoopMode,
} from './deterministicStageCore.ts'

export type SemanticActivationAction =
  | 'click-start'
  | 'confirm-wipe'
  | 'confirm-diagnostic'
  | 'fail-diagnostic'

export type SemanticTargetDecision =
  | { kind: 'ready' }
  | { kind: 'advanced' }
  | { kind: 'temporarily-unavailable'; reason: string }
  | { kind: 'unsafe'; reason: string }

export function decideSemanticTarget(
  mode: StageLoopMode,
  action: SemanticActivationAction,
  stage: MesWorkflowStage,
): SemanticTargetDecision {
  const expected = expectedStage(action)
  if (stage === expected) return { kind: 'ready' }
  if (stage === 'ambiguous') {
    return { kind: 'unsafe', reason: 'Multiple semantic action targets are visible.' }
  }
  if (isForwardStage(mode, action, stage)) return { kind: 'advanced' }
  return {
    kind: 'temporarily-unavailable',
    reason: `Expected ${expected}; observed ${stage}.`,
  }
}

export class TargetInstabilityDeduplicator {
  private readonly windowMs: number
  private lastKey: string | null = null
  private lastTimestamp = 0
  private suppressed = 0

  constructor(windowMs: number) {
    this.windowMs = windowMs
  }

  record(key: string, timestamp: number): {
    emit: boolean
    summarizedCount: number
  } {
    if (this.lastKey === key && timestamp - this.lastTimestamp <= this.windowMs) {
      this.lastTimestamp = timestamp
      this.suppressed += 1
      return { emit: false, summarizedCount: 0 }
    }
    const summarizedCount = this.suppressed
    this.lastKey = key
    this.lastTimestamp = timestamp
    this.suppressed = 0
    return { emit: true, summarizedCount }
  }

  flush(): number {
    const count = this.suppressed
    this.suppressed = 0
    return count
  }
}

function expectedStage(action: SemanticActivationAction): MesWorkflowStage {
  switch (action) {
    case 'click-start': return 'start-ready'
    case 'confirm-wipe': return 'wipe-confirm-ready'
    case 'confirm-diagnostic': return 'diagnostic-pass-ready'
    case 'fail-diagnostic': return 'diagnostic-fail-ready'
  }
}

function isForwardStage(
  mode: StageLoopMode,
  action: SemanticActivationAction,
  stage: MesWorkflowStage,
): boolean {
  const wipeStages: MesWorkflowStage[] = [
    'wipe-scan-ready',
    'wipe-awaiting-confirm',
    'wipe-confirm-ready',
  ]
  const diagnosticStages: MesWorkflowStage[] = [
    'diagnostic-scan-ready',
    'diagnostic-awaiting-action',
    'diagnostic-pass-ready',
    'diagnostic-fail-ready',
  ]
  switch (action) {
    case 'click-start':
      return wipeStages.includes(stage) ||
        diagnosticStages.includes(stage) ||
        stage === 'failure-dialog' ||
        stage === 'move-to-repair' ||
        stage === 'mri-completed' ||
        stage === 'eol-completed'
    case 'confirm-wipe':
      return mode === 'EOL'
        ? stage === 'eol-completed'
        : diagnosticStages.includes(stage) ||
            stage === 'failure-dialog' ||
            stage === 'move-to-repair' ||
            stage === 'mri-completed'
    case 'confirm-diagnostic':
      return stage === 'mri-completed'
    case 'fail-diagnostic':
      return stage === 'failure-dialog' || stage === 'move-to-repair'
  }
}
