import type { RunnerStatus } from '../../types/workspace'
import styles from './RunnerStatusDot.module.css'

const STATUS_LABEL: Record<RunnerStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  paused: 'Paused',
  'needs-review': 'Needs review',
  error: 'Error',
}

const STATUS_CLASS: Record<RunnerStatus, string> = {
  running: styles.running,
  idle: styles.idle,
  paused: styles.paused,
  'needs-review': styles.needsReview,
  error: styles.error,
}

interface RunnerStatusDotProps {
  status: RunnerStatus
  /** When true, renders the status word next to the dot. */
  showLabel?: boolean
}

/**
 * Small colored status indicator for a runner. The status word is always
 * available to assistive tech even when the visible label is hidden.
 */
export function RunnerStatusDot({
  status,
  showLabel = false,
}: RunnerStatusDotProps) {
  const label = STATUS_LABEL[status]

  return (
    <span className={styles.wrapper}>
      <span
        className={`${styles.dot} ${STATUS_CLASS[status]}`}
        aria-hidden="true"
      />
      {showLabel ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className={styles.srOnly}>{label}</span>
      )}
    </span>
  )
}
