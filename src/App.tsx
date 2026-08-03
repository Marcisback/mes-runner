import { EngineProvider } from './state/EngineProvider'
import { WorkspaceProvider } from './state/WorkspaceProvider'
import { AppShell } from './components/shell/AppShell'

/**
 * Application root. Provides the shared engine/managed-Chrome state and the
 * workspace/navigation model, then renders the shell. State and views grow from
 * the providers rather than being threaded through here.
 */
function App() {
  return (
    <EngineProvider>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </EngineProvider>
  )
}

export default App
