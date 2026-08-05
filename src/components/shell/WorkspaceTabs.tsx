import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import {
  deriveRunnerStatus,
  isEngineActive,
} from '../../lib/dashboard'
import { RunnerStatusDot } from '../common/RunnerStatusDot'
import { CloseIcon } from '../icons'
import styles from './WorkspaceTabs.module.css'

/**
 * Horizontal, VS Code-style tab strip. The Dashboard tab is permanent and
 * cannot be closed. Runner tabs are closable only when doing so is safe — a
 * runner that currently owns an in-progress engine run cannot be closed (its
 * close control is disabled), so automation is never stopped silently by
 * closing a tab.
 */
export function WorkspaceTabs() {
  const { runners: snapshots } = useEngine()
  const {
    runners,
    activeWorkspaceId,
    setActiveWorkspace,
    closeRunner,
  } = useWorkspace()

  function handleClose(runnerId: string): void {
    const snapshot = snapshots[runnerId as keyof typeof snapshots]?.workflow
    if (snapshot !== undefined && isEngineActive(snapshot)) {
      const confirmed = window.confirm(
        'This runner is active. Stop it safely and close the runner?',
      )
      if (!confirmed) return
    }
    void closeRunner(runnerId as import('../../types/eolRunner').RunnerId)
  }

  return (
    <div className={styles.strip} role="tablist" aria-label="Workspaces">
      <button
        type="button"
        role="tab"
        aria-selected={activeWorkspaceId === 'dashboard'}
        className={`${styles.tab} ${
          activeWorkspaceId === 'dashboard' ? styles.active : ''
        }`}
        onClick={() => setActiveWorkspace('dashboard')}
      >
        <span className={styles.tabLabel}>Dashboard</span>
      </button>

      {runners.map((runner) => {
        const active = activeWorkspaceId === runner.id
        const snapshot = snapshots[runner.id]?.workflow
        const status = snapshot === undefined ? 'idle' : deriveRunnerStatus(snapshot)

        return (
          <div
            key={runner.id}
            className={`${styles.tab} ${styles.runnerTab} ${
              active ? styles.active : ''
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={styles.tabButton}
              onClick={() => setActiveWorkspace(runner.id)}
            >
              <RunnerStatusDot status={status} />
              <span className={styles.tabLabel}>{runner.name}</span>
            </button>
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${runner.name}`}
              title={`Close ${runner.name}`}
              onClick={() => handleClose(runner.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
