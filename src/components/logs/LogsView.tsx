import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../../state/engineContext'
import { useHistory } from '../../state/historyContext'
import { useWorkspace } from '../../state/workspaceContext'
import { formatDiagnostics } from '../../lib/diagnostics'
import { resolveHistoryPresetRange } from '../../lib/historyCalendar'
import {
  buildFilteredHistoryRequest,
  canCopyHistoryAssetIds,
  copyFilteredAssetIds,
  normalizeHistoryDates,
  resolveActiveHistoryRange,
  selectDateWithinRange,
} from '../../lib/historyView'
import type {
  HistoryDateSummary,
  HistoryOutcome,
  HistoryRangePreset,
  HistoryRangeResult,
  HistoryResult,
} from '../../types/history'
import type { WorkflowMode } from '../../types/eolRunner'
import styles from './LogsView.module.css'

type View = 'history' | 'diagnostics'
type ModeFilter = WorkflowMode | 'all'
type OutcomeFilter = HistoryOutcome | 'all'

const DEFAULT_HISTORY_RANGE = resolveHistoryPresetRange('this_week')

export function LogsView() {
  const { runners } = useEngine()
  const { health, revision } = useHistory()
  const { logsFilterIntent } = useWorkspace()
  const [view, setView] = useState<View>('history')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [preset, setPreset] = useState<HistoryRangePreset>('this_week')
  const [customStart, setCustomStart] = useState(DEFAULT_HISTORY_RANGE.startDate)
  const [customEnd, setCustomEnd] = useState(DEFAULT_HISTORY_RANGE.endDate)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<ModeFilter>('all')
  const [outcome, setOutcome] = useState<OutcomeFilter>(
    logsFilterIntent === 'needs-review' ? 'needs_review' : 'all',
  )
  const [history, setHistory] = useState<HistoryRangeResult | null>(null)
  const [dates, setDates] = useState<HistoryDateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [copying, setCopying] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)

  const activeRange = useMemo(
    () => resolveActiveHistoryRange(preset, customStart, customEnd),
    [customEnd, customStart, preset],
  )
  const activeSelectedDate = selectDateWithinRange(selectedDate, activeRange)
  const filteredRequest = useMemo(
    () => buildFilteredHistoryRequest(activeRange, activeSelectedDate, {
      search,
      mode,
      outcome,
    }),
    [activeRange, activeSelectedDate, mode, outcome, search],
  )

  useEffect(() => {
    if (selectedDate !== null && activeSelectedDate === null) setSelectedDate(null)
  }, [activeSelectedDate, selectedDate])

  useEffect(() => {
    if (copyFeedback === null) return
    const timeout = window.setTimeout(() => setCopyFeedback(null), 3_000)
    return () => window.clearTimeout(timeout)
  }, [copyFeedback])

  useEffect(() => {
    let active = true
    async function load(): Promise<void> {
      if (!health.available) {
        setLoading(false)
        setError(health.message ?? 'Local history is unavailable.')
        return
      }
      setLoading(true)
      let response
      let datesResponse
      try {
        [datesResponse, response] = await Promise.all([
          window.mesHistory.getHistoryDates(activeRange),
          window.mesHistory.getHistoryRange({
            ...filteredRequest,
            limit: 500,
            offset: 0,
          }),
        ])
      } catch {
        if (active) {
          setHistory(null)
          setDates([])
          setError('Local history is unavailable.')
          setLoading(false)
        }
        return
      }
      if (!active) return
      if (!response.ok) {
        setHistory(null)
        setDates([])
        setError(response.error)
      } else if (!datesResponse.ok) {
        setHistory(null)
        setDates([])
        setError(datesResponse.error)
      } else {
        setHistory(response.data)
        setDates(normalizeHistoryDates(datesResponse.data, activeRange))
        setError(null)
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [activeRange, filteredRequest, health, revision])

  const activeRangeTotal = useMemo(
    () => dates.reduce((total, item) => total + item.total, 0),
    [dates],
  )
  const copyEnabled = canCopyHistoryAssetIds(
    history?.total ?? 0,
    loading,
    error !== null,
    copying,
  )

  async function copyAssetIds(): Promise<void> {
    if (!copyEnabled) return
    setCopying(true)
    setCopyFeedback(null)
    const result = await copyFilteredAssetIds(
      () => window.mesHistory.getHistoryAssetIds({
        ...filteredRequest,
      }),
      (text) => window.mesClipboard.writeText(text),
    )
    setCopying(false)
    setCopyFeedback({ kind: result.ok ? 'success' : 'error', message: result.message })
  }

  const diagnostics = useMemo(
    () => Object.values(runners)
      .filter((runner) => runner !== undefined)
      .map((runner) => `${runner.label}\n${formatDiagnostics(runner.workflow.diagnostics, false, runner.workflow.assets)}`)
      .join('\n\n'),
    [runners],
  )

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>History</h1>
          <p className={styles.subtitle}>Local asset outcomes and current-session diagnostics</p>
        </div>
        <div className={styles.viewTabs} aria-label="Logs views">
          <button className={view === 'history' ? styles.tabActive : styles.tab} onClick={() => setView('history')}>History</button>
          <button className={view === 'diagnostics' ? styles.tabActive : styles.tab} onClick={() => setView('diagnostics')}>Diagnostics</button>
        </div>
      </header>

      {view === 'diagnostics' ? (
        <section className={styles.diagnostics} aria-label="Current session diagnostics">
          <div className={styles.diagnosticsHeader}>Current session</div>
          <pre>{diagnostics || 'No diagnostics yet.'}</pre>
        </section>
      ) : !health.available ? (
        <div className={styles.state} role="status">
          <strong>History unavailable</strong>
          <span>{health.message ?? 'The local history database could not be opened.'}</span>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.segmented} aria-label="History range">
              <button className={preset === 'this_week' ? styles.segmentActive : styles.segment} onClick={() => setPreset('this_week')}>This Week</button>
              <button className={preset === 'last_week' ? styles.segmentActive : styles.segment} onClick={() => setPreset('last_week')}>Last Week</button>
              <button className={preset === 'custom' ? styles.segmentActive : styles.segment} onClick={() => setPreset('custom')}>Date Range</button>
            </div>
            {preset === 'custom' && (
              <div className={styles.dateRange}>
                <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="History start date" />
                <span>to</span>
                <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="History end date" />
              </div>
            )}
            <input className={styles.search} type="search" placeholder="Search assets…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search asset history" />
            <select value={mode} onChange={(event) => setMode(event.target.value as ModeFilter)} aria-label="Filter history by mode">
              <option value="all">All modes</option>
              <option value="MRI">MRI</option>
              <option value="MRI_FAIL">MRI Fail</option>
              <option value="EOL">EOL</option>
              <option value="REPAIR">Repair</option>
            </select>
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as OutcomeFilter)} aria-label="Filter history by outcome">
              <option value="all">All outcomes</option>
              <option value="completed">Completed</option>
              <option value="needs_review">Needs Review</option>
            </select>
            <button
              className={styles.copyButton}
              type="button"
              disabled={!copyEnabled}
              onClick={() => { void copyAssetIds() }}
              title="Copy all matching asset IDs"
              aria-label="Copy all matching asset IDs"
            >
              {copying ? 'Copying…' : 'Copy Asset IDs'}
            </button>
            <span
              className={copyFeedback?.kind === 'error' ? styles.copyError : styles.copyFeedback}
              role="status"
              aria-live="polite"
            >
              {copyFeedback?.message ?? ''}
            </span>
          </div>

          <div className={styles.content}>
            <aside className={styles.dates} aria-label="History dates">
              <h2>Dates</h2>
              <button
                type="button"
                className={activeSelectedDate === null ? styles.dateActive : styles.dateButton}
                onClick={() => setSelectedDate(null)}
              >
                <span>All Dates</span>
                <small>{activeRangeTotal} {activeRangeTotal === 1 ? 'asset' : 'assets'}</small>
              </button>
              {dates.length === 0 ? <p>No recorded dates in this range.</p> : dates.map((item) => (
                <button type="button" key={item.date} className={activeSelectedDate === item.date ? styles.dateActive : styles.dateButton} onClick={() => setSelectedDate(item.date)}>
                  <span>{formatDate(item.date)}</span>
                  <small>{item.total} {item.total === 1 ? 'asset' : 'assets'}</small>
                </button>
              ))}
            </aside>

            <section className={styles.results}>
              <Summary history={history} loading={loading} />
              <div className={styles.tableWrap}>
                {loading ? <div className={styles.state}>Loading history…</div> : error !== null ? <div className={styles.state}>{error}</div> : history === null || history.results.length === 0 ? <div className={styles.state}>No asset outcomes match this view.</div> : (
                  <>
                    <div className={styles.tableHeader}><span>Time</span><span>Asset ID</span><span>Mode</span><span>Outcome</span><span>Reason</span></div>
                    <ul className={styles.rows}>
                      {history.results.map((result) => (
                        <HistoryRow key={result.id} result={result} expanded={expandedId === result.id} onToggle={() => setExpandedId((id) => id === result.id ? null : result.id)} />
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Summary({ history, loading }: { history: HistoryRangeResult | null; loading: boolean }) {
  const values = history ?? { total: 0, completed: 0, needsReview: 0, byMode: { MRI: 0, MRI_FAIL: 0, EOL: 0 } }
  return <dl className={styles.summary} aria-busy={loading}>
    <SummaryItem label="Assets run" value={values.total} />
    <SummaryItem label="MRI" value={values.byMode.MRI} />
    <SummaryItem label="MRI Fail" value={values.byMode.MRI_FAIL} />
    <SummaryItem label="EOL" value={values.byMode.EOL} />
    <SummaryItem label="Completed" value={values.completed} />
    <SummaryItem label="Needs Review" value={values.needsReview} />
  </dl>
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function HistoryRow({ result, expanded, onToggle }: { result: HistoryResult; expanded: boolean; onToggle(): void }) {
  return <li>
    <button className={styles.row} type="button" onClick={onToggle} aria-expanded={expanded && result.reason !== null}>
      <span>{new Date(result.finishedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      <strong>{result.assetId}</strong>
      <span>{modeLabel(result.mode)}</span>
      <span className={result.outcome === 'completed' ? styles.completed : styles.needsReview}>{result.outcome === 'completed' ? 'Completed' : 'Needs Review'}</span>
      <span className={styles.reason}>{result.reason ?? '—'}</span>
    </button>
    {expanded && result.reason !== null && <div className={styles.details}><strong>Needs-review reason</strong><span>{result.reason}</span></div>}
  </li>
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

function modeLabel(mode: WorkflowMode): string {
  if (mode === 'MRI_FAIL') return 'MRI Fail'
  if (mode === 'MRI') return 'MRI'
  if (mode === 'EOL') return 'EOL'
  return 'Repair'
}
