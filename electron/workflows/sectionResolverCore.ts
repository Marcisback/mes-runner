export interface WorkflowSectionCandidate {
  id: string
  stageName: string
  inputId: string
  buttonId: string
  depth: number
  hasExactStageLabel: boolean
  inputKind: 'asset' | 'locator' | 'other'
  inputVisible: boolean
  inputEnabled: boolean
  inputLabel: string
  inputPlaceholder: string
  buttonVisible: boolean
  buttonEnabled: boolean
}

export interface WorkflowSectionResolution {
  rawContainerCandidateCount: number
  uniqueActionableControlCount: number
  deduplicatedBundleCount: number
  selected: WorkflowSectionCandidate | null
  ambiguityReason: string | null
}

export function resolveWorkflowSectionBundle(
  candidates: WorkflowSectionCandidate[],
  expectedStageName: string,
): WorkflowSectionResolution {
  const actionable = candidates.filter(
    (candidate) =>
      candidate.stageName === expectedStageName &&
      candidate.hasExactStageLabel &&
      candidate.inputKind === 'asset' &&
      candidate.inputVisible &&
      candidate.inputEnabled &&
      isAssetInputMetadata(candidate) &&
      candidate.buttonVisible &&
      candidate.buttonEnabled,
  )
  const bundles = new Map<string, WorkflowSectionCandidate>()

  for (const candidate of actionable) {
    const key = `${candidate.inputId}:${candidate.buttonId}`
    const existing = bundles.get(key)

    if (existing === undefined || candidate.depth > existing.depth) {
      bundles.set(key, candidate)
    }
  }

  const deduplicated = [...bundles.values()]

  if (deduplicated.length > 1) {
    return {
      rawContainerCandidateCount: candidates.length,
      uniqueActionableControlCount: actionable.length,
      deduplicatedBundleCount: deduplicated.length,
      selected: null,
      ambiguityReason: 'multiple actionable workflow panels',
    }
  }

  return {
    rawContainerCandidateCount: candidates.length,
    uniqueActionableControlCount: actionable.length,
    deduplicatedBundleCount: deduplicated.length,
    selected: deduplicated[0] ?? null,
    ambiguityReason: null,
  }
}

function isAssetInputMetadata(candidate: WorkflowSectionCandidate): boolean {
  const metadata = `${candidate.inputLabel} ${candidate.inputPlaceholder}`
  return /Asset tag or serial number/i.test(metadata) && !/Scan locator|Locator/i.test(metadata)
}
