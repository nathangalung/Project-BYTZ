import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRateLimitStore,
  MemoryRateLimitStore,
  ResilientRateLimitStore,
  ValkeyRateLimitStore,
} from './rate-limit-store'

const stores: Array<{ stop(): void }> = []
function track<T extends { stop(): void }>(s: T): T {
  stores.push(s)
  return s
}
afterEach(() => {
  for (const s of stores.splice(0)) s.stop()
  vi.useRealTimers()
})

describe('MemoryRateLimitStore', () => {
  it('counts down the allowance', async () => {
    const store = track(new MemoryRateLimitStore())
    expect(await store.hit('a', 60_000, 3)).toMatchObject({ allowed: true, remaining: 2 })
    expect(await store.hit('a', 60_000, 3)).toMatchObject({ allowed: true, remaining: 1 })
    expect(await store.hit('a', 60_000, 3)).toMatchObject({ allowed: true, remaining: 0 })
    expect(await store.hit('a', 60_000, 3)).toMatchObject({ allowed: false, remaining: 0 })
  })

  it('keeps separate callers apart', async () => {
    const store = track(new MemoryRateLimitStore())
    await store.hit('a', 60_000, 1)
    expect(await store.hit('b', 60_000, 1)).toMatchObject({ allowed: true })
  })

  it('starts a fresh window once the old one expires', async () => {
    vi.useFakeTimers()
    const store = track(new MemoryRateLimitStore())
    await store.hit('a', 1_000, 1)
    expect(await store.hit('a', 1_000, 1)).toMatchObject({ allowed: false })
    vi.advanceTimersByTime(1_001)
    expect(await store.hit('a', 1_000, 1)).toMatchObject({ allowed: true, remaining: 0 })
  })

  it('reports at least a one second retry', async () => {
    const store = track(new MemoryRateLimitStore())
    const v = await store.hit('a', 200, 1)
    expect(v.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  /** The sweep must keep live windows while clearing dead ones. */
  it('sweeps only the expired entries', async () => {
    vi.useFakeTimers()
    const store = track(new MemoryRateLimitStore(1_000))
    await store.hit('short', 500, 5)
    await store.hit('long', 10_000, 5)
    vi.advanceTimersByTime(1_500)
    // short was swept and starts over; long survived and keeps counting.
    expect(await store.hit('short', 500, 5)).toMatchObject({ remaining: 4 })
    expect(await store.hit('long', 10_000, 5)).toMatchObject({ remaining: 3 })
  })

  it('drops expired entries so the map does not grow forever', async () => {
    vi.useFakeTimers()
    const store = track(new MemoryRateLimitStore(1_000))
    await store.hit('a', 500, 5)
    vi.advanceTimersByTime(1_500)
    // Swept, so the next hit starts a new window rather than continuing.
    expect(await store.hit('a', 500, 5)).toMatchObject({ remaining: 4 })
  })
})

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const keys = new Map<string, { count: number; ttl: number }>()
  return {
    keys,
    incr: vi.fn(async (k: string) => {
      const e = keys.get(k) ?? { count: 0, ttl: -1 }
      e.count += 1
      keys.set(k, e)
      return e.count
    }),
    pexpire: vi.fn(async (k: string, ms: number) => {
      const e = keys.get(k)
      if (e) e.ttl = ms
      return 1
    }),
    pttl: vi.fn(async (k: string) => keys.get(k)?.ttl ?? -2),
    ...overrides,
  }
}

describe('ValkeyRateLimitStore', () => {
  it('sets the window only on the first hit', async () => {
    const client = fakeClient()
    const store = new ValkeyRateLimitStore(client)
    await store.hit('a', 60_000, 3)
    await store.hit('a', 60_000, 3)
    expect(client.pexpire).toHaveBeenCalledTimes(1)
  })

  it('namespaces keys so it can share a database', async () => {
    const client = fakeClient()
    await new ValkeyRateLimitStore(client, 'auth:').hit('1.2.3.4', 60_000, 3)
    expect(client.incr).toHaveBeenCalledWith('auth:1.2.3.4')
  })

  it('refuses once the shared count passes the limit', async () => {
    const client = fakeClient()
    const store = new ValkeyRateLimitStore(client)
    await store.hit('a', 60_000, 2)
    await store.hit('a', 60_000, 2)
    expect(await store.hit('a', 60_000, 2)).toMatchObject({ allowed: false, remaining: 0 })
  })

  /**
   * A crash between INCR and PEXPIRE leaves a counter with no expiry, which
   * blocks that caller until someone deletes the key by hand.
   */
  it('repairs a counter that lost its expiry', async () => {
    const client = fakeClient()
    client.keys.set('rl:a', { count: 5, ttl: -1 })
    const store = new ValkeyRateLimitStore(client)
    const v = await store.hit('a', 60_000, 10)
    expect(client.pexpire).toHaveBeenCalledWith('rl:a', 60_000)
    expect(v.retryAfterSeconds).toBe(60)
  })

  it('reports the remaining window from the store', async () => {
    const client = fakeClient()
    client.keys.set('rl:a', { count: 1, ttl: 30_000 })
    const v = await new ValkeyRateLimitStore(client).hit('a', 60_000, 10)
    expect(v.retryAfterSeconds).toBe(30)
  })

  it('shares one window across callers that use the same key', async () => {
    const client = fakeClient()
    const a = new ValkeyRateLimitStore(client)
    const b = new ValkeyRateLimitStore(client)
    await a.hit('same', 60_000, 2)
    await b.hit('same', 60_000, 2)
    expect(await a.hit('same', 60_000, 2)).toMatchObject({ allowed: false })
  })
})

describe('ResilientRateLimitStore', () => {
  it('uses the shared store while it answers', async () => {
    const client = fakeClient()
    const store = track(new ResilientRateLimitStore(new ValkeyRateLimitStore(client)))
    await store.hit('a', 60_000, 5)
    expect(client.incr).toHaveBeenCalled()
  })

  /** A cache outage must not close the login page. */
  it('degrades to per-process counting when the store fails', async () => {
    const onError = vi.fn()
    const failing = {
      hit: vi.fn(async () => {
        throw new Error('connection refused')
      }),
    }
    const store = track(new ResilientRateLimitStore(failing, onError))
    expect(await store.hit('a', 60_000, 2)).toMatchObject({ allowed: true, remaining: 1 })
    expect(onError).toHaveBeenCalledOnce()
  })

  it('still enforces a limit while degraded', async () => {
    const failing = {
      hit: async () => {
        throw new Error('down')
      },
    }
    const store = track(new ResilientRateLimitStore(failing))
    await store.hit('a', 60_000, 1)
    expect(await store.hit('a', 60_000, 1)).toMatchObject({ allowed: false })
  })

  it('survives a store failure with no error handler attached', async () => {
    const failing = {
      hit: async () => {
        throw new Error('down')
      },
    }
    const store = track(new ResilientRateLimitStore(failing))
    await expect(store.hit('a', 60_000, 1)).resolves.toMatchObject({ allowed: true })
  })
})

describe('createRateLimitStore', () => {
  const originalBun = (globalThis as Record<string, unknown>).Bun

  afterEach(() => {
    if (originalBun === undefined) delete (globalThis as Record<string, unknown>).Bun
    else (globalThis as Record<string, unknown>).Bun = originalBun
  })

  it('counts locally when no store is configured', async () => {
    const store = track(createRateLimitStore({}))
    await store.hit('a', 60_000, 1)
    expect(await store.hit('a', 60_000, 1)).toMatchObject({ allowed: false })
  })

  it('counts locally when the runtime has no client', async () => {
    delete (globalThis as Record<string, unknown>).Bun
    const store = track(createRateLimitStore({ redisUrl: 'redis://localhost:6379' }))
    expect(await store.hit('a', 60_000, 2)).toMatchObject({ allowed: true, remaining: 1 })
  })

  it('uses the shared store when a URL and a client are both present', async () => {
    const client = fakeClient()
    const seen: string[] = []
    ;(globalThis as Record<string, unknown>).Bun = {
      RedisClient: class {
        incr = client.incr
        pexpire = client.pexpire
        pttl = client.pttl
        constructor(url: string) {
          seen.push(url)
        }
      },
    }
    const store = track(createRateLimitStore({ redisUrl: 'redis://valkey:6379', prefix: 'svc:' }))
    await store.hit('1.2.3.4', 60_000, 5)
    expect(seen).toEqual(['redis://valkey:6379'])
    expect(client.incr).toHaveBeenCalledWith('svc:1.2.3.4')
  })

  /** A store that refuses connections must not take the login page down. */
  it('falls back when the configured store throws', async () => {
    const onError = vi.fn()
    ;(globalThis as Record<string, unknown>).Bun = {
      RedisClient: class {
        incr() {
          return Promise.reject(new Error('connection refused'))
        }
        pexpire() {
          return Promise.resolve(1)
        }
        pttl() {
          return Promise.resolve(-2)
        }
      },
    }
    const store = track(createRateLimitStore({ redisUrl: 'redis://down:6379', onError }))
    expect(await store.hit('a', 60_000, 3)).toMatchObject({ allowed: true, remaining: 2 })
    expect(onError).toHaveBeenCalledOnce()
  })
})
