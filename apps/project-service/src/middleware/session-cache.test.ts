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
