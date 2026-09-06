/**
 * Resolve the caller's IP from proxy headers, or report that it could not be.
 *
 * The rate limiter keys on whatever this returns, so a wrong answer does not
 * degrade gracefully: it merges unrelated callers into one bucket. That is not
 * hypothetical here. Production ran three proxy hops (Cloudflare, then the
 * Dokploy proxy, then the service gateway) and every hop rewrote X-Real-IP
 * with its own socket peer, so the auth service saw 10.0.1.224 for the entire
 * internet and the strict 10-per-minute login limit was shared by every user.
 *
 * Two rules follow from that.
 *
 * Prefer CF-Connecting-IP. Cloudflare writes it once with the real client and
 * no later hop touches it, so it survives a chain that mangles everything
 * else. It is only trustworthy while Cloudflare is the sole ingress: a request
 * that reaches the origin directly can set it freely. Locking the origin to
 * Cloudflare is what makes this header safe, and it is an infrastructure
 * setting rather than something this function can enforce.
 *
 * Never key on a private address. Every candidate here is a public client
 * address when the chain is configured correctly, so a loopback or RFC 1918
 * value means the header describes a proxy rather than a caller. Falling
 * through to the next candidate is right, and exhausting them is worth
 * surfacing rather than papering over with a shared constant.
 *
 * X-Forwarded-For contributes only its rightmost hop. nginx builds it with
 * $proxy_add_x_forwarded_for, which appends the real peer to whatever the
 * client already sent, so the leftmost entry is attacker input and keying on
 * it hands out a fresh bucket per request.
 */

/** Returned when no header carried a usable public address. */
export const UNRESOLVED_CLIENT_IP = 'unresolved'

type HeaderReader = (name: string) => string | null | undefined

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Shape alone is not enough: 999.1.1.1 matches the pattern. */
function ipv4Octets(value: string): [number, number, number, number] | null {
  const match = IPV4.exec(value)
  if (!match) return null
  const octets = match.slice(1, 5).map(Number)
  if (octets.some((o) => o > 255)) return null
  return octets as [number, number, number, number]
}

function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

function isPrivateIpv6(value: string): boolean {
  const v = value.toLowerCase()
  if (v === '::1' || v === '::') return true
  // Unique local fc00::/7 and link local fe80::/10.
  if (v.startsWith('fc') || v.startsWith('fd')) return true
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) {
    return true
  }
  return false
}

/** Strips the port nginx leaves on IPv6 and forwarded values. */
function normalise(raw: string): string {
  const value = raw.trim().replace(/^\[|\]$/g, '')
  if (!value) return ''
  // IPv4 with port. IPv6 has many colons and must keep them.
  const parts = value.split(':')
  /* v8 ignore next 2 -- split always yields a first element; the fallback
     exists only to satisfy noUncheckedIndexedAccess and cannot be reached. */
  const head = parts[0] ?? ''
  if (parts.length === 2 && IPV4.test(head)) return head
  return value
}

/** True when the value is a routable client address worth keying on. */
export function isUsableClientIp(raw: string): boolean {
  const value = normalise(raw)
  if (!value) return false
  if (value.includes('.')) {
    const octets = ipv4Octets(value)
    return octets !== null && !isPrivateIpv4(octets)
  }
  if (value.includes(':')) return !isPrivateIpv6(value)
  return false
}

/**
 * The caller's public IP, or UNRESOLVED_CLIENT_IP when the chain hid it.
 *
 * Callers should treat the unresolved marker as a misconfiguration signal
 * rather than a normal key, because everything behind a broken proxy chain
 * collapses onto it.
 */
export function resolveClientIp(header: HeaderReader): string {
  const cloudflare = header('cf-connecting-ip')
  if (cloudflare && isUsableClientIp(cloudflare)) return normalise(cloudflare)

  const realIp = header('x-real-ip')
  if (realIp && isUsableClientIp(realIp)) return normalise(realIp)

  // Rightmost first: that end is what the proxy appended.
  const forwarded = header('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i]
      if (hop && isUsableClientIp(hop)) return normalise(hop)
    }
  }

  return UNRESOLVED_CLIENT_IP
}
