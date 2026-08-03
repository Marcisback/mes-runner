import type { Locator } from 'playwright-core'
import { WorkflowInvariantError } from './errors'
import { scopedWait, sleepWithCheckpoint } from './primitives'
import { type WorkflowRuntime } from './types'

const LOCATOR_VERIFY_TIMEOUT_MS = 5_000
const LOCATOR_OPEN_TIMEOUT_MS = 5_000
const LOCATOR_NAV_DELAY_MS = 90
const LOCATOR_MAX_NAV_ITERATIONS = 300

export async function selectRepairLocatorByKeyboard(
  runtime: WorkflowRuntime,
  input: Locator,
  locator: string,
): Promise<void> {
  if (locator.trim().length === 0) {
    throw new WorkflowInvariantError('Locator string was empty.')
  }

  await input.scrollIntoViewIfNeeded()
  await input.click()
  await input.focus()
  await runtime.page.keyboard.press('ArrowDown')

  await scopedWait(
    runtime,
    'opened repair locator dropdown',
    async () => {
      const expanded = await input.getAttribute('aria-expanded').catch(() => null)
      const active = await input.getAttribute('aria-activedescendant').catch(() => null)

      return expanded === 'true' && active !== null && active.length > 0
        ? input
        : null
    },
    LOCATOR_OPEN_TIMEOUT_MS,
  )

  const visited = new Set<string>()

  for (let index = 0; index < LOCATOR_MAX_NAV_ITERATIONS; index += 1) {
    await runtime.checkpoint()

    const activeId = await input
      .getAttribute('aria-activedescendant')
      .catch(() => null)

    if (activeId === null || activeId.length === 0) {
      throw new WorkflowInvariantError(
        `Locator dropdown active option disappeared for "${locator}".`,
      )
    }

    if (visited.has(activeId)) {
      throw new WorkflowInvariantError(`Locator "${locator}" was not found.`)
    }

    visited.add(activeId)

    const optionText = await runtime.page
      .locator(`#${escapeCssId(activeId)}`)
      .innerText()
      .catch(() => '')

    if (normalize(optionText).includes(locator)) {
      await runtime.page.keyboard.press('Enter')
      await verifyCommitted(runtime, input, locator)
      return
    }

    await runtime.page.keyboard.press('ArrowDown')
    await sleepWithCheckpoint(runtime, LOCATOR_NAV_DELAY_MS)
  }

  throw new WorkflowInvariantError(
    `Locator "${locator}" navigation exceeded ${LOCATOR_MAX_NAV_ITERATIONS} iterations.`,
  )
}

async function verifyCommitted(
  runtime: WorkflowRuntime,
  input: Locator,
  locator: string,
): Promise<void> {
  await scopedWait(
    runtime,
    `committed locator "${locator}"`,
    async () => {
      const value = await input.inputValue().catch(() => '')
      return value.includes(locator) ? input : null
    },
    LOCATOR_VERIFY_TIMEOUT_MS,
  )
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function escapeCssId(id: string): string {
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}
