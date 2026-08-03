import { useId, useState } from 'react'
import { formatErrorDetails } from '../../lib/diagnostics'
import type { EolRunnerSnapshot } from '../../types/eolRunner'
import { ChevronRightIcon } from '../icons'
import styles from './RunnerWorkspace.module.css'

type Assets = EolRunnerSnapshot['assets']

interface ResultAccordionProps {
  title: string
  assets: Assets
  onCopy(text: string): void
}

/**
 * A compact, collapsible results section. Empty accordions stay collapsed by
 * default. Result data (ids, reasons, error details, Copy Error Details) is
 * derived from the shared snapshot, so collapsing or switching tabs never loses
 * it. Uses a real button with `aria-expanded` for accessibility.
 */
export function ResultAccordion({ title, assets, onCopy }: ResultAccordionProps) {
  const [open, setOpen] = useState(false)
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const panelId = useId()

  return (
    <div className={styles.accordion}>
      <button
        type="button"
        className={styles.accordionHeader}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon
          size={16}
          className={`${styles.accordionChevron} ${
            open ? styles.accordionChevronOpen : ''
          }`}
        />
        <span className={styles.accordionTitle}>{title}</span>
        <span className={styles.accordionCount}>{assets.length}</span>
      </button>

      {open && (
        <div id={panelId} className={styles.accordionPanel}>
          {assets.length === 0 ? (
            <p className={styles.emptyResult}>None</p>
          ) : (
            <ul className={styles.resultList}>
              {assets.map((asset) => {
                const expanded = expandedAssetId === asset.id
                const detailsText = formatErrorDetails(asset, true)

                return (
                  <li key={asset.id} className={styles.resultItem}>
                    <span>{asset.id}</span>
                    {asset.errorDetails === null ? (
                      <span>{asset.reason ?? asset.state}</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.reasonButton}
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedAssetId(expanded ? null : asset.id)
                        }
                      >
                        {asset.reason ?? asset.state}
                      </button>
                    )}
                    {expanded && asset.errorDetails !== null && (
                      <div className={styles.errorDetails}>
                        <pre>{formatErrorDetails(asset, false)}</pre>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => onCopy(detailsText)}
                        >
                          Copy Error Details
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
