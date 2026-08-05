import {
  app,
  MessageChannelMain,
  type BrowserWindow,
  type MessagePortMain,
} from 'electron'
import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Frame,
  type Page,
} from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MANAGED_CHROME_IPC_CHANNELS } from './managedChromeChannels'
import type {
  ManagedChromeFrame,
  ManagedChromeLifecycleState,
  ManagedChromePoint,
  ManagedChromeState,
  ManagedChromeViewport,
  ManagedChromeWheelInput,
} from '../src/types/managedChrome'
import type { RunnerId } from '../src/types/eolRunner'
import { isCurrentRunnerStream } from './runnerManagerCore'
import { sanitizeSensitiveText } from './sanitize.ts'

const MANAGED_CHROME_EXECUTABLE =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MANAGED_CHROME_PROFILE_DIR = 'managed-chrome-profile'
const MES_URL =
  'https://www.internalfb.com/inventory/manufacturing/reverse/triage?env=prod'

const AUTOMATION_VIEWPORT: ManagedChromeViewport = {
  width: 1600,
  height: 1000,
}
const STREAM_JPEG_QUALITY = 60
const STREAM_TARGET_FPS = 18
const STREAM_FRAME_INTERVAL_MS = Math.floor(1000 / STREAM_TARGET_FPS)
const PROFILE_RELEASE_DELAY_MS = 500

const MISSING_CHROME_MESSAGE =
  'Managed Google Chrome is required. Install the organization-managed Google Chrome application and try again.'
const PROFILE_LOCK_MESSAGE =
  'The MES Runner Chrome profile is already in use. Close the stale MES Runner Chrome window and try again.'
const LAUNCH_FAILED_MESSAGE =
  'Managed Chrome could not be launched. Close any stale MES Runner Chrome windows and try again.'
const STREAM_FAILED_MESSAGE =
  'MES streaming could not be started. Stop the session and try again.'
const CLEANUP_FAILED_MESSAGE =
  'Managed Chrome cleanup failed. Close the MES Runner Chrome window manually if it remains open.'
const COMPLIANCE_BLOCKED_MESSAGE =
  'InternalFB rejected headless managed Chrome as non-compliant. Stop the session and use a visible managed Chrome workflow.'
const AUTHENTICATION_REQUIRED_MESSAGE =
  'MES requires manual authentication in a visible managed Chrome window.'

type ContextMode = 'headless' | 'authentication'

interface ActiveContext {
  context: BrowserContext
  page: Page
  mode: ContextMode
  generation: number
  closeListener: () => void
  frameNavigatedListener: (frame: Frame) => void
  loadListener: () => void
}

interface ScreencastFramePayload {
  data?: unknown
  metadata?: {
    deviceWidth?: unknown
    deviceHeight?: unknown
  }
  sessionId?: unknown
}

interface RunnerPageRecord {
  page: Page
  pageGeneration: number
  frameNavigatedListener: (frame: Frame) => void
  loadListener: () => void
  closeListener: () => void
}

export interface AutomationSessionIdentity {
  browserGeneration: number
  pageGeneration: number
}

export class ManagedChromeController {
  private activeContext: ActiveContext | null = null
  private cdpSession: CDPSession | null = null
  private cdpFrameListener: ((payload: unknown) => void) | null = null
  private framePort: MessagePortMain | null = null
  private rendererWantsFramePort = false
  private state: ManagedChromeState = {
    lifecycle: 'stopped',
    errorMessage: null,
    generation: 0,
    viewport: AUTOMATION_VIEWPORT,
  }
  private transitionInProgress: Promise<ManagedChromeState> | null = null
  private frameId = 0
  private lastFrameSentAt = 0
  private generation = 0
  private pageGeneration = 0
  private streamGeneration = 0
  private selectedRunnerId: RunnerId | null = null
  private readonly desiredRunnerIds = new Set<RunnerId>()
  private readonly runnerPages = new Map<RunnerId, RunnerPageRecord>()
  private disposed = false
  private readonly sessionInvalidationListeners = new Set<(
    reason: string,
    runnerId: RunnerId | null,
  ) => void>()
  private readonly rendererReloadListener = (): void => {
    this.closeFramePort()
  }

  constructor(private readonly hostWindow: BrowserWindow) {
    this.hostWindow.webContents.on(
      'did-start-loading',
      this.rendererReloadListener,
    )
  }

  getState(): ManagedChromeState {
    return this.state
  }

  getAutomationPage(runnerId: RunnerId): Page | null {
    if (
      this.state.lifecycle !== 'streaming' ||
      this.activeContext === null ||
      this.activeContext.mode !== 'headless'
    ) {
      return null
    }
    const record = this.runnerPages.get(runnerId)
    return record !== undefined && !record.page.isClosed() ? record.page : null
  }

  getAutomationSessionIdentity(runnerId: RunnerId): AutomationSessionIdentity | null {
    const record = this.runnerPages.get(runnerId)
    return this.getAutomationPage(runnerId) === null || record === undefined
      ? null
      : {
          browserGeneration: this.generation,
          pageGeneration: record.pageGeneration,
        }
  }

  getRunnerPageGeneration(runnerId: RunnerId): number {
    return this.runnerPages.get(runnerId)?.pageGeneration ?? 0
  }

  async createRunnerPage(runnerId: RunnerId): Promise<Page> {
    this.desiredRunnerIds.add(runnerId)
    if (this.activeContext === null || this.activeContext.mode !== 'headless') {
      await this.launch()
    }
    const existing = this.runnerPages.get(runnerId)
    if (existing !== undefined && !existing.page.isClosed()) return existing.page
    return this.createRegisteredRunnerPage(runnerId)
  }

  async closeRunnerPage(runnerId: RunnerId): Promise<void> {
    this.desiredRunnerIds.delete(runnerId)
    if (this.selectedRunnerId === runnerId) {
      await this.selectRunnerStream(null)
    }
    const record = this.runnerPages.get(runnerId)
    if (record === undefined) return
    this.detachRunnerPage(runnerId, record)
    await record.page.close().catch(() => undefined)
  }

  async selectRunnerStream(runnerId: RunnerId | null): Promise<boolean> {
    this.streamGeneration += 1
    await this.stopScreencast()
    this.selectedRunnerId = runnerId
    this.clearCurrentFrame()
    if (runnerId === null) return true
    const page = this.getAutomationPage(runnerId)
    if (page === null) return false
    await this.startScreencast(this.generation, runnerId, page, this.streamGeneration)
    return true
  }

  onAutomationSessionInvalidated(
    listener: (reason: string, runnerId: RunnerId | null) => void,
  ): () => void {
    this.sessionInvalidationListeners.add(listener)
    return () => this.sessionInvalidationListeners.delete(listener)
  }

  async launch(): Promise<ManagedChromeState> {
    if (!canLaunch(this.state.lifecycle)) {
      return this.state
    }

    return this.runTransition(() => this.launchHeadless('launching-headless'))
  }

  async openLoginWindow(): Promise<ManagedChromeState> {
    if (
      this.state.lifecycle !== 'authentication-required' &&
      this.state.lifecycle !== 'streaming' &&
      this.state.lifecycle !== 'loading'
    ) {
      return this.state
    }

    return this.runTransition(() => this.launchAuthenticationWindow())
  }

  async authenticationComplete(): Promise<ManagedChromeState> {
    if (this.state.lifecycle !== 'authenticating') {
      return this.state
    }

    return this.runTransition(() => this.resumeHeadless())
  }

  async cancelAuthentication(): Promise<ManagedChromeState> {
    if (
      this.state.lifecycle !== 'authentication-required' &&
      this.state.lifecycle !== 'authenticating' &&
      this.state.lifecycle !== 'launching-authentication'
    ) {
      return this.state
    }

    return this.runTransition(async () => {
      await this.closeActiveContext()
      return this.setState('stopped')
    })
  }

  async stop(): Promise<ManagedChromeState> {
    if (this.state.lifecycle === 'stopped' && this.activeContext === null) {
      return this.state
    }

    return this.runTransition(async () => {
      await this.closeActiveContext()
      return this.setState('stopped')
    })
  }

  connectFramePort(): void {
    this.rendererWantsFramePort = true
    this.recreateFramePort()
  }

  async mouseMove(runnerId: RunnerId, payload: unknown): Promise<void> {
    await this.runInputTask(async () => {
      const point = parsePoint(payload, this.state.viewport)

      if (point === null || !this.canForwardInput(runnerId)) {
        return
      }

      await this.getSelectedPage(runnerId)?.mouse.move(point.x, point.y)
    })
  }

  async mouseClick(runnerId: RunnerId, payload: unknown): Promise<void> {
    await this.runInputTask(async () => {
      const point = parsePoint(payload, this.state.viewport)

      if (point === null || !this.canForwardInput(runnerId)) {
        return
      }

      await this.getSelectedPage(runnerId)?.mouse.click(point.x, point.y, {
        button: 'left',
      })
      await this.detectAuthenticationState()
    })
  }

  async mouseWheel(runnerId: RunnerId, payload: unknown): Promise<void> {
    await this.runInputTask(async () => {
      const input = parseWheelInput(payload, this.state.viewport)

      if (input === null || !this.canForwardInput(runnerId)) {
        return
      }

      await this.getSelectedPage(runnerId)?.mouse.wheel(input.deltaX, input.deltaY)
    })
  }

  async keyDown(runnerId: RunnerId, payload: unknown): Promise<void> {
    await this.runInputTask(async () => {
      const key = parseKeyInput(payload)

      if (key === null || !this.canForwardInput(runnerId)) {
        return
      }

      await this.getSelectedPage(runnerId)?.keyboard.down(key)
    })
  }

  async keyUp(runnerId: RunnerId, payload: unknown): Promise<void> {
    await this.runInputTask(async () => {
      const key = parseKeyInput(payload)

      if (key === null || !this.canForwardInput(runnerId)) {
        return
      }

      await this.getSelectedPage(runnerId)?.keyboard.up(key)
    })
  }

  async insertText(runnerId: RunnerId, payload: unknown): Promise<void> {
    await this.runInputTask(async () => {
      if (
        typeof payload !== 'string' ||
        payload.length === 0 ||
        payload.length > 128
      ) {
        return
      }

      if (!this.canForwardInput(runnerId)) {
        return
      }

      await this.getSelectedPage(runnerId)?.keyboard.insertText(payload)
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.hostWindow.webContents.off(
      'did-start-loading',
      this.rendererReloadListener,
    )
    this.closeFramePort()

    try {
      await this.closeActiveContext()
    } catch (error: unknown) {
      console.warn(
        `[managed-chrome] Failed to close Chrome during shutdown: ${sanitizeDiagnostic(
          error,
        )}`,
      )
    }
  }

  private async runTransition(
    transition: () => Promise<ManagedChromeState>,
  ): Promise<ManagedChromeState> {
    if (this.disposed) {
      return this.setError(CLEANUP_FAILED_MESSAGE)
    }

    if (this.transitionInProgress !== null) {
      return this.transitionInProgress
    }

    this.transitionInProgress = transition()

    try {
      return await this.transitionInProgress
    } finally {
      this.transitionInProgress = null
    }
  }

  private async runInputTask(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error: unknown) {
      console.warn(
        `[managed-chrome] Input forwarding failed: ${sanitizeDiagnostic(
          error,
        )}`,
      )
    }
  }

  private async launchHeadless(
    startingState: 'launching-headless' | 'resuming-headless',
  ): Promise<ManagedChromeState> {
    const generation = this.nextGeneration()
    this.clearCurrentFrame()
    this.setState(startingState)

    try {
      await verifyManagedChromeExecutable()
      await fs.mkdir(getProfileDirectory(), { recursive: true })

      const context = await chromium.launchPersistentContext(
        getProfileDirectory(),
        {
          channel: 'chrome',
          headless: true,
          chromiumSandbox: true,
          viewport: AUTOMATION_VIEWPORT,
        },
      )

      const page = await getReusablePage(context)
      await page.setViewportSize(AUTOMATION_VIEWPORT)
      this.registerActiveContext(context, page, 'headless', generation)

      this.setState(
        startingState === 'resuming-headless' ? 'resuming-headless' : 'loading',
      )
      await page.goto(MES_URL, { waitUntil: 'domcontentloaded' })

      if (!this.isCurrentGeneration(generation)) {
        await closeContextSafely(context)
        return this.state
      }

      const detection = await this.detectAuthenticationState()

      if (
        detection === 'compliance-blocked' ||
        detection === 'authentication-required'
      ) {
        return this.state
      }

      await this.restoreRunnerPages()
      if (
        this.state.lifecycle === 'authentication-required' ||
        this.state.lifecycle === 'compliance-blocked'
      ) {
        return this.state
      }
      this.setState('streaming')
      if (this.selectedRunnerId !== null) {
        await this.selectRunnerStream(this.selectedRunnerId)
      }
      return this.state
    } catch (error: unknown) {
      await this.closeFailedContext(this.generation)
      return this.setError(getLaunchErrorMessage(error), error)
    }
  }

  private async launchAuthenticationWindow(): Promise<ManagedChromeState> {
    this.clearCurrentFrame()
    this.setState('launching-authentication')

    try {
      await this.closeActiveContext(false, true)
      await waitForProfileRelease()
      await verifyManagedChromeExecutable()
      await fs.mkdir(getProfileDirectory(), { recursive: true })
      const generation = this.nextGeneration()

      const context = await chromium.launchPersistentContext(
        getProfileDirectory(),
        {
          channel: 'chrome',
          headless: false,
          chromiumSandbox: true,
          viewport: AUTOMATION_VIEWPORT,
        },
      )

      const page = await getReusablePage(context)
      this.registerActiveContext(context, page, 'authentication', generation)
      await page.goto(MES_URL, { waitUntil: 'domcontentloaded' })

      if (!this.isCurrentGeneration(generation)) {
        await closeContextSafely(context)
        return this.state
      }

      return this.setState('authenticating')
    } catch (error: unknown) {
      await this.closeFailedContext(this.generation)
      return this.setError(getLaunchErrorMessage(error), error)
    }
  }

  private async resumeHeadless(): Promise<ManagedChromeState> {
    this.clearCurrentFrame()
    this.setState('resuming-headless')

    try {
      await this.closeActiveContext(false, true)
      await waitForProfileRelease()
      return this.launchHeadless('resuming-headless')
    } catch (error: unknown) {
      await this.stopScreencast()
      return this.setError(getLaunchErrorMessage(error), error)
    }
  }

  private registerActiveContext(
    context: BrowserContext,
    page: Page,
    mode: ContextMode,
    generation: number,
  ): void {
    this.pageGeneration += 1
    const closeListener = (): void => {
      this.handleUnexpectedClose(generation)
    }
    const frameNavigatedListener = (frame: Frame): void => {
      if (frame === page.mainFrame()) {
        this.pageGeneration += 1
        this.notifyAutomationSessionInvalidated('Controlled page generation changed.')
      }
      void this.detectAuthenticationState()
    }
    const loadListener = (): void => {
      void this.detectAuthenticationState()
    }

    context.on('close', closeListener)
    page.on('framenavigated', frameNavigatedListener)
    page.on('load', loadListener)

    this.activeContext = {
      context,
      page,
      mode,
      generation,
      closeListener,
      frameNavigatedListener,
      loadListener,
    }
  }

  private async createRegisteredRunnerPage(runnerId: RunnerId): Promise<Page> {
    const activeContext = this.activeContext
    if (activeContext === null || activeContext.mode !== 'headless') {
      throw new Error('Managed Chrome is not ready for runner creation.')
    }
    const page = await activeContext.context.newPage()
    await page.setViewportSize(AUTOMATION_VIEWPORT)
    await page.goto(MES_URL, { waitUntil: 'domcontentloaded' })
    this.pageGeneration += 1
    const pageGeneration = this.pageGeneration
    const frameNavigatedListener = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return
      const record = this.runnerPages.get(runnerId)
      if (record !== undefined) record.pageGeneration = ++this.pageGeneration
      this.notifyAutomationSessionInvalidated(
        'Controlled page generation changed.',
        runnerId,
      )
      void this.detectAuthenticationStateForPage(page)
    }
    const loadListener = (): void => {
      void this.detectAuthenticationStateForPage(page)
    }
    const closeListener = (): void => {
      const record = this.runnerPages.get(runnerId)
      if (record === undefined || record.page !== page) return
      this.detachRunnerPage(runnerId, record)
      this.notifyAutomationSessionInvalidated('Runner page closed.', runnerId)
    }
    page.on('framenavigated', frameNavigatedListener)
    page.on('load', loadListener)
    page.on('close', closeListener)
    this.runnerPages.set(runnerId, {
      page,
      pageGeneration,
      frameNavigatedListener,
      loadListener,
      closeListener,
    })
    await this.detectAuthenticationStateForPage(page)
    return page
  }

  private async restoreRunnerPages(): Promise<void> {
    for (const runnerId of this.desiredRunnerIds) {
      if (!this.runnerPages.has(runnerId)) {
        await this.createRegisteredRunnerPage(runnerId)
      }
    }
  }

  private detachRunnerPage(runnerId: RunnerId, record: RunnerPageRecord): void {
    record.page.off('framenavigated', record.frameNavigatedListener)
    record.page.off('load', record.loadListener)
    record.page.off('close', record.closeListener)
    if (this.runnerPages.get(runnerId) === record) this.runnerPages.delete(runnerId)
  }

  private async startScreencast(
    generation: number,
    runnerId: RunnerId,
    page: Page,
    streamGeneration: number,
  ): Promise<void> {
    const activeContext = this.activeContext

    if (
      activeContext === null ||
      activeContext.mode !== 'headless' ||
      activeContext.generation !== generation
    ) {
      return
    }

    await this.stopScreencast()

    const cdpSession = await activeContext.context.newCDPSession(page)
    const frameListener = (payload: unknown): void => {
      void this.handleScreencastFrame(
        payload,
        generation,
        runnerId,
        streamGeneration,
        cdpSession,
      )
    }

    cdpSession.on('Page.screencastFrame', frameListener)
    this.cdpSession = cdpSession
    this.cdpFrameListener = frameListener

    await cdpSession.send('Page.enable')
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: STREAM_JPEG_QUALITY,
      everyNthFrame: 1,
      maxWidth: this.state.viewport.width,
      maxHeight: this.state.viewport.height,
    })
  }

  private async stopScreencast(): Promise<void> {
    if (this.cdpSession === null) {
      return
    }

    const cdpSession = this.cdpSession
    const listener = this.cdpFrameListener
    this.cdpSession = null
    this.cdpFrameListener = null

    if (listener !== null) {
      cdpSession.off('Page.screencastFrame', listener)
    }

    try {
      await cdpSession.send('Page.stopScreencast')
    } catch (error: unknown) {
      console.warn(
        `[managed-chrome] Failed to stop screencast: ${sanitizeDiagnostic(
          error,
        )}`,
      )
    }

    try {
      await cdpSession.detach()
    } catch (error: unknown) {
      console.warn(
        `[managed-chrome] Failed to detach screencast session: ${sanitizeDiagnostic(
          error,
        )}`,
      )
    }
  }

  private async handleScreencastFrame(
    payload: unknown,
    generation: number,
    runnerId: RunnerId,
    streamGeneration: number,
    frameSession: CDPSession,
  ): Promise<void> {
    const cdpSession = this.cdpSession
    const frame = parseScreencastFramePayload(payload)

    if (
      cdpSession === null ||
      cdpSession !== frameSession ||
      frame === null ||
      !this.isCurrentGeneration(generation) ||
      !isCurrentRunnerStream(
        this.selectedRunnerId,
        this.streamGeneration,
        runnerId,
        streamGeneration,
      ) ||
      this.state.lifecycle !== 'streaming'
    ) {
      return
    }

    const now = Date.now()

    if (now - this.lastFrameSentAt < STREAM_FRAME_INTERVAL_MS) {
      await acknowledgeCdpFrame(cdpSession, frame.sessionId)
      return
    }

    this.lastFrameSentAt = now
    const frameId = this.nextFrameId()
    const imageBuffer = Buffer.from(frame.data, 'base64')
    const transferableBuffer = toExactArrayBuffer(imageBuffer)

    const rendererFrame: ManagedChromeFrame = {
      runnerId,
      generation,
      streamGeneration,
      frameId,
      mimeType: 'image/jpeg',
      data: transferableBuffer,
      viewport: this.state.viewport,
    }

    try {
      if (this.framePort !== null) {
        this.framePort.postMessage(rendererFrame)
      }
    } finally {
      await acknowledgeCdpFrame(cdpSession, frame.sessionId)
    }
  }

  private async detectAuthenticationState(): Promise<
    'none' | 'authentication-required' | 'compliance-blocked'
  > {
    const activeContext = this.activeContext

    if (
      activeContext === null ||
      activeContext.mode !== 'headless' ||
      !this.isCurrentGeneration(activeContext.generation)
    ) {
      return 'none'
    }

    return this.detectAuthenticationStateForPage(activeContext.page)
  }

  private async detectAuthenticationStateForPage(page: Page): Promise<
    'none' | 'authentication-required' | 'compliance-blocked'
  > {
    const pageIsCurrent = this.activeContext?.page === page ||
      [...this.runnerPages.values()].some((record) => record.page === page)
    if (!pageIsCurrent || page.isClosed()) return 'none'

    if (isLikelyAuthenticationUrl(page.url())) {
      this.setState('authentication-required', AUTHENTICATION_REQUIRED_MESSAGE)
      await this.stopScreencast()
      return 'authentication-required'
    }

    try {
      if (
        await hasVisibleText(
          page,
          'Your Meta internal access is blocked due to non-compliant controls.',
        )
      ) {
        this.setState('compliance-blocked', COMPLIANCE_BLOCKED_MESSAGE)
        await this.stopScreencast()
        return 'compliance-blocked'
      }

      if (
        await hasVisibleText(
          page,
          'Your session expired. Refresh the page to sign in again.',
        )
      ) {
        this.setState('authentication-required', AUTHENTICATION_REQUIRED_MESSAGE)
        await this.stopScreencast()
        return 'authentication-required'
      }
    } catch (error: unknown) {
      console.warn(
        `[managed-chrome] Authentication detection failed: ${sanitizeDiagnostic(
          error,
        )}`,
      )
    }

    return 'none'
  }

  private async closeActiveContext(
    emitState = true,
    preserveRunnerPages = false,
  ): Promise<ManagedChromeState> {
    const activeContext = this.activeContext

    await this.stopScreencast()

    if (activeContext === null) {
      return emitState ? this.setState('stopped') : this.state
    }

    this.notifyAutomationSessionInvalidated('Controlled browser or page generation changed.')
    for (const [runnerId, record] of this.runnerPages) {
      this.detachRunnerPage(runnerId, record)
    }
    if (!preserveRunnerPages) this.desiredRunnerIds.clear()
    this.activeContext = null
    activeContext.context.off('close', activeContext.closeListener)
    activeContext.page.off('framenavigated', activeContext.frameNavigatedListener)
    activeContext.page.off('load', activeContext.loadListener)
    this.nextGeneration()

    try {
      await activeContext.context.close()
      return emitState ? this.setState('stopped') : this.state
    } catch (error: unknown) {
      return this.setError(CLEANUP_FAILED_MESSAGE, error)
    }
  }

  private handleUnexpectedClose(generation: number): void {
    if (
      this.disposed ||
      this.activeContext === null ||
      this.activeContext.generation !== generation
    ) {
      return
    }

    const activeContext = this.activeContext
    this.notifyAutomationSessionInvalidated('Managed Chrome disconnected.')
    this.activeContext = null
    activeContext.context.off('close', activeContext.closeListener)
    activeContext.page.off('framenavigated', activeContext.frameNavigatedListener)
    activeContext.page.off('load', activeContext.loadListener)
    this.nextGeneration()
    this.clearCurrentFrame()
    void this.stopScreencast()
    this.setState('disconnected')
  }

  private async closeFailedContext(generation: number): Promise<void> {
    if (
      this.activeContext === null ||
      this.activeContext.generation !== generation
    ) {
      await this.stopScreencast()
      return
    }

    const activeContext = this.activeContext
    this.notifyAutomationSessionInvalidated('Managed Chrome session failed.')
    this.activeContext = null
    activeContext.context.off('close', activeContext.closeListener)
    activeContext.page.off('framenavigated', activeContext.frameNavigatedListener)
    activeContext.page.off('load', activeContext.loadListener)
    this.nextGeneration()
    await this.stopScreencast()
    await closeContextSafely(activeContext.context)
  }

  private canForwardInput(runnerId: RunnerId): boolean {
    return (
      this.state.lifecycle === 'streaming' &&
      this.activeContext !== null &&
      this.activeContext.mode === 'headless' &&
      this.selectedRunnerId === runnerId &&
      this.getAutomationPage(runnerId) !== null
    )
  }

  private getSelectedPage(runnerId: RunnerId): Page | null {
    return this.selectedRunnerId === runnerId
      ? this.getAutomationPage(runnerId)
      : null
  }

  private notifyAutomationSessionInvalidated(
    reason: string,
    runnerId: RunnerId | null = null,
  ): void {
    for (const listener of this.sessionInvalidationListeners) {
      listener(reason, runnerId)
    }
  }

  private setState(
    lifecycle: ManagedChromeLifecycleState,
    errorMessage: string | null = null,
  ): ManagedChromeState {
    this.state = {
      lifecycle,
      errorMessage,
      generation: this.generation,
      viewport: AUTOMATION_VIEWPORT,
    }
    this.emitState()
    return this.state
  }

  private setError(
    message: string,
    diagnostic?: unknown,
  ): ManagedChromeState {
    if (diagnostic !== undefined) {
      console.warn(
        `[managed-chrome] ${message} Diagnostic: ${sanitizeDiagnostic(
          diagnostic,
        )}`,
      )
    }

    return this.setState('error', message)
  }

  private emitState(): void {
    if (this.hostWindow.isDestroyed()) {
      return
    }

    this.hostWindow.webContents.send(
      MANAGED_CHROME_IPC_CHANNELS.stateChanged,
      this.state,
    )
  }

  private clearCurrentFrame(): void {
    if (this.framePort !== null && this.selectedRunnerId !== null) {
      this.framePort.postMessage({
        runnerId: this.selectedRunnerId,
        generation: this.generation,
        streamGeneration: this.streamGeneration,
        frameId: 0,
        mimeType: 'image/jpeg',
        data: new ArrayBuffer(0),
        viewport: this.state.viewport,
      } satisfies ManagedChromeFrame)
    }
  }

  private recreateFramePort(): void {
    this.closeFramePort()

    if (this.hostWindow.isDestroyed()) {
      return
    }

    const { port1, port2 } = new MessageChannelMain()
    this.framePort = port1
    this.hostWindow.webContents.postMessage(
      MANAGED_CHROME_IPC_CHANNELS.framePort,
      null,
      [port2],
    )
  }

  private closeFramePort(): void {
    if (this.framePort === null) {
      return
    }

    this.framePort.close()
    this.framePort = null
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && this.generation === generation
  }

  private nextGeneration(): number {
    this.generation += 1
    this.lastFrameSentAt = 0
    this.closeFramePort()

    if (this.rendererWantsFramePort) {
      this.recreateFramePort()
    }

    return this.generation
  }

  private nextFrameId(): number {
    this.frameId += 1
    return this.frameId
  }
}

function canLaunch(lifecycle: ManagedChromeLifecycleState): boolean {
  return (
    lifecycle === 'stopped' ||
    lifecycle === 'disconnected' ||
    lifecycle === 'error' ||
    lifecycle === 'compliance-blocked'
  )
}

function getProfileDirectory(): string {
  return path.join(app.getPath('userData'), MANAGED_CHROME_PROFILE_DIR)
}

async function verifyManagedChromeExecutable(): Promise<void> {
  try {
    await fs.access(MANAGED_CHROME_EXECUTABLE)
  } catch {
    throw new Error(MISSING_CHROME_MESSAGE)
  }
}

async function getReusablePage(context: BrowserContext): Promise<Page> {
  const existingPage = context.pages().find((page) => !page.isClosed())

  if (existingPage !== undefined) {
    return existingPage
  }

  return context.newPage()
}

async function closeContextSafely(context: BrowserContext): Promise<void> {
  try {
    await context.close()
  } catch (error: unknown) {
    console.warn(
      `[managed-chrome] Failed to close stale context: ${sanitizeDiagnostic(
        error,
      )}`,
    )
  }
}

async function acknowledgeCdpFrame(
  cdpSession: CDPSession | null,
  sessionId: number,
): Promise<void> {
  if (cdpSession === null) {
    return
  }

  try {
    await cdpSession.send('Page.screencastFrameAck', { sessionId })
  } catch (error: unknown) {
    console.warn(
      `[managed-chrome] Failed to acknowledge screencast frame: ${sanitizeDiagnostic(
        error,
      )}`,
    )
  }
}

async function waitForProfileRelease(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, PROFILE_RELEASE_DELAY_MS)
  })
}

async function hasVisibleText(page: Page, text: string): Promise<boolean> {
  try {
    return await page.getByText(text).first().isVisible({ timeout: 250 })
  } catch {
    return false
  }
}

function parseScreencastFramePayload(
  payload: unknown,
): { data: string; sessionId: number } | null {
  if (!isRecord(payload)) {
    return null
  }

  const framePayload = payload as ScreencastFramePayload

  if (
    typeof framePayload.data !== 'string' ||
    typeof framePayload.sessionId !== 'number' ||
    !Number.isFinite(framePayload.sessionId)
  ) {
    return null
  }

  return {
    data: framePayload.data,
    sessionId: framePayload.sessionId,
  }
}

function parsePoint(
  payload: unknown,
  viewport: ManagedChromeViewport,
): ManagedChromePoint | null {
  if (!isRecord(payload)) {
    return null
  }

  const x = sanitizeCoordinate(payload.x, viewport.width)
  const y = sanitizeCoordinate(payload.y, viewport.height)

  if (x === null || y === null) {
    return null
  }

  return { x, y }
}

function parseWheelInput(
  payload: unknown,
  viewport: ManagedChromeViewport,
): ManagedChromeWheelInput | null {
  const point = parsePoint(payload, viewport)

  if (point === null || !isRecord(payload)) {
    return null
  }

  if (
    typeof payload.deltaX !== 'number' ||
    typeof payload.deltaY !== 'number' ||
    !Number.isFinite(payload.deltaX) ||
    !Number.isFinite(payload.deltaY)
  ) {
    return null
  }

  return {
    ...point,
    deltaX: clamp(Math.round(payload.deltaX), -1200, 1200),
    deltaY: clamp(Math.round(payload.deltaY), -1200, 1200),
  }
}

function parseKeyInput(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.key !== 'string') {
    return null
  }

  const key = payload.key.trim()

  if (key.length === 0 || key.length > 40) {
    return null
  }

  return key
}

function sanitizeCoordinate(value: unknown, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return clamp(Math.round(value), 0, Math.max(0, maximum - 1))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )

  return arrayBuffer instanceof ArrayBuffer
    ? arrayBuffer
    : new Uint8Array(arrayBuffer).slice().buffer
}

function isLikelyAuthenticationUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    const value = `${parsedUrl.hostname} ${parsedUrl.pathname}`.toLowerCase()
    return (
      value.includes('login') ||
      value.includes('auth') ||
      value.includes('checkpoint') ||
      value.includes('sso') ||
      value.includes('session')
    )
  } catch {
    return false
  }
}

function getLaunchErrorMessage(error: unknown): string {
  const diagnostic = sanitizeDiagnostic(error).toLowerCase()

  if (diagnostic.includes(MISSING_CHROME_MESSAGE.toLowerCase())) {
    return MISSING_CHROME_MESSAGE
  }

  if (
    diagnostic.includes('profile') ||
    diagnostic.includes('user data directory') ||
    diagnostic.includes('process singleton') ||
    diagnostic.includes('already in use') ||
    diagnostic.includes('singletonlock')
  ) {
    return PROFILE_LOCK_MESSAGE
  }

  if (
    diagnostic.includes('screencast') ||
    diagnostic.includes('target closed') ||
    diagnostic.includes('cdp')
  ) {
    return STREAM_FAILED_MESSAGE
  }

  return LAUNCH_FAILED_MESSAGE
}

function sanitizeDiagnostic(error: unknown): string {
  const message = sanitizeSensitiveText(
    error instanceof Error ? error.message : String(error),
  )
  const replacements = [
    [getProfileDirectory(), '[managed-chrome-profile]'],
    [process.env.HOME, '[home]'],
    [MANAGED_CHROME_EXECUTABLE, '[managed-chrome-executable]'],
  ] as const

  return replacements.reduce((sanitizedMessage, [value, replacement]) => {
    if (value === undefined || value.length === 0) {
      return sanitizedMessage
    }

    return sanitizedMessage.split(value).join(replacement)
  }, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
