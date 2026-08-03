import type { EolRunnerSnapshot } from '../types/eolRunner'

type Diagnostics = EolRunnerSnapshot['diagnostics']
type Assets = EolRunnerSnapshot['assets']
type Asset = Assets[number]

/**
 * Shared, side-effect-free formatting for runner diagnostics and asset error
 * details. Extracted so both the runner workspace diagnostics drawer and the
 * Logs view render identical, consistently sanitized output. Sanitization
 * strips URLs' query strings, local filesystem paths, and (optionally) asset
 * identifiers so copied logs never leak sensitive context.
 */
export function parseAssetText(text: string): string[] {
  const seen = new Set<string>()
  const assets: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const asset = line.trim()

    if (asset.length === 0 || asset.startsWith('#') || seen.has(asset)) {
      continue
    }

    seen.add(asset)
    assets.push(asset)
  }

  return assets
}

export function formatDiagnostics(
  events: Diagnostics,
  sanitized: boolean,
  assets: Assets,
): string {
  const assetIds = assets.map((asset) => asset.id)

  return events
    .map((event) => {
      const parts = [
        event.timestamp,
        event.severity.toUpperCase(),
        event.runnerState,
        event.workflowMode,
        event.currentStep ?? '-',
        event.assetId ?? '-',
        event.message,
      ]

      if (event.errorClass !== null) {
        parts.push(event.errorClass)
      }

      if (event.reason !== null) {
        parts.push(event.reason)
      }

      const line = parts.join(' | ')
      return sanitized ? sanitizeCopiedText(line, assetIds) : line
    })
    .join('\n')
}

export function formatErrorDetails(asset: Asset, sanitized: boolean): string {
  if (asset.errorDetails === null) {
    return ''
  }

  const details = asset.errorDetails
  const text = [
    `Timestamp: ${details.timestamp}`,
    `Asset: ${asset.id}`,
    `Workflow mode: ${details.workflowMode}`,
    `Last completed step: ${details.lastCompletedStep ?? '-'}`,
    `Failing step: ${details.failingStep ?? '-'}`,
    `Error class: ${details.errorClass}`,
    `Reason: ${details.sanitizedMessage}`,
  ].join('\n')

  return sanitized ? sanitizeCopiedText(text, [asset.id]) : text
}

export function sanitizeCopiedText(text: string, assetIds: string[]): string {
  const withoutQueries = text.replace(/https?:\/\/[^\s|]+/g, (urlText) => {
    try {
      const url = new URL(urlText)
      return `${url.origin}${url.pathname}`
    } catch {
      return '[url]'
    }
  })
  const withoutPaths = withoutQueries.replace(/\/Users\/[^\s|]+/g, '[local-path]')

  return assetIds.reduce((result, assetId) => {
    if (assetId.length === 0) {
      return result
    }

    return result.split(assetId).join('[ASSET]')
  }, withoutPaths)
}
