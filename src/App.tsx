import { AppLayout } from './components/layout/AppLayout'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { Footer } from './components/layout/Footer'
import { Welcome } from './components/Welcome'

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
      <Welcome />
    </AppLayout>
  )
}

export default App
