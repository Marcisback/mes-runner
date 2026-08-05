import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import { deriveRunnerStatus } from '../../lib/dashboard'
import type { RunnerTab } from '../../types/workspace'
import type { EolRunnerSnapshot } from '../../types/eolRunner'
import { Card } from '../common/Card'
import { CircularProgress } from '../common/CircularProgress'
import { RunnerStatusDot } from '../common/RunnerStatusDot'
import { PlusCircleIcon } from '../icons'
import styles from './ActiveRunnersCard.module.css'

/**
 * Lists every real main-process runner with its independent workflow progress.
 * Each card focuses the runner's existing tab; it never creates a duplicate.
 */
export function ActiveRunnersCard() {
  const { runners: snapshots } = useEngine()
  const { runners, setActiveWorkspace, createRunner } =
    useWorkspace()

  return (
    <Card label="Active Runners" className={styles.card}>
      {runners.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No active runners</p>
          <p className={styles.emptyText}>
            Create a runner to configure a workflow, then start it to see live progress here.
          </p>
          <button
            type="button"
            className={styles.emptyAction}
            onClick={() => void createRunner()}
          >
            <PlusCircleIcon size={18} />
            Create Runner
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {runners.map((runner) => (
            <RunnerCard
              key={runner.id}
              runner={runner}
              snapshot={snapshots[runner.id]?.workflow}
              onFocus={() => setActiveWorkspace(runner.id)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

interface RunnerCardProps {
  runner: RunnerTab
  snapshot: EolRunnerSnapshot | undefined
  onFocus(): void
}

function RunnerCard({ runner, snapshot, onFocus }: RunnerCardProps) {
  if (snapshot === undefined) return null
  const status = deriveRunnerStatus(snapshot)
  const percent =
    snapshot.total > 0
      ? Math.round((snapshot.completed / snapshot.total) * 100)
      : 0

  return (
    <button
      type="button"
      className={styles.runnerCard}
      onClick={onFocus}
      aria-label={`Open ${runner.name} — ${snapshot.modeLabel}, ${percent}% complete`}
    >
      <div className={styles.runnerHead}>
        <span className={styles.runnerName}>{runner.name}</span>
        <RunnerStatusDot status={status} showLabel />
      </div>

      <div className={styles.runnerBody}>
        <div className={styles.progressWrap}>
          <CircularProgress
            percent={percent}
            size={108}
            thickness={10}
            active={status === 'running'}
            label={`${runner.name} progress: ${percent}%`}
          >
            <span className={styles.runnerPercent}>{percent}%</span>
          </CircularProgress>
        </div>

        <div className={styles.runnerMeta}>
          <span className={styles.runnerMode}>{snapshot.modeLabel}</span>
          <span className={styles.runnerCount}>
            {snapshot.completed} / {snapshot.total}
          </span>
          {snapshot.needsReview > 0 && (
            <span className={styles.needsReview}>
              {snapshot.needsReview} needs review
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
