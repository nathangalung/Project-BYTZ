import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const SOURCE = readSource('./_authenticated/verify-phone.tsx')

/**
 * The page sent an OTP on mount, then sent another every sixty seconds for as
 * long as it stayed open.
 *
 * requestOtp was a useCallback over [cooldown], and the mount effect depended
 * on requestOtp. Sending set cooldown to 60; the countdown decremented it to
 * 0; that rebuilt requestOtp with a new identity; the effect saw a new
 * dependency and ran again; the `cooldown > 0` guard now passed. Unbounded.
 *
 * The cost is not only SMS spend and the rate limiter. Each new code
 * invalidates the previous one, so an owner still typing the digits they were
 * sent has them go stale underneath - the slower the user, the less able they
 * are to ever verify a phone number.
 *
 * Sending on mount is a one-shot. A ref says so; a dependency array cannot.
 */

describe('verify-phone OTP request', () => {
  it('fires once on mount rather than whenever the callback changes', () => {
    expect(SOURCE).toContain('useRef(false)')
    expect(SOURCE).not.toMatch(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*requestOtp\(\)\s*\}?,?\s*\[requestOtp\]/,
    )
  })

  /**
   * The countdown must be able to reach zero - that is what re-enables the
   * resend button - without that transition being what triggers a send.
   */
  it('does not let the countdown reaching zero trigger a send', () => {
    const mount = SOURCE.slice(SOURCE.indexOf('useRef(false)'))
    const effect = mount.slice(mount.indexOf('useEffect'), mount.indexOf('}, ['))
    expect(effect).not.toContain('cooldown')
  })

  // The user must still be able to ask for a new code deliberately.
  it('keeps an explicit resend', () => {
    expect(SOURCE).toContain('requestOtp')
    expect(SOURCE).toMatch(/onClick=\{[^}]*requestOtp/)
  })
})
