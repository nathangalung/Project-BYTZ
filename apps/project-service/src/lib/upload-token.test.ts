import { describe, expect, it } from 'vitest'
import { signUploadKey, verifyUploadKey } from './upload-token'

/**
 * Presigned PUT hands the browser a storage key and forgets it. Nothing
 * recorded who was given which key, so the CV parse endpoint had no way to tell
 * whether the caller owned the object it was about to read, and the parse
 * response carries name, email, phone and employment history.
 *
 * The token binds key to user at the moment the key is minted, so parse-cv can
 * check ownership without a lookup table.
 */

const SECRET = 'a-test-secret-at-least-32-characters-long'
const KEY = 'cv/0192f3a4-0000-7000-8000-000000000000.pdf'

describe('signUploadKey', () => {
  it('is stable for the same key and user', () => {
    expect(signUploadKey(KEY, 'user-1', SECRET)).toBe(signUploadKey(KEY, 'user-1', SECRET))
  })

  it('differs per user', () => {
    expect(signUploadKey(KEY, 'user-1', SECRET)).not.toBe(signUploadKey(KEY, 'user-2', SECRET))
  })

  it('differs per key', () => {
    expect(signUploadKey(KEY, 'user-1', SECRET)).not.toBe(
      signUploadKey('cv/other.pdf', 'user-1', SECRET),
    )
  })

  it('differs per secret', () => {
    expect(signUploadKey(KEY, 'user-1', SECRET)).not.toBe(
      signUploadKey(KEY, 'user-1', `${SECRET}-rotated`),
    )
  })

  it('leaks neither the key nor the user', () => {
    const token = signUploadKey(KEY, 'user-1', SECRET)
    expect(token).not.toContain('user-1')
    expect(token).not.toContain('cv/')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verifyUploadKey', () => {
  it('accepts the token it issued', () => {
    const token = signUploadKey(KEY, 'user-1', SECRET)
    expect(verifyUploadKey(KEY, 'user-1', token, SECRET)).toBe(true)
  })

  // The attack: read another talent's CV with their key.
  it('rejects a token issued to a different user', () => {
    const token = signUploadKey(KEY, 'user-1', SECRET)
    expect(verifyUploadKey(KEY, 'user-2', token, SECRET)).toBe(false)
  })

  it('rejects a token issued for a different key', () => {
    const token = signUploadKey(KEY, 'user-1', SECRET)
    expect(verifyUploadKey('cv/someone-else.pdf', 'user-1', token, SECRET)).toBe(false)
  })

  it('rejects an empty or malformed token', () => {
    expect(verifyUploadKey(KEY, 'user-1', '', SECRET)).toBe(false)
    expect(verifyUploadKey(KEY, 'user-1', 'not-hex', SECRET)).toBe(false)
    expect(verifyUploadKey(KEY, 'user-1', 'ab'.repeat(16), SECRET)).toBe(false)
  })

  it('rejects a token signed with an old secret', () => {
    const token = signUploadKey(KEY, 'user-1', SECRET)
    expect(verifyUploadKey(KEY, 'user-1', token, `${SECRET}-rotated`)).toBe(false)
  })

  // Separator injection: user "a" key "b:c" must not match user "a:b" key "c".
  it('does not confuse a colon in the key for the field boundary', () => {
    const a = signUploadKey('b:c', 'a', SECRET)
    const b = signUploadKey('c', 'a:b', SECRET)
    expect(a).not.toBe(b)
  })
})
