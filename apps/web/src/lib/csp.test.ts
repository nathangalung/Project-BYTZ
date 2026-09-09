import { createHash } from 'node:crypto'
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

const INDEX_HTML = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8')

function inlineScriptBodies(): string[] {
  return [...INDEX_HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  )
}

function sha256Source(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
}

/**
 * The header and the script it allows live in two files, and nothing connects
 * them at build time.
 *
 * A hash covers the exact bytes between the tags. Reformat the block, change
 * one character of the theme key, and the hash stops matching - with no error
 * in any log, no failing request, and no visible difference except that dark
 * mode flashes white again on every load. That is what happened before the
 * hash existed: `script-src 'self'` refused the script outright, so the class
 * was applied by the bundle instead, one paint too late.
 */
describe('the inline script the header has to keep allowing', () => {
  it('carries a hash for every inline script index.html ships', () => {
    const bodies = inlineScriptBodies()
    expect(bodies).toHaveLength(1)
    for (const body of bodies) {
      const hash = sha256Source(body)
      expect(
        directive('script-src'),
        `nginx.conf script-src is missing ${hash} for the inline script in index.html`,
      ).toContain(hash)
    }
  })

  it('spends no hash on a script that is gone', () => {
    const shipped = new Set(inlineScriptBodies().map(sha256Source))
    const listed = directive('script-src').filter((source) => source.startsWith("'sha256-"))
    expect(listed.length).toBeGreaterThan(0)
    for (const source of listed) expect(shipped).toContain(source)
  })

  /**
   * Hashes do not cover inline event handlers. Those need 'unsafe-hashes',
   * which admits every inline handler on the page, so the answer is to have
   * none. The skip link used to reveal itself with onfocus/onblur, and because
   * script-src refused them it stayed parked off-screen at translateY(-200px)
   * on the live site - the first thing Tab reached, and invisible.
   */
  it('ships no inline event handler for the header to refuse', () => {
    expect(INDEX_HTML.match(/\son[a-z]+=/g)).toBeNull()
  })
})
