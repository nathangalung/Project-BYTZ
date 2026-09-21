import { MAX_PAID_DOC_VERSION } from './constants'
import type { ProjectStatus } from './enums'

/**
 * The project statuses a PRD may be generated or regenerated from.
 *
 * A PRD is written FROM the BRD, and only from a BRD the owner has approved:
 * the first two entries are exactly the states the project state machine lets
 * GENERATE_PRD fire from, so reaching either means the BRD-approval gate was
 * passed. The three PRD states keep regeneration and revision working for a
 * project that already has one - the free/paid allowance is what caps those,
 * not this list. Everything earlier (draft, scoping, brd_generated) still owes
 * an approval, and everything later has moved on to staffing the work.
 *
 * Shared rather than local to the service so the PRD page can grey out the
 * button on the same rule the route enforces; state-machine.test.ts holds it
 * against VALID_TRANSITIONS so a new edge cannot leave it behind.
 */
export const PRD_GENERATION_STATUSES: readonly ProjectStatus[] = [
  'brd_approved',
  'brd_purchased',
  'prd_generated',
  'prd_approved',
  'prd_purchased',
] as const

/** Whether a project at this status has an approved BRD to build a PRD from. */
export function canGeneratePrd(status: ProjectStatus | undefined | null): boolean {
  return !!status && PRD_GENERATION_STATUSES.includes(status)
}

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
