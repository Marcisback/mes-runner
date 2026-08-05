import { type Locator, type Page } from 'playwright-core'
import {
  BrowserDisconnectedError,
  StopRequestedError,
  WorkflowInvariantError,
} from './errors.ts'
import { closePopupIfPresent } from './popupHandler.ts'
import { WORKFLOW_TIMEOUTS, type WorkflowRuntime } from './types.ts'

export async function popupAwareWait<T>(
  runtime: WorkflowRuntime,
  description: string,
  find: () => Promise<T | null>,
  timeoutMs: number = WORKFLOW_TIMEOUTS.defaultMs,
): Promise<T> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    await runtime.checkpoint()
      await closePopupIfPresent(runtime)
    await runtime.checkpoint()

    const result = await find()

    if (result !== null) {
      return result
    }

    await sleepWithCheckpoint(runtime, WORKFLOW_TIMEOUTS.popupPollMs)
  }

  runtime.log('warning', 'Wait timed out.', {
    errorClass: 'WorkflowInvariantError',
    reason: description,
  })
  throw new WorkflowInvariantError(`Timed out waiting for ${description}.`)
}

export async function scopedWait<T>(
  runtime: WorkflowRuntime,
  description: string,
  find: () => Promise<T | null>,
  timeoutMs: number = WORKFLOW_TIMEOUTS.defaultMs,
): Promise<T> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    await runtime.checkpoint()

    const result = await find()

    if (result !== null) {
      return result
    }

    await sleepWithCheckpoint(runtime, WORKFLOW_TIMEOUTS.scopedPollMs)
  }

  runtime.log('warning', 'Scoped wait timed out.', {
    errorClass: 'WorkflowInvariantError',
    reason: description,
  })
  throw new WorkflowInvariantError(`Timed out waiting for ${description}.`)
}

export async function sleepWithCheckpoint(
  runtime: WorkflowRuntime,
  ms: number,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < ms) {
    await runtime.checkpoint()

    const remaining = ms - (Date.now() - startedAt)
    await delay(Math.min(WORKFLOW_TIMEOUTS.stopPollMs, remaining))
  }
}

export async function typeAndSubmit(
  runtime: WorkflowRuntime,
  input: Locator,
  value: string,
): Promise<void> {
  await runtime.checkpoint()
  await input.scrollIntoViewIfNeeded()
  if (!(await isVisibleAndEnabled(input))) {
    throw new WorkflowInvariantError('Workflow input was not actionable after scrolling.')
  }
  await input.click()
  await input.fill('')
  await input.fill(value)
  if ((await input.inputValue()) !== value) {
    throw new WorkflowInvariantError('Workflow input did not retain the expected asset before submission.')
  }
  await sleepWithCheckpoint(runtime, 150)
  await runtime.page.keyboard.press('Enter')
  await sleepWithCheckpoint(runtime, 400)
}

export async function clickWithSettles(
  runtime: WorkflowRuntime,
  locator: Locator,
  preMs: number,
  postMs: number,
): Promise<void> {
  await runtime.checkpoint()
  await locator.scrollIntoViewIfNeeded()
  if (!(await isVisibleAndEnabled(locator))) {
    throw new WorkflowInvariantError('Workflow control was not actionable after scrolling.')
  }
  await sleepWithCheckpoint(runtime, preMs)
  await locator.click()
  await sleepWithCheckpoint(runtime, postMs)
}

export async function waitScopedVisibleAndEnabled(
  runtime: WorkflowRuntime,
  locator: Locator,
  description: string,
  timeoutMs: number = WORKFLOW_TIMEOUTS.defaultMs,
): Promise<Locator> {
  return scopedWait(
    runtime,
    description,
    async () =>
      (await isVisibleAndEnabled(locator))
        ? locator
        : null,
    timeoutMs,
  )
}

export async function isLocatorVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false)
}

export async function isLocatorEnabled(locator: Locator): Promise<boolean> {
  return locator.isEnabled().catch(() => false)
}

export async function isLocatorEditable(locator: Locator): Promise<boolean> {
  return locator.isEditable().catch(() => false)
}

export async function isVisibleAndEnabled(locator: Locator): Promise<boolean> {
  return (await isLocatorVisible(locator)) && (await isLocatorEnabled(locator))
}

export async function visibleMatches(locator: Locator): Promise<Locator[]> {
  const count = await locator.count().catch(() => 0)
  const matches: Locator[] = []

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)

    if (await isLocatorVisible(candidate)) {
      matches.push(candidate)
    }
  }

  return matches
}

export async function uniqueVisible(
  locator: Locator,
  description: string,
): Promise<Locator> {
  const matches = await visibleMatches(locator)

  if (matches.length !== 1) {
    throw new WorkflowInvariantError(
      `${description} resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0]
}

export async function singleVisibleOrNull(
  locator: Locator,
  description: string,
): Promise<Locator | null> {
  const matches = await visibleMatches(locator)

  if (matches.length > 1) {
    throw new WorkflowInvariantError(
      `${description} resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0] ?? null
}

export async function visibleEnabledMatches(locator: Locator): Promise<Locator[]> {
  const count = await locator.count().catch(() => 0)
  const matches: Locator[] = []

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)

    if (await isVisibleAndEnabled(candidate)) {
      matches.push(candidate)
    }
  }

  return matches
}

export async function uniqueVisibleEnabled(
  locator: Locator,
  description: string,
): Promise<Locator> {
  const matches = await visibleEnabledMatches(locator)

  if (matches.length !== 1) {
    throw new WorkflowInvariantError(
      `${description} resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0]
}

export async function singleVisibleEnabledOrNull(
  locator: Locator,
  description: string,
): Promise<Locator | null> {
  const matches = await visibleEnabledMatches(locator)

  if (matches.length > 1) {
    throw new WorkflowInvariantError(
      `${description} resolved ${matches.length} candidates; expected exactly one.`,
    )
  }

  return matches[0] ?? null
}

export async function ensureConnected(page: Page): Promise<void> {
  if (page.isClosed()) {
    throw new BrowserDisconnectedError()
  }
}

export function throwIfStopped(runtime: WorkflowRuntime): void {
  if (runtime.isStopRequested()) {
    throw new StopRequestedError()
  }
}

export async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
