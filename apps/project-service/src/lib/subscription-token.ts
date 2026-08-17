import { createHmac } from 'node:crypto'

/**
 * Mint a Centrifugo subscription token.
 *
 * Centrifugo enforces a channel containing "#" itself: it refuses the
 * subscription unless the connection token's sub matches the part after it.
 * That is why notifications#<userId> was safe. chat:, project: and milestone:
 * have no "#", so with allow_subscribe_for_client they accepted any subscriber,
 * and chat replays 168 hours of history on subscribe.
 *
 * Those namespaces now require a token per channel. Centrifugo checks the
 * signature, the channel and the expiry; this service decides who gets one,
 * because it holds the assignment and participant rows that answer that.
 */

const TOKEN_TTL_SECONDS = 600

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function signSubscriptionToken(
  channel: string,
  userId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      channel,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_TTL_SECONDS,
    }),
  )
  const signature = base64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${signature}`
}

type ChannelRef = { namespace: 'chat' | 'project' | 'milestone'; id: string }

/**
 * Split a channel name, rejecting anything not in the guarded set.
 *
 * Returning null rather than throwing keeps the caller's 403 uniform: a
 * malformed channel and an unauthorised one look the same from outside.
 */
export function parseChannel(channel: string): ChannelRef | null {
  const separator = channel.indexOf(':')
  if (separator <= 0) return null

  const namespace = channel.slice(0, separator)
  const id = channel.slice(separator + 1)
  if (!id || id.includes(':') || id.includes('#')) return null

  if (namespace === 'chat' || namespace === 'project' || namespace === 'milestone') {
    return { namespace, id }
  }
  return null
}
