import { useHistory } from '../../state/historyContext'
import { useWorkspace } from '../../state/workspaceContext'
import styles from './NeedsReviewCard.module.css'

export function NeedsReviewCard() {
  const { weekly, health } = useHistory()
  const { openLogs } = useWorkspace()

  const count = weekly?.needsReview ?? 0

  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => openLogs('needs-review')}
      disabled={!health.available}
      aria-label={`Needs-review outcomes this week: ${count}. Open History filtered to needs review.`}
    >
      <span className={styles.label}>Weekly Needs Review</span>
      <span className={styles.row}>
        <span className={styles.count}>{count}</span>
        <span className={styles.unit}>{count === 1 ? 'asset' : 'assets'}</span>
      </span>
    </button>
  )
}
