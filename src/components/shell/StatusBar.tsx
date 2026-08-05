import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import { isEngineActive } from '../../lib/dashboard'
import styles from './StatusBar.module.css'

/** Bottom status bar: engine state on the left, runner tab count on the right. */
export function StatusBar() {
  const { runners: snapshots } = useEngine()
  const { runners } = useWorkspace()

  const workflows = Object.values(snapshots)
    .filter((runner) => runner !== undefined)
    .map((runner) => runner.workflow)
  const busy = workflows.some(isEngineActive)
  const error = workflows.some((workflow) => workflow.state === 'error')
  const stateLabel = busy ? 'Runners active' : error ? 'Attention required' : 'Ready'
  const runnerCount = runners.length

  return (
    <footer className={styles.bar}>
      <span className={styles.left}>
        <span
          className={`${styles.dot} ${busy ? styles.busy : styles.ready} ${
            error ? styles.error : ''
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
