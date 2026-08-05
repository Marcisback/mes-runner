import { type CSSProperties, type PointerEvent, useRef, useState } from 'react'
import {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  clampInspectorWidth,
} from '../../lib/runnerInspector'
import { MesStreamSurface } from './MesStreamSurface'
import { RunnerInspector } from './RunnerInspector'
import { RunnerDiagnostics } from './RunnerDiagnostics'
import styles from './RunnerWorkspace.module.css'
import type { RunnerId } from '../../types/eolRunner'

const RESIZE_STEP = 24

interface RunnerWorkspaceProps {
  runnerId: RunnerId
  runnerName: string
}

/**
 * A runner tab's workspace: the shared MES stream on the left and a
 * resizable/collapsible Runner Inspector on the right, with a diagnostics drawer
 * along the bottom. A single instance is kept mounted and reused across runner
 * tabs (see {@link AppShell}) so switching tabs never restarts Chrome, restarts
 * a run, resets engine state, or duplicates subscriptions.
 *
 * The inspector width is React-local and only affects CSS layout — resizing does
 * not touch the fixed 1600x1000 Playwright viewport or the screencast. Collapse
 * is a single source of truth shared with the toolbar's Maximize / Show Panel.
 */
export function RunnerWorkspace({ runnerId, runnerName }: RunnerWorkspaceProps) {
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH)

  const contentRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const contentClassName = [
    styles.content,
    inspectorCollapsed ? styles.contentCollapsed : '',
    diagnosticsOpen ? styles.contentWithDiagnostics : '',
  ]
    .filter(Boolean)
    .join(' ')

  const contentStyle = {
    '--inspector-width': `${inspectorWidth}px`,
  } as CSSProperties

  function handleHandlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleHandlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) {
      return
    }

    const rect = contentRef.current?.getBoundingClientRect()

    if (rect === undefined) {
      return
    }

    setInspectorWidth(clampInspectorWidth(rect.right - event.clientX))
  }

  function handleHandlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    draggingRef.current = false

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleHandleKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void {
    // Left grows the inspector (handle moves left); Right shrinks it.
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setInspectorWidth((width) => clampInspectorWidth(width + RESIZE_STEP))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setInspectorWidth((width) => clampInspectorWidth(width - RESIZE_STEP))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setInspectorWidth(INSPECTOR_MAX_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setInspectorWidth(INSPECTOR_MIN_WIDTH)
    }
  }

  return (
    <section className={styles.workspace} aria-label={`${runnerName} workspace`}>
      <div ref={contentRef} className={contentClassName} style={contentStyle}>
        <MesStreamSurface
          runnerId={runnerId}
          inspectorCollapsed={inspectorCollapsed}
          diagnosticsOpen={diagnosticsOpen}
          onToggleCollapsed={() => setInspectorCollapsed((value) => !value)}
          onToggleDiagnostics={() => setDiagnosticsOpen((value) => !value)}
        />

        {!inspectorCollapsed && (
          <div
            className={styles.resizeHandle}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize inspector"
            aria-valuemin={INSPECTOR_MIN_WIDTH}
            aria-valuemax={INSPECTOR_MAX_WIDTH}
            aria-valuenow={inspectorWidth}
            onPointerDown={handleHandlePointerDown}
            onPointerMove={handleHandlePointerMove}
            onPointerUp={handleHandlePointerUp}
            onKeyDown={handleHandleKeyDown}
          >
            <span className={styles.resizeGrip} aria-hidden="true" />
          </div>
        )}

        {!inspectorCollapsed && (
          <RunnerInspector
            runnerId={runnerId}
            runnerName={runnerName}
            onCollapse={() => setInspectorCollapsed(true)}
          />
        )}

        {diagnosticsOpen && <RunnerDiagnostics runnerId={runnerId} />}
      </div>
    </section>
  )
}
