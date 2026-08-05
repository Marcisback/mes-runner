import {
  DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  DEFAULT_REPAIR_LOCATOR,
  type RepairOutcome,
  type WorkflowMode,
} from '../src/types/eolRunner.ts'
import type { WorkflowOptions } from './workflows/types.ts'

export const RUNNER_REQUEST_LIMITS = {
  assetTextLength: 128_000,
  assetsPerRun: 1_000,
  assetIdLength: 128,
  locatorLength: 128,
} as const

export interface ValidatedRunnerStartRequest {
  assets: string[]
  options: WorkflowOptions
}

export function parseRunnerStartRequest(
  payload: unknown,
): ValidatedRunnerStartRequest | null {
  if (typeof payload === 'string') {
    return buildRequest(payload, 'EOL', 'confirmed', undefined, undefined)
  }
  if (!isRecord(payload)) return null

  const mode = parseMode(payload.mode)
  const repairOutcome = parseRepairOutcome(payload.repairOutcome)
  if (mode === null || repairOutcome === null) return null

  return typeof payload.assetsText === 'string'
    ? buildRequest(
        payload.assetsText,
        mode,
        repairOutcome,
        payload.repairLocator,
        payload.moveToRepairLocator,
      )
    : null
}

function buildRequest(
  assetsText: string,
  mode: WorkflowMode,
  repairOutcome: RepairOutcome,
  repairLocatorValue: unknown,
  moveToRepairLocatorValue: unknown,
): ValidatedRunnerStartRequest | null {
  if (assetsText.length > RUNNER_REQUEST_LIMITS.assetTextLength) return null
  const assets = parseAssets(assetsText)
  if (
    assets.length === 0 ||
    assets.length > RUNNER_REQUEST_LIMITS.assetsPerRun ||
    assets.some((asset) => asset.length > RUNNER_REQUEST_LIMITS.assetIdLength)
  ) return null

  const repairLocator = parseLocator(repairLocatorValue, DEFAULT_REPAIR_LOCATOR)
  const moveToRepairLocator = parseLocator(
    moveToRepairLocatorValue,
    DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  )
  if (repairLocator === null || moveToRepairLocator === null) return null

  return {
    assets,
    options: { mode, repairOutcome, repairLocator, moveToRepairLocator },
  }
}

function parseAssets(text: string): string[] {
  const seen = new Set<string>()
  const assets: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const asset = line.trim()
    if (asset.length === 0 || asset.startsWith('#') || seen.has(asset)) continue
    seen.add(asset)
    assets.push(asset)
  }
  return assets
}

function parseMode(value: unknown): WorkflowMode | null {
  if (value === undefined) return 'EOL'
  return value === 'EOL' || value === 'MRI' || value === 'MRI_FAIL' || value === 'REPAIR'
    ? value
    : null
}

function parseRepairOutcome(value: unknown): RepairOutcome | null {
  if (value === undefined) return 'confirmed'
  return value === 'confirmed' || value === 'failed' ? value : null
}

function parseLocator(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback
  if (typeof value !== 'string') return null
  const locator = value.trim()
  return locator.length > 0 &&
    locator.length <= RUNNER_REQUEST_LIMITS.locatorLength &&
    !/[\r\n\0]/.test(locator)
    ? locator
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
