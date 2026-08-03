import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import {
  deriveRecentActivity,
  formatClockTime,
  type RecentActivityItem,
} from '../../lib/dashboard'
import { Card } from '../common/Card'
import { InfoCircleIcon, WarningIcon, XCircleIcon } from '../icons'
import styles from './RecentActivityCard.module.css'

// Recent Activity is only a Dashboard preview; the full history lives in Logs.
// Render at most three rows and let CSS reduce this further at short heights.
const RECENT_LIMIT = 3

/**
 * Concise feed of current-session runner events, newest first. Rows derive from
 * engine diagnostics. A "View all logs" link switches to the Logs view through
 * the shared workspace navigation state — no separate navigation logic.
 */
export function RecentActivityCard() {
  const { snapshot } = useEngine()
  const { openLogs } = useWorkspace()
  const items = deriveRecentActivity(snapshot, RECENT_LIMIT)

  return (
    <Card
      label="Recent Activity"
      action={
        <button
          type="button"
          className={styles.viewAll}
          onClick={() => openLogs('all')}
        >
          View all logs
        </button>
      }
    >
      {items.length === 0 ? (
        <p className={styles.empty}>
          No activity yet this session. Events appear here as runners process
          assets.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function ActivityRow({ item }: { item: RecentActivityItem }) {
  return (
    <li className={styles.row}>
      <span className={`${styles.icon} ${styles[item.severity]}`}>
        <SeverityIcon severity={item.severity} />
      </span>
      <span className={styles.text}>
        <span className={styles.mode}>{item.mode}</span>
        {item.assetId !== null && (
          <span className={styles.asset}>{item.assetId}</span>
        )}
        <span className={styles.message}>{item.message}</span>
      </span>
      <span className={styles.time}>{formatClockTime(item.timestamp)}</span>
    </li>
  )
}

function SeverityIcon({ severity }: { severity: RecentActivityItem['severity'] }) {
  if (severity === 'error') {
    return <XCircleIcon size={18} />
  }

  if (severity === 'warning') {
    return <WarningIcon size={18} />
  }

  return <InfoCircleIcon size={18} />
}
