import type { Context } from 'hono'
import { describe, expect, it } from 'vitest'
import { clientIp } from './client-ip'

/**
 * The rate limiter keyed on the first X-Forwarded-For element. nginx sets that
 * header to $proxy_add_x_forwarded_for, which appends the real peer to
 * whatever the client sent, so the first element is whatever the client typed.
 * Incrementing it gave every request a fresh bucket, which defeated the only
 * brute-force protection on sign-in and OTP verification.
 */

function ctx(headers: Record<string, string>): Context {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  } as unknown as Context
}

describe('clientIp', () => {
  it('prefers x-real-ip, which the proxy sets from the peer', () => {
    expect(clientIp(ctx({ 'x-real-ip': '10.0.0.5' }))).toBe('10.0.0.5')
  })

  // The attack: the client picks the first element.
  it('ignores a client-supplied x-forwarded-for prefix', () => {
    const spoofed = { 'x-forwarded-for': '1.2.3.4, 10.0.0.5', 'x-real-ip': '10.0.0.5' }
    expect(clientIp(ctx(spoofed))).toBe('10.0.0.5')
  })

  it('takes the last hop when only x-forwarded-for is present', () => {
    expect(clientIp(ctx({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9, 10.0.0.5' }))).toBe('10.0.0.5')
  })

  it('gives one attacker one key however many hops they invent', () => {
    const keys = new Set(
      ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((claimed) =>
        clientIp(ctx({ 'x-forwarded-for': `${claimed}, 10.0.0.5` })),
      ),
    )
    expect(keys.size).toBe(1)
  })

  it('handles a single-element header', () => {
    expect(clientIp(ctx({ 'x-forwarded-for': '10.0.0.5' }))).toBe('10.0.0.5')
  })

  it('falls back to unknown when neither header is set', () => {
    expect(clientIp(ctx({}))).toBe('unknown')
  })

  it('ignores whitespace-only values', () => {
    expect(clientIp(ctx({ 'x-real-ip': '   ', 'x-forwarded-for': '  ' }))).toBe('unknown')
  })
})
