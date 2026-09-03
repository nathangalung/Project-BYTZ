/**
 * Process-local cache for the canonical skill embedding table.
 *
 * The table is admin-managed master data: it changes when the skill taxonomy is
 * edited, not when projects or talents change. Every matching request was
 * re-reading all of it, and each row carries a vector(1024), so the cost is
 * megabytes of row materialisation per request rather than a cheap lookup.
 *
 * Deliberately in process rather than in Valkey: the value is a Map of typed
 * arrays that would have to be serialised and parsed on every hit, which is
 * most of the cost this avoids. Replicas each keep their own copy, which is
 * fine for read-only master data.
 */

const SKILL_EMBEDDING_TTL_MS = 10 * 60 * 1000

let entry: { map: Map<string, number[]>; expiresAt: number } | null = null

export function getCachedSkillEmbeddings(): Map<string, number[]> | null {
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    entry = null
    return null
  }
  return entry.map
}

export function setCachedSkillEmbeddings(map: Map<string, number[]>): void {
  entry = { map, expiresAt: Date.now() + SKILL_EMBEDDING_TTL_MS }
}

/** Test seam, and the hook to call if the taxonomy is ever edited in-process. */
export function clearSkillEmbeddingCache(): void {
  entry = null
}
