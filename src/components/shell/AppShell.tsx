import { useWorkspace } from '../../state/workspaceContext'
import { isPrimaryWorkspace, type PrimaryWorkspaceId } from '../../types/workspace'
import { DashboardView } from '../dashboard/DashboardView'
import { LogsView } from '../logs/LogsView'
import { SettingsView } from '../settings/SettingsView'
import { RunnerWorkspace } from '../runner/RunnerWorkspace'
import { ActivityRail } from './ActivityRail'
import { WorkspaceTabs } from './WorkspaceTabs'
import { StatusBar } from './StatusBar'
import styles from './AppShell.module.css'
import type { RunnerId } from '../../types/eolRunner'

/**
 * Top-level application shell: a narrow activity rail, a horizontal workspace
 * tab strip, the active workspace, and a bottom status bar.
 *
 * A single {@link RunnerWorkspace} instance is kept mounted whenever any runner
 * exists and is merely hidden (not unmounted) when a primary view is active or
 * when switching between runner tabs. This preserves the engine-owned stream,
 * canvas, frame subscription, and diagnostics across every navigation — nothing
 * restarts, resets, or duplicates.
 */
export function AppShell() {
  const {
    runners,
    activeWorkspaceId,
    lastActiveRunnerId,
    getRunnerName,
  } = useWorkspace()

  const activeIsPrimary = isPrimaryWorkspace(activeWorkspaceId)

  // Choose which runner the persistent workspace should render. When a runner
  // tab is active it is that runner; otherwise fall back to the last focused
  // runner (or any remaining runner) so the instance stays mounted while hidden.
  let displayedRunnerId: RunnerId | null = null
  if (!activeIsPrimary) {
    displayedRunnerId = activeWorkspaceId as RunnerId
  } else if (
    lastActiveRunnerId !== null &&
    runners.some((runner) => runner.id === lastActiveRunnerId)
  ) {
    displayedRunnerId = lastActiveRunnerId
  } else if (runners.length > 0) {
    displayedRunnerId = runners[runners.length - 1].id
  }

  const displayedRunnerName =
    displayedRunnerId !== null ? getRunnerName(displayedRunnerId) : null

  return (
    <div className={styles.shell}>
      <div className={styles.rail}>
        <ActivityRail />
      </div>

      <div className={styles.tabs}>
        <WorkspaceTabs />
      </div>

      <main className={styles.main}>
        {activeIsPrimary && (
          <div className={styles.primaryHost}>
            <PrimaryView id={activeWorkspaceId as PrimaryWorkspaceId} />
          </div>
        )}

        {displayedRunnerId !== null && displayedRunnerName !== null && (
          <div className={activeIsPrimary ? styles.hidden : styles.runnerHost}>
            <RunnerWorkspace
              runnerId={displayedRunnerId}
              runnerName={displayedRunnerName}
            />
          </div>
        )}
      </main>

      <div className={styles.status}>
        <StatusBar />
      </div>
    </div>
  )
}

function PrimaryView({ id }: { id: PrimaryWorkspaceId }) {
  if (id === 'logs') {
    return <LogsView />
  }

  if (id === 'settings') {
    return <SettingsView />
  }

  return <DashboardView />
}
