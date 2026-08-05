export type ManagedChromeLifecycleState =
  | 'stopped'
  | 'launching-headless'
  | 'loading'
  | 'streaming'
  | 'authentication-required'
  | 'launching-authentication'
  | 'authenticating'
  | 'resuming-headless'
  | 'disconnected'
  | 'compliance-blocked'
  | 'error'

export interface ManagedChromeState {
  lifecycle: ManagedChromeLifecycleState
  errorMessage: string | null
  generation: number
  viewport: ManagedChromeViewport
}

export interface ManagedChromeViewport {
  width: number
  height: number
}

export interface ManagedChromeFrame {
  runnerId: import('./eolRunner').RunnerId
  generation: number
  streamGeneration: number
  frameId: number
  mimeType: 'image/jpeg' | 'image/png'
  data: ArrayBuffer
  viewport: ManagedChromeViewport
}

export interface ManagedChromePoint {
  x: number
  y: number
}

export interface ManagedChromeWheelInput extends ManagedChromePoint {
  deltaX: number
  deltaY: number
}

export interface ManagedChromeKeyInput {
  key: string
}

export interface ManagedChromeApi {
  launch(): Promise<ManagedChromeState>
  openLoginWindow(): Promise<ManagedChromeState>
  authenticationComplete(): Promise<ManagedChromeState>
  cancelAuthentication(): Promise<ManagedChromeState>
  stop(): Promise<ManagedChromeState>
  getState(): Promise<ManagedChromeState>
  selectRunnerStream(runnerId: import('./eolRunner').RunnerId | null): Promise<boolean>
  mouseMove(runnerId: import('./eolRunner').RunnerId, point: ManagedChromePoint): void
  mouseClick(runnerId: import('./eolRunner').RunnerId, point: ManagedChromePoint): void
  mouseWheel(runnerId: import('./eolRunner').RunnerId, input: ManagedChromeWheelInput): void
  keyDown(runnerId: import('./eolRunner').RunnerId, input: ManagedChromeKeyInput): void
  keyUp(runnerId: import('./eolRunner').RunnerId, input: ManagedChromeKeyInput): void
  insertText(runnerId: import('./eolRunner').RunnerId, text: string): void
  onStateChanged(listener: (state: ManagedChromeState) => void): () => void
  onFrame(listener: (frame: ManagedChromeFrame) => void): () => void
}
