import assert from 'node:assert/strict'
import test from 'node:test'
import type { HistoryResponse } from '../types/history.ts'
import {
  buildFilteredHistoryRequest,
  canCopyHistoryAssetIds,
  copyFilteredAssetIds,
  formatAssetIdsForClipboard,
  normalizeHistoryDates,
  resolveActiveHistoryRange,
  selectDateWithinRange,
} from './historyView.ts'

process.env.TZ = 'America/Los_Angeles'

const health = { available: true, message: null }
const recordedDates = [
  { date: '2026-08-10', total: 4 },
  { date: '2026-08-09', total: 3 },
  { date: '2026-08-05', total: 2 },
  { date: '2026-08-03', total: 1 },
  { date: '2026-08-02', total: 6 },
  { date: '2026-07-27', total: 5 },
]

test('This Week sidebar uses the current Monday range and sorts newest first', () => {
  const range = resolveActiveHistoryRange(
    'this_week',
    '',
    '',
    new Date(2026, 7, 5, 12),
  )
  assert.deepEqual(normalizeHistoryDates(recordedDates, range), [
    { date: '2026-08-09', total: 3 },
    { date: '2026-08-05', total: 2 },
    { date: '2026-08-03', total: 1 },
  ])
})

test('Last Week sidebar uses the previous Monday through Sunday', () => {
  const range = resolveActiveHistoryRange(
    'last_week',
    '',
    '',
    new Date(2026, 7, 5, 12),
  )
  assert.deepEqual(
    normalizeHistoryDates(recordedDates, range).map((item) => item.date),
    ['2026-08-02', '2026-07-27'],
  )
})

test('custom range restricts dates and clears an out-of-range selection', () => {
  const range = resolveActiveHistoryRange(
    'custom',
    '2026-08-04',
    '2026-08-08',
  )
  assert.deepEqual(normalizeHistoryDates(recordedDates, range), [
    { date: '2026-08-05', total: 2 },
  ])
  assert.equal(selectDateWithinRange('2026-08-05', range), '2026-08-05')
  assert.equal(selectDateWithinRange('2026-08-09', range), null)
})

test('active ranges preserve shared month, year, and DST calendar boundaries', () => {
  assert.deepEqual(
    resolveActiveHistoryRange('this_week', '', '', new Date(2026, 2, 1, 12)),
    { preset: 'this_week', startDate: '2026-02-23', endDate: '2026-03-01' },
  )
  assert.deepEqual(
    resolveActiveHistoryRange('this_week', '', '', new Date(2026, 0, 1, 12)),
    { preset: 'this_week', startDate: '2025-12-29', endDate: '2026-01-04' },
  )
  assert.deepEqual(
    resolveActiveHistoryRange('this_week', '', '', new Date(2026, 2, 8, 12)),
    { preset: 'this_week', startDate: '2026-03-02', endDate: '2026-03-08' },
  )
})

test('All Dates restores the active range and selected dates retain every filter', () => {
  const range = resolveActiveHistoryRange('custom', '2026-08-01', '2026-08-09')
  const filters = {
    search: 'IT29',
    mode: 'MRI_FAIL' as const,
    outcome: 'needs_review' as const,
  }
  assert.deepEqual(buildFilteredHistoryRequest(range, null, filters), {
    preset: 'custom',
    startDate: '2026-08-01',
    endDate: '2026-08-09',
    ...filters,
  })
  assert.deepEqual(buildFilteredHistoryRequest(range, '2026-08-05', filters), {
    preset: 'custom',
    startDate: '2026-08-05',
    endDate: '2026-08-05',
    ...filters,
  })
})

test('copy formatting normalizes and deduplicates while preserving first order', () => {
  assert.deepEqual(
    formatAssetIdsForClipboard([' it2835739 ', 'IT9362459', 'it2835739', 'IT9390331']),
    {
      text: 'IT2835739\nIT9362459\nIT9390331',
      count: 3,
    },
  )
})

test('copy writes every returned ID through the injected clipboard boundary', async () => {
  let copied = ''
  const result = await copyFilteredAssetIds(
    async () => assetIdsResponse(['IT2835739', 'IT9362459']),
    async (text) => { copied = text; return true },
  )
  assert.deepEqual(result, { ok: true, count: 2, message: '2 Asset IDs copied' })
  assert.equal(copied, 'IT2835739\nIT9362459')
})

test('zero results do not invoke the clipboard', async () => {
  assert.equal(canCopyHistoryAssetIds(0, false, false, false), false)
  assert.equal(canCopyHistoryAssetIds(1, false, false, false), true)
  let writes = 0
  const result = await copyFilteredAssetIds(
    async () => assetIdsResponse([]),
    async () => { writes += 1; return true },
  )
  assert.equal(result.ok, false)
  assert.equal(writes, 0)
})

test('incomplete exports are refused instead of silently copying one bounded page', async () => {
  let writes = 0
  const response = assetIdsResponse(['IT2835739'])
  if (response.ok) response.data.complete = false
  const result = await copyFilteredAssetIds(
    async () => response,
    async () => { writes += 1; return true },
  )
  assert.equal(result.message, 'Too many matching assets. Narrow the History filters before copying.')
  assert.equal(writes, 0)
})

test('clipboard failures stay sanitized and do not write diagnostics', async () => {
  const diagnostics: string[] = []
  const result = await copyFilteredAssetIds(
    async () => assetIdsResponse(['IT2835739']),
    async () => { throw new Error('/Users/operator/internal IPC failure') },
  )
  assert.deepEqual(result, {
    ok: false,
    count: 0,
    message: 'Asset IDs could not be copied.',
  })
  assert.deepEqual(diagnostics, [])
})

function assetIdsResponse(
  assetIds: string[],
): HistoryResponse<{ assetIds: string[]; complete: boolean }> {
  return { ok: true, data: { assetIds, complete: true }, health }
}
