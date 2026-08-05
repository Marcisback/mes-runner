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
import { useEngine } from '../../state/engineContext'
import {
  getLifecycleLabel,
  getOverlayMessage,
  getStreamToolbarControls,
  streamStatusLabel,
  streamStatusTone,
} from '../../lib/runnerInspector'
import type {
  ManagedChromeFrame,
  ManagedChromePoint,
  ManagedChromeState,
  ManagedChromeViewport,
} from '../../types/managedChrome'
import { DiagnosticsIcon, MaximizeIcon, StreamOfflineIcon } from '../icons'
import styles from './RunnerWorkspace.module.css'
import type { RunnerId } from '../../types/eolRunner'

/**
 * The live MES browser stream. Owns the drawing canvas, the single frame
 * subscription (`window.managedChrome.onFrame`), and pointer/keyboard forwarding
 * to managed Chrome. Managed Chrome lifecycle state is read from the shared
 * {@link EngineProvider} rather than a private subscription, so the surface can
 * be mounted once and reused across every runner tab without duplicating
 * subscriptions or restarting the stream.
 *
 * This is a faithful port of the previous stream logic; the Playwright/CDP
 * interactions, screencast, and completion behavior are unchanged. Only the
 * toolbar (now contextual) and the stopped empty state were redesigned.
 */

const AUTOMATION_VIEWPORT: ManagedChromeViewport = { width: 1600, height: 1000 }

type StreamDisplayMode = 'fit-page' | 'fit-width' | 'actual-size'

interface DrawnFrame {
  streamGeneration: number
  viewport: ManagedChromeViewport
}

interface PendingWheel {
  point: ManagedChromePoint
  deltaX: number
  deltaY: number
}

interface MesStreamSurfaceProps {
  runnerId: RunnerId
  inspectorCollapsed: boolean
  diagnosticsOpen: boolean
  onToggleCollapsed(): void
  onToggleDiagnostics(): void
}

export function MesStreamSurface({
  runnerId,
  inspectorCollapsed,
  diagnosticsOpen,
  onToggleCollapsed,
  onToggleDiagnostics,
}: MesStreamSurfaceProps) {
  const { chromeState: state } = useEngine()
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [displayMode, setDisplayMode] = useState<StreamDisplayMode>('fit-page')
  const [surfaceSize, setSurfaceSize] =
    useState<ManagedChromeViewport>(AUTOMATION_VIEWPORT)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const drawnFrameRef = useRef<DrawnFrame | null>(null)
  const currentStreamGenerationRef = useRef(-1)
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
        frame.streamGeneration !== currentStreamGenerationRef.current ||
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
          if (frame.streamGeneration !== currentStreamGenerationRef.current) {
            return
          }

          canvas.width = frame.viewport.width
          canvas.height = frame.viewport.height
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          drawnFrameRef.current = {
            streamGeneration: frame.streamGeneration,
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
        () => frame.streamGeneration === currentStreamGenerationRef.current,
      )

      if (drawn) {
        drawnFrameRef.current = {
          streamGeneration: frame.streamGeneration,
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
      if (frame.streamGeneration < currentStreamGenerationRef.current) {
        return
      }

      if (frame.streamGeneration > currentStreamGenerationRef.current) {
        currentStreamGenerationRef.current = frame.streamGeneration
        clearCanvas()
      }

      pendingFrameRef.current = frame
      processNextFrame()
    },
    [clearCanvas, processNextFrame],
  )

  useEffect(() => {
    void window.managedChrome.selectRunnerStream(runnerId)
  }, [runnerId])

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

  // Track the current stream generation from shared Chrome state and clear the
  // canvas when the underlying session changes.
  useEffect(() => {
    currentStreamGenerationRef.current = -1
    pendingFrameRef.current = null
    clearCanvas()
  }, [state.generation, runnerId, clearCanvas])

  // Single frame subscription for the whole app (mounted once).
  useEffect(() => {
    const unsubscribeFrame = window.managedChrome.onFrame((frame) => {
      if (frame.runnerId === runnerId) queueFrame(frame)
    })

    return () => {
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
  }, [clearCanvas, queueFrame, runnerId])

  const canLaunch =
    state.lifecycle === 'stopped' ||
    state.lifecycle === 'disconnected' ||
    state.lifecycle === 'error' ||
    state.lifecycle === 'compliance-blocked'
  const canCompleteAuthentication = state.lifecycle === 'authenticating'
  const canCancelAuthentication =
    state.lifecycle === 'authentication-required' ||
    state.lifecycle === 'authenticating' ||
    state.lifecycle === 'launching-authentication'
  const showOverlay = state.lifecycle !== 'streaming'
  const isStopped = state.lifecycle === 'stopped'
  const hasErrorText = state.errorMessage !== null
  const { showAuthenticate, showStopSession } = getStreamToolbarControls(
    state.lifecycle,
  )
  const tone = streamStatusTone(state.lifecycle)

  const frameStyle = useMemo(
    () =>
      getFrameStyle(
        displayMode,
        surfaceSize,
        drawnFrameRef.current?.viewport ?? AUTOMATION_VIEWPORT,
      ),
    [displayMode, surfaceSize],
  )

  async function runAction(
    actionName: string,
    action: () => Promise<ManagedChromeState>,
  ): Promise<void> {
    if (pendingAction !== null) {
      return
    }

    setPendingAction(actionName)

    try {
      await action()
    } finally {
      setPendingAction(null)
    }
  }

  function getPagePoint(
    event: MouseEvent<HTMLElement>,
  ): ManagedChromePoint | null {
    const canvas = canvasRef.current
    const frame = drawnFrameRef.current

    if (canvas === null || frame === null) {
      return null
    }

    const rect = canvas.getBoundingClientRect()

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
            window.managedChrome.mouseMove(runnerId, pendingPoint)
          }
        })
      }
    }
  }

  function handleClick(event: MouseEvent<HTMLCanvasElement>): void {
    const point = getPagePoint(event)

    if (point !== null) {
      event.currentTarget.focus()
      window.managedChrome.mouseClick(runnerId, point)
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
            window.managedChrome.mouseWheel(runnerId, {
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
      window.managedChrome.insertText(runnerId, event.key)
      return
    }

    event.preventDefault()
    window.managedChrome.keyDown(runnerId, { key: event.key })
  }

  function handleKeyUp(event: KeyboardEvent<HTMLCanvasElement>): void {
    if (!focused || event.metaKey || event.ctrlKey || event.key.length === 1) {
      return
    }

    event.preventDefault()
    window.managedChrome.keyUp(runnerId, { key: event.key })
  }

  return (
    <div className={styles.streamRegion}>
      <div className={styles.toolbar}>
        <span className={styles.streamStatus}>
          <span
            className={`${styles.streamDot} ${styles[`tone_${tone}`]}`}
            aria-hidden="true"
          />
          <span className={styles.streamStatusLabel}>
            {streamStatusLabel(state.lifecycle)}
          </span>
        </span>

        <div className={styles.toolbarActions}>
          {showAuthenticate && (
            <button
              type="button"
              className={styles.toolbarButton}
              disabled={pendingAction !== null}
              onClick={() =>
                void runAction('authenticate', () =>
                  window.managedChrome.openLoginWindow(),
                )
              }
            >
              Authenticate
            </button>
          )}
          {showStopSession && (
            <button
              type="button"
              className={styles.toolbarButton}
              disabled={pendingAction !== null}
              onClick={() =>
                void runAction('stop', () => window.managedChrome.stop())
              }
            >
              Stop Session
            </button>
          )}
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
            aria-pressed={inspectorCollapsed}
            onClick={onToggleCollapsed}
          >
            <MaximizeIcon size={16} />
            {inspectorCollapsed ? 'Show Panel' : 'Maximize'}
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-pressed={diagnosticsOpen}
            onClick={onToggleDiagnostics}
          >
            <DiagnosticsIcon size={16} />
            Diagnostics
          </button>
        </div>
      </div>

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

        {isStopped && (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <StreamOfflineIcon size={34} />
            </span>
            <h1 className={styles.emptyTitle}>MES is offline</h1>
            <p className={styles.emptyText}>
              Launch the managed MES session to begin.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={pendingAction !== null}
              onClick={() =>
                void runAction('launch', () => window.managedChrome.launch())
              }
            >
              {pendingAction === 'launch' ? 'Launching…' : 'Launch MES'}
            </button>
          </div>
        )}

        {showOverlay && !isStopped && (
          <div className={styles.overlay}>
            <div className={styles.overlayPanel}>
              <h1 className={styles.overlayTitle}>
                {getLifecycleLabel(state.lifecycle)}
              </h1>
              <p className={styles.overlayDetail}>
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
                      void runAction('launch', () => window.managedChrome.launch())
                    }
                  >
                    {pendingAction === 'launch' ? 'Launching…' : 'Launch MES'}
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
    </div>
  )
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
      : Math.min(
          surfaceSize.width / viewport.width,
          surfaceSize.height / viewport.height,
        )
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  return {
    width: `${Math.max(1, Math.round(viewport.width * safeScale))}px`,
    height: `${Math.max(1, Math.round(viewport.height * safeScale))}px`,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
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
