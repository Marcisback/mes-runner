import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveSnapshotStage,
  resolveStageLoopIteration,
  type MesWorkflowStage,
  type StageControlEvidence,
  type StageLoopMode,
} from './deterministicStageCore.ts'
import { probeStageControls } from './stageControlResolver.ts'
import { probeMoveToRepairStage } from './moveToRepairStageResolver.ts'
import { observeWorkflowStage } from './deterministicStages.ts'
import type { PassiveStageSnapshot } from './passiveStageSnapshot.ts'
import type { AssetWorkflowContext } from './types.ts'

interface FixtureNode {
  kind: 'root' | 'container' | 'input' | 'heading' | 'button' | 'label'
  text?: string
  placeholder?: string
  value?: string
  visible?: boolean
  enabled?: boolean
  editable?: boolean
  ariaLabel?: string
  parent?: FixtureNode
  children: FixtureNode[]
}

class FixtureLocator {
  private readonly nodes: FixtureNode[]

  constructor(nodes: FixtureNode[]) {
    this.nodes = nodes
  }

  count(): Promise<number> { return Promise.resolve(this.nodes.length) }
  nth(index: number): FixtureLocator { return new FixtureLocator(this.nodes[index] === undefined ? [] : [this.nodes[index]]) }
  isVisible(): Promise<boolean> { return Promise.resolve(this.nodes[0]?.visible !== false) }
  isEnabled(): Promise<boolean> { return Promise.resolve(this.nodes[0]?.enabled !== false) }
  isEditable(): Promise<boolean> { return Promise.resolve(this.nodes[0]?.editable === true) }
  inputValue(): Promise<string> { return Promise.resolve(this.nodes[0]?.value ?? '') }
  getAttribute(name: string): Promise<string | null> {
    const node = this.nodes[0]
    if (name === 'aria-disabled') return Promise.resolve(node?.enabled === false ? 'true' : 'false')
    return Promise.resolve(name === 'aria-label' ? node?.ariaLabel ?? null : null)
  }

  getByText(pattern: RegExp): FixtureLocator {
    return new FixtureLocator(descendants(this.nodes).filter((node) => pattern.test(node.text ?? '')))
  }

  getByPlaceholder(pattern: RegExp): FixtureLocator {
    return new FixtureLocator(descendants(this.nodes).filter((node) =>
      node.kind === 'input' && pattern.test(node.placeholder ?? '')))
  }

  getByRole(role: string, options: { name?: RegExp }): FixtureLocator {
    return new FixtureLocator(descendants(this.nodes).filter((node) => {
      const nodeRole = node.kind === 'heading' ? 'heading' : node.kind === 'button' ? 'button' : null
      const name = node.ariaLabel ?? node.text ?? ''
      return nodeRole === role && (options.name?.test(name) ?? true)
    }))
  }

  locator(selector: string): FixtureLocator {
    if (selector === 'input[placeholder="Scan locator"]') {
      return new FixtureLocator(descendants(this.nodes).filter((node) =>
        node.kind === 'input' && node.placeholder === 'Scan locator'))
    }
    if (selector === 'button[aria-label="Diagnostic failed"]') {
      return new FixtureLocator(descendants(this.nodes).filter((node) =>
        node.kind === 'button' && node.ariaLabel === 'Diagnostic failed'))
    }
    if (!selector.startsWith('xpath=ancestor::*')) return new FixtureLocator([])
    const stage = selector.includes('="Wipe"')
      ? 'Wipe'
      : selector.includes('="Move to repair"') ? 'Move to repair' : 'Diagnostic'
    const nearestOnly = selector.endsWith('[1]')
    const matches: FixtureNode[] = []
    for (const source of this.nodes) {
      let current = source.parent
      while (current !== undefined) {
        const nested = descendants([current])
        const hasHeading = nested.some((node) => node.kind === 'heading' && node.text === stage)
        const hasAction = nested.some((node) => node.kind === 'button' && (
          stage === 'Wipe'
            ? (node.ariaLabel ?? node.text) === 'Confirm wipe'
            : stage === 'Move to repair'
              ? (node.ariaLabel ?? node.text) === 'Confirm move'
            : ['Confirm diagnostic', 'Diagnostic failed'].includes(node.ariaLabel ?? node.text ?? '')
        ))
        if (hasHeading && hasAction) {
          matches.push(current)
          if (nearestOnly) break
        }
        current = current.parent
      }
    }
    return new FixtureLocator(nearestOnly ? matches.slice(0, 1) : matches)
  }
}

class FixturePage extends FixtureLocator {
  constructor(root: FixtureNode) { super([root]) }
}

function descendants(roots: FixtureNode[]): FixtureNode[] {
  const result: FixtureNode[] = []
  const visit = (node: FixtureNode): void => {
    result.push(node)
    node.children.forEach(visit)
  }
  roots.forEach(visit)
  return result
}

function node(kind: FixtureNode['kind'], values: Omit<FixtureNode, 'kind' | 'children'> = {}): FixtureNode {
  return { kind, children: [], ...values }
}

function append(parent: FixtureNode, child: FixtureNode): FixtureNode {
  child.parent = parent
  parent.children.push(child)
  return child
}

function stagePanel(
  root: FixtureNode,
  stage: 'Wipe' | 'Diagnostic',
  value: string,
  buttonEnabled: boolean,
  action: 'pass' | 'fail' = 'pass',
  nested = false,
): FixtureNode {
  const outer = append(root, node('container'))
  const panel = append(outer, node('container'))
  append(panel, node('heading', { text: stage }))
  const inputParent = nested ? append(append(panel, node('container')), node('container')) : panel
  append(inputParent, node('input', {
    placeholder: 'Scan asset tag or serial number',
    value,
    enabled: true,
    editable: true,
  }))
  const label = stage === 'Wipe'
    ? 'Confirm wipe'
    : action === 'fail' ? 'Diagnostic failed' : 'Confirm diagnostic'
  append(panel, node('button', {
    text: label,
    ariaLabel: label,
    enabled: buttonEnabled,
  }))
  return panel
}

function moveToRepairPanel(root: FixtureNode, nested = false): void {
  const outer = append(root, node('container'))
  const panel = append(outer, node('container'))
  append(panel, node('heading', { text: 'Move to repair' }))
  const inputParent = nested ? append(append(panel, node('container')), node('container')) : panel
  append(inputParent, node('input', {
    placeholder: 'Scan locator',
    value: '',
    enabled: true,
    editable: true,
  }))
  append(panel, node('button', {
    text: 'Confirm move',
    ariaLabel: 'Confirm move',
    enabled: false,
  }))
}

function resolverContext(root: FixtureNode): AssetWorkflowContext {
  return {
    page: new FixturePage(root) as unknown as AssetWorkflowContext['page'],
    assetId: 'IT2830528',
  } as AssetWorkflowContext
}

function signals(override: Partial<Parameters<typeof resolveSnapshotStage>[0]> = {}): Parameters<typeof resolveSnapshotStage>[0] {
  return {
    mode: 'MRI' as StageLoopMode,
    startCount: 0,
    startActionable: false,
    wipe: 'unknown' as MesWorkflowStage,
    diagnostic: 'unknown' as MesWorkflowStage,
    initialState: 'initial-empty',
    initialCount: 1,
    initialEnabled: true,
    failureDialogCount: 0,
    moveToRepairCount: 0,
    mriCompletionCount: 0,
    activeWorkflowPresent: false,
    ...override,
  }
}

function evidence(override: Partial<StageControlEvidence> = {}): StageControlEvidence {
  return {
    sectionCandidateCount: 1,
    scannerCandidateCount: 1,
    scannerValue: 'empty',
    scannerVisible: true,
    scannerEnabled: true,
    scannerEditable: true,
    buttonCandidateCount: 1,
    buttonEnabled: false,
    headingMatchCount: 1,
    ignoredTimelineLabelCount: 0,
    deduplicatedAncestorCandidateCount: 0,
    resolutionStrategy: 'nearest-actionable-control-bundle',
    ...override,
  }
}

test('clean landing requires no active workflow controls', () => {
  assert.equal(resolveSnapshotStage(signals()), 'landing')
  assert.equal(resolveSnapshotStage(signals({ activeWorkflowPresent: true })), 'transitioning')
})

test('later scoped stages outrank persistent Start and global scanner evidence', () => {
  assert.equal(resolveSnapshotStage(signals({
    startCount: 1,
    startActionable: true,
    wipe: 'wipe-scan-ready',
    activeWorkflowPresent: true,
  })), 'wipe-scan-ready')
  assert.equal(resolveSnapshotStage(signals({
    startCount: 1,
    startActionable: true,
    wipe: 'wipe-confirm-ready',
    diagnostic: 'diagnostic-scan-ready',
    activeWorkflowPresent: true,
  })), 'diagnostic-scan-ready')
})

test('failure, Move-to-Repair, and terminal evidence have explicit priority', () => {
  assert.equal(resolveSnapshotStage(signals({
    failureDialogCount: 1,
    diagnostic: 'diagnostic-fail-ready',
    activeWorkflowPresent: true,
  })), 'failure-dialog')
  assert.equal(resolveSnapshotStage(signals({
    moveToRepairCount: 1,
    diagnostic: 'diagnostic-fail-ready',
    activeWorkflowPresent: true,
  })), 'move-to-repair')
  assert.equal(resolveSnapshotStage(signals({
    mriCompletionCount: 1,
    diagnostic: 'diagnostic-pass-ready',
    activeWorkflowPresent: true,
  })), 'mri-completed')
})

test('multiple actionable targets fail closed', () => {
  assert.equal(resolveSnapshotStage(signals({
    startCount: 2,
    startActionable: false,
    activeWorkflowPresent: true,
  })), 'ambiguous')
  assert.equal(resolveSnapshotStage(signals({
    wipe: 'ambiguous',
    activeWorkflowPresent: true,
  })), 'ambiguous')
})

test('production Wipe resolver ignores global scanner and timeline label', async () => {
  const root = node('root')
  append(root, node('input', {
    placeholder: 'Scan the asset tag or serial number to get started',
    value: '',
    enabled: true,
    editable: true,
  }))
  append(root, node('label', { text: 'Wipe' }))
  stagePanel(root, 'Wipe', '', false)

  const result = await probeStageControls(resolverContext(root), 'Wipe')
  assert.equal(result.state, 'wipe-scan-ready')
  assert.equal(result.evidence.headingMatchCount, 2)
  assert.equal(result.evidence.ignoredTimelineLabelCount, 1)
  assert.equal(result.evidence.sectionCandidateCount, 1)
  assert.equal(result.evidence.scannerCandidateCount, 1)
})

test('production Wipe resolver deduplicates nested ancestors around one scanner', async () => {
  const root = node('root')
  stagePanel(root, 'Wipe', '', false, 'pass', true)
  const result = await probeStageControls(resolverContext(root), 'Wipe')
  assert.equal(result.state, 'wipe-scan-ready')
  assert.equal(result.evidence.sectionCandidateCount, 1)
  assert.ok(result.evidence.deduplicatedAncestorCandidateCount >= 1)
})

test('production Wipe resolver distinguishes scan, wait, and confirmation states', async () => {
  const emptyRoot = node('root')
  stagePanel(emptyRoot, 'Wipe', '', false)
  assert.equal((await probeStageControls(resolverContext(emptyRoot), 'Wipe')).state, 'wipe-scan-ready')

  const waitingRoot = node('root')
  stagePanel(waitingRoot, 'Wipe', 'IT2830528', false)
  assert.equal((await probeStageControls(resolverContext(waitingRoot), 'Wipe')).state, 'wipe-awaiting-confirm')

  const readyRoot = node('root')
  stagePanel(readyRoot, 'Wipe', 'IT2830528', true)
  assert.equal((await probeStageControls(resolverContext(readyRoot), 'Wipe')).state, 'wipe-confirm-ready')
})

test('production Wipe resolver reports only genuinely distinct bundles as ambiguous', async () => {
  const root = node('root')
  stagePanel(root, 'Wipe', '', false)
  stagePanel(root, 'Wipe', '', false)
  assert.equal((await probeStageControls(resolverContext(root), 'Wipe')).state, 'ambiguous')
})

test('timeline-only Wipe text is not a stage', async () => {
  const root = node('root')
  append(root, node('label', { text: 'Wipe' }))
  const result = await probeStageControls(resolverContext(root), 'Wipe')
  assert.equal(result.state, 'unknown')
  assert.equal(result.evidence.sectionCandidateCount, 0)
})

test('production Diagnostic resolver uses the same control-bundle rules', async () => {
  const scanRoot = node('root')
  append(scanRoot, node('label', { text: 'Diagnostic' }))
  stagePanel(scanRoot, 'Diagnostic', '', false)
  const scan = await probeStageControls(resolverContext(scanRoot), 'Diagnostic', 'pass')
  assert.equal(scan.state, 'diagnostic-scan-ready')
  assert.equal(scan.evidence.ignoredTimelineLabelCount, 1)

  const waitRoot = node('root')
  stagePanel(waitRoot, 'Diagnostic', 'IT2830528', false)
  assert.equal(
    (await probeStageControls(resolverContext(waitRoot), 'Diagnostic', 'pass')).state,
    'diagnostic-awaiting-action',
  )

  const passRoot = node('root')
  stagePanel(passRoot, 'Diagnostic', 'IT2830528', true)
  assert.equal(
    (await probeStageControls(resolverContext(passRoot), 'Diagnostic', 'pass')).state,
    'diagnostic-pass-ready',
  )

  const failRoot = node('root')
  stagePanel(failRoot, 'Diagnostic', 'IT2830528', true, 'fail')
  assert.equal(
    (await probeStageControls(resolverContext(failRoot), 'Diagnostic', 'fail')).state,
    'diagnostic-fail-ready',
  )
})

test('pending submission acknowledges direct Wipe and dispatches one scan action', () => {
  const acknowledged = resolveStageLoopIteration('MRI', 'wipe-scan-ready', true, 'submit-asset')
  assert.equal(acknowledged.acknowledged, true)
  assert.deepEqual(acknowledged.decision, {
    kind: 'act',
    action: 'scan-wipe-asset',
    reason: 'Scoped Wipe scanner is actionable.',
  })
  const pendingScan = resolveStageLoopIteration('MRI', 'wipe-scan-ready', true, 'scan-wipe-asset')
  assert.equal(pendingScan.acknowledged, false)
  assert.equal(pendingScan.decision.kind, 'wait')
})

test('Wipe and Diagnostic locator inputs do not resolve Move-to-Repair', async () => {
  const wipeRoot = node('root')
  const wipe = stagePanel(wipeRoot, 'Wipe', '', false)
  append(wipe, node('input', {
    placeholder: 'Scan locator',
    value: '',
    enabled: true,
    editable: true,
  }))
  const wipeMove = await probeMoveToRepairStage(resolverContext(wipeRoot))
  assert.equal(wipeMove.state, 'none')
  assert.equal(wipeMove.bundleCount, 0)
  assert.equal(wipeMove.ignoredGenericLocatorInputCount, 1)

  const diagnosticRoot = node('root')
  const diagnostic = stagePanel(diagnosticRoot, 'Diagnostic', '', false)
  append(diagnostic, node('input', {
    placeholder: 'Scan locator',
    value: '',
    enabled: true,
    editable: true,
  }))
  const diagnosticMove = await probeMoveToRepairStage(resolverContext(diagnosticRoot))
  assert.equal(diagnosticMove.state, 'none')
  assert.equal(diagnosticMove.ignoredGenericLocatorInputCount, 1)
})

test('generic locator input and timeline repair labels are not Move-to-Repair', async () => {
  const root = node('root')
  append(root, node('input', {
    placeholder: 'Scan locator',
    value: '',
    enabled: true,
    editable: true,
  }))
  append(root, node('label', { text: 'Repair' }))
  append(root, node('label', { text: 'Move instruction' }))
  const result = await probeMoveToRepairStage(resolverContext(root))
  assert.equal(result.state, 'none')
  assert.equal(result.headingMatchCount, 0)
  assert.equal(result.bundleCount, 0)
  assert.equal(result.ignoredGenericLocatorInputCount, 1)
  assert.equal(result.ignoredTimelineRepairLabelCount, 2)
})

test('complete Move-to-Repair bundle resolves and nested ancestors deduplicate', async () => {
  const root = node('root')
  moveToRepairPanel(root, true)
  const result = await probeMoveToRepairStage(resolverContext(root))
  assert.equal(result.state, 'ready')
  assert.equal(result.bundleCount, 1)
  assert.equal(result.headingMatchCount, 1)
  assert.equal(result.locatorCandidateCount, 1)
  assert.equal(result.confirmMoveMatchCount, 1)
  assert.ok(result.deduplicatedAncestorCandidateCount >= 1)
})

test('two complete Move-to-Repair bundles fail closed as ambiguous', async () => {
  const root = node('root')
  moveToRepairPanel(root)
  moveToRepairPanel(root)
  const result = await probeMoveToRepairStage(resolverContext(root))
  assert.equal(result.state, 'ambiguous')
  assert.equal(result.bundleCount, 2)
})

test('supplied Wipe state outranks ignored generic locator evidence', async () => {
  const root = node('root')
  const wipePanel = stagePanel(root, 'Wipe', '', false)
  append(wipePanel, node('input', {
    placeholder: 'Scan locator',
    value: '',
    enabled: true,
    editable: true,
  }))
  const context = resolverContext(root)
  const [wipe, move] = await Promise.all([
    probeStageControls(context, 'Wipe'),
    probeMoveToRepairStage(context),
  ])
  assert.equal(wipe.state, 'wipe-scan-ready')
  assert.equal(move.bundleCount, 0)
  const stage = resolveSnapshotStage(signals({
    wipe: wipe.state,
    moveToRepairCount: move.bundleCount,
    activeWorkflowPresent: true,
  }))
  assert.equal(stage, 'wipe-scan-ready')
  const iteration = resolveStageLoopIteration('MRI', stage, true, 'submit-asset')
  assert.equal(iteration.acknowledged, true)
  assert.equal(iteration.decision.kind, 'act')
  if (iteration.decision.kind === 'act') {
    assert.equal(iteration.decision.action, 'scan-wipe-asset')
  }
  assert.equal(
    resolveStageLoopIteration('MRI', stage, true, 'scan-wipe-asset').decision.kind,
    'wait',
  )
})

test('production passive observer resolves Diagnostic from one DOM snapshot without locator probes', async () => {
  let evaluateCalls = 0
  const emptyEvidence = evidence({
    sectionCandidateCount: 0,
    scannerCandidateCount: 0,
    scannerVisible: false,
    scannerEnabled: false,
    scannerEditable: false,
    headingMatchCount: 0,
  })
  const passive = {
    startCount: 0,
    startActionable: false,
    wipe: emptyEvidence,
    diagnostic: evidence(),
    initial: {
      state: 'ambiguous',
      candidateCount: 0,
      enabled: false,
      editable: false,
    },
    failureDialogCount: 0,
    moveToRepair: {
      state: 'none',
      bundleCount: 0,
      headingMatchCount: 0,
      locatorCandidateCount: 0,
      confirmMoveMatchCount: 0,
      ignoredGenericLocatorInputCount: 0,
      ignoredTimelineRepairLabelCount: 0,
      deduplicatedAncestorCandidateCount: 0,
    },
    mriCompletionCount: 0,
    activeWorkflowPresent: true,
  } satisfies PassiveStageSnapshot
  const page = {
    evaluate: async () => { evaluateCalls += 1; return passive },
    locator: () => { throw new Error('passive observer used a Locator') },
    getByPlaceholder: () => { throw new Error('passive observer used a Locator') },
  }
  const context = {
    page,
    assetId: 'IT2830528',
    ensurePageReady: async () => undefined,
  } as unknown as AssetWorkflowContext

  const snapshot = await observeWorkflowStage(context, 'MRI')
  assert.equal(snapshot.stage, 'diagnostic-scan-ready')
  assert.equal(evaluateCalls, 1)
})
