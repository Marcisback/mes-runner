import { useHistory } from '../../state/historyContext'
import { Card } from '../common/Card'
import { CircularProgress } from '../common/CircularProgress'
import styles from './TodayProgressCard.module.css'

export function TodayProgressCard() {
  const { weekly, health, loading } = useHistory()
  const total = weekly?.total ?? 0
  const categories = weekly === null
    ? []
    : [
        { key: 'MRI', label: 'MRI', count: weekly.byMode.MRI, className: styles.toneSuccess },
        { key: 'MRI_FAIL', label: 'MRI Fail', count: weekly.byMode.MRI_FAIL, className: styles.toneDanger },
        { key: 'EOL', label: 'EOL', count: weekly.byMode.EOL, className: styles.toneNeutral },
        { key: 'NEEDS_REVIEW', label: 'Needs Review', count: weekly.needsReview, className: styles.toneDanger },
      ]

  return (
    <Card label="Weekly Progress" className={styles.card}>
      {!health.available ? (
        <div className={styles.unavailable} role="status">
          <strong>History unavailable</strong>
          <span>{health.message ?? 'Local history could not be loaded.'}</span>
        </div>
      ) : (
      <div className={styles.body}>
        <div className={styles.progressRing}>
          <CircularProgress
            percent={total > 0 ? 100 : 0}
            size={220}
            thickness={16}
            active={false}
            label={`${total} assets run this week`}
          >
            <div className={styles.centerCount}>{loading ? '—' : total}</div>
            <div className={styles.centerLabel}>
              {total === 1 ? 'asset run' : 'assets run'}
            </div>
          </CircularProgress>
        </div>

        <dl className={styles.categories}>
          {categories.map((category) => (
            <div key={category.key} className={styles.category}>
              <dt className={styles.categoryLabel}>{category.label}</dt>
              <dd className={`${styles.categoryValue} ${category.className}`}>
                {category.count}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      )}
      {health.available && !loading && total === 0 && (
        <p className={styles.emptyNote}>
          No assets have been recorded this week.
        </p>
      )}
    </Card>
  )
}
