import type { EolRunnerSnapshot, EolRunnerState } from '../types/eolRunner'
import type { ManagedChromeLifecycleState } from '../types/managedChrome'

/**
 * Pure presentation logic for the Runner Inspector and stream toolbar. Kept free
 * of React/DOM so the contextual-control, status, gating, and sizing rules can
 * be unit-tested directly. None of this touches the workflow engine, Playwright,
 * or Chrome — it only maps existing snapshot/lifecycle state to what the UI
 * shows.
 */

/* ---- Managed Chrome lifecycle labels / messages (single source of truth) ---- */

const LIFECYCLE_LABEL: Record<ManagedChromeLifecycleState, string> = {
  stopped: 'Stopped',
  'launching-headless': 'Launching',
  loading: 'Loading',
  streaming: 'Streaming',
  'authentication-required': 'Authentication required',
  'launching-authentication': 'Opening login',
  authenticating: 'Authenticating',
  'resuming-headless': 'Resuming',
  disconnected: 'Disconnected',
  'compliance-blocked': 'Compliance blocked',
  error: 'Error',
}

const OVERLAY_MESSAGE: Record<ManagedChromeLifecycleState, string> = {
  stopped: 'Launch the managed MES session to begin.',
  'launching-headless': 'Starting headless managed Chrome.',
  loading: 'Loading MES.',
  streaming: '',
  'authentication-required':
    'Manual login or YubiKey authentication is required in a visible managed Chrome window.',
  'launching-authentication': 'Opening the visible managed Chrome login window.',
  authenticating:
    'Complete password and YubiKey authentication in Chrome, then return here.',
  'resuming-headless': 'Returning to headless streaming.',
  disconnected: 'The controlled Chrome session closed unexpectedly.',
  'compliance-blocked': 'InternalFB rejected this browser as non-compliant.',
  error: 'MES streaming needs attention before it can continue.',
}

export function getLifecycleLabel(lifecycle: ManagedChromeLifecycleState): string {
  return LIFECYCLE_LABEL[lifecycle]
}

export function getOverlayMessage(lifecycle: ManagedChromeLifecycleState): string {
  return OVERLAY_MESSAGE[lifecycle]
}

/** Short status shown at the left of the stream toolbar. */
export function streamStatusLabel(lifecycle: ManagedChromeLifecycleState): string {
  return lifecycle === 'stopped' ? 'MES OFFLINE' : LIFECYCLE_LABEL[lifecycle]
}

export type StreamTone = 'idle' | 'ready' | 'busy' | 'error'

export function streamStatusTone(
  lifecycle: ManagedChromeLifecycleState,
): StreamTone {
  switch (lifecycle) {
    case 'streaming':
      return 'ready'
    case 'error':
    case 'compliance-blocked':
      return 'error'
    case 'stopped':
    case 'disconnected':
      return 'idle'
    default:
      return 'busy'
  }
}

/* ---- Inspector status pill ---- */

export type InspectorStatus =
  | 'IDLE'
  | 'LAUNCHING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'NEEDS REVIEW'
  | 'ERROR'

/**
 * Derives the inspector status pill. Run states take priority over the Chrome
 * lifecycle; the pill never depends on the draft mode, so the header can never
 * disagree with the active run.
 */
export function deriveInspectorStatus(
  runnerState: EolRunnerState,
  needsReview: number,
  chromeLifecycle: ManagedChromeLifecycleState,
): InspectorStatus {
  switch (runnerState) {
    case 'running':
      return 'RUNNING'
    case 'paused':
      return 'PAUSED'
    case 'stopping':
      return 'STOPPING'
    case 'error':
      return 'ERROR'
    case 'completed':
    case 'idle':
      if (needsReview > 0) {
        return 'NEEDS REVIEW'
      }
      break
  }

  switch (chromeLifecycle) {
    case 'streaming':
      return 'READY'
    case 'error':
    case 'compliance-blocked':
      return 'ERROR'
    case 'stopped':
    case 'disconnected':
      return 'IDLE'
    default:
      return 'LAUNCHING'
  }
}

export type StatusTone =
  | 'idle'
  | 'ready'
  | 'running'
  | 'warning'
  | 'error'

export function inspectorStatusTone(status: InspectorStatus): StatusTone {
  switch (status) {
    case 'RUNNING':
      return 'running'
    case 'READY':
      return 'ready'
    case 'PAUSED':
    case 'STOPPING':
    case 'NEEDS REVIEW':
      return 'warning'
    case 'ERROR':
      return 'error'
    case 'IDLE':
    case 'LAUNCHING':
      return 'idle'
  }
}

/* ---- Assets-ready label (singular/plural) ---- */

export function assetsReadyLabel(count: number): string {
  return `${count} ${count === 1 ? 'asset' : 'assets'} ready`
}

/* ---- Start Run gating ---- */

export interface StartGateInput {
  assetCount: number
  /** Chrome lifecycle is 'streaming'. */
  streamReady: boolean
  /** Another runner currently owns an active engine run. */
  engineBusyElsewhere: boolean
  /** A command is in flight. */
  pending: boolean
}

/** Returns a human explanation of why Start Run is disabled, or null if enabled. */
export function getStartDisabledReason(input: StartGateInput): string | null {
  if (!input.streamReady) {
    return 'Launch MES and wait for the live stream before starting a run.'
  }
  if (input.assetCount === 0) {
    return 'Add at least one asset ID to start a run.'
  }
  if (input.engineBusyElsewhere) {
    return 'The automation engine is in use by another runner. Wait for it to finish.'
  }
  if (input.pending) {
    return 'A command is in progress. Please wait.'
  }
  return null
}

/* ---- Stream toolbar contextual controls ---- */

export interface StreamToolbarControls {
  showAuthenticate: boolean
  showStopSession: boolean
}

export function getStreamToolbarControls(
  lifecycle: ManagedChromeLifecycleState,
): StreamToolbarControls {
  return {
    showAuthenticate:
      lifecycle === 'authentication-required' ||
      lifecycle === 'authenticating' ||
      lifecycle === 'launching-authentication',
    showStopSession: lifecycle !== 'stopped',
  }
}

/* ---- Run controls contextual visibility ---- */

export type RunControl = 'start' | 'pause' | 'resume' | 'stop'

export function getRunControls(runnerState: EolRunnerState): RunControl[] {
  switch (runnerState) {
    case 'running':
      return ['pause', 'stop']
    case 'paused':
      return ['resume', 'stop']
    case 'stopping':
      return ['stop']
    case 'idle':
    case 'completed':
    case 'error':
      return ['start']
  }
}

/* ---- Run summary (from the active snapshot only, never the draft mode) ---- */

export interface RunSummary {
  current: string
  completed: number
  total: number
  skipped: number
  needsReview: number
}

export function getRunSummary(snapshot: EolRunnerSnapshot): RunSummary {
  return {
    current: snapshot.currentAssetId ?? '—',
    completed: snapshot.completed,
    total: snapshot.total,
    skipped: snapshot.skipped,
    needsReview: snapshot.needsReview,
  }
}

/* ---- Inspector width clamping ---- */

export const INSPECTOR_MIN_WIDTH = 320
export const INSPECTOR_MAX_WIDTH = 480
export const INSPECTOR_DEFAULT_WIDTH = 360

export function clampInspectorWidth(px: number): number {
  if (!Number.isFinite(px)) {
    return INSPECTOR_MIN_WIDTH
  }
  return Math.max(
    INSPECTOR_MIN_WIDTH,
    Math.min(INSPECTOR_MAX_WIDTH, Math.round(px)),
  )
}
