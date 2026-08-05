import { EngineProvider } from './state/EngineProvider'
import { WorkspaceProvider } from './state/WorkspaceProvider'
import { AppShell } from './components/shell/AppShell'
import { HistoryProvider } from './state/HistoryProvider'

/**
 * Application root. Provides runner snapshots/shared managed-Chrome state and the
 * workspace/navigation model, then renders the shell. State and views grow from
 * the providers rather than being threaded through here.
 */
function App() {
  return (
    <EngineProvider>
      <HistoryProvider>
        <WorkspaceProvider>
          <AppShell />
        </WorkspaceProvider>
      </HistoryProvider>
    </EngineProvider>
  )
}

export default App
