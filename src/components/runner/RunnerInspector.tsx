import { useId, useMemo, useState } from 'react'
import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import { parseAssetText } from '../../lib/diagnostics'
import { isEngineActive } from '../../lib/dashboard'
import {
  assetsReadyLabel,
  deriveInspectorStatus,
  getRunControls,
  getRunSummary,
  getStartDisabledReason,
  inspectorStatusTone,
} from '../../lib/runnerInspector'
import type {
  EolRunnerSnapshot,
  RepairOutcome,
  RunnerId,
  RunnerOperationResult,
  RunnerSnapshot,
  WorkflowMode,
} from '../../types/eolRunner'
import { WORKFLOW_LABELS } from '../../types/eolRunner'
import { ChevronUpIcon } from '../icons'
import { ResultAccordion } from './ResultAccordion'
import styles from './RunnerWorkspace.module.css'

const WORKFLOW_MODES: WorkflowMode[] = ['EOL', 'MRI', 'MRI_FAIL', 'REPAIR']
const EMPTY_SNAPSHOT: EolRunnerSnapshot = {
  state: 'idle', mode: 'EOL', modeLabel: WORKFLOW_LABELS.EOL, assets: [],
  currentAssetId: null, total: 0, completed: 0, skipped: 0,
  needsReview: 0, errorMessage: null, diagnostics: [],
}

interface RunnerInspectorProps {
  runnerId: RunnerId
  runnerName: string
  onCollapse(): void
}

/**
 * Structured, VS Code-style runner inspector: a sticky header with the runner
 * name, a contextual status pill, and a collapse control, over a scrolling body
 * of Configuration, Run Controls, Run Summary, and Results.
 *
 * The status pill and Run Summary derive from the live engine snapshot, while
 * Configuration reflects this runner's draft mode — so the header and the run
 * state can never disagree, and stale mode data is never shown. No engine,
 * Playwright, or IPC behavior is changed here.
 */
export function RunnerInspector({
  runnerId,
  runnerName,
  onCollapse,
}: RunnerInspectorProps) {
  const { runners, chromeState } = useEngine()
  const {
    runnerConfigs,
    updateRunnerConfig,
  } = useWorkspace()
  const [pendingEolAction, setPendingEolAction] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const startHintId = useId()

  const config = runnerConfigs[runnerId]

  const snapshot = runners[runnerId]?.workflow ?? EMPTY_SNAPSHOT
  const engineActive = isEngineActive(snapshot)
  const configLocked = engineActive
  const runnerState = snapshot.state

  const status = deriveInspectorStatus(
    snapshot.state,
    snapshot.needsReview,
    chromeState.lifecycle,
  )
  const statusTone = inspectorStatusTone(status)
  const summary = getRunSummary(snapshot)
  const runControls = getRunControls(runnerState)

  const parsedAssetCount = useMemo(
    () => parseAssetText(config?.assetsText ?? '').length,
    [config?.assetsText],
  )
  const completedAssets = useMemo(
    () => snapshot.assets.filter((asset) => asset.state === 'completed'),
    [snapshot.assets],
  )
  const skippedAssets = useMemo(
    () => snapshot.assets.filter((asset) => asset.state === 'skipped'),
    [snapshot.assets],
  )
  const needsReviewAssets = useMemo(
    () => snapshot.assets.filter((asset) => asset.state === 'needs-review'),
    [snapshot.assets],
  )

  const startDisabledReason = getStartDisabledReason({
    assetCount: parsedAssetCount,
    streamReady: chromeState.lifecycle === 'streaming',
    engineBusyElsewhere: false,
    pending: pendingEolAction !== null,
  })

  if (config === undefined) {
    return null
  }

  async function runEolAction(
    actionName: string,
    action: () => Promise<RunnerOperationResult<RunnerSnapshot>>,
  ): Promise<void> {
    if (pendingEolAction !== null) {
      return
    }

    setPendingEolAction(actionName)

    try {
      await action()
    } finally {
      setPendingEolAction(null)
    }
  }

  function handleStartWorkflow(): void {
    if (config === undefined || startDisabledReason !== null) {
      return
    }

    const confirmed = window.confirm(
      `Start ${WORKFLOW_LABELS[config.mode]} for ${parsedAssetCount} asset(s)? This will perform production MES actions.`,
    )

    if (!confirmed) {
      return
    }

    void runEolAction('start', () =>
      window.eolRunner.startEol(runnerId, {
        assetsText: config.assetsText,
        mode: config.mode,
        repairOutcome: config.repairOutcome,
        repairLocator: config.repairLocator,
        moveToRepairLocator: config.moveToRepairLocator,
      }),
    )
  }

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
    <aside className={styles.inspector} aria-label={`${runnerName} inspector`}>
      <header className={styles.inspectorHeader}>
        <h2 className={styles.inspectorTitle}>{runnerName}</h2>
        <span
          className={`${styles.statusPill} ${styles[`pill_${statusTone}`]}`}
        >
          {status}
        </span>
        <button
          type="button"
          className={styles.collapseButton}
          aria-label="Collapse inspector"
          title="Collapse inspector"
          onClick={onCollapse}
        >
          <ChevronUpIcon size={18} />
        </button>
      </header>

      <div className={styles.inspectorBody}>
        {/* ---- Configuration ---- */}
        <section className={styles.section} aria-labelledby={`${runnerId}-cfg`}>
          <h3 id={`${runnerId}-cfg`} className={styles.sectionLabel}>
            Configuration
          </h3>

          <label className={styles.fieldLabel} htmlFor={`${runnerId}-mode`}>
            Mode
          </label>
          <select
            id={`${runnerId}-mode`}
            className={styles.selectInput}
            value={config.mode}
            disabled={configLocked}
            onChange={(event) =>
              updateRunnerConfig(runnerId, {
                mode: event.target.value as WorkflowMode,
              })
            }
          >
            {WORKFLOW_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {WORKFLOW_LABELS[mode]}
              </option>
            ))}
          </select>

          {config.mode === 'REPAIR' && (
            <div className={styles.optionGrid}>
              <label
                className={styles.fieldLabel}
                htmlFor={`${runnerId}-outcome`}
              >
                Repair outcome
              </label>
              <select
                id={`${runnerId}-outcome`}
                className={styles.selectInput}
                value={config.repairOutcome}
                disabled={configLocked}
                onChange={(event) =>
                  updateRunnerConfig(runnerId, {
                    repairOutcome: event.target.value as RepairOutcome,
                  })
                }
              >
                <option value="confirmed">Confirmed</option>
                <option value="failed">Failed</option>
              </select>

              <label
                className={styles.fieldLabel}
                htmlFor={`${runnerId}-repair`}
              >
                Repair locator
              </label>
              <input
                id={`${runnerId}-repair`}
                className={styles.textInput}
                value={config.repairLocator}
                disabled={configLocked}
                onChange={(event) =>
                  updateRunnerConfig(runnerId, {
                    repairLocator: event.target.value,
                  })
                }
              />
            </div>
          )}

          {config.mode === 'MRI_FAIL' && (
            <div className={styles.optionGrid}>
              <label className={styles.fieldLabel} htmlFor={`${runnerId}-move`}>
                Move-to-Repair locator
              </label>
              <input
                id={`${runnerId}-move`}
                className={styles.textInput}
                value={config.moveToRepairLocator}
                disabled={configLocked}
                onChange={(event) =>
                  updateRunnerConfig(runnerId, {
                    moveToRepairLocator: event.target.value,
                  })
                }
              />
            </div>
          )}

          <label className={styles.fieldLabel} htmlFor={`${runnerId}-assets`}>
            Assets
          </label>
          <textarea
            id={`${runnerId}-assets`}
            className={styles.assetInput}
            value={config.assetsText}
            placeholder="One asset ID per line"
            disabled={configLocked}
            onChange={(event) =>
              updateRunnerConfig(runnerId, { assetsText: event.target.value })
            }
          />
          <div className={styles.assetCount}>
            {assetsReadyLabel(parsedAssetCount)}
          </div>

          {/* ---- Run controls (contextual) ---- */}
          {runControls.includes('start') && (
            <>
              <button
                type="button"
                className={styles.startButton}
                disabled={startDisabledReason !== null}
                aria-describedby={
                  startDisabledReason !== null ? startHintId : undefined
                }
                title={startDisabledReason ?? undefined}
                onClick={handleStartWorkflow}
              >
                Start Run
              </button>
              {startDisabledReason !== null && (
                <p id={startHintId} className={styles.startHint} role="note">
                  {startDisabledReason}
                </p>
              )}
            </>
          )}

          {(runControls.includes('pause') ||
            runControls.includes('resume') ||
            runControls.includes('stop')) && (
            <div className={styles.runControlsRow}>
              {runControls.includes('pause') && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={pendingEolAction !== null}
                  onClick={() =>
                    void runEolAction('pause', () => window.eolRunner.pauseEol(runnerId))
                  }
                >
                  Pause
                </button>
              )}
              {runControls.includes('resume') && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={pendingEolAction !== null}
                  onClick={() =>
                    void runEolAction('resume', () =>
                      window.eolRunner.resumeEol(runnerId),
                    )
                  }
                >
                  Resume
                </button>
              )}
              {runControls.includes('stop') && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={
                    pendingEolAction !== null || runnerState === 'stopping'
                  }
                  onClick={() =>
                    void runEolAction('stop', () => window.eolRunner.stopEol(runnerId))
                  }
                >
                  {runnerState === 'stopping' ? 'Stopping…' : 'Stop Safely'}
                </button>
              )}
            </div>
          )}

          {snapshot.errorMessage !== null && (
            <p className={styles.runnerError}>{snapshot.errorMessage}</p>
          )}
        </section>

        {/* ---- Run summary ---- */}
        <section className={styles.section} aria-labelledby={`${runnerId}-sum`}>
          <h3 id={`${runnerId}-sum`} className={styles.sectionLabel}>
            Run Summary
          </h3>
          <dl className={styles.summaryGrid}>
            <div className={styles.summaryCell}>
              <dt>Current</dt>
              <dd className={styles.summaryStrong}>{summary.current}</dd>
            </div>
            <div className={styles.summaryCell}>
              <dt>Completed</dt>
              <dd className={styles.summaryStrong}>
                {summary.completed} / {summary.total}
              </dd>
            </div>
            <div className={styles.summaryCell}>
              <dt>Skipped</dt>
              <dd className={styles.summaryStrong}>{summary.skipped}</dd>
            </div>
            <div className={styles.summaryCell}>
              <dt>Needs review</dt>
              <dd className={styles.summaryStrong}>{summary.needsReview}</dd>
            </div>
          </dl>
        </section>

        {/* ---- Results ---- */}
        <section className={styles.section} aria-labelledby={`${runnerId}-res`}>
          <h3 id={`${runnerId}-res`} className={styles.sectionLabel}>
            Results
          </h3>
          <div className={styles.accordionGroup}>
            <ResultAccordion
              title="Completed assets"
              assets={completedAssets}
              onCopy={(text) => void copyText(text)}
            />
            <ResultAccordion
              title="Skipped assets"
              assets={skippedAssets}
              onCopy={(text) => void copyText(text)}
            />
            <ResultAccordion
              title="Needs review"
              assets={needsReviewAssets}
              onCopy={(text) => void copyText(text)}
            />
          </div>
          {copyStatus !== null && (
            <span className={styles.copyStatus} role="status">
              {copyStatus}
            </span>
          )}
        </section>
      </div>
    </aside>
  )
}
