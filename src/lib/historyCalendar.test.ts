import assert from 'node:assert/strict'
import test from 'node:test'
import { currentLocalWeek } from '../../electron/history/historyValidation.ts'
import {
  localRangeUtcBounds,
  resolveHistoryPresetRange,
} from './historyCalendar.ts'

process.env.TZ = 'America/Los_Angeles'

test('This Week begins Monday and ends Sunday', () => {
  const range = resolveHistoryPresetRange('this_week', new Date(2026, 7, 5, 12))
  assert.equal(range.startDate, '2026-08-03')
  assert.equal(range.endDate, '2026-08-09')
})

test('Last Week covers the previous Monday through Sunday', () => {
  const range = resolveHistoryPresetRange('last_week', new Date(2026, 7, 5, 12))
  assert.equal(range.startDate, '2026-07-27')
  assert.equal(range.endDate, '2026-08-02')
})

test('Monday remains in the week beginning that day', () => {
  const range = resolveHistoryPresetRange('this_week', new Date(2026, 7, 3, 12))
  assert.equal(range.startDate, '2026-08-03')
  assert.equal(range.endDate, '2026-08-09')
})

test('Sunday remains in the week beginning six days earlier', () => {
  const range = resolveHistoryPresetRange('this_week', new Date(2026, 7, 9, 12))
  assert.equal(range.startDate, '2026-08-03')
  assert.equal(range.endDate, '2026-08-09')
})

test('calendar weeks cross month boundaries', () => {
  const range = resolveHistoryPresetRange('this_week', new Date(2026, 2, 1, 12))
  assert.equal(range.startDate, '2026-02-23')
  assert.equal(range.endDate, '2026-03-01')
})

test('calendar weeks cross year boundaries', () => {
  const range = resolveHistoryPresetRange('this_week', new Date(2026, 0, 1, 12))
  assert.equal(range.startDate, '2025-12-29')
  assert.equal(range.endDate, '2026-01-04')
})

test('UTC query bounds preserve local midnights across daylight saving time', () => {
  const range = resolveHistoryPresetRange('this_week', new Date(2026, 2, 4, 12))
  const bounds = localRangeUtcBounds(range.startDate, range.endDate)
  assert.equal(range.startDate, '2026-03-02')
  assert.equal(range.endDate, '2026-03-08')
  assert.equal(Date.parse(bounds.end) - Date.parse(bounds.start), 167 * 60 * 60 * 1000)
})

test('Dashboard and History use identical This Week boundaries', () => {
  const now = new Date(2026, 7, 5, 12)
  const history = resolveHistoryPresetRange('this_week', now)
  const dashboard = currentLocalWeek(now)
  assert.deepEqual(dashboard, {
    startDate: history.startDate,
    endDate: history.endDate,
    start: history.startUtc,
    end: history.endUtc,
  })
})
