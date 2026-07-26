import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Sign Contract was dead for both parties. The button PATCHed
 * /contracts/:id/sign with no body, and the handler opened with
 * c.req.json() into a schema requiring role: 'owner' | 'talent' - so every
 * click failed before it reached a permission check. Nobody could sign a
 * contract, which is the gate in front of the whole project.
 *
 * The fix is not to make the client send the role. The handler already
 * resolved the project owner and the assignment's talent to verify the claim,
 * which means identity alone determines the party - so the parameter was
 * never information the client held, only a claim the server had to
 * disprove. Deriving it removes the failure and the spoofing surface at once.
 */

const source = readFileSync(path.resolve(__dirname, './contracts.ts'), 'utf8')
const hook = readFileSync(path.resolve(__dirname, '../../../web/src/hooks/use-projects.ts'), 'utf8')

function signHandler(): string {
  const start = source.indexOf("contractRoute.patch('/:id/sign'")
  expect(start, 'sign route not found').toBeGreaterThan(-1)
  const next = source.indexOf('contractRoute.', start + 20)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('PATCH /contracts/:id/sign', () => {
  const body = signHandler()

  /**
   * The caller sends no body, so reading one is what broke it. An empty
   * PATCH must be a valid request.
   */
  it('does not require a request body', () => {
    expect(body).not.toContain('c.req.json()')
    expect(body).not.toContain('signContractSchema')
  })

  it('has no role schema left to require', () => {
    expect(source).not.toContain('signContractSchema')
  })

  it('works out the signing party from the session', () => {
    expect(body).toMatch(/user\.id/)
    expect(body).toContain('signedByOwner')
    expect(body).toContain('signedByTalent')
  })

  /**
   * Someone who is neither the owner nor the assigned talent has no party to
   * sign as, and must be refused rather than defaulted into one.
   */
  it('refuses a caller who is neither party', () => {
    expect(body).toContain('AUTH_FORBIDDEN')
  })
})

describe('useSignContract', () => {
  it('sends the PATCH the route now accepts', () => {
    const start = hook.indexOf('export function useSignContract')
    expect(start).toBeGreaterThan(-1)
    const fn = hook.slice(start, hook.indexOf('export function', start + 20))
    expect(fn).toContain('/sign')
    expect(fn).toContain("method: 'PATCH'")
  })
})
