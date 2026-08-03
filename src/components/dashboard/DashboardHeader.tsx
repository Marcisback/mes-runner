import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import { formatTodayLabel } from '../../lib/dashboard'
import { PlusCircleIcon } from '../icons'
import styles from './DashboardHeader.module.css'

/**
 * Compact Dashboard header: the Computer:)Care wordmark and date on the left,
 * the Create Runner action and global system-status pill on the right.
 */
export function DashboardHeader() {
  const { snapshot, chromeState } = useEngine()
  const { createRunner, runners } = useWorkspace()

  const runnerExists = runners.length > 0
  const actionLabel = runnerExists ? 'Open Runner' : 'Create Runner'

  const attention =
    snapshot.state === 'error' ||
    chromeState.lifecycle === 'error' ||
    chromeState.lifecycle === 'compliance-blocked'

  const todayLabel = formatTodayLabel(new Date())

  return (
    <header className={styles.header}>
      <div className={styles.brandBlock}>
        <div className={styles.wordmark}>
          <span>Computer</span>
          <span className={styles.accent}>:)</span>
          <span>Care</span>
        </div>
        <div className={styles.subline}>
          <span className={styles.product}>MES RUNNER</span>
          <span className={styles.divider} aria-hidden="true">
            ·
          </span>
          <span className={styles.date}>Today · {todayLabel}</span>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.createButton}
          onClick={() => createRunner()}
          aria-label={
            runnerExists
              ? 'Open the existing Runner 1 tab'
              : 'Create Runner 1'
          }
        >
          <PlusCircleIcon size={18} />
          {actionLabel}
        </button>

        <span
          className={`${styles.systemPill} ${
            attention ? styles.attention : styles.ready
          }`}
        >
          <span className={styles.pillDot} aria-hidden="true" />
          {attention ? 'ATTENTION' : 'SYSTEM READY'}
        </span>
      </div>
    </header>
  )
}
