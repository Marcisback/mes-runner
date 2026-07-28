import { useState } from 'react'
import styles from './Sidebar.module.css'

/** Navigation entries. Routing will be wired up in a later milestone. */
const NAV_ITEMS = ['Dashboard', 'Automation', 'Logs', 'Settings'] as const

type NavItem = (typeof NAV_ITEMS)[number]

/**
 * Left navigation. For now it tracks the selected item purely for visual
 * feedback — no views are mounted and no routing is performed yet.
 */
export function Sidebar() {
  const [active, setActive] = useState<NavItem>('Dashboard')

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav} aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={`${styles.item} ${item === active ? styles.active : ''}`}
            aria-current={item === active ? 'page' : undefined}
            onClick={() => setActive(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </aside>
  )
}
