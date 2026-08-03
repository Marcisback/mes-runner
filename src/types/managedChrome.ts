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
  generation: number
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
  setViewport(viewport: ManagedChromeViewport): void
  mouseMove(point: ManagedChromePoint): void
  mouseClick(point: ManagedChromePoint): void
  mouseWheel(input: ManagedChromeWheelInput): void
  keyDown(input: ManagedChromeKeyInput): void
  keyUp(input: ManagedChromeKeyInput): void
  insertText(text: string): void
  onStateChanged(listener: (state: ManagedChromeState) => void): () => void
  onFrame(listener: (frame: ManagedChromeFrame) => void): () => void
}
