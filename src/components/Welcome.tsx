import styles from './Welcome.module.css'

/** Placeholder main-content view shown until real screens are built. */
export function Welcome() {
  return (
    <section className={styles.welcome}>
      <h1 className={styles.title}>Welcome to MES Runner</h1>
      <p className={styles.subtitle}>Application shell initialized.</p>
    </section>
  )
}
