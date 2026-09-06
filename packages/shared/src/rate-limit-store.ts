/**
 * Rate limit counters that survive more than one process.
 *
 * The in-memory Map this replaces was correct for one instance and quietly
 * wrong for the deployment it ran in. Production serves auth from more than
 * one replica, so each held its own counters: a caller was allowed roughly
 * (replicas x limit) requests, and which bucket they landed in depended on
 * which container the proxy chose. The limit was neither the number written
 * in the config nor a stable one.
 *
 * Valkey makes the window shared. The fallback matters as much as the store:
 * a limiter that throws when its backing store blinks takes the login page
 * down, which is a worse outcome than briefly counting per process.
 */

export type RateLimitVerdict = {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

export type RateLimitStore = {
  hit(key: string, windowMs: number, max: number): Promise<RateLimitVerdict>
}

function verdict(count: number, max: number, resetInMs: number): RateLimitVerdict {
  return {
    allowed: count <= max,
    limit: max,
    remaining: Math.max(0, max - count),
    retryAfterSeconds: Math.max(1, Math.ceil(resetInMs / 1000)),
  }
}

/** Per-process counters. Correct for one instance, and the fallback path. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(sweepMs = 60_000) {
    this.timer = setInterval(() => this.sweep(), sweepMs)
    /* v8 ignore next 2 -- unref exists on both Node and Bun timers, so the
       optional-call miss branch cannot be reached in either runtime. */
    // Never hold the process open for a cache.
    this.timer.unref?.()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key)
    }
  }

  async hit(key: string, windowMs: number, max: number): Promise<RateLimitVerdict> {
    const now = Date.now()
    const existing = this.entries.get(key)
    if (!existing || now >= existing.resetAt) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs })
      return verdict(1, max, windowMs)
    }
    existing.count += 1
    return verdict(existing.count, max, existing.resetAt - now)
  }

  stop(): void {
    clearInterval(this.timer)
    this.entries.clear()
  }
}

/** The subset of a Valkey client this needs, so tests need no server. */
export type CounterClient = {
  incr(key: string): Promise<number>
  pexpire(key: string, ms: number): Promise<unknown>
  pttl(key: string): Promise<number>
}

/** Shared fixed-window counters in Valkey. */
export class ValkeyRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: CounterClient,
    private readonly prefix = 'rl:',
  ) {}

  async hit(key: string, windowMs: number, max: number): Promise<RateLimitVerdict> {
    const namespaced = `${this.prefix}${key}`
    const count = await this.client.incr(namespaced)

    if (count === 1) {
      await this.client.pexpire(namespaced, windowMs)
      return verdict(count, max, windowMs)
    }

    const ttl = await this.client.pttl(namespaced)
    // A key with no expiry outlived its INCR, which happens if the process
    // died in between. Without this it blocks that caller permanently.
    if (ttl < 0) {
      await this.client.pexpire(namespaced, windowMs)
      return verdict(count, max, windowMs)
    }
    return verdict(count, max, ttl)
  }
}

/**
 * Shared counters when the store answers, per-process when it does not.
 *
 * Failing open entirely would remove the limit exactly when a dependency is
 * unhealthy, which is when it is most needed. Failing closed would reject
 * every login because a cache is down. Degrading to per-process counting keeps
 * a real limit in force and loses only the sharing.
 */
export class ResilientRateLimitStore implements RateLimitStore {
  private readonly fallback: MemoryRateLimitStore

  constructor(
    private readonly primary: RateLimitStore,
    private readonly onError?: (error: unknown) => void,
  ) {
    this.fallback = new MemoryRateLimitStore()
  }

  async hit(key: string, windowMs: number, max: number): Promise<RateLimitVerdict> {
    try {
      return await this.primary.hit(key, windowMs, max)
    } catch (error) {
      this.onError?.(error)
      return this.fallback.hit(key, windowMs, max)
    }
  }

  stop(): void {
    this.fallback.stop()
  }
}

/**
 * Build the store a service should use, given its environment.
 *
 * Composition lives here rather than in each service because both had their
 * own copy of the limiter and the copies had already drifted apart. A security
 * control with two implementations has two behaviours, and only one of them
 * gets reviewed.
 *
 * Bun ships a Redis client, so the shared window costs no dependency. Without
 * a URL the service still limits, just per process, which is what every
 * deployment did before this.
 */
export function createRateLimitStore(options: {
  redisUrl?: string
  prefix?: string
  onError?: (error: unknown) => void
}): RateLimitStore & { stop(): void } {
  const { redisUrl, prefix = 'rl:', onError } = options
  const bun = (globalThis as { Bun?: { RedisClient?: new (url: string) => unknown } }).Bun

  if (!redisUrl || !bun?.RedisClient) {
    return new ResilientRateLimitStore(new MemoryRateLimitStore(), onError)
  }

  const client = new bun.RedisClient(redisUrl) as CounterClient
  return new ResilientRateLimitStore(new ValkeyRateLimitStore(client, prefix), onError)
}
