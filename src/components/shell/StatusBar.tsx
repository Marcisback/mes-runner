import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import { isEngineActive } from '../../lib/dashboard'
import type { EolRunnerState } from '../../types/eolRunner'
import styles from './StatusBar.module.css'

const RUNNER_STATE_LABEL: Record<EolRunnerState, string> = {
  idle: 'Ready',
  running: 'Running',
  paused: 'Paused',
  stopping: 'Stopping safely',
  completed: 'Run complete',
  error: 'Error',
}

/** Bottom status bar: engine state on the left, runner tab count on the right. */
export function StatusBar() {
  const { snapshot } = useEngine()
  const { runners } = useWorkspace()

  const busy = isEngineActive(snapshot)
  const stateLabel = RUNNER_STATE_LABEL[snapshot.state]
  const runnerCount = runners.length

  return (
    <footer className={styles.bar}>
      <span className={styles.left}>
        <span
          className={`${styles.dot} ${busy ? styles.busy : styles.ready} ${
            snapshot.state === 'error' ? styles.error : ''
          }`}
          aria-hidden="true"
        />
        <span>{stateLabel}</span>
      </span>
      <span className={styles.right}>
        {runnerCount === 0
          ? 'No runners'
          : `${runnerCount} runner${runnerCount === 1 ? '' : 's'}${
              busy ? ' · active' : ''
            }`}
      </span>
    </footer>
  )
}
