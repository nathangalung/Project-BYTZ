import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The limiter keyed on the leftmost X-Forwarded-For entry. nginx sets that
 * header with $proxy_add_x_forwarded_for, which APPENDS the real client to
 * whatever the client already sent - so the leftmost value is attacker input.
 * A different X-Forwarded-For per request meant a fresh bucket per request,
 * and every limit on the service was advisory.
 *
 * X-Real-IP is set by nginx from $remote_addr, the socket peer, which a
 * client cannot forge.
 *
 * Coverage was the second half of the same problem. The strict tier was
 * bound to the literal path /api/v1/projects/:id/chat, which does not match
 * /chat/stream, so the SSE stream and every document-generation route ran at
 * the general limit. Generating a PRD is the most expensive call the
 * platform makes.
 */

const middleware = readFileSync(path.resolve(__dirname, './rate-limit.ts'), 'utf8')
const index = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8')

describe('the rate limit key', () => {
  /**
   * Precedence is in the expression, not in source order - the forwarded
   * header may be read into a variable first and still be the fallback.
   */
  it('prefers the header a client cannot forge', () => {
    const assignment = middleware.slice(
      middleware.indexOf('const ip ='),
      middleware.indexOf("'unknown'") + 10,
    )
    expect(assignment, 'x-real-ip is not the first choice').toMatch(
      /const ip =\s*c\.req\.header\('x-real-ip'\)/,
    )
  })

  /**
   * If forwarded-for is kept as a fallback it must be the rightmost hop, not
   * the leftmost - the right end is what the proxy appended.
   */
  it('never trusts the leftmost forwarded-for entry', () => {
    expect(middleware).not.toContain("split(',')[0]")
  })
})

describe('the strict tier', () => {
  const AI_ROUTES = ['chat/stream', 'generate-brd', 'generate-prd', 'brd/revision', 'prd/revision']

  for (const route of AI_ROUTES) {
    it(`covers ${route}`, () => {
      const line = index.split('\n').find((l) => l.includes('strictRateLimit') && l.includes(route))
      expect(line, `${route} is not on the strict tier`).toBeDefined()
    })
  }

  /**
   * Owner-to-talent chat is platform messaging, not an AI call, so it belongs
   * on the general tier. Throttling people talking to each other would be
   * throttling the wrong thing.
   */
  it('leaves owner-talent chat on the general tier', () => {
    const strict = index.split('\n').filter((l) => l.includes('strictRateLimit'))
    expect(strict.some((l) => l.includes('/api/v1/chat'))).toBe(false)
  })
})
