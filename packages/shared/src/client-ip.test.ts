import { describe, expect, it } from 'vitest'
import { isUsableClientIp, resolveClientIp, UNRESOLVED_CLIENT_IP } from './client-ip'

/**
 * These tests exist because the previous implementation passed its own tests
 * while being wrong in production. It asserted that X-Real-IP wins over
 * X-Forwarded-For, which is true and useless: behind three proxy hops X-Real-IP
 * held 10.0.1.224 for every request on the platform, so the strict login limit
 * of ten per minute was shared by the entire internet.
 *
 * The cases that matter are therefore the ones about which values are real
 * clients, not which header has priority.
 */

function headers(map: Record<string, string>) {
  return (name: string) => map[name]
}

describe('resolveClientIp', () => {
  it('prefers the header Cloudflare writes', () => {
    const ip = resolveClientIp(
      headers({ 'cf-connecting-ip': '203.0.113.9', 'x-real-ip': '10.0.1.224' }),
    )
    expect(ip).toBe('203.0.113.9')
  })

  /** The production failure, stated as a test. */
  it('refuses a private X-Real-IP written by an internal hop', () => {
    const ip = resolveClientIp(
      headers({ 'x-real-ip': '10.0.1.224', 'x-forwarded-for': '198.51.100.4, 10.0.1.224' }),
    )
    expect(ip).toBe('198.51.100.4')
    expect(ip).not.toBe('10.0.1.224')
  })

  it('reports unresolved when every candidate is internal', () => {
    const ip = resolveClientIp(
      headers({ 'x-real-ip': '10.0.1.65', 'x-forwarded-for': '172.17.0.3, 10.0.1.224' }),
    )
    expect(ip).toBe(UNRESOLVED_CLIENT_IP)
  })

  it('falls back to X-Real-IP when Cloudflare is absent', () => {
    expect(resolveClientIp(headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  /**
   * nginx builds the chain with $proxy_add_x_forwarded_for, so the leftmost
   * entry is whatever the client sent. Keying on it is a fresh bucket per
   * request, which is the same as having no limiter.
   */
  it('takes the rightmost forwarded hop, not the client-supplied left', () => {
    const ip = resolveClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }))
    expect(ip).toBe('198.51.100.9')
  })

  it('skips private hops while walking right to left', () => {
    const ip = resolveClientIp(
      headers({ 'x-forwarded-for': '198.51.100.9, 10.0.1.224, 10.0.1.65' }),
    )
    expect(ip).toBe('198.51.100.9')
  })

  it('ignores an unusable Cloudflare header rather than trusting it', () => {
    const ip = resolveClientIp(
      headers({ 'cf-connecting-ip': 'not-an-ip', 'x-real-ip': '203.0.113.7' }),
    )
    expect(ip).toBe('203.0.113.7')
  })

  it('returns the marker when no headers are present', () => {
    expect(resolveClientIp(() => undefined)).toBe(UNRESOLVED_CLIENT_IP)
  })

  it('ignores empty header values', () => {
    expect(resolveClientIp(headers({ 'x-real-ip': '   ', 'x-forwarded-for': '' }))).toBe(
      UNRESOLVED_CLIENT_IP,
    )
  })

  it('strips a port from an IPv4 value', () => {
    expect(resolveClientIp(headers({ 'x-real-ip': '203.0.113.7:54321' }))).toBe('203.0.113.7')
  })

  it('unwraps a bracketed IPv6 value', () => {
    expect(resolveClientIp(headers({ 'cf-connecting-ip': '[2001:db8::1]' }))).toBe('2001:db8::1')
  })
})

describe('isUsableClientIp', () => {
  /**
   * Cloudflare egress lives in 172.64.0.0/13 and 104.16.0.0/13, both public.
   * A naive "starts with 172" check would discard the real client address on
   * every Cloudflare request and collapse the platform onto one bucket again.
   */
  it.each([
    '172.71.81.97',
    '104.22.66.97',
    '203.0.113.1',
    '8.8.8.8',
    '172.32.0.1',
    '172.15.255.255',
  ])('accepts the public address %s', (ip) => {
    expect(isUsableClientIp(ip)).toBe(true)
  })

  it.each([
    '10.0.1.224',
    '127.0.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '0.0.0.0',
    '172.16.0.1',
    '172.31.255.255',
    '172.20.10.5',
  ])('rejects the internal address %s', (ip) => {
    expect(isUsableClientIp(ip)).toBe(false)
  })

  it.each(['::1', '::', 'fc00::1', 'fd12::9', 'fe80::1'])('rejects the IPv6 internal %s', (ip) => {
    expect(isUsableClientIp(ip)).toBe(false)
  })

  it.each(['2001:db8::1', '2606:4700::1111'])('accepts the IPv6 public %s', (ip) => {
    expect(isUsableClientIp(ip)).toBe(true)
  })

  it.each(['', '   ', 'not-an-ip', '999.1.1.1', '1.2.3'])('rejects the malformed %s', (ip) => {
    expect(isUsableClientIp(ip)).toBe(false)
  })
})
