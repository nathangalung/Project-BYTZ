import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PRODUCTION_SNAP_URL, resolveSnapUrl, SANDBOX_SNAP_URL } from './midtrans'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const checkoutSource = readSource('../routes/_authenticated/projects/$projectId/checkout.tsx')

/**
 * The snap.js URL was hardcoded to the sandbox host, so a production build
 * loaded the sandbox script and Midtrans rejected every live token. The backend
 * had the same problem from the other side: docker-compose.prod.yml set
 * MIDTRANS_SNAP_URL, which config.go never reads, while the control it does
 * read, MIDTRANS_IS_SANDBOX, was never set and defaults to sandbox.
 *
 * Sandbox and production tokens are not interchangeable, so the two sides have
 * to agree. Both now read the same flag.
 */

describe('resolveSnapUrl', () => {
  it('uses production when the sandbox flag is off', () => {
    expect(resolveSnapUrl('false')).toBe(PRODUCTION_SNAP_URL)
  })

  it('accepts the flag in any case', () => {
    expect(resolveSnapUrl('FALSE')).toBe(PRODUCTION_SNAP_URL)
    expect(resolveSnapUrl('False')).toBe(PRODUCTION_SNAP_URL)
  })

  it('accepts 0 as off, matching the Go config', () => {
    expect(resolveSnapUrl('0')).toBe(PRODUCTION_SNAP_URL)
  })

  it('uses sandbox when the flag is unset', () => {
    expect(resolveSnapUrl(undefined)).toBe(SANDBOX_SNAP_URL)
    expect(resolveSnapUrl('')).toBe(SANDBOX_SNAP_URL)
  })

  // Anything unrecognised must not silently go live.
  it('uses sandbox for any other value', () => {
    expect(resolveSnapUrl('true')).toBe(SANDBOX_SNAP_URL)
    expect(resolveSnapUrl('yes')).toBe(SANDBOX_SNAP_URL)
    expect(resolveSnapUrl('no')).toBe(SANDBOX_SNAP_URL)
  })

  it('points the two hosts at different origins', () => {
    expect(new URL(SANDBOX_SNAP_URL).host).not.toBe(new URL(PRODUCTION_SNAP_URL).host)
    expect(SANDBOX_SNAP_URL).toContain('sandbox')
    expect(PRODUCTION_SNAP_URL).not.toContain('sandbox')
  })
})

describe('checkout page', () => {
  it('does not hardcode a snap host', () => {
    expect(checkoutSource).not.toMatch(/https:\/\/app\.(sandbox\.)?midtrans\.com/)
    expect(checkoutSource).toContain('resolveSnapUrl')
  })
})
