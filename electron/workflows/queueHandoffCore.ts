import type { WorkflowMode } from '../../src/types/eolRunner.ts'
import type { MesWorkflowStage } from './deterministicStageCore.ts'

export type WorkflowTerminalStage =
  | 'eol-completed'
  | 'mri-completed'
  | 'move-to-repair-completed'
  | 'repair-completed'

export interface QueueHandoffAuthorization {
  previousMode: 'MRI'
  terminalStage: 'mri-completed'
  browserGeneration: number
  pageGeneration: number
  confirmedTimestamp: number
  consumed: false
}

export interface AutomationSessionIdentity {
  browserGeneration: number
  pageGeneration: number
}

export function createQueueHandoffAuthorization(
  mode: WorkflowMode,
  terminalStage: WorkflowTerminalStage,
  identity: AutomationSessionIdentity,
  confirmedTimestamp = Date.now(),
): QueueHandoffAuthorization | null {
  return mode === 'MRI' && terminalStage === 'mri-completed'
    ? {
        previousMode: 'MRI',
        terminalStage: 'mri-completed',
        browserGeneration: identity.browserGeneration,
        pageGeneration: identity.pageGeneration,
        confirmedTimestamp,
        consumed: false,
      }
    : null
}

export class RuntimeQueueHandoff {
  private authorization: QueueHandoffAuthorization | null = null

  authorize(
    mode: WorkflowMode,
    terminalStage: WorkflowTerminalStage,
    identity: AutomationSessionIdentity,
    confirmedTimestamp = Date.now(),
  ): QueueHandoffAuthorization | null {
    this.authorization = createQueueHandoffAuthorization(
      mode,
      terminalStage,
      identity,
      confirmedTimestamp,
    )
    return this.authorization
  }

  peek(identity?: AutomationSessionIdentity): QueueHandoffAuthorization | null {
    if (identity !== undefined && this.authorization !== null && !sameIdentity(
      this.authorization,
      identity,
    )) {
      this.authorization = null
    }
    return this.authorization
  }

  consume(identity?: AutomationSessionIdentity): boolean {
    if (identity !== undefined && this.peek(identity) === null) return false
    if (this.authorization === null) return false
    this.authorization = null
    return true
  }

  clear(): boolean {
    if (this.authorization === null) return false
    this.authorization = null
    return true
  }
}

function sameIdentity(
  authorization: QueueHandoffAuthorization,
  identity: AutomationSessionIdentity,
): boolean {
  return authorization.browserGeneration === identity.browserGeneration &&
    authorization.pageGeneration === identity.pageGeneration
}

export type QueueHandoffScannerState =
  | 'actionable-empty'
  | 'temporarily-unavailable'
  | 'unexpected-value'

export type QueueHandoffDecision =
  | { kind: 'submit' }
  | { kind: 'wait'; reason: string }
  | { kind: 'reject'; reason: string }

export function decideQueueHandoff(
  authorization: QueueHandoffAuthorization | null,
  terminalVisible: boolean,
  scannerState: QueueHandoffScannerState,
  timedOut: boolean,
): QueueHandoffDecision {
  if (authorization === null) {
    return { kind: 'reject', reason: 'No queue handoff is authorized.' }
  }
  if (!terminalVisible) {
    return { kind: 'reject', reason: 'The authorized terminal screen is no longer visible.' }
  }
  if (scannerState === 'unexpected-value') {
    return { kind: 'reject', reason: 'The global scanner contains an unexpected value.' }
  }
  if (scannerState === 'temporarily-unavailable') {
    return timedOut
      ? { kind: 'reject', reason: 'The global scanner did not become actionable before timeout.' }
      : { kind: 'wait', reason: 'Waiting for the authorized global scanner.' }
  }
  return { kind: 'submit' }
}

export function isQueueHandoffAcknowledgementStage(stage: MesWorkflowStage): boolean {
  return stage === 'start-ready' ||
    stage === 'wipe-scan-ready' ||
    stage === 'wipe-awaiting-confirm' ||
    stage === 'wipe-confirm-ready' ||
    stage === 'diagnostic-scan-ready' ||
    stage === 'diagnostic-awaiting-action' ||
    stage === 'diagnostic-pass-ready' ||
    stage === 'diagnostic-fail-ready' ||
    stage === 'failure-dialog' ||
    stage === 'move-to-repair'
}
