import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  ManagedChromeFrame,
  ManagedChromeLifecycleState,
  ManagedChromePoint,
  ManagedChromeState,
  ManagedChromeViewport,
} from '../../types/managedChrome'
import type {
  EolRunnerSnapshot,
  RepairOutcome,
  WorkflowMode,
} from '../../types/eolRunner'
import {
  DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  DEFAULT_REPAIR_LOCATOR,
  WORKFLOW_LABELS,
} from '../../types/eolRunner'
import styles from './ManagedChromeView.module.css'

const INITIAL_VIEWPORT: ManagedChromeViewport = { width: 1600, height: 1000 }
const AUTOMATION_VIEWPORT: ManagedChromeViewport = { width: 1600, height: 1000 }

const INITIAL_STATE: ManagedChromeState = {
  lifecycle: 'stopped',
  errorMessage: null,
  generation: 0,
  viewport: INITIAL_VIEWPORT,
}

const INITIAL_EOL_SNAPSHOT: EolRunnerSnapshot = {
  state: 'idle',
  mode: 'EOL',
  modeLabel: WORKFLOW_LABELS.EOL,
  assets: [],
  currentAssetId: null,
  total: 0,
  completed: 0,
  skipped: 0,
  needsReview: 0,
  errorMessage: null,
  diagnostics: [],
}

const WORKFLOW_MODES: WorkflowMode[] = [
  'EOL',
  'MRI',
  'MRI_FAIL',
  'REPAIR',
]

type StreamDisplayMode = 'fit-page' | 'fit-width' | 'actual-size'
type DiagnosticFilter = 'all' | 'info' | 'warning' | 'error'

interface DrawnFrameRect {
  left: number
  top: number
  width: number
  height: number
}

interface DrawnFrame {
  generation: number
  viewport: ManagedChromeViewport
}

interface PendingWheel {
  point: ManagedChromePoint
  deltaX: number
  deltaY: number
}

function getLifecycleLabel(lifecycle: ManagedChromeLifecycleState): string {
  switch (lifecycle) {
    case 'stopped':
      return 'Stopped'
    case 'launching-headless':
      return 'Launching'
    case 'loading':
      return 'Loading'
    case 'streaming':
      return 'Streaming'
    case 'authentication-required':
      return 'Authentication required'
    case 'launching-authentication':
      return 'Opening login'
    case 'authenticating':
      return 'Authenticating'
    case 'resuming-headless':
      return 'Resuming'
    case 'disconnected':
      return 'Disconnected'
    case 'compliance-blocked':
      return 'Compliance blocked'
    case 'error':
      return 'Error'
  }
}

function getOverlayMessage(lifecycle: ManagedChromeLifecycleState): string {
  switch (lifecycle) {
    case 'stopped':
      return 'Launch MES to start headless managed Chrome streaming.'
    case 'launching-headless':
      return 'Starting headless managed Chrome.'
    case 'loading':
      return 'Loading MES.'
    case 'authentication-required':
      return 'Manual login or YubiKey authentication is required in a visible managed Chrome window.'
    case 'launching-authentication':
      return 'Opening the visible managed Chrome login window.'
    case 'authenticating':
      return 'Complete password and YubiKey authentication in Chrome, then return here.'
    case 'resuming-headless':
      return 'Returning to headless streaming.'
    case 'disconnected':
      return 'The controlled Chrome session closed unexpectedly.'
    case 'compliance-blocked':
      return 'InternalFB rejected this browser as non-compliant.'
    case 'error':
      return 'MES streaming needs attention before it can continue.'
    case 'streaming':
      return ''
  }
}

export function ManagedChromeView() {
  const [state, setState] = useState<ManagedChromeState>(INITIAL_STATE)
  const [eolSnapshot, setEolSnapshot] =
    useState<EolRunnerSnapshot>(INITIAL_EOL_SNAPSHOT)
  const [assetsText, setAssetsText] = useState('')
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('EOL')
  const [repairOutcome, setRepairOutcome] =
    useState<RepairOutcome>('confirmed')
  const [repairLocator, setRepairLocator] = useState(DEFAULT_REPAIR_LOCATOR)
  const [moveToRepairLocator, setMoveToRepairLocator] = useState(
    DEFAULT_MOVE_TO_REPAIR_LOCATOR,
  )
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [pendingEolAction, setPendingEolAction] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [displayMode, setDisplayMode] =
    useState<StreamDisplayMode>('fit-page')
  const [streamMaximized, setStreamMaximized] = useState(false)
  const [surfaceSize, setSurfaceSize] =
    useState<ManagedChromeViewport>(INITIAL_VIEWPORT)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticFilter, setDiagnosticFilter] =
    useState<DiagnosticFilter>('all')
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [clearedThroughDiagnosticId, setClearedThroughDiagnosticId] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const shouldAutoScrollLogRef = useRef(true)
  const drawnFrameRef = useRef<DrawnFrame | null>(null)
  const currentGenerationRef = useRef(0)
  const decodingFrameRef = useRef(false)
  const pendingFrameRef = useRef<ManagedChromeFrame | null>(null)
  const pendingMouseMoveRef = useRef<ManagedChromePoint | null>(null)
  const mouseMoveAnimationRef = useRef<number | null>(null)
  const pendingWheelRef = useRef<PendingWheel | null>(null)
  const wheelAnimationRef = useRef<number | null>(null)

  const clearCanvas = useCallback((): void => {
    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const context = canvas.getContext('2d')

    if (context !== null) {
      context.clearRect(0, 0, canvas.width, canvas.height)
    }

    drawnFrameRef.current = null
  }, [])

  const decodeAndDrawFrame = useCallback(
    async (frame: ManagedChromeFrame): Promise<void> => {
      const canvas = canvasRef.current

      if (
        frame.generation !== currentGenerationRef.current ||
        frame.data.byteLength === 0
      ) {
        if (frame.data.byteLength === 0) {
          clearCanvas()
        }
        return
      }

      if (canvas === null) {
        return
      }

      const context = canvas.getContext('2d')

      if (context === null) {
        return
      }

      const blob = new Blob([frame.data], { type: frame.mimeType })

      if ('createImageBitmap' in window) {
        const bitmap = await createImageBitmap(blob)

        try {
          if (frame.generation !== currentGenerationRef.current) {
            return
          }

          canvas.width = frame.viewport.width
          canvas.height = frame.viewport.height
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          drawnFrameRef.current = {
            generation: frame.generation,
            viewport: frame.viewport,
          }
        } finally {
          bitmap.close()
        }

        return
      }

      const drawn = await drawBlobWithObjectUrl(
        blob,
        canvas,
        context,
        frame,
        () => frame.generation === currentGenerationRef.current,
      )

      if (drawn) {
        drawnFrameRef.current = {
          generation: frame.generation,
          viewport: frame.viewport,
        }
      }
    },
    [clearCanvas],
  )

  const processNextFrame = useCallback((): void => {
    if (decodingFrameRef.current) {
      return
    }

    const frame = pendingFrameRef.current

    if (frame === null) {
      return
    }

    pendingFrameRef.current = null
    decodingFrameRef.current = true

    decodeAndDrawFrame(frame)
      .catch(() => {
        // Avoid logging frame data or page content.
      })
      .finally(() => {
        decodingFrameRef.current = false
        processNextFrame()
      })
  }, [decodeAndDrawFrame])

  const queueFrame = useCallback(
    (frame: ManagedChromeFrame): void => {
      if (frame.generation !== currentGenerationRef.current) {
        return
      }

      pendingFrameRef.current = frame
      processNextFrame()
    },
    [processNextFrame],
  )

  useEffect(() => {
    const surface = surfaceRef.current

    if (surface === null) {
      return
    }

    const reportSurfaceSize = (): void => {
      const rect = surface.getBoundingClientRect()

      if (rect.width <= 0 || rect.height <= 0) {
        return
      }

      setSurfaceSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    const observer = new ResizeObserver(reportSurfaceSize)
    observer.observe(surface)
    window.addEventListener('resize', reportSurfaceSize)
    reportSurfaceSize()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportSurfaceSize)
    }
  }, [])

  const canLaunch =
    state.lifecycle === 'stopped' ||
    state.lifecycle === 'disconnected' ||
    state.lifecycle === 'error' ||
    state.lifecycle === 'compliance-blocked'
  const canAuthenticate =
    state.lifecycle === 'authentication-required' ||
    state.lifecycle === 'streaming' ||
    state.lifecycle === 'loading'
  const canCompleteAuthentication = state.lifecycle === 'authenticating'
  const canCancelAuthentication =
    state.lifecycle === 'authentication-required' ||
    state.lifecycle === 'authenticating' ||
    state.lifecycle === 'launching-authentication'
  const canStop = state.lifecycle !== 'stopped'
  const showOverlay = state.lifecycle !== 'streaming'
  const hasErrorText = state.errorMessage !== null

  const statusClassName = useMemo(
    () =>
      `${styles.statusValue} ${
        state.lifecycle === 'error' ||
        state.lifecycle === 'compliance-blocked'
          ? styles.error
          : ''
      }`,
    [state.lifecycle],
  )

  const parsedAssetCount = useMemo(
    () => parseAssetText(assetsText).length,
    [assetsText],
  )
  const completedAssets = useMemo(
    () => eolSnapshot.assets.filter((asset) => asset.state === 'completed'),
    [eolSnapshot.assets],
  )
  const skippedAssets = useMemo(
    () => eolSnapshot.assets.filter((asset) => asset.state === 'skipped'),
    [eolSnapshot.assets],
  )
  const needsReviewAssets = useMemo(
    () => eolSnapshot.assets.filter((asset) => asset.state === 'needs-review'),
    [eolSnapshot.assets],
  )
  const filteredDiagnostics = useMemo(
    () =>
      eolSnapshot.diagnostics.filter((event) => {
        if (event.id <= clearedThroughDiagnosticId) {
          return false
        }

        return diagnosticFilter === 'all' || event.severity === diagnosticFilter
      }),
    [clearedThroughDiagnosticId, diagnosticFilter, eolSnapshot.diagnostics],
  )
  const diagnosticText = useMemo(
    () => formatDiagnostics(filteredDiagnostics, false, eolSnapshot.assets),
    [eolSnapshot.assets, filteredDiagnostics],
  )
  const fullDiagnosticText = useMemo(
    () => formatDiagnostics(eolSnapshot.diagnostics, false, eolSnapshot.assets),
    [eolSnapshot.assets, eolSnapshot.diagnostics],
  )
  const sanitizedDiagnosticText = useMemo(
    () => formatDiagnostics(filteredDiagnostics, true, eolSnapshot.assets),
    [eolSnapshot.assets, filteredDiagnostics],
  )
  const frameStyle = useMemo(
    () => getFrameStyle(displayMode, surfaceSize, drawnFrameRef.current?.viewport ?? AUTOMATION_VIEWPORT),
    [displayMode, surfaceSize],
  )
  const contentClassName = useMemo(
    () =>
      `${styles.content} ${streamMaximized ? styles.contentMaximized : ''} ${
        diagnosticsOpen ? styles.contentWithDiagnostics : ''
      }`,
    [diagnosticsOpen, streamMaximized],
  )

  useEffect(() => {
    let mounted = true

    window.managedChrome.getState().then((currentState) => {
      if (mounted) {
        currentGenerationRef.current = currentState.generation
        setState(currentState)
      }
    })

    const unsubscribeState = window.managedChrome.onStateChanged((nextState) => {
      currentGenerationRef.current = nextState.generation
      setState(nextState)

      if (nextState.generation !== drawnFrameRef.current?.generation) {
        pendingFrameRef.current = null
        clearCanvas()
      }
    })

    const unsubscribeFrame = window.managedChrome.onFrame((frame) => {
      queueFrame(frame)
    })

    return () => {
      mounted = false
      unsubscribeState()
      unsubscribeFrame()
      pendingFrameRef.current = null
      if (mouseMoveAnimationRef.current !== null) {
        cancelAnimationFrame(mouseMoveAnimationRef.current)
      }
      if (wheelAnimationRef.current !== null) {
        cancelAnimationFrame(wheelAnimationRef.current)
      }
      clearCanvas()
    }
  }, [clearCanvas, queueFrame])

  useEffect(() => {
    const logElement = logRef.current

    if (logElement === null || !diagnosticsOpen) {
      return
    }

    if (shouldAutoScrollLogRef.current) {
      logElement.scrollTop = logElement.scrollHeight
    }
  }, [diagnosticText, diagnosticsOpen])

  useEffect(() => {
    let mounted = true

    window.eolRunner.getEolSnapshot().then((snapshot) => {
      if (mounted) {
        setEolSnapshot(snapshot)
      }
    })

    const unsubscribe = window.eolRunner.onEolSnapshotChanged(setEolSnapshot)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  async function runAction(
    actionName: string,
    action: () => Promise<ManagedChromeState>,
  ): Promise<void> {
    if (pendingAction !== null) {
      return
    }

    setPendingAction(actionName)

    try {
      setState(await action())
    } finally {
      setPendingAction(null)
    }
  }

  async function runEolAction(
    actionName: string,
    action: () => Promise<EolRunnerSnapshot>,
  ): Promise<void> {
    if (pendingEolAction !== null) {
      return
    }

    setPendingEolAction(actionName)

    try {
      setEolSnapshot(await action())
    } finally {
      setPendingEolAction(null)
    }
  }

  function handleStartWorkflow(): void {
    if (parsedAssetCount === 0) {
      return
    }

    const confirmed = window.confirm(
      `Start ${WORKFLOW_LABELS[workflowMode]} for ${parsedAssetCount} asset(s)? This will perform production MES actions.`,
    )

    if (!confirmed) {
      return
    }

    void runEolAction('start', () =>
      window.eolRunner.startEol({
        assetsText,
        mode: workflowMode,
        repairOutcome,
        repairLocator,
        moveToRepairLocator,
      }),
    )
  }

  async function copyText(text: string, emptyMessage = 'Nothing to copy'): Promise<void> {
    if (text.trim().length === 0) {
      showCopyStatus(emptyMessage)
      return
    }

    const copied = await window.mesClipboard.writeText(text).catch(() => false)
    showCopyStatus(copied ? 'Copied' : 'Copy failed')
  }

  function showCopyStatus(message: string): void {
    setCopyStatus(message)
    window.setTimeout(() => setCopyStatus(null), 1600)
  }

  function getPagePoint(event: MouseEvent<HTMLElement>): ManagedChromePoint | null {
    const canvas = canvasRef.current
    const frame = drawnFrameRef.current

    if (canvas === null || frame === null) {
      return null
    }

    const rect = getDrawnFrameRect(canvas)

    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      if (import.meta.env.DEV) {
        console.debug('[mes-stream] Pointer event rejected outside frame.')
      }
      return null
    }

    return {
      x: clamp((x / rect.width) * frame.viewport.width, 0, frame.viewport.width - 1),
      y: clamp((y / rect.height) * frame.viewport.height, 0, frame.viewport.height - 1),
    }
  }

  function handleMouseMove(event: MouseEvent<HTMLCanvasElement>): void {
    const point = getPagePoint(event)

    if (point !== null) {
      pendingMouseMoveRef.current = point

      if (mouseMoveAnimationRef.current === null) {
        mouseMoveAnimationRef.current = requestAnimationFrame(() => {
          mouseMoveAnimationRef.current = null
          const pendingPoint = pendingMouseMoveRef.current
          pendingMouseMoveRef.current = null

          if (pendingPoint !== null) {
            window.managedChrome.mouseMove(pendingPoint)
          }
        })
      }
    }
  }

  function handleClick(event: MouseEvent<HTMLCanvasElement>): void {
    const point = getPagePoint(event)

    if (point !== null) {
      event.currentTarget.focus()
      window.managedChrome.mouseClick(point)
    }
  }

  function handleWheel(event: WheelEvent<HTMLCanvasElement>): void {
    const point = getPagePoint(event)

    if (point !== null) {
      event.preventDefault()
      const pendingWheel = pendingWheelRef.current

      pendingWheelRef.current = {
        point,
        deltaX: (pendingWheel?.deltaX ?? 0) + event.deltaX,
        deltaY: (pendingWheel?.deltaY ?? 0) + event.deltaY,
      }

      if (wheelAnimationRef.current === null) {
        wheelAnimationRef.current = requestAnimationFrame(() => {
          wheelAnimationRef.current = null
          const wheel = pendingWheelRef.current
          pendingWheelRef.current = null

          if (wheel !== null) {
            window.managedChrome.mouseWheel({
              ...wheel.point,
              deltaX: wheel.deltaX,
              deltaY: wheel.deltaY,
            })
          }
        })
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLCanvasElement>): void {
    if (!focused || event.metaKey || event.ctrlKey) {
      return
    }

    if (event.key.length === 1) {
      event.preventDefault()
      window.managedChrome.insertText(event.key)
      return
    }

    event.preventDefault()
    window.managedChrome.keyDown({ key: event.key })
  }

  function handleKeyUp(event: KeyboardEvent<HTMLCanvasElement>): void {
    if (!focused || event.metaKey || event.ctrlKey || event.key.length === 1) {
      return
    }

    event.preventDefault()
    window.managedChrome.keyUp({ key: event.key })
  }

  return (
    <section className={styles.view} aria-label="MES browser stream">
      <div className={styles.toolbar}>
        <span className={styles.statusLabel}>Status</span>
        <span className={statusClassName}>
          {getLifecycleLabel(state.lifecycle)}
        </span>
        <button
          type="button"
          className={styles.toolbarButton}
          disabled={!canAuthenticate || pendingAction !== null}
          onClick={() =>
            void runAction('authenticate', () =>
              window.managedChrome.openLoginWindow(),
            )
          }
        >
          Authenticate
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          disabled={!canStop || pendingAction !== null}
          onClick={() =>
            void runAction('stop', () => window.managedChrome.stop())
          }
        >
          Stop Session
        </button>
        <select
          className={styles.toolbarSelect}
          value={displayMode}
          onChange={(event) =>
            setDisplayMode(event.target.value as StreamDisplayMode)
          }
          aria-label="Stream display mode"
        >
          <option value="fit-page">Fit Page</option>
          <option value="fit-width">Fit Width</option>
          <option value="actual-size">Actual Size</option>
        </select>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => setStreamMaximized((value) => !value)}
        >
          {streamMaximized ? 'Show Panel' : 'Maximize Stream'}
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => setDiagnosticsOpen((value) => !value)}
        >
          Diagnostics
        </button>
      </div>

      <div className={contentClassName}>
        <div ref={surfaceRef} className={styles.surface}>
          <div
            className={`${styles.streamScroller} ${
              displayMode === 'fit-page' ? styles.streamScrollerFitPage : ''
            }`}
          >
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              style={frameStyle}
              tabIndex={0}
              aria-label="Live MES page"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onMouseMove={handleMouseMove}
              onClick={handleClick}
              onWheel={handleWheel}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
            />
          </div>

          {showOverlay && (
            <div className={styles.overlay}>
              <div className={styles.overlayPanel}>
                <h1 className={styles.title}>
                  {getLifecycleLabel(state.lifecycle)}
                </h1>
                <p className={styles.detail}>
                  {hasErrorText
                    ? state.errorMessage
                    : getOverlayMessage(state.lifecycle)}
                </p>

                <div className={styles.overlayActions}>
                  {canLaunch && (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={pendingAction !== null}
                      onClick={() =>
                        void runAction('launch', () =>
                          window.managedChrome.launch(),
                        )
                      }
                    >
                      {pendingAction === 'launch' ? 'Launching...' : 'Launch MES'}
                    </button>
                  )}

                  {(state.lifecycle === 'authentication-required' ||
                    state.lifecycle === 'launching-authentication') && (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={pendingAction !== null}
                      onClick={() =>
                        void runAction('authenticate', () =>
                          window.managedChrome.openLoginWindow(),
                        )
                      }
                    >
                      Open Login Window
                    </button>
                  )}

                  {canCompleteAuthentication && (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={pendingAction !== null}
                      onClick={() =>
                        void runAction('complete-auth', () =>
                          window.managedChrome.authenticationComplete(),
                        )
                      }
                    >
                      Authentication Complete
                    </button>
                  )}

                  {canCancelAuthentication && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={pendingAction !== null}
                      onClick={() =>
                        void runAction('cancel-auth', () =>
                          window.managedChrome.cancelAuthentication(),
                        )
                      }
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {state.lifecycle === 'streaming' && !focused && (
            <div className={styles.focusHint}>Click the MES surface to type.</div>
          )}
        </div>

        {!streamMaximized && (
        <aside className={styles.eolPanel} aria-label="MES workflow controls">
          <div className={styles.eolHeader}>
            <h2 className={styles.eolTitle}>Workflow Runner</h2>
            <span className={styles.eolState}>{eolSnapshot.state}</span>
          </div>

          <label className={styles.assetLabel} htmlFor="workflow-mode">
            Mode
          </label>
          <select
            id="workflow-mode"
            className={styles.selectInput}
            value={workflowMode}
            disabled={
              eolSnapshot.state === 'running' ||
              eolSnapshot.state === 'paused' ||
              eolSnapshot.state === 'stopping'
            }
            onChange={(event) =>
              setWorkflowMode(event.target.value as WorkflowMode)
            }
          >
            {WORKFLOW_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {WORKFLOW_LABELS[mode]}
              </option>
            ))}
          </select>

          {workflowMode === 'REPAIR' && (
            <div className={styles.optionGrid}>
              <label className={styles.assetLabel} htmlFor="repair-outcome">
                Repair outcome
              </label>
              <select
                id="repair-outcome"
                className={styles.selectInput}
                value={repairOutcome}
                onChange={(event) =>
                  setRepairOutcome(event.target.value as RepairOutcome)
                }
              >
                <option value="confirmed">Confirmed</option>
                <option value="failed">Failed</option>
              </select>

              <label className={styles.assetLabel} htmlFor="repair-locator">
                Repair locator
              </label>
              <input
                id="repair-locator"
                className={styles.textInput}
                value={repairLocator}
                onChange={(event) => setRepairLocator(event.target.value)}
              />
            </div>
          )}

          {workflowMode === 'MRI_FAIL' && (
            <div className={styles.optionGrid}>
              <label className={styles.assetLabel} htmlFor="move-locator">
                Move-to-Repair locator
              </label>
              <input
                id="move-locator"
                className={styles.textInput}
                value={moveToRepairLocator}
                onChange={(event) => setMoveToRepairLocator(event.target.value)}
              />
            </div>
          )}

          <label className={styles.assetLabel} htmlFor="eol-assets">
            Assets
          </label>
          <textarea
            id="eol-assets"
            className={styles.assetInput}
            value={assetsText}
            placeholder="One asset ID per line"
            onChange={(event) => setAssetsText(event.target.value)}
          />
          <div className={styles.assetCount}>
            Parsed assets: {parsedAssetCount}
          </div>

          <div className={styles.eolActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={
                parsedAssetCount === 0 ||
                pendingEolAction !== null ||
                eolSnapshot.state === 'running' ||
                eolSnapshot.state === 'paused' ||
                eolSnapshot.state === 'stopping'
              }
              onClick={handleStartWorkflow}
            >
              Start
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={eolSnapshot.state !== 'running' || pendingEolAction !== null}
              onClick={() =>
                void runEolAction('pause', () => window.eolRunner.pauseEol())
              }
            >
              Pause
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={eolSnapshot.state !== 'paused' || pendingEolAction !== null}
              onClick={() =>
                void runEolAction('resume', () => window.eolRunner.resumeEol())
              }
            >
              Resume
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={
                (eolSnapshot.state !== 'running' &&
                  eolSnapshot.state !== 'paused') ||
                pendingEolAction !== null
              }
              onClick={() =>
                void runEolAction('stop', () => window.eolRunner.stopEol())
              }
            >
              Stop Safely
            </button>
          </div>

          {eolSnapshot.errorMessage !== null && (
            <p className={styles.eolError}>{eolSnapshot.errorMessage}</p>
          )}

          <dl className={styles.eolStats}>
            <div>
              <dt>Mode</dt>
              <dd>{eolSnapshot.modeLabel}</dd>
            </div>
            <div>
              <dt>Current</dt>
              <dd>{eolSnapshot.currentAssetId ?? '-'}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>
                {eolSnapshot.completed}/{eolSnapshot.total}
              </dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{eolSnapshot.skipped}</dd>
            </div>
            <div>
              <dt>Needs review</dt>
              <dd>{eolSnapshot.needsReview}</dd>
            </div>
          </dl>

          <ResultGroup
            title="Completed assets"
            assets={completedAssets}
            expandedAssetId={expandedAssetId}
            onToggle={setExpandedAssetId}
            onCopy={(text) => void copyText(text)}
          />
          <ResultGroup
            title="Skipped assets"
            assets={skippedAssets}
            expandedAssetId={expandedAssetId}
            onToggle={setExpandedAssetId}
            onCopy={(text) => void copyText(text)}
          />
          <ResultGroup
            title="Needs review"
            assets={needsReviewAssets}
            expandedAssetId={expandedAssetId}
            onToggle={setExpandedAssetId}
            onCopy={(text) => void copyText(text)}
          />
        </aside>
        )}

        {diagnosticsOpen && (
          <section className={styles.diagnosticsDrawer} aria-label="Diagnostics">
            <div className={styles.diagnosticsToolbar}>
              <strong>Diagnostics</strong>
              <select
                className={styles.toolbarSelect}
                value={diagnosticFilter}
                onChange={(event) =>
                  setDiagnosticFilter(event.target.value as DiagnosticFilter)
                }
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
                onClick={() => {
                  setClearedThroughDiagnosticId(
                    eolSnapshot.diagnostics.at(-1)?.id ?? 0,
                  )
                }}
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
                shouldAutoScrollLogRef.current = distanceFromBottom < 40
              }}
            >
              {diagnosticText || 'No diagnostics yet.'}
            </pre>
          </section>
        )}
      </div>
    </section>
  )
}

interface ResultGroupProps {
  title: string
  assets: EolRunnerSnapshot['assets']
  expandedAssetId: string | null
  onToggle(assetId: string | null): void
  onCopy(text: string): void
}

function ResultGroup({
  title,
  assets,
  expandedAssetId,
  onToggle,
  onCopy,
}: ResultGroupProps) {
  return (
    <section className={styles.resultGroup}>
      <h3 className={styles.resultTitle}>{title}</h3>
      <ul className={styles.resultList}>
        {assets.length === 0 ? (
          <li className={styles.emptyResult}>None</li>
        ) : (
          assets.map((asset) => {
            const expanded = expandedAssetId === asset.id
            const detailsText = formatErrorDetails(asset, true)

            return (
            <li key={asset.id} className={styles.resultItem}>
              <span>{asset.id}</span>
              {asset.errorDetails === null ? (
                <span>{asset.reason ?? asset.state}</span>
              ) : (
                <button
                  type="button"
                  className={styles.reasonButton}
                  onClick={() => onToggle(expanded ? null : asset.id)}
                >
                  {asset.reason ?? asset.state}
                </button>
              )}
              {expanded && asset.errorDetails !== null && (
                <div className={styles.errorDetails}>
                  <pre>{formatErrorDetails(asset, false)}</pre>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => onCopy(detailsText)}
                  >
                    Copy Error Details
                  </button>
                </div>
              )}
            </li>
            )
          })
        )}
      </ul>
    </section>
  )
}

function parseAssetText(text: string): string[] {
  const seen = new Set<string>()
  const assets: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const asset = line.trim()

    if (asset.length === 0 || asset.startsWith('#') || seen.has(asset)) {
      continue
    }

    seen.add(asset)
    assets.push(asset)
  }

  return assets
}

function getFrameStyle(
  displayMode: StreamDisplayMode,
  surfaceSize: ManagedChromeViewport,
  viewport: ManagedChromeViewport,
): CSSProperties {
  if (displayMode === 'actual-size') {
    return {
      width: `${viewport.width}px`,
      height: `${viewport.height}px`,
    }
  }

  const scale =
    displayMode === 'fit-width'
      ? surfaceSize.width / viewport.width
      : Math.min(surfaceSize.width / viewport.width, surfaceSize.height / viewport.height)
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  return {
    width: `${Math.max(1, Math.round(viewport.width * safeScale))}px`,
    height: `${Math.max(1, Math.round(viewport.height * safeScale))}px`,
  }
}

function getDrawnFrameRect(canvas: HTMLCanvasElement): DrawnFrameRect {
  const rect = canvas.getBoundingClientRect()

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function formatDiagnostics(
  events: EolRunnerSnapshot['diagnostics'],
  sanitized: boolean,
  assets: EolRunnerSnapshot['assets'],
): string {
  const assetIds = assets.map((asset) => asset.id)

  return events
    .map((event) => {
      const parts = [
        event.timestamp,
        event.severity.toUpperCase(),
        event.runnerState,
        event.workflowMode,
        event.currentStep ?? '-',
        event.assetId ?? '-',
        event.message,
      ]

      if (event.errorClass !== null) {
        parts.push(event.errorClass)
      }

      if (event.reason !== null) {
        parts.push(event.reason)
      }

      const line = parts.join(' | ')
      return sanitized ? sanitizeCopiedText(line, assetIds) : line
    })
    .join('\n')
}

function formatErrorDetails(
  asset: EolRunnerSnapshot['assets'][number],
  sanitized: boolean,
): string {
  if (asset.errorDetails === null) {
    return ''
  }

  const details = asset.errorDetails
  const text = [
    `Timestamp: ${details.timestamp}`,
    `Asset: ${asset.id}`,
    `Workflow mode: ${details.workflowMode}`,
    `Last completed step: ${details.lastCompletedStep ?? '-'}`,
    `Failing step: ${details.failingStep ?? '-'}`,
    `Error class: ${details.errorClass}`,
    `Reason: ${details.sanitizedMessage}`,
  ].join('\n')

  return sanitized ? sanitizeCopiedText(text, [asset.id]) : text
}

function sanitizeCopiedText(text: string, assetIds: string[]): string {
  const withoutQueries = text.replace(
    /https?:\/\/[^\s|]+/g,
    (urlText) => {
      try {
        const url = new URL(urlText)
        return `${url.origin}${url.pathname}`
      } catch {
        return '[url]'
      }
    },
  )
  const withoutPaths = withoutQueries.replace(/\/Users\/[^\s|]+/g, '[local-path]')

  return assetIds.reduce((result, assetId) => {
    if (assetId.length === 0) {
      return result
    }

    return result.split(assetId).join('[ASSET]')
  }, withoutPaths)
}

async function drawBlobWithObjectUrl(
  blob: Blob,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  frame: ManagedChromeFrame,
  isCurrentFrame: () => boolean,
): Promise<boolean> {
  const url = URL.createObjectURL(blob)
  const image = new Image()

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Frame decode failed.'))
      image.src = url
    })

    if (!isCurrentFrame()) {
      return false
    }

    canvas.width = frame.viewport.width
    canvas.height = frame.viewport.height
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return true
  } finally {
    image.onload = null
    image.onerror = null
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
