import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseChannel, signSubscriptionToken } from './subscription-token'

/**
 * chat:, project: and milestone: had allow_subscribe_for_client and no "#", so
 * any connected client could subscribe to any id. Chat was the worst of the
 * three: history_size 200, history_ttl 168h and force_recovery, so subscribing
 * to a stranger's conversation replayed a week of it.
 *
 * Centrifugo verifies the signature, the channel and the expiry. This service
 * decides who gets a token, because it holds the rows that answer that.
 */

const SECRET = 'a-test-centrifugo-secret'

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

describe('signSubscriptionToken', () => {
  const token = signSubscriptionToken('project:p-1', 'user-1', SECRET, 1_000_000)
  const [header, payload, signature] = token.split('.')

  it('is a three part JWT', () => {
    expect(token.split('.')).toHaveLength(3)
  })

  it('declares HS256, which is what Centrifugo verifies with', () => {
    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  // Centrifugo rejects the subscription if either fails to match.
  it('binds the token to one channel and one user', () => {
    const claims = decode(payload)
    expect(claims.channel).toBe('project:p-1')
    expect(claims.sub).toBe('user-1')
  })

  it('expires, so a leaked token is not permanent', () => {
    const claims = decode(payload)
    expect(claims.exp).toBeGreaterThan(claims.iat as number)
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(900)
  })

  it('signs over header and payload with the shared secret', () => {
    const expected = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
    expect(signature).toBe(expected)
  })

  it('produces a different signature for a different channel', () => {
    const other = signSubscriptionToken('project:p-2', 'user-1', SECRET, 1_000_000)
    expect(other.split('.')[2]).not.toBe(signature)
  })

  it('produces a different signature for a different user', () => {
    const other = signSubscriptionToken('project:p-1', 'user-2', SECRET, 1_000_000)
    expect(other.split('.')[2]).not.toBe(signature)
  })

  it('emits no padding, which base64url forbids', () => {
    expect(token).not.toContain('=')
    expect(token).not.toContain('+')
    expect(token).not.toContain('/')
  })
})

describe('parseChannel', () => {
  it.each([
    ['chat:c-1', 'chat', 'c-1'],
    ['project:p-1', 'project', 'p-1'],
    ['milestone:p-1', 'milestone', 'p-1'],
  ])('reads %s', (channel, namespace, id) => {
    expect(parseChannel(channel)).toEqual({ namespace, id })
  })

  // notifications# is enforced by Centrifugo itself and needs no token.
  it('refuses a namespace it does not guard', () => {
    expect(parseChannel('notifications#user-1')).toBeNull()
    expect(parseChannel('anything:x')).toBeNull()
  })

  it('refuses a malformed channel', () => {
    for (const bad of ['', 'project', 'project:', ':p-1', 'project:a:b']) {
      expect(parseChannel(bad), bad).toBeNull()
    }
  })

  // A "#" in the id would let a caller forge a user-limited channel name.
  it('refuses an id containing the user separator', () => {
    expect(parseChannel('project:p-1#user-2')).toBeNull()
  })
})
