import { useRef } from 'react'
import { useWorkspace } from '../../state/workspaceContext'
import type { PrimaryWorkspaceId } from '../../types/workspace'
import {
  DashboardIcon,
  LogsIcon,
  SettingsIcon,
} from '../icons'
import styles from './ActivityRail.module.css'

interface RailItem {
  id: PrimaryWorkspaceId
  label: string
  Icon: (props: { size?: number }) => JSX.Element
}

const RAIL_ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { id: 'logs', label: 'Logs', Icon: LogsIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
]

/**
 * VS Code-style narrow activity rail for the permanent primary views. Icons are
 * unlabelled visually but carry `aria-label`s and hover/focus tooltips.
 * Arrow keys move focus between rail buttons (roving tab order).
 */
export function ActivityRail() {
  const { activeWorkspaceId, setActiveWorkspace, openLogs } = useWorkspace()
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])

  function openWorkspace(id: PrimaryWorkspaceId): void {
    // Logs uses the dedicated opener so navigation flows through one place; a
    // plain rail click applies no result filter.
    if (id === 'logs') {
      openLogs('all')
    } else {
      setActiveWorkspace(id)
    }
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex =
      (index + delta + RAIL_ITEMS.length) % RAIL_ITEMS.length
    buttonRefs.current[nextIndex]?.focus()
  }

  return (
    <nav className={styles.rail} aria-label="Primary views">
      {RAIL_ITEMS.map((item, index) => {
        const active = activeWorkspaceId === item.id

        return (
          <button
            key={item.id}
            ref={(node) => {
              buttonRefs.current[index] = node
            }}
            type="button"
            className={`${styles.item} ${active ? styles.active : ''}`}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => openWorkspace(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <item.Icon size={22} />
            <span className={styles.tooltip} role="tooltip">
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
