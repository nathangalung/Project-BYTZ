import { MAX_PAID_DOC_VERSION } from './constants'

// What a revision request should do at the current version.
export type RevisionGate = 'ok' | 'pay_to_unlock' | 'max_reached'

/**
 * Decide a revision request from the current version and paid state.
 *
 * Unpaid documents stop at the free limit and pay to unlock more; paid ones
 * stop at the hard cap and cannot revise further. The two stops are distinct
 * on purpose: routing the paid cap to checkout would charge for nothing, since
 * the payment only sets an unlock that is already set.
 */
export function revisionGate(version: number, paid: boolean, freeLimit: number): RevisionGate {
  const cap = paid ? MAX_PAID_DOC_VERSION : freeLimit
  if (version < cap) return 'ok'
  return paid ? 'max_reached' : 'pay_to_unlock'
}
