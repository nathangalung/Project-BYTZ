import type { Context } from 'hono'

/**
 * The caller's IP, taken from what the proxy wrote rather than what the client
 * claimed.
 *
 * nginx sets X-Forwarded-For to $proxy_add_x_forwarded_for, which appends the
 * real peer to whatever the client already sent. Reading the first element
 * therefore reads attacker-controlled text: a client sending
 * "X-Forwarded-For: 1.2.3.4" produces "1.2.3.4, <real ip>" upstream. Keying
 * the rate limiter on that gave every request a fresh bucket by incrementing
 * one header.
 *
 * X-Real-IP is set straight from $remote_addr and cannot be spoofed through
 * the proxy, so it wins. The last X-Forwarded-For element is the same value
 * and covers a proxy that only sets that header.
 */
export function clientIp(c: Context): string {
  const realIp = c.req.header('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    const nearest = hops[hops.length - 1]?.trim()
    if (nearest) return nearest
  }

  return 'unknown'
}
