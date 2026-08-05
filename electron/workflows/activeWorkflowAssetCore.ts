export type ActiveWorkflowAssetRelation =
  | 'current'
  | 'different'
  | 'unknown'
  | 'ambiguous'
  | 'none'

export interface LabeledAssetField {
  label: string
  values: string[]
  fieldContainerResolved: boolean
}

export interface ActiveWorkflowAssetResolution {
  relation: ActiveWorkflowAssetRelation
  assetTagCandidateCount: number
  assetTagResolved: boolean
  labelCandidateCount: number
  fieldContainerCount: number
  validValueCandidateCount: number
  strategy: 'asset-information-field-row'
}

export function resolveActiveWorkflowAsset(
  activeWorkflowDetected: boolean,
  fields: LabeledAssetField[],
  currentAssetId: string,
): ActiveWorkflowAssetResolution {
  if (!activeWorkflowDetected) {
    return unresolved('none', 0, 0, 0)
  }

  const assetTagFields = fields.filter(
    (field) => normalizeLabel(field.label) === 'asset tag',
  )
  if (assetTagFields.length !== 1) {
    return unresolved(
      assetTagFields.length > 1 ? 'ambiguous' : 'unknown',
      assetTagFields.length,
      assetTagFields.filter((field) => field.fieldContainerResolved).length,
      0,
    )
  }

  const field = assetTagFields[0]
  const values = [...new Set(field.values.map(normalizeAssetId).filter(isValidAssetId))]
  if (!field.fieldContainerResolved || values.length === 0) {
    return unresolved('unknown', 1, field.fieldContainerResolved ? 1 : 0, values.length)
  }
  if (values.length > 1) {
    return unresolved('ambiguous', 1, 1, values.length)
  }

  return {
    relation: values[0] === normalizeAssetId(currentAssetId)
      ? 'current'
      : 'different',
    assetTagCandidateCount: 1,
    assetTagResolved: true,
    labelCandidateCount: 1,
    fieldContainerCount: 1,
    validValueCandidateCount: 1,
    strategy: 'asset-information-field-row',
  }
}

export function normalizeAssetId(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

export function isValidAssetId(value: string): boolean {
  return /^IT\d+$/.test(normalizeAssetId(value))
}

function unresolved(
  relation: ActiveWorkflowAssetRelation,
  labelCandidateCount: number,
  fieldContainerCount: number,
  validValueCandidateCount: number,
): ActiveWorkflowAssetResolution {
  return {
    relation,
    assetTagCandidateCount: labelCandidateCount,
    assetTagResolved: false,
    labelCandidateCount,
    fieldContainerCount,
    validValueCandidateCount,
    strategy: 'asset-information-field-row',
  }
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/:$/, '').trim().toLowerCase()
}
