import type { WorkflowMode } from '../../src/types/eolRunner'

export type WorkflowOperation =
  | 'startAsset'
  | 'runWipePass'
  | 'scanDiagnosticAsset'
  | 'runDiagnosticPass'
  | 'completeDiagnosticFailure'
  | 'moveToRepair'
  | 'verifyEolCompletion'
  | 'verifyMriCompletion'
  | 'verifyMoveToRepairCompletion'

export function getWorkflowOperationPlan(
  mode: WorkflowMode,
): WorkflowOperation[] {
  switch (mode) {
    case 'EOL':
      return ['startAsset', 'runWipePass', 'verifyEolCompletion']
    case 'MRI':
      return [
        'startAsset',
        'runWipePass',
        'runDiagnosticPass',
        'verifyMriCompletion',
      ]
    case 'MRI_FAIL':
      return [
        'startAsset',
        'runWipePass',
        'scanDiagnosticAsset',
        'completeDiagnosticFailure',
        'moveToRepair',
        'verifyMoveToRepairCompletion',
      ]
    case 'REPAIR':
      return []
  }
}
