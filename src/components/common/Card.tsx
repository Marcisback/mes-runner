import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  /** Uppercase muted section label shown at the top of the card. */
  label?: string
  /** Optional control rendered opposite the label (e.g. a link). */
  action?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Raised surface card with the shared Computer:)Care styling: rounded corners,
 * subtle border, and an optional uppercase muted label with an action slot.
 * Presentational only.
 */
export function Card({ label, action, className, children }: CardProps) {
  return (
    <section className={`${styles.card} ${className ?? ''}`}>
      {(label !== undefined || action !== undefined) && (
        <div className={styles.head}>
          {label !== undefined && <h2 className={styles.label}>{label}</h2>}
          {action !== undefined && <div className={styles.action}>{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
