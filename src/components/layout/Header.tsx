import { StatusBadge } from '../common/StatusBadge'
import styles from './Header.module.css'

interface HeaderProps {
  status: string
}

/**
 * Application header: brand on the left, current run status on the right.
 */
export function Header({ status }: HeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.brand}>MES Runner</span>
      <StatusBadge label="Status" value={status} />
    </header>
  )
}
