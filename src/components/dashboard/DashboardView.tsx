import { DashboardHeader } from './DashboardHeader'
import { TodayProgressCard } from './TodayProgressCard'
import { ActiveRunnersCard } from './ActiveRunnersCard'
import { NeedsReviewCard } from './NeedsReviewCard'
import { RecentActivityCard } from './RecentActivityCard'
import styles from './DashboardView.module.css'

/**
 * The permanent Dashboard. Composes the header and the operational cards; each
 * card owns its own derivation from runner snapshots. This component
 * only handles layout so no single oversized Dashboard component emerges.
 */
export function DashboardView() {
  return (
    <div className={styles.view}>
      <DashboardHeader />

      <div className={styles.grid}>
        <div className={styles.leftColumn}>
          <TodayProgressCard />
          <NeedsReviewCard />
        </div>
        <div className={styles.rightColumn}>
          <ActiveRunnersCard />
        </div>
      </div>

      <RecentActivityCard />
    </div>
  )
}
