import test from 'node:test'
import assert from 'node:assert/strict'
import { AssetSkipError } from './errors.ts'
import {
  closePopupIfPresent,
  type PopupOwnershipContext,
} from './popupHandler.ts'
import { classifyVisibleDialog } from './dialogOwnershipCore.ts'
import type { WorkflowRuntime } from './types.ts'

interface DialogFixture {
  text: string
  closeLabel: string | null
  closeClicks: number
}

class FixtureLocator {
  private readonly fixtures: DialogFixture[]
  private readonly buttons: boolean

  constructor(fixtures: DialogFixture[], buttons = false) {
    this.fixtures = fixtures
    this.buttons = buttons
  }

  count(): Promise<number> { return Promise.resolve(this.fixtures.length) }
  nth(index: number): FixtureLocator {
    const fixture = this.fixtures[index]
    return new FixtureLocator(fixture === undefined ? [] : [fixture], this.buttons)
  }
  isVisible(): Promise<boolean> { return Promise.resolve(this.fixtures.length === 1) }
  innerText(): Promise<string> {
    const fixture = this.fixtures[0]
    return Promise.resolve(this.buttons ? fixture?.closeLabel ?? '' : fixture?.text ?? '')
  }
  getByRole(role: string): FixtureLocator {
    if (role !== 'button') return new FixtureLocator([])
    const fixture = this.fixtures[0]
    return new FixtureLocator(
      fixture?.closeLabel === null || fixture === undefined ? [] : [fixture],
      true,
    )
  }
  click(): Promise<void> {
    const fixture = this.fixtures[0]
    if (fixture !== undefined) fixture.closeClicks += 1
    return Promise.resolve()
  }
}

function runtime(
  fixture: DialogFixture | DialogFixture[],
  logs: string[],
): WorkflowRuntime {
  const dialogs = new FixtureLocator(Array.isArray(fixture) ? fixture : [fixture])
  const log: WorkflowRuntime['log'] = (_severity, message) => { logs.push(message) }
  return {
    page: {
      locator: () => dialogs,
      waitForTimeout: async () => undefined,
    },
    log,
  } as unknown as WorkflowRuntime
}

function expected(deadline = Date.now() + 2_000): PopupOwnershipContext {
  return {
    expectedWorkflowDialog: 'failure-reason',
    classificationDeadline: deadline,
  }
}

test('partially mounted expected failure dialog is reserved and never closed', async () => {
  const fixture = { text: '', closeLabel: 'Close', closeClicks: 0 }
  const logs: string[] = []

  assert.equal(await closePopupIfPresent(runtime(fixture, logs), expected()), 'workflow-mounting')
  assert.equal(fixture.closeClicks, 0)
  assert.equal(logs.includes('Unmatched dialog closed with a safe close control.'), false)
})

test('completed expected failure dialog is workflow-owned and never closed', async () => {
  const fixture = {
    text: 'Select failure reason Phone - Display Confirm failure',
    closeLabel: 'Close',
    closeClicks: 0,
  }

  assert.equal(await closePopupIfPresent(runtime(fixture, []), expected()), 'workflow-owned')
  assert.equal(fixture.closeClicks, 0)
})

test('expected workflow-dialog mounting classification is bounded', () => {
  assert.equal(classifyVisibleDialog('', 'failure-reason', 1_999, 2_000).kind, 'workflow-mounting')
  assert.equal(classifyVisibleDialog('', 'failure-reason', 2_000, 2_000).kind, 'classification-expired')
  assert.equal(
    classifyVisibleDialog('Select failure reason', 'failure-reason', 3_000, 2_000).kind,
    'workflow-owned',
  )
})

test('known business dialogs retain priority during failure-dialog mounting', async () => {
  const cases = [
    ['No order found for the scanned asset', 'No Order Found'],
    ['Asset Tag/Serial Number Not Found', 'Asset Not Found'],
    ['Failed to execute instruction', 'Failed Instruction'],
    ['Query Error', 'Query Error'],
  ] as const

  for (const [text, reason] of cases) {
    const fixture = { text, closeLabel: 'Close', closeClicks: 0 }
    await assert.rejects(
      closePopupIfPresent(runtime(fixture, []), expected()),
      (error: unknown) => error instanceof AssetSkipError && error.reason === reason,
    )
    assert.equal(fixture.closeClicks, 1)
  }
})

test('business classification outranks an earlier partially mounted workflow dialog', async () => {
  const mounting = { text: '', closeLabel: 'Close', closeClicks: 0 }
  const business = { text: 'Query Error', closeLabel: 'Close', closeClicks: 0 }

  await assert.rejects(
    closePopupIfPresent(runtime([mounting, business], []), expected()),
    (error: unknown) => error instanceof AssetSkipError && error.reason === 'Query Error',
  )
  assert.equal(mounting.closeClicks, 0)
  assert.equal(business.closeClicks, 1)
})

test('unrelated unknown dialog outside an expected transition retains safe-close handling', async () => {
  const fixture = { text: 'Informational notice', closeLabel: 'Close', closeClicks: 0 }
  const logs: string[] = []

  assert.equal(await closePopupIfPresent(runtime(fixture, logs)), 'closed')
  assert.equal(fixture.closeClicks, 1)
  assert.equal(logs.includes('Unmatched dialog closed with a safe close control.'), true)
})
