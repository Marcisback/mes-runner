export class StopRequestedError extends Error {
  constructor(message = 'Stop requested') {
    super(message)
    this.name = 'StopRequestedError'
  }
}

export class AssetSkipError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.reason = reason
    this.name = 'AssetSkipError'
  }
}

export class NeedsReviewError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.reason = reason
    this.name = 'NeedsReviewError'
  }
}

export class WorkflowInvariantError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.reason = reason
    this.name = 'WorkflowInvariantError'
  }
}

export class AuthenticationRequiredError extends Error {
  constructor(message = 'Authentication is required before continuing.') {
    super(message)
    this.name = 'AuthenticationRequiredError'
  }
}

export class BrowserDisconnectedError extends Error {
  constructor(message = 'Managed Chrome disconnected during workflow.') {
    super(message)
    this.name = 'BrowserDisconnectedError'
  }
}

export function classifyWorkflowError(error: unknown): string {
  if (error instanceof AssetSkipError) {
    return 'asset-skip'
  }

  if (error instanceof NeedsReviewError) {
    return 'needs-review'
  }

  if (error instanceof WorkflowInvariantError) {
    return 'workflow-invariant'
  }

  if (error instanceof AuthenticationRequiredError) {
    return 'authentication-required'
  }

  if (error instanceof BrowserDisconnectedError) {
    return 'browser-disconnected'
  }

  if (error instanceof StopRequestedError) {
    return 'stop-requested'
  }

  return 'unexpected-error'
}

export function isBrowserDisconnectedDiagnostic(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('target page') ||
    message.includes('target closed') ||
    message.includes('browser has been closed') ||
    message.includes('context has been closed')
  )
}

export function sanitizeWorkflowReason(error: unknown): string {
  if (error instanceof AssetSkipError || error instanceof NeedsReviewError) {
    return sanitizeSensitiveText(error.reason)
  }

  if (error instanceof WorkflowInvariantError) {
    return sanitizeSensitiveText(error.reason)
  }

  if (error instanceof AuthenticationRequiredError) {
    return 'authentication-required'
  }

  if (error instanceof BrowserDisconnectedError) {
    return 'browser-disconnected'
  }

  if (error instanceof StopRequestedError) {
    return 'stopped'
  }

  if (isBrowserDisconnectedDiagnostic(error)) {
    return 'browser-disconnected'
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeSensitiveText(error.message)
  }

  return 'unexpected-error'
}
import { sanitizeSensitiveText } from '../sanitize.ts'
