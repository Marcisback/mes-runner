import { Card } from '../common/Card'
import styles from './SettingsView.module.css'

/**
 * Settings view. This milestone ships a branded placeholder only — no settings
 * system, storage, or configuration is implemented yet. The sections below
 * describe what will be configurable so the surface communicates intent
 * honestly without implying functionality that does not exist.
 */
const PLANNED_SECTIONS = [
  {
    title: 'Managed Chrome',
    description:
      'Profile location and launch behavior are managed by the application and are not configurable here yet.',
  },
  {
    title: 'Workflow defaults',
    description:
      'Default repair and move-to-repair locators are configured per runner for now.',
  },
  {
    title: 'Appearance',
    description: 'Dark theme is the only theme in this milestone.',
  },
] as const

export function SettingsView() {
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Configuration is not available in this milestone. These sections
          outline what will be configurable in a future update.
        </p>
      </header>

      <div className={styles.grid}>
        {PLANNED_SECTIONS.map((section) => (
          <Card key={section.title} label={section.title}>
            <p className={styles.sectionText}>{section.description}</p>
            <span className={styles.badge}>Coming soon</span>
          </Card>
        ))}
      </div>
    </div>
  )
}
