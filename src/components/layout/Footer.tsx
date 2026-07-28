import styles from './Footer.module.css'

interface FooterProps {
  message: string
}

/** Status bar pinned to the bottom of the window. */
export function Footer({ message }: FooterProps) {
  return <footer className={styles.footer}>{message}</footer>
}
