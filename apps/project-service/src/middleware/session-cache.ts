import type { SessionUser } from './session'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, { user: SessionUser; expiresAt: number }>()

export function getCachedSession(cookieHash: string): SessionUser | null {
  const entry = cache.get(cookieHash)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(cookieHash)
    return null
  }
  return entry.user
}

export function setCachedSession(cookieHash: string, user: SessionUser): void {
  cache.set(cookieHash, { user, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function clearSessionCache(): void {
  cache.clear()
}

// Periodic cleanup of expired entries (every 10 minutes)
setInterval(
  () => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) cache.delete(key)
    }
  },
  10 * 60 * 1000,
)
