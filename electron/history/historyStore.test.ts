import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import test from 'node:test'
import { LocalHistoryStore } from './historyStore.ts'
import { localDateBounds, parseHistoryRangeRequest } from './historyValidation.ts'

async function fixture(t: test.TestContext): Promise<{ store: LocalHistoryStore; file: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'mes-runner-history-'))
  const file = path.join(directory, 'history.sqlite')
  const store = new LocalHistoryStore(file)
  await store.initialize()
  t.after(async () => {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { store, file }
}

test('first launch creates the database and repeated migration is idempotent', async (t) => {
  const { store, file } = await fixture(t)
  assert.equal(store.getHealth().available, true)
  await store.close()
  const reopened = new LocalHistoryStore(file)
  await reopened.initialize()
  assert.equal(reopened.getHealth().available, true)
  await reopened.close()
  const version = await queryOne(file, 'PRAGMA user_version')
  assert.equal(version.user_version, 2)
})

test('version 1 history migrates additively and remains readable', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mes-runner-history-v1-'))
  const file = path.join(directory, 'history.sqlite')
  const database = new sqlite3.Database(file)
  await new Promise<void>((resolve, reject) => {
    database.exec(`
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE asset_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        asset_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        UNIQUE (run_id, asset_id)
      );
      PRAGMA user_version = 1;
    `, (error) => error === null ? resolve() : reject(error))
  })
  await new Promise<void>((resolve) => database.close(() => resolve()))
  const store = new LocalHistoryStore(file)
  await store.initialize()
  t.after(async () => {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  })
  assert.equal(store.getHealth().available, true)
  const runId = await store.createRun('MRI_FAIL', '2026-08-05T10:00:00.000Z', 'Runner 3')
  assert.ok(runId !== null)
  assert.deepEqual(
    await queryOne(file, 'SELECT runner_label FROM runs WHERE id = ?', [runId]),
    { runner_label: 'Runner 3' },
  )
})

test('a future schema version fails closed with sanitized health', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mes-runner-history-future-'))
  const file = path.join(directory, 'history.sqlite')
  const database = new sqlite3.Database(file)
  await new Promise<void>((resolve, reject) => {
    database.exec('PRAGMA user_version = 99', (error) =>
      error === null ? resolve() : reject(error))
  })
  await new Promise<void>((resolve) => database.close(() => resolve()))
  const store = new LocalHistoryStore(file)
  await store.initialize()
  t.after(async () => {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  })
  assert.deepEqual(store.getHealth(), {
    available: false,
    message: 'Local history is unavailable.',
  })
})

test('creates and finalizes a run', async (t) => {
  const { store, file } = await fixture(t)
  const id = await store.createRun('MRI', '2026-08-05T10:00:00.000Z')
  assert.ok(id !== null)
  assert.equal(await store.finalizeRun(id, 'completed', '2026-08-05T10:10:00.000Z'), true)
  const row = await queryOne(file, 'SELECT status, finished_at FROM runs WHERE id = ?', [id])
  assert.deepEqual(row, { status: 'completed', finished_at: '2026-08-05T10:10:00.000Z' })
})

test('attributes concurrent runs to their owning runner label', async (t) => {
  const { store, file } = await fixture(t)
  const [first, second] = await Promise.all([
    store.createRun('MRI', '2026-08-05T10:00:00.000Z', 'Runner 1'),
    store.createRun('EOL', '2026-08-05T10:00:00.000Z', 'Runner 2'),
  ])
  assert.ok(first !== null && second !== null)
  const rows = await queryAll(file, 'SELECT mode, runner_label FROM runs ORDER BY runner_label')
  assert.deepEqual(rows, [
    { mode: 'MRI', runner_label: 'Runner 1' },
    { mode: 'EOL', runner_label: 'Runner 2' },
  ])
})

test('persists completed and needs-review results but duplicate finalization is idempotent', async (t) => {
  const { store } = await fixture(t)
  const runId = await store.createRun('MRI', '2026-08-05T10:00:00.000Z')
  assert.ok(runId !== null)
  assert.equal(await store.recordAssetResult({ runId, assetId: 'IT001', mode: 'MRI', outcome: 'completed', reason: null, startedAt: '2026-08-05T10:00:00.000Z', finishedAt: '2026-08-05T10:01:00.000Z' }), true)
  assert.equal(await store.recordAssetResult({ runId, assetId: 'IT002', mode: 'MRI', outcome: 'needs_review', reason: 'sanitized reason', startedAt: '2026-08-05T10:02:00.000Z', finishedAt: '2026-08-05T10:03:00.000Z' }), true)
  assert.equal(await store.recordAssetResult({ runId, assetId: 'IT001', mode: 'MRI', outcome: 'completed', reason: null, startedAt: '2026-08-05T10:00:00.000Z', finishedAt: '2026-08-05T10:01:00.000Z' }), false)
  const request = parseHistoryRangeRequest({ startDate: '2026-08-05', endDate: '2026-08-05' })
  assert.ok(request)
  const response = await store.getHistoryRange(request)
  assert.equal(response.ok && response.data.total, 2)
  assert.equal(response.ok && response.data.needsReview, 1)
})

test('weekly totals include completed and needs-review with correct mode breakdown', async (t) => {
  const { store } = await fixture(t)
  const now = new Date(2026, 7, 5, 12)
  const finishedAt = new Date(2026, 7, 5, 10).toISOString()
  for (const [index, mode, outcome] of [
    [1, 'MRI', 'completed'],
    [2, 'MRI_FAIL', 'needs_review'],
    [3, 'EOL', 'completed'],
  ] as const) {
    const runId = await store.createRun(mode, finishedAt)
    assert.ok(runId !== null)
    await store.recordAssetResult({ runId, assetId: `IT00${index}`, mode, outcome, reason: outcome === 'needs_review' ? 'review' : null, startedAt: finishedAt, finishedAt })
  }
  const response = await store.getWeeklySummary(now)
  assert.ok(response.ok)
  assert.equal(response.data.total, 3)
  assert.equal(response.data.needsReview, 1)
  assert.deepEqual(response.data.byMode, { MRI: 1, MRI_FAIL: 1, EOL: 1 })
})

test('date history, search, mode, outcome, and local boundaries are applied', async (t) => {
  const { store } = await fixture(t)
  const bounds = localDateBounds('2026-08-05')
  const inside = new Date(Date.parse(bounds.start) + 60_000).toISOString()
  const outside = new Date(Date.parse(bounds.end) + 60_000).toISOString()
  const firstRun = await store.createRun('MRI_FAIL', inside)
  const secondRun = await store.createRun('EOL', outside)
  assert.ok(firstRun !== null && secondRun !== null)
  await store.recordAssetResult({ runId: firstRun, assetId: 'IT2985567', mode: 'MRI_FAIL', outcome: 'needs_review', reason: 'review', startedAt: inside, finishedAt: inside })
  await store.recordAssetResult({ runId: secondRun, assetId: 'IT9999999', mode: 'EOL', outcome: 'completed', reason: null, startedAt: outside, finishedAt: outside })
  const request = parseHistoryRangeRequest({ startDate: '2026-08-05', endDate: '2026-08-05', search: '2985', mode: 'MRI_FAIL', outcome: 'needs_review' })
  assert.ok(request)
  const response = await store.getHistoryRange(request)
  assert.ok(response.ok)
  assert.equal(response.data.total, 1)
  assert.equal(response.data.results[0]?.assetId, 'IT2985567')
  const dates = await store.getHistoryDates()
  assert.ok(dates.ok)
  assert.equal(dates.data.length, 2)
})

test('change notification fires once only for a newly inserted result', async (t) => {
  const { store } = await fixture(t)
  let changes = 0
  store.onChanged(() => { changes += 1 })
  const runId = await store.createRun('EOL', '2026-08-05T10:00:00.000Z')
  assert.ok(runId !== null)
  const input = { runId, assetId: 'IT001', mode: 'EOL' as const, outcome: 'completed' as const, reason: null, startedAt: '2026-08-05T10:00:00.000Z', finishedAt: '2026-08-05T10:01:00.000Z' }
  await store.recordAssetResult(input)
  await store.recordAssetResult(input)
  assert.equal(changes, 1)
})

test('database failures are contained and return unavailable health', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mes-runner-history-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LocalHistoryStore(directory)
  await store.initialize()
  assert.equal(store.getHealth().available, false)
  assert.equal(await store.createRun('MRI', new Date().toISOString()), null)
  const response = await store.getWeeklySummary()
  assert.equal(response.ok, false)
})

function queryOne(file: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(file)
    database.get(sql, params, (error, row: Record<string, unknown>) => {
      database.close()
      if (error === null) resolve(row)
      else reject(error)
    })
  })
}

function queryAll(file: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(file)
    database.all(sql, params, (error, rows: Record<string, unknown>[]) => {
      database.close()
      if (error === null) resolve(rows)
      else reject(error)
    })
  })
}
