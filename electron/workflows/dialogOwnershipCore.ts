export type ExpectedWorkflowDialog = 'failure-reason'

export type DialogOwnershipDecision =
  | { kind: 'authentication' }
  | { kind: 'business-error'; reason: string }
  | { kind: 'workflow-owned' }
  | { kind: 'workflow-mounting' }
  | { kind: 'classification-expired' }
  | { kind: 'unmatched' }

const BUSINESS_DIALOGS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /No order found for the scanned asset|Would you like to create a new order/i,
    reason: 'No Order Found',
  },
  {
    pattern: /Asset Tag\/Serial Number Not Found|not found\. Please verify and try again|Failed to retrieve order/i,
    reason: 'Asset Not Found',
  },
  { pattern: /Failed to execute instruction/i, reason: 'Failed Instruction' },
  { pattern: /Query Error/i, reason: 'Query Error' },
]

const AUTHENTICATION_DIALOG =
  /session expired|sign in|authentication|security key|YubiKey|non-compliant controls/i

export function classifyVisibleDialog(
  text: string,
  expected: ExpectedWorkflowDialog | null,
  now: number,
  classificationDeadline: number | null,
): DialogOwnershipDecision {
  if (AUTHENTICATION_DIALOG.test(text)) return { kind: 'authentication' }
  const business = BUSINESS_DIALOGS.find((rule) => rule.pattern.test(text))
  if (business !== undefined) {
    return { kind: 'business-error', reason: business.reason }
  }
  if (expected === 'failure-reason') {
    if (/Select failure reason/i.test(text)) return { kind: 'workflow-owned' }
    return classificationDeadline !== null && now >= classificationDeadline
      ? { kind: 'classification-expired' }
      : { kind: 'workflow-mounting' }
  }
  return { kind: 'unmatched' }
}

export function mapBusinessDialogText(text: string): string | null {
  return BUSINESS_DIALOGS.find((rule) => rule.pattern.test(text))?.reason ?? null
}
