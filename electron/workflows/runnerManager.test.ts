import assert from 'node:assert/strict'
import test from 'node:test'
import type { Page } from 'playwright-core'
import { RunnerManager, type RunnerWorkflow } from '../runnerManager.ts'
import type { RunnerBrowserAccess } from '../runnerBrowserAccess.ts'
import type { EolRunnerSnapshot, RunnerId } from '../../src/types/eolRunner.ts'

class FakeBrowser {
  readonly pages = new Map<RunnerId, Page>()
  readonly closed: RunnerId[] = []
  readonly streams: Array<RunnerId | null> = []
  readonly invalidationListeners = new Set<(reason: string, runnerId: RunnerId | null) => void>()
  failNext = false

  getState() {
    return { lifecycle: 'streaming' as const, errorMessage: null, generation: 1, viewport: { width: 1600, height: 1000 } }
  }
  async createRunnerPage(runnerId: RunnerId): Promise<Page> {
    if (this.failNext) { this.failNext = false; throw new Error('failed') }
    const page = { runnerId, isClosed: () => false } as unknown as Page
    this.pages.set(runnerId, page)
    return page
  }
  async closeRunnerPage(runnerId: RunnerId) { this.pages.delete(runnerId); this.closed.push(runnerId) }
  getAutomationPage(runnerId: RunnerId) { return this.pages.get(runnerId) ?? null }
  getAutomationSessionIdentity(runnerId: RunnerId) {
    return this.pages.has(runnerId) ? { browserGeneration: 1, pageGeneration: Number(runnerId.at(-1)) } : null
  }
  getRunnerPageGeneration(runnerId: RunnerId) { return this.pages.has(runnerId) ? Number(runnerId.at(-1)) : 0 }
  onAutomationSessionInvalidated(listener: (reason: string, runnerId: RunnerId | null) => void) {
    this.invalidationListeners.add(listener)
    return () => this.invalidationListeners.delete(listener)
  }
  invalidate(runnerId: RunnerId | null) {
    for (const listener of this.invalidationListeners) listener('session invalidated', runnerId)
  }
  async selectRunnerStream(runnerId: RunnerId | null) { this.streams.push(runnerId); return runnerId === null || this.pages.has(runnerId) }
}

class FakeWorkflow implements RunnerWorkflow {
  snapshot = emptySnapshot()
  disposed = false
  getSnapshot() { return this.snapshot }
  async start() { this.snapshot = { ...this.snapshot, state: 'running', total: 1 }; return this.snapshot }
  async pause() { this.snapshot = { ...this.snapshot, state: 'paused' }; return this.snapshot }
  async resume() { this.snapshot = { ...this.snapshot, state: 'running' }; return this.snapshot }
  async stop() { this.snapshot = { ...this.snapshot, state: 'completed' }; return this.snapshot }
  async dispose() { this.disposed = true }
}

function fixture() {
  const browser = new FakeBrowser()
  const workflows: FakeWorkflow[] = []
  const accesses: RunnerBrowserAccess[] = []
  const snapshotCallbacks: Array<(snapshot: EolRunnerSnapshot) => void> = []
  const events: Array<{ channel: string; value: unknown }> = []
  const manager = new RunnerManager(
    { isDestroyed: () => false, webContents: { send: (channel, value) => events.push({ channel, value }) } },
    browser,
    (access, _label, onSnapshot) => {
      accesses.push(access)
      snapshotCallbacks.push(onSnapshot)
      const workflow = new FakeWorkflow()
      workflows.push(workflow)
      return workflow
    },
  )
  return { manager, browser, workflows, accesses, snapshotCallbacks, events }
}

test('production manager creates distinct pages in slots 1-3 and rejects a fourth', async () => {
  const { manager, browser } = fixture()
  for (const slot of [1, 2, 3] as const) {
    const result = await manager.create()
    assert.equal(result.ok && result.value.slot, slot)
  }
  assert.equal(new Set(browser.pages.values()).size, 3)
  const fourth = await manager.create()
  assert.equal(fourth.ok, false)
  if (!fourth.ok) assert.equal(fourth.error.code, 'capacity-reached')
})

test('failed creation consumes no number and closing Runner 2 reuses slot 2', async () => {
  const { manager, browser, events } = fixture()
  browser.failNext = true
  assert.equal((await manager.create()).ok, false)
  assert.equal((await manager.create()).ok, true)
  assert.equal((await manager.create()).ok, true)
  await manager.close('runner-2')
  const replacement = await manager.create()
  assert.equal(replacement.ok && replacement.value.runnerId, 'runner-2')
  if (!replacement.ok) return
  const removed = events.find((event) => event.channel.endsWith(':removed'))
  assert.deepEqual(removed?.value, {
    runnerId: 'runner-2',
    sessionGeneration: replacement.value.sessionGeneration - 1,
  })
  assert.notEqual(replacement.value.sessionGeneration, 2)
})

test('commands, workflow state, diagnostics, and cleanup remain runner scoped', async () => {
  const { manager, browser, workflows } = fixture()
  await manager.create()
  await manager.create()
  await manager.start('runner-2', {})
  const first = manager.get('runner-1')
  const second = manager.get('runner-2')
  assert.equal(first.ok && first.value.workflow.state, 'idle')
  assert.equal(second.ok && second.value.workflow.state, 'running')
  assert.notEqual(workflows[0]?.snapshot.diagnostics, workflows[1]?.snapshot.diagnostics)
  await manager.close('runner-2')
  assert.ok(browser.pages.has('runner-1'))
  assert.equal(workflows[0]?.disposed, false)
  assert.equal(workflows[1]?.disposed, true)
})

test('only selected runner streams and global disposal closes every session', async () => {
  const { manager, browser } = fixture()
  await manager.create(); await manager.create(); await manager.create()
  assert.equal(await manager.selectStream('runner-2'), true)
  assert.deepEqual(browser.streams, ['runner-2'])
  await manager.dispose()
  assert.deepEqual(browser.closed.sort(), ['runner-1', 'runner-2', 'runner-3'])
  assert.equal(manager.list().length, 0)
})

test('stale workflow callbacks cannot publish over a reused runner slot', async () => {
  const { manager, snapshotCallbacks, events } = fixture()
  await manager.create()
  const staleCallback = snapshotCallbacks[0]
  await manager.close('runner-1')
  const replacement = await manager.create()
  assert.equal(replacement.ok, true)
  events.length = 0
  staleCallback?.(emptySnapshot())
  assert.equal(events.length, 0)
  snapshotCallbacks[1]?.(emptySnapshot())
  assert.equal(events.length, 1)
  assert.equal(
    (events[0]?.value as { sessionGeneration?: number }).sessionGeneration,
    replacement.ok ? replacement.value.sessionGeneration : -1,
  )
})

test('shared invalidation reaches every runner while page invalidation stays scoped', async () => {
  const { manager, browser, accesses } = fixture()
  await manager.create()
  await manager.create()
  const counts = [0, 0]
  accesses[0]?.onAutomationSessionInvalidated(() => { counts[0] += 1 })
  accesses[1]?.onAutomationSessionInvalidated(() => { counts[1] += 1 })
  browser.invalidate('runner-2')
  assert.deepEqual(counts, [0, 1])
  browser.invalidate(null)
  assert.deepEqual(counts, [1, 2])
})

function emptySnapshot(): EolRunnerSnapshot {
  return {
    state: 'idle', mode: 'EOL', modeLabel: 'EOL', assets: [], currentAssetId: null,
    total: 0, completed: 0, skipped: 0, needsReview: 0,
    errorMessage: null, diagnostics: [],
  }
}
