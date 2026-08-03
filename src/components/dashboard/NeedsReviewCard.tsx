import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import styles from './NeedsReviewCard.module.css'

/**
 * Clickable summary of assets awaiting manual review. The count comes from the
 * shared engine snapshot (the single source of truth also used by Logs), and
 * clicking opens the Logs workspace pre-filtered to needs-review — rather than
 * maintaining a separate needs-review dataset or drawer.
 */
export function NeedsReviewCard() {
  const { snapshot } = useEngine()
  const { openLogs } = useWorkspace()

  const count = snapshot.needsReview

  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => openLogs('needs-review')}
      aria-label={`Needs review: ${count} asset${
        count === 1 ? '' : 's'
      }. Open the Logs view filtered to needs review.`}
    >
      <span className={styles.label}>Needs Review</span>
      <span className={styles.row}>
        <span className={styles.count}>{count}</span>
        <span className={styles.unit}>{count === 1 ? 'asset' : 'assets'}</span>
      </span>
    </button>
  )
}
