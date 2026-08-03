import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_LOG_FILTERS,
  filterLogEntries,
  hasActiveFilters,
  normalizeLogEntries,
  sortLogEntriesNewestFirst,
  summarizeLog,
  type AssetLogEntry,
} from './logs.ts'
import type { EolAssetResult, EolRunnerSnapshot } from '../types/eolRunner.ts'

const RUNNER_ID = 'runner-1'
const RUNNER_NAME = 'Runner 1'

function asset(
  id: string,
  state: EolAssetResult['state'],
  reason: string | null = null,
  timestamp: string | null = null,
): EolAssetResult {
  return {
    id,
    state,
    reason,
    errorDetails:
      timestamp === null
        ? null
        : {
            workflowMode: 'MRI',
            lastCompletedStep: 'wipe-pass',
            failingStep: 'scan',
            errorClass: 'NeedsReviewError',
            sanitizedMessage: reason ?? 'review',
            timestamp,
          },
  }
}

function snapshot(overrides: Partial<EolRunnerSnapshot> = {}): EolRunnerSnapshot {
  return {
    state: 'completed',
    mode: 'MRI',
    modeLabel: 'MRI',
    assets: [],
    currentAssetId: null,
    total: 0,
    completed: 0,
    skipped: 0,
    needsReview: 0,
    errorMessage: null,
    diagnostics: [],
    ...overrides,
  }
}

function normalize(snap: EolRunnerSnapshot): AssetLogEntry[] {
  return normalizeLogEntries(snap, RUNNER_ID, RUNNER_NAME)
}

test('normalizes completed, skipped, and needs-review assets only', () => {
  const entries = normalize(
    snapshot({
      assets: [
        asset('IT001', 'completed'),
        asset('IT002', 'skipped', 'no-scan'),
        asset('IT003', 'needs-review', 'display-check'),
        asset('IT004', 'pending'),
        asset('IT005', 'running'),
      ],
    }),
  )

  assert.deepEqual(
    entries.map((e) => e.assetId),
    ['IT001', 'IT002', 'IT003'],
  )
  assert.deepEqual(
    entries.map((e) => e.result),
    ['completed', 'skipped', 'needs-review'],
  )
  assert.equal(entries[0].mode, 'MRI')
  assert.equal(entries[0].runnerName, RUNNER_NAME)
  assert.equal(entries[1].reason, 'no-scan')
})

test('needs-review normalization carries sanitized details', () => {
  const [entry] = normalize(
    snapshot({
      assets: [asset('IT003', 'needs-review', 'display-check', '2026-08-03T09:32:00Z')],
    }),
  )

  assert.equal(entry.result, 'needs-review')
  assert.ok(entry.details && entry.details.includes('IT003'))
  assert.ok(entry.detailsForCopy && entry.detailsForCopy.includes('[ASSET]'))
})

test('timestamps use real event time, or stay unavailable (never faked)', () => {
  const withDiag = normalize(
    snapshot({
      assets: [asset('IT001', 'completed')],
      diagnostics: [
        {
          id: 1,
          timestamp: '2026-08-03T09:40:00Z',
          severity: 'info',
          runnerState: 'running',
          workflowMode: 'MRI',
          currentStep: null,
          message: 'Asset completed.',
          errorClass: null,
          reason: null,
          assetId: 'IT001',
        },
      ],
    }),
  )
  assert.equal(withDiag[0].timestamp, Date.parse('2026-08-03T09:40:00Z'))

  const withoutTime = normalize(snapshot({ assets: [asset('IT001', 'completed')] }))
  assert.equal(withoutTime[0].timestamp, undefined)
  assert.equal(withoutTime[0].reason, undefined)
})

test('sorts newest first, undated entries last (stable)', () => {
  const entries: AssetLogEntry[] = [
    { id: 'a', assetId: 'A', mode: 'MRI', runnerId: RUNNER_ID, runnerName: RUNNER_NAME, result: 'completed', timestamp: 100 },
    { id: 'b', assetId: 'B', mode: 'MRI', runnerId: RUNNER_ID, runnerName: RUNNER_NAME, result: 'completed' },
    { id: 'c', assetId: 'C', mode: 'MRI', runnerId: RUNNER_ID, runnerName: RUNNER_NAME, result: 'completed', timestamp: 300 },
    { id: 'd', assetId: 'D', mode: 'MRI', runnerId: RUNNER_ID, runnerName: RUNNER_NAME, result: 'completed' },
  ]

  assert.deepEqual(
    sortLogEntriesNewestFirst(entries).map((e) => e.id),
    ['c', 'a', 'b', 'd'],
  )
})

test('asset-ID search is trimmed, case-insensitive, and partial', () => {
  const entries = normalize(
    snapshot({ assets: [asset('IT8109038', 'completed'), asset('IT8109027', 'skipped')] }),
  )

  // Whitespace-trimmed, case-insensitive, partial match.
  assert.deepEqual(
    filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, search: '  it810903 ' }).map(
      (e) => e.assetId,
    ),
    ['IT8109038'],
  )
  assert.deepEqual(
    filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, search: 'it8109027' }).map(
      (e) => e.assetId,
    ),
    ['IT8109027'],
  )
})

test('mode, result, and runner filters each narrow the list', () => {
  const base = normalize(
    snapshot({
      mode: 'MRI',
      assets: [asset('IT001', 'completed'), asset('IT002', 'needs-review', 'x')],
    }),
  )

  assert.equal(
    filterLogEntries(base, { ...EMPTY_LOG_FILTERS, result: 'needs-review' }).length,
    1,
  )
  assert.equal(
    filterLogEntries(base, { ...EMPTY_LOG_FILTERS, mode: 'EOL' }).length,
    0,
  )
  assert.equal(
    filterLogEntries(base, { ...EMPTY_LOG_FILTERS, mode: 'MRI' }).length,
    2,
  )
  assert.equal(
    filterLogEntries(base, { ...EMPTY_LOG_FILTERS, runnerId: RUNNER_ID }).length,
    2,
  )
  assert.equal(
    filterLogEntries(base, { ...EMPTY_LOG_FILTERS, runnerId: 'runner-2' }).length,
    0,
  )
})

test('filters combine predictably', () => {
  const base = normalize(
    snapshot({
      assets: [
        asset('IT001', 'completed'),
        asset('IT002', 'needs-review', 'x'),
        asset('IT003', 'needs-review', 'y'),
      ],
    }),
  )

  const filtered = filterLogEntries(base, {
    search: 'IT00',
    mode: 'MRI',
    result: 'needs-review',
    runnerId: RUNNER_ID,
  })
  assert.deepEqual(filtered.map((e) => e.assetId), ['IT002', 'IT003'])
})

test('clear filters (empty) returns every entry; no-results is empty', () => {
  const base = normalize(
    snapshot({ assets: [asset('IT001', 'completed'), asset('IT002', 'skipped')] }),
  )

  assert.equal(filterLogEntries(base, EMPTY_LOG_FILTERS).length, 2)
  assert.equal(hasActiveFilters(EMPTY_LOG_FILTERS), false)
  assert.equal(
    filterLogEntries(base, { ...EMPTY_LOG_FILTERS, search: 'NOPE' }).length,
    0,
  )
  assert.equal(hasActiveFilters({ ...EMPTY_LOG_FILTERS, search: 'x' }), true)
})

test('needs-review navigation filter yields only needs-review rows', () => {
  const base = normalize(
    snapshot({
      assets: [
        asset('IT001', 'completed'),
        asset('IT002', 'needs-review', 'x'),
        asset('IT003', 'skipped'),
      ],
    }),
  )

  const needsReview = filterLogEntries(base, {
    ...EMPTY_LOG_FILTERS,
    result: 'needs-review',
  })
  assert.deepEqual(needsReview.map((e) => e.assetId), ['IT002'])
})

test('summary counts by result', () => {
  const base = normalize(
    snapshot({
      assets: [
        asset('IT001', 'completed'),
        asset('IT002', 'completed'),
        asset('IT003', 'skipped'),
        asset('IT004', 'needs-review', 'x'),
      ],
    }),
  )

  assert.deepEqual(summarizeLog(base), {
    total: 4,
    completed: 2,
    skipped: 1,
    needsReview: 1,
  })
})

test('re-normalizing the same snapshot yields identical stable ids (no duplicates)', () => {
  const snap = snapshot({ assets: [asset('IT001', 'completed'), asset('IT002', 'skipped')] })
  const first = normalize(snap)
  const second = normalize(snap)

  assert.deepEqual(
    first.map((e) => e.id),
    second.map((e) => e.id),
  )
  assert.deepEqual(first.map((e) => e.id), ['runner-1:IT001', 'runner-1:IT002'])
  assert.equal(new Set(first.map((e) => e.id)).size, first.length)
})
