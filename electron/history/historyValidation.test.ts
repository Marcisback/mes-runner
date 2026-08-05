import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentLocalWeek,
  localDateBounds,
  parseHistoryAssetIdsRequest,
  parseHistoryDateRequest,
  parseHistoryDatesRequest,
  parseHistoryRangeRequest,
} from './historyValidation.ts'
import { resolveHistoryPresetRange } from '../../src/lib/historyCalendar.ts'

test('validates bounded date, range, filter, and pagination inputs', () => {
  assert.ok(parseHistoryDateRequest({ date: '2026-08-05', limit: 100, offset: 0 }))
  assert.ok(parseHistoryRangeRequest({
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    mode: 'MRI_FAIL',
    outcome: 'needs_review',
    search: ' it29 ',
  }))
  assert.equal(parseHistoryDateRequest({ date: '2026-02-30' }), null)
  assert.equal(parseHistoryRangeRequest({ startDate: '2026-08-05', endDate: '2026-08-01' }), null)
  assert.equal(parseHistoryRangeRequest({ startDate: '2025-01-01', endDate: '2026-08-01' }), null)
  assert.equal(parseHistoryRangeRequest({ startDate: '2026-08-01', endDate: '2026-08-02', mode: 'SQL' }), null)
  assert.equal(parseHistoryRangeRequest({ startDate: '2026-08-01', endDate: '2026-08-02', limit: 501 }), null)
})

test('validates typed calendar presets and preserves custom ranges', () => {
  const thisWeek = resolveHistoryPresetRange('this_week')
  const lastWeek = resolveHistoryPresetRange('last_week')
  assert.ok(parseHistoryRangeRequest({
    preset: 'this_week',
    startDate: thisWeek.startDate,
    endDate: thisWeek.endDate,
  }))
  assert.ok(parseHistoryRangeRequest({
    preset: 'last_week',
    startDate: lastWeek.startDate,
    endDate: lastWeek.endDate,
  }))
  assert.ok(parseHistoryRangeRequest({
    preset: 'custom',
    startDate: '2026-07-30',
    endDate: '2026-08-05',
  }))
  assert.equal(parseHistoryRangeRequest({
    preset: 'last7',
    startDate: lastWeek.startDate,
    endDate: lastWeek.endDate,
  }), null)
  assert.equal(parseHistoryRangeRequest({
    preset: 'this_week',
    startDate: lastWeek.startDate,
    endDate: lastWeek.endDate,
  }), null)
})

test('validates range-scoped date summaries and asset-ID export filters', () => {
  const range = resolveHistoryPresetRange('this_week')
  assert.ok(parseHistoryDatesRequest({
    preset: 'this_week',
    startDate: range.startDate,
    endDate: range.endDate,
  }))
  assert.ok(parseHistoryAssetIdsRequest({
    preset: 'custom',
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    search: 'it29',
    mode: 'MRI_FAIL',
    outcome: 'needs_review',
  }))
  assert.equal(parseHistoryDatesRequest({
    startDate: '2026-08-05',
    endDate: '2026-08-01',
  }), null)
  assert.equal(parseHistoryAssetIdsRequest({
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    mode: 'SQL',
  }), null)
})

test('current week is Monday through Sunday in local calendar time', () => {
  const monday = currentLocalWeek(new Date(2026, 7, 3, 12))
  const sunday = currentLocalWeek(new Date(2026, 7, 9, 12))
  assert.equal(monday.startDate, '2026-08-03')
  assert.equal(monday.endDate, '2026-08-09')
  assert.deepEqual(sunday, monday)
})

test('local date boundaries convert local midnight to UTC storage bounds', () => {
  const bounds = localDateBounds('2026-08-05')
  assert.equal(new Date(bounds.start).getDate(), 5)
  assert.equal(new Date(bounds.end).getDate(), 6)
  assert.equal(Date.parse(bounds.end) - Date.parse(bounds.start), 86_400_000)
})
