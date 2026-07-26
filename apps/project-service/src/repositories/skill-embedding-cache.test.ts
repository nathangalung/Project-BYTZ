import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSkillEmbeddingCache,
  getCachedSkillEmbeddings,
  setCachedSkillEmbeddings,
} from './skill-embedding-cache'

beforeEach(() => clearSkillEmbeddingCache())
afterEach(() => {
  vi.useRealTimers()
  clearSkillEmbeddingCache()
})

describe('skill embedding cache', () => {
  it('misses before anything is stored', () => {
    expect(getCachedSkillEmbeddings()).toBeNull()
  })

  it('returns the stored map so a matching request skips the table read', () => {
    const map = new Map([['react', [0.1, 0.2]]])
    setCachedSkillEmbeddings(map)
    expect(getCachedSkillEmbeddings()).toBe(map)
  })

  /**
   * The taxonomy is admin-editable, so a stale entry must not live forever -
   * a newly embedded skill has to start participating in semantic matching.
   */
  it('expires after the TTL', () => {
    vi.useFakeTimers()
    setCachedSkillEmbeddings(new Map([['react', [0.1]]]))
    expect(getCachedSkillEmbeddings()).not.toBeNull()

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(getCachedSkillEmbeddings()).toBeNull()
  })

  it('caches an empty map rather than re-querying an unembedded taxonomy', () => {
    const empty = new Map<string, number[]>()
    setCachedSkillEmbeddings(empty)
    // Must be the map itself, not null - otherwise every request re-reads the
    // table to discover there is still nothing to read.
    expect(getCachedSkillEmbeddings()).toBe(empty)
  })

  it('clears on demand', () => {
    setCachedSkillEmbeddings(new Map([['go', [0.3]]]))
    clearSkillEmbeddingCache()
    expect(getCachedSkillEmbeddings()).toBeNull()
  })
})
