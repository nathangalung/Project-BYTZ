import { MAX_PAID_DOC_VERSION } from './constants'
import type { ProjectStatus } from './enums'

/**
 * The project positions a PRD may be generated or regenerated from.
 *
 * A PRD is written FROM the BRD, so the project is either still on the BRD
 * step or already on the PRD one - the second keeps regeneration and revision
 * working for a project that has a PRD, and the free/paid allowance is what
 * caps those, not this list. Everything earlier (draft, scoping) has no BRD at
 * all, and everything later has moved on to staffing the work.
 *
 * The position is half the gate. Approval used to be a position of its own
 * (`brd_approved`), so the list alone decided it; now brd_review spans the
 * whole BRD step and approval is the document's own status, which is why
 * canGeneratePrd takes it as a second argument.
 *
 * Shared rather than local to the service so the PRD page can grey out the
 * button on the same rule the route enforces; state-machine.test.ts holds it
 * against VALID_TRANSITIONS so a new edge cannot leave it behind.
 */
export const PRD_GENERATION_STATUSES: readonly ProjectStatus[] = [
  'brd_review',
  'prd_review',
] as const

/** Whether a project here has an approved BRD to build a PRD from. */
export function canGeneratePrd(
  status: ProjectStatus | undefined | null,
  brdStatus: string | undefined | null,
): boolean {
  if (!status || !PRD_GENERATION_STATUSES.includes(status)) return false
  // Approval is the whole gate. Buying the BRD is recorded on the document as
  // paid_at, never as a status, so a bought BRD is an approved one and nothing
  // further needs asking here.
  return brdStatus === 'approved'
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
