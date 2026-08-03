import { useEngine } from '../../state/engineContext'
import { deriveTodayProgress, isEngineActive } from '../../lib/dashboard'
import { Card } from '../common/Card'
import { CircularProgress } from '../common/CircularProgress'
import styles from './TodayProgressCard.module.css'

const CATEGORY_TONE_CLASS = {
  success: styles.toneSuccess,
  danger: styles.toneDanger,
  neutral: styles.toneNeutral,
} as const

/**
 * Large progress card summarizing the current session: a circular completion
 * ring with the completed/total count at its center, plus per-mode category
 * totals. All values derive from the live engine snapshot — there is no
 * historical persistence, so an empty session shows an honest empty state.
 */
export function TodayProgressCard() {
  const { snapshot } = useEngine()
  const progress = deriveTodayProgress(snapshot)
  const active = isEngineActive(snapshot)

  return (
    <Card label="Today's Progress" className={styles.card}>
      <div className={styles.body}>
        <div className={styles.progressRing}>
          <CircularProgress
            percent={progress.percent}
            size={220}
            thickness={16}
            active={active}
            label={`Today's progress: ${progress.completed} of ${progress.total} assets complete`}
          >
            <div className={styles.centerCount}>
              {progress.completed} / {progress.total}
            </div>
            <div className={styles.centerLabel}>
              {progress.hasData
                ? `${progress.percent}% complete`
                : 'No runs yet'}
            </div>
          </CircularProgress>
        </div>

        <dl className={styles.categories}>
          {progress.categories.map((category) => (
            <div key={category.key} className={styles.category}>
              <dt className={styles.categoryLabel}>{category.label}</dt>
              <dd
                className={`${styles.categoryValue} ${
                  CATEGORY_TONE_CLASS[category.tone]
                }`}
              >
                {category.count}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {!progress.hasData && (
        <p className={styles.emptyNote}>
          Category totals reflect the current session and populate as runners
          complete assets.
        </p>
      )}
    </Card>
  )
}
