import test from 'node:test'
import assert from 'node:assert/strict'
import type { Locator } from 'playwright-core'
import { NeedsReviewError } from './errors.ts'
import {
  activateSemanticAction,
  type SemanticActionDependencies,
} from './semanticActions.ts'
import {
  TargetInstabilityDeduplicator,
} from './semanticActionCore.ts'
import type {
  MesWorkflowStage,
  StageControlEvidence,
} from './deterministicStageCore.ts'
import type { WorkflowStageSnapshot } from './deterministicStages.ts'
import type { StageControlProbe } from './stageControlResolver.ts'
import type { AssetWorkflowContext } from './types.ts'

const nodeA = { id: 'old-confirm-wipe' } as unknown as Locator
const nodeB = { id: 'replacement-confirm-wipe' } as unknown as Locator

function evidence(overrides: Partial<StageControlEvidence> = {}): StageControlEvidence {
  return {
    sectionCandidateCount: 1,
    scannerCandidateCount: 1,
    scannerValue: 'current',
    scannerVisible: true,
    scannerEnabled: true,
    scannerEditable: true,
    buttonCandidateCount: 1,
    buttonEnabled: true,
    headingMatchCount: 1,
    ignoredTimelineLabelCount: 0,
    deduplicatedAncestorCandidateCount: 0,
    resolutionStrategy: 'nearest-actionable-control-bundle',
    ...overrides,
  }
}

function probe(
  state: MesWorkflowStage,
  button: Locator | null = nodeB,
  overrides: Partial<StageControlEvidence> = {},
): StageControlProbe {
  return {
    state,
    evidence: evidence(overrides),
    scanner: null,
    button,
    durationMs: 0,
  }
}

function snapshot(stage: MesWorkflowStage): WorkflowStageSnapshot {
  const emptyProbe = probe('unknown', null, {
    sectionCandidateCount: 0,
    scannerCandidateCount: 0,
    scannerValue: 'unreadable',
    scannerVisible: false,
    scannerEnabled: false,
    scannerEditable: false,
    buttonCandidateCount: 0,
    buttonEnabled: false,
    headingMatchCount: 0,
  })
  return {
    stage,
    start: { locator: null, candidateCount: 0, durationMs: 0 },
    wipe: emptyProbe,
    diagnostic: emptyProbe,
    initial: {
      state: 'ambiguous',
      locator: null,
      candidateCount: 0,
      enabled: false,
      editable: false,
    },
    failureDialogCount: 0,
    moveToRepairCount: 0,
    moveToRepair: {
      state: 'none',
      bundleCount: 0,
      headingMatchCount: 0,
      locatorCandidateCount: 0,
      confirmMoveMatchCount: 0,
      ignoredGenericLocatorInputCount: 0,
      ignoredTimelineRepairLabelCount: 0,
      deduplicatedAncestorCandidateCount: 0,
      resolutionStrategy: 'nearest-actionable-control-bundle',
      durationMs: 0,
    },
    mriCompletionCount: 0,
    activeWorkflowPresent: true,
    durationMs: 0,
  }
}

function context(logs: string[]): AssetWorkflowContext {
  const log: AssetWorkflowContext['log'] = (_severity, message) => { logs.push(message) }
  return {
    assetId: 'IT2830528',
    checkpoint: async () => undefined,
    log,
  } as unknown as AssetWorkflowContext
}

function dependencies(
  stage: MesWorkflowStage,
  stageProbes: StageControlProbe[],
  clicks: Locator[],
  backoffs: { count: number },
): SemanticActionDependencies {
  let probeIndex = 0
  return {
    observe: async () => snapshot(stage),
    resolveStart: async () => ({ locator: null, candidateCount: 0, durationMs: 0 }),
    resolveStage: async () => stageProbes[Math.min(probeIndex++, stageProbes.length - 1)],
    closePopup: async () => 'none',
    click: async (_context, locator) => { clicks.push(locator) },
    backoff: async () => { backoffs.count += 1 },
  }
}

test('Confirm Wipe accepts a semantically identical replacement node and clicks it once', async () => {
  const logs: string[] = []
  const clicks: Locator[] = []
  const backoffs = { count: 0 }

  assert.notEqual(nodeA, nodeB)
  assert.equal(await activateSemanticAction(
    context(logs),
    'MRI_FAIL',
    'confirm-wipe',
    dependencies('wipe-confirm-ready', [probe('wipe-confirm-ready', nodeB)], clicks, backoffs),
  ), 'dispatched')
  assert.deepEqual(clicks, [nodeB])
  assert.equal(logs.includes('DOM replacement accepted.'), true)
  assert.equal(backoffs.count, 0)
})

test('changed scanner value never clicks Confirm Wipe', async () => {
  const clicks: Locator[] = []
  const backoffs = { count: 0 }
  await assert.rejects(
    activateSemanticAction(
      context([]),
      'MRI_FAIL',
      'confirm-wipe',
      dependencies(
        'wipe-confirm-ready',
        [probe('ambiguous', null, { scannerValue: 'different' })],
        clicks,
        backoffs,
      ),
    ),
    NeedsReviewError,
  )
  assert.equal(clicks.length, 0)
})

test('disabled Confirm Wipe is bounded and never clicked', async () => {
  const clicks: Locator[] = []
  const backoffs = { count: 0 }
  await assert.rejects(
    activateSemanticAction(
      context([]),
      'MRI_FAIL',
      'confirm-wipe',
      dependencies(
        'wipe-confirm-ready',
        [probe('wipe-awaiting-confirm', null, { buttonEnabled: false })],
        clicks,
        backoffs,
      ),
    ),
    /Semantic target instability exhausted/,
  )
  assert.equal(clicks.length, 0)
  assert.equal(backoffs.count, 2)
})

test('Diagnostic advancement before Confirm Wipe activation is accepted without a click', async () => {
  const clicks: Locator[] = []
  assert.equal(await activateSemanticAction(
    context([]),
    'MRI_FAIL',
    'confirm-wipe',
    dependencies('diagnostic-scan-ready', [], clicks, { count: 0 }),
  ), 'already-advanced')
  assert.equal(clicks.length, 0)
})

test('two genuine Confirm Wipe targets fail closed', async () => {
  const clicks: Locator[] = []
  await assert.rejects(
    activateSemanticAction(
      context([]),
      'MRI_FAIL',
      'confirm-wipe',
      dependencies(
        'wipe-confirm-ready',
        [probe('ambiguous', null, { sectionCandidateCount: 2, buttonCandidateCount: 2 })],
        clicks,
        { count: 0 },
      ),
    ),
    NeedsReviewError,
  )
  assert.equal(clicks.length, 0)
})

test('duplicate target-instability diagnostics are suppressed and summarized', () => {
  const diagnostics = new TargetInstabilityDeduplicator(2_000)
  assert.deepEqual(diagnostics.record('confirm-wipe:missing', 100), {
    emit: true,
    summarizedCount: 0,
  })
  assert.equal(diagnostics.record('confirm-wipe:missing', 200).emit, false)
  assert.equal(diagnostics.record('confirm-wipe:missing', 300).emit, false)
  assert.equal(diagnostics.flush(), 2)
})
