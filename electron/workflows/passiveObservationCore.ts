export type BoundedObservationResult<T> =
  | { kind: 'completed'; value: T; generation: number }
  | { kind: 'hard-timeout'; generation: number }

interface ObservationFlight<T> {
  generation: number
  promise: Promise<T>
  timedOut: boolean
}

export class BoundedObservationGate<T> {
  private readonly timeoutMs: number
  private readonly timeout: (ms: number) => Promise<void>
  private generation = 0
  private active: ObservationFlight<T> | null = null
  private abandoned: ObservationFlight<T> | null = null
  private staleDiscardCount = 0

  constructor(
    timeoutMs: number,
    timeout: (ms: number) => Promise<void> = defaultTimeout,
  ) {
    this.timeoutMs = timeoutMs
    this.timeout = timeout
  }

  async observe(producer: () => Promise<T>): Promise<BoundedObservationResult<T>> {
    if (this.active?.timedOut === true) {
      return { kind: 'hard-timeout', generation: this.active.generation }
    }
    if (this.active === null) this.active = this.start(producer)
    const flight = this.active
    let result: { kind: 'completed'; value: T } | { kind: 'hard-timeout' }
    try {
      result = await Promise.race([
        flight.promise.then((value) => ({ kind: 'completed' as const, value })),
        this.timeout(this.timeoutMs).then(() => ({ kind: 'hard-timeout' as const })),
      ])
    } catch (error: unknown) {
      if (this.active === flight) this.active = null
      throw error
    }

    if (result.kind === 'completed') {
      if (this.active !== flight || flight.timedOut) {
        this.staleDiscardCount += 1
        return { kind: 'hard-timeout', generation: flight.generation }
      }
      this.active = null
      return { kind: 'completed', value: result.value, generation: flight.generation }
    }

    flight.timedOut = true
    if (this.abandoned === null) {
      this.abandoned = flight
      this.active = null
      void flight.promise.then(
        () => this.discardAbandoned(flight),
        () => this.discardAbandoned(flight),
      )
    } else {
      void flight.promise.then(
        () => this.discardActive(flight),
        () => this.discardActive(flight),
      )
    }
    return { kind: 'hard-timeout', generation: flight.generation }
  }

  consumeStaleDiscardCount(): number {
    const count = this.staleDiscardCount
    this.staleDiscardCount = 0
    return count
  }

  private start(producer: () => Promise<T>): ObservationFlight<T> {
    return {
      generation: ++this.generation,
      promise: producer(),
      timedOut: false,
    }
  }

  private discardAbandoned(flight: ObservationFlight<T>): void {
    if (this.abandoned !== flight) return
    this.abandoned = null
    this.staleDiscardCount += 1
  }

  private discardActive(flight: ObservationFlight<T>): void {
    if (this.active !== flight) return
    this.active = null
    this.staleDiscardCount += 1
  }
}

function defaultTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
