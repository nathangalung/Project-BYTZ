import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Bind a storage key to the user it was minted for.
 *
 * Presigned PUT gives the browser a key and keeps no record of it, so a later
 * request naming that key carries no proof of ownership. The token is that
 * proof: it travels with the key and is checked before the object is read.
 *
 * Length-prefixed fields, not a plain join, so a colon inside a key cannot be
 * shifted into the user field to forge a match.
 */

function payload(key: string, userId: string): string {
  return `upload-key:${userId.length}:${userId}:${key.length}:${key}`
}

export function signUploadKey(key: string, userId: string, secret: string): string {
  return createHmac('sha256', secret).update(payload(key, userId)).digest('hex')
}

export function verifyUploadKey(
  key: string,
  userId: string,
  token: string,
  secret: string,
): boolean {
  const expected = signUploadKey(key, userId, secret)
  if (token.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}
