import type { Page } from 'playwright-core'
import type { ManagedChromeState } from '../src/types/managedChrome'
import type { AutomationSessionIdentity } from './managedChromeController'

export interface RunnerBrowserAccess {
  getAutomationPage(): Page | null
  getAutomationSessionIdentity(): AutomationSessionIdentity | null
  getState(): ManagedChromeState
  onAutomationSessionInvalidated(listener: (reason: string) => void): () => void
}
