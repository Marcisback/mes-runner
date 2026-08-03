import { AppLayout } from './components/layout/AppLayout'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { Footer } from './components/layout/Footer'
import { ManagedChromeView } from './components/browser/ManagedChromeView'

/**
 * Application root. Composes the shell regions; state and views will grow from
 * here as features are added.
 */
function App() {
  return (
    <AppLayout
      header={<Header status="Idle" />}
      sidebar={<Sidebar />}
      footer={<Footer message="Ready" />}
    >
      <ManagedChromeView />
    </AppLayout>
  )
}

export default App
