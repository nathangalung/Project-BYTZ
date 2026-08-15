import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSessionCache, getCachedSession, setCachedSession } from './session-cache'

describe('session cache', () => {
  beforeEach(() => {
    clearSessionCache()
  })

  afterEach(() => {
    clearSessionCache()
  })

  it('returns null for uncached key', () => {
    expect(getCachedSession('nonexistent')).toBeNull()
  })

  it('stores and retrieves a session', () => {
    const user = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'owner' }
    setCachedSession('key1', user)
    expect(getCachedSession('key1')).toEqual(user)
  })

  it('stores multiple sessions independently', () => {
    const user1 = { id: 'u1', email: 'a@b.com', name: 'User1', role: 'owner' }
    const user2 = { id: 'u2', email: 'c@d.com', name: 'User2', role: 'talent' }

    setCachedSession('key1', user1)
    setCachedSession('key2', user2)

    expect(getCachedSession('key1')).toEqual(user1)
    expect(getCachedSession('key2')).toEqual(user2)
  })

  it('overwrites existing session for same key', () => {
    const user1 = { id: 'u1', email: 'a@b.com', name: 'First', role: 'owner' }
    const user2 = { id: 'u2', email: 'c@d.com', name: 'Second', role: 'talent' }

    setCachedSession('key1', user1)
    setCachedSession('key1', user2)

    expect(getCachedSession('key1')).toEqual(user2)
  })

  it('clearSessionCache removes all entries', () => {
    const user = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'owner' }
    setCachedSession('k1', user)
    setCachedSession('k2', user)

    clearSessionCache()

    expect(getCachedSession('k1')).toBeNull()
    expect(getCachedSession('k2')).toBeNull()
  })

  it('returns null for expired entries', () => {
    const user = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'owner' }
    setCachedSession('key1', user)

    // Fast-forward time past TTL (5 minutes)
    vi.useFakeTimers()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    expect(getCachedSession('key1')).toBeNull()

    vi.useRealTimers()
  })

  it('returns valid entry before TTL expires', () => {
    vi.useFakeTimers()

    const user = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'owner' }
    setCachedSession('key1', user)

    // Advance time but stay within TTL
    vi.advanceTimersByTime(4 * 60 * 1000) // 4 minutes

    expect(getCachedSession('key1')).toEqual(user)

    vi.useRealTimers()
  })

  it('deletes expired entry on access (lazy cleanup)', () => {
    const user = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'owner' }
    setCachedSession('key1', user)

    vi.useFakeTimers()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    // First access returns null and deletes
    expect(getCachedSession('key1')).toBeNull()
    // Second access also null (confirming deletion)
    expect(getCachedSession('key1')).toBeNull()

    vi.useRealTimers()
  })
})

/**
 * Lazy deletion only reclaims a key someone asks for again. A signed-out
 * cookie hash is never asked for again, so without the sweep the map grows for
 * the life of the process - which is the leak the interval exists to stop.
 *
 * It is registered at import time, so it has to be re-imported under fake
 * timers: timers created before useFakeTimers stay real and the callback never
 * runs.
 */
describe('session cache periodic sweep', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('drops entries past their TTL and keeps the ones still live', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const cache = await import('./session-cache')

    const stale = { id: 'u1', email: 'a@b.com', name: 'Stale', role: 'owner' }
    const live = { id: 'u2', email: 'c@d.com', name: 'Live', role: 'talent' }

    cache.setCachedSession('stale', stale)
    // Nine minutes on, `stale` is four minutes past its five minute TTL and
    // `live` has just been written, so the one sweep sees both halves.
    vi.advanceTimersByTime(9 * 60 * 1000)
    cache.setCachedSession('live', live)

    // Tenth minute: the interval fires.
    vi.advanceTimersByTime(60 * 1000)

    expect(cache.getCachedSession('stale')).toBeNull()
    expect(cache.getCachedSession('live')).toEqual(live)
  })
})
