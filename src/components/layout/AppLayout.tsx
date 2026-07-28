import type { ReactNode } from 'react'
import styles from './AppLayout.module.css'

interface AppLayoutProps {
  header: ReactNode
  sidebar: ReactNode
  footer: ReactNode
  children: ReactNode
}

/**
 * Top-level application shell. Arranges the header, sidebar, main content, and
 * footer into a fixed CSS grid. It owns layout only — each region is passed in
 * as a slot so this component stays presentation-agnostic and reusable.
 */
export function AppLayout({ header, sidebar, footer, children }: AppLayoutProps) {
  return (
    <div className={styles.layout}>
      <div className={styles.header}>{header}</div>
      <div className={styles.sidebar}>{sidebar}</div>
      <main className={styles.main}>{children}</main>
      <div className={styles.footer}>{footer}</div>
    </div>
  )
}
