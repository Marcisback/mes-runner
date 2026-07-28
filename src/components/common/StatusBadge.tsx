import styles from './StatusBadge.module.css'

interface StatusBadgeProps {
  label: string
  value: string
}

/**
 * Compact "label: value" indicator with a status dot. Presentational and
 * reusable — the app status is passed in rather than derived here.
 */
export function StatusBadge({ label, value }: StatusBadgeProps) {
  return (
    <span className={styles.badge}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{label}:</span>
      <span className={styles.value}>{value}</span>
    </span>
  )
}
