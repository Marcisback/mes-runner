import type { ReactNode } from 'react'
import styles from './CircularProgress.module.css'

interface CircularProgressProps {
  /** Completion from 0 to 100. */
  percent: number
  /** Maximum diameter in pixels; the ring fills its container up to this. */
  size?: number
  /** Ring thickness, in the same units as {@link size}. */
  thickness?: number
  /** Accessible description of what the ring measures. */
  label: string
  /** When true, shows a restrained motion cue (honors reduced-motion). */
  active?: boolean
  /** Ring color token; defaults to the accent. */
  tone?: 'accent' | 'success' | 'muted'
  children?: ReactNode
}

/**
 * Presentational circular progress ring. Exposes its value through a
 * `progressbar` role so assistive technology can read completion. The optional
 * `active` cue is a slow, subtle pulse that is disabled under
 * `prefers-reduced-motion` via the global stylesheet.
 */
export function CircularProgress({
  percent,
  size = 200,
  thickness = 14,
  label,
  active = false,
  tone = 'accent',
  children,
}: CircularProgressProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped / 100)
  const center = size / 2

  const toneClass =
    tone === 'success'
      ? styles.toneSuccess
      : tone === 'muted'
        ? styles.toneMuted
        : styles.toneAccent

  return (
    <div
      className={styles.wrapper}
      style={{ maxWidth: size }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg
        className={`${styles.svg} ${active ? styles.active : ''}`}
        width="100%"
        height="100%"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          className={styles.track}
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={thickness}
          fill="none"
        />
        <circle
          className={`${styles.progress} ${toneClass}`}
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className={styles.center}>{children}</div>
    </div>
  )
}
