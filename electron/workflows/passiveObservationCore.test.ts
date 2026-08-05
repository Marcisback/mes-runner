import test from 'node:test'
import assert from 'node:assert/strict'
import { BoundedObservationGate } from './passiveObservationCore.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

function controlledTimeouts(): {
  timeout: () => Promise<void>
  expireNext(): void
} {
  const expirations: Array<() => void> = []
  return {
    timeout: () => new Promise((resolve) => expirations.push(resolve)),
    expireNext: () => expirations.shift()?.(),
  }
}

test('passive observation completes without waiting for its hard bound', async () => {
  const timeouts = controlledTimeouts()
  const gate = new BoundedObservationGate<string>(1_500, timeouts.timeout)

  assert.deepEqual(await gate.observe(async () => 'snapshot'), {
    kind: 'completed',
    value: 'snapshot',
    generation: 1,
  })
})

test('hard-timed-out observation is discarded and cannot overwrite a newer snapshot', async () => {
  const timeouts = controlledTimeouts()
  const gate = new BoundedObservationGate<string>(1_500, timeouts.timeout)
  const oldObservation = deferred<string>()
  const oldResult = gate.observe(() => oldObservation.promise)
  timeouts.expireNext()
  assert.deepEqual(await oldResult, { kind: 'hard-timeout', generation: 1 })

  assert.deepEqual(await gate.observe(async () => 'new-snapshot'), {
    kind: 'completed',
    value: 'new-snapshot',
    generation: 2,
  })
  oldObservation.resolve('stale-snapshot')
  await Promise.resolve()
  assert.equal(gate.consumeStaleDiscardCount(), 1)
})

test('gate caps unresolved observations instead of accumulating one per poll', async () => {
  const timeouts = controlledTimeouts()
  const gate = new BoundedObservationGate<string>(1_500, timeouts.timeout)
  const first = deferred<string>()
  const second = deferred<string>()
  let producers = 0

  const firstResult = gate.observe(() => { producers += 1; return first.promise })
  timeouts.expireNext()
  await firstResult
  const secondResult = gate.observe(() => { producers += 1; return second.promise })
  timeouts.expireNext()
  await secondResult
  assert.equal((await gate.observe(async () => { producers += 1; return 'third' })).kind, 'hard-timeout')
  assert.equal(producers, 2)

  first.resolve('old')
  second.resolve('also-old')
})
