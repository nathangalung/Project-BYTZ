export const SANDBOX_SNAP_URL = 'https://app.sandbox.midtrans.com/snap/snap.js'
export const PRODUCTION_SNAP_URL = 'https://app.midtrans.com/snap/snap.js'

/**
 * Pick the snap.js host from the same flag the payment service reads.
 *
 * Mirrors internal/config/config.go: sandbox unless the value is "false" or
 * "0", case-insensitive. Sandbox and production tokens are not interchangeable,
 * so an unrecognised value has to stay on sandbox rather than go live.
 */
export function resolveSnapUrl(isSandbox: string | undefined): string {
  const off = isSandbox?.trim().toLowerCase()
  return off === 'false' || off === '0' ? PRODUCTION_SNAP_URL : SANDBOX_SNAP_URL
}
