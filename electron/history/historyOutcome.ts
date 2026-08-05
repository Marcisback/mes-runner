import type { EolAssetState } from '../../src/types/eolRunner'
import type { HistoryOutcome } from '../../src/types/history'

export function toHistoryOutcome(state: EolAssetState): HistoryOutcome | null {
  if (state === 'completed') return 'completed'
  if (state === 'needs-review') return 'needs_review'
  return null
}

