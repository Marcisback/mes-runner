import { useEffect, useMemo, useRef, useState } from 'react'
import { useEngine } from '../../state/engineContext'
import { formatDiagnostics } from '../../lib/diagnostics'
import styles from './RunnerWorkspace.module.css'

type DiagnosticFilter = 'all' | 'info' | 'warning' | 'error'

/**
 * Diagnostics drawer for the runner workspace. Reads the shared engine snapshot
 * and renders sanitized, copyable session diagnostics. Copy actions reuse the
 * shared sanitizer so identifiers and local paths never leak.
 */
export function RunnerDiagnostics() {
  const { snapshot } = useEngine()
  const [diagnosticFilter, setDiagnosticFilter] =
    useState<DiagnosticFilter>('all')
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [clearedThroughDiagnosticId, setClearedThroughDiagnosticId] =
    useState(0)
  const logRef = useRef<HTMLPreElement>(null)
  const shouldAutoScrollRef = useRef(true)

  const filteredDiagnostics = useMemo(
    () =>
      snapshot.diagnostics.filter((event) => {
        if (event.id <= clearedThroughDiagnosticId) {
          return false
        }

        return diagnosticFilter === 'all' || event.severity === diagnosticFilter
      }),
    [clearedThroughDiagnosticId, diagnosticFilter, snapshot.diagnostics],
  )

  const diagnosticText = useMemo(
    () => formatDiagnostics(filteredDiagnostics, false, snapshot.assets),
    [filteredDiagnostics, snapshot.assets],
  )
  const sanitizedDiagnosticText = useMemo(
    () => formatDiagnostics(filteredDiagnostics, true, snapshot.assets),
    [filteredDiagnostics, snapshot.assets],
  )
  const fullDiagnosticText = useMemo(
    () => formatDiagnostics(snapshot.diagnostics, false, snapshot.assets),
    [snapshot.diagnostics, snapshot.assets],
  )

  useEffect(() => {
    const element = logRef.current

    if (element !== null && shouldAutoScrollRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [diagnosticText])

  async function copyText(text: string): Promise<void> {
    if (text.trim().length === 0) {
      showCopyStatus('Nothing to copy')
      return
    }

    const copied = await window.mesClipboard.writeText(text).catch(() => false)
    showCopyStatus(copied ? 'Copied' : 'Copy failed')
  }

  function showCopyStatus(message: string): void {
    setCopyStatus(message)
    window.setTimeout(() => setCopyStatus(null), 1600)
  }

  return (
    <section className={styles.diagnosticsDrawer} aria-label="Diagnostics">
      <div className={styles.diagnosticsToolbar}>
        <strong>Diagnostics</strong>
        <select
          className={styles.toolbarSelect}
          value={diagnosticFilter}
          onChange={(event) =>
            setDiagnosticFilter(event.target.value as DiagnosticFilter)
          }
          aria-label="Diagnostics severity filter"
        >
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warning">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void copyText(sanitizedDiagnosticText)}
        >
          Copy Diagnostics
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() =>
            void copyText(
              `Local MES Runner log. May contain internal identifiers.\n\n${fullDiagnosticText}`,
            )
          }
        >
          Copy Full Log
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() =>
            setClearedThroughDiagnosticId(snapshot.diagnostics.at(-1)?.id ?? 0)
          }
        >
          Clear
        </button>
        {copyStatus !== null && (
          <span className={styles.copyStatus}>{copyStatus}</span>
        )}
      </div>
      <pre
        ref={logRef}
        className={styles.diagnosticsLog}
        onScroll={(event) => {
          const element = event.currentTarget
          const distanceFromBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight
          shouldAutoScrollRef.current = distanceFromBottom < 40
        }}
      >
        {diagnosticText || 'No diagnostics yet.'}
      </pre>
    </section>
  )
}
