import { useEngine } from '../../state/engineContext'
import { useWorkspace } from '../../state/workspaceContext'
import { deriveRunnerStatus } from '../../lib/dashboard'
import type { RunnerTab } from '../../types/workspace'
import { Card } from '../common/Card'
import { CircularProgress } from '../common/CircularProgress'
import { RunnerStatusDot } from '../common/RunnerStatusDot'
import { PlusCircleIcon } from '../icons'
import styles from './ActiveRunnersCard.module.css'

/**
 * Lists runners that are active or recently active. Because the engine is a
 * singleton, at most one runner (the current engine owner) can be active at a
 * time — this honestly reflects that rather than implying parallel execution.
 * Each card focuses the runner's existing tab; it never creates a duplicate.
 */
export function ActiveRunnersCard() {
  const { snapshot } = useEngine()
  const { runners, engineOwnerId, setActiveWorkspace, createRunner } =
    useWorkspace()

  const activeRunners = runners.filter(
    (runner) => runner.id === engineOwnerId && snapshot.total > 0,
  )

  // A runner can exist but be idle (engine not running). Reflect that honestly:
  // offer to open the existing Runner 1 rather than implying a new one.
  const runnerExists = runners.length > 0

  return (
    <Card label="Active Runners" className={styles.card}>
      {activeRunners.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No active runners</p>
          <p className={styles.emptyText}>
            {runnerExists
              ? 'Runner 1 is idle. Open it to configure and start a workflow.'
              : 'Create a runner to configure a workflow, then start it to see live progress here.'}
          </p>
          <button
            type="button"
            className={styles.emptyAction}
            onClick={() => createRunner()}
          >
            <PlusCircleIcon size={18} />
            {runnerExists ? 'Open Runner' : 'Create Runner'}
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {activeRunners.map((runner) => (
            <RunnerCard
              key={runner.id}
              runner={runner}
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
  onFocus(): void
}

function RunnerCard({ runner, onFocus }: RunnerCardProps) {
  const { snapshot } = useEngine()
  const { engineOwnerId } = useWorkspace()

  const status = deriveRunnerStatus(runner.id, engineOwnerId, snapshot)
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
