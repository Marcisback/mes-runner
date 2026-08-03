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
  const { snapshot } = useEngine()
  const {
    runners,
    activeWorkspaceId,
    engineOwnerId,
    setActiveWorkspace,
    closeRunner,
  } = useWorkspace()

  const engineBusy = isEngineActive(snapshot)

  function handleClose(runnerId: string): void {
    const ownsActiveEngine = engineBusy && engineOwnerId === runnerId

    if (ownsActiveEngine) {
      // Guarded by the disabled control; ignored defensively.
      return
    }

    closeRunner(runnerId)
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
        const status = deriveRunnerStatus(runner.id, engineOwnerId, snapshot)
        const ownsActiveEngine = engineBusy && engineOwnerId === runner.id

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
              disabled={ownsActiveEngine}
              aria-label={
                ownsActiveEngine
                  ? `Cannot close ${runner.name} while it is running. Stop it first.`
                  : `Close ${runner.name}`
              }
              title={
                ownsActiveEngine
                  ? 'Stop this runner before closing.'
                  : `Close ${runner.name}`
              }
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
