import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PRODUCTION_SNAP_URL, SANDBOX_SNAP_URL } from './midtrans'

/**
 * The deployed policy, read from the file that ships it.
 *
 * Checkout appends a <script> for snap.js at runtime and Midtrans then opens
 * its payment window in an iframe, so the policy nginx sends is what decides
 * whether anyone can pay. Under `script-src 'self'` the script was refused and
 * window.snap never existed, which leaves the Pay button disabled behind
 * `snapReady` for every payment the platform takes. No test looked at this
 * file, so nothing said so.
 */
const NGINX_CONF = readFileSync(path.resolve(__dirname, '../../nginx.conf'), 'utf8')

function directive(name: string): string[] {
  const policy = /Content-Security-Policy "([^"]+)"/.exec(NGINX_CONF)?.[1]
  if (!policy) throw new Error('no Content-Security-Policy in nginx.conf')
  const found = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
  if (!found) return []
  return found.split(/\s+/).slice(1)
}

const snapOrigins = [SANDBOX_SNAP_URL, PRODUCTION_SNAP_URL].map((url) => new URL(url).origin)

describe('the policy the payment window has to survive', () => {
  it.each(snapOrigins)('lets %s serve a script', (origin) => {
    expect(directive('script-src')).toContain(origin)
  })

  it.each(snapOrigins)('lets the page reach %s', (origin) => {
    expect(directive('connect-src')).toContain(origin)
  })

  /** Snap renders its payment window in an iframe on the Midtrans origin. */
  it.each(snapOrigins)('lets %s be framed', (origin) => {
    expect(directive('frame-src')).toContain(origin)
  })

  /**
   * Both hosts, always. One image serves every environment and the host is
   * chosen at runtime from MIDTRANS_IS_SANDBOX, so naming only one breaks the
   * other silently - a disabled button, not an error.
   */
  it('names the sandbox and the live host, not one of them', () => {
    expect(snapOrigins).toHaveLength(2)
    expect(new Set(snapOrigins).size).toBe(2)
  })
})

/** Widening for a payment SDK must not widen anything else. */
describe('what the policy still refuses', () => {
  it('admits no inline script', () => {
    expect(directive('script-src')).not.toContain("'unsafe-inline'")
    expect(directive('script-src')).not.toContain("'unsafe-eval'")
  })

  it('admits no plugin content and no rewritten base', () => {
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('base-uri')).toEqual(["'self'"])
  })

  it('still refuses to be framed by anyone else', () => {
    expect(directive('frame-ancestors')).toEqual(["'self'"])
  })

  it('keeps a default that falls back to this origin', () => {
    expect(directive('default-src')).toEqual(["'self'"])
  })
})
