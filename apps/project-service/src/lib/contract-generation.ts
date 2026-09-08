import {
  contracts,
  type Database,
  projectAssignments,
  projects,
  talentProfiles,
  user,
} from '@kerjacus/db'
import { and, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { appendOutboxEvent } from './outbox'

/** Assignments that still hold their work package. */
const LIVE_ASSIGNMENT_STATUSES = ['active', 'completed'] as const

/** Both agreements the platform promises per talent. */
const CONTRACT_TYPES = ['standard_nda', 'ip_transfer'] as const

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

type Party = { owner: string | null; talent: string | null }

/**
 * The clauses each agreement carries.
 *
 * Stored per contract rather than referenced by version, because a template
 * edited later must not silently restate what two people already signed. The
 * text is what the signature attaches to, so it travels with the row.
 */
function clausesFor(type: (typeof CONTRACT_TYPES)[number]): string[] {
  if (type === 'standard_nda') {
    return [
      'Both parties keep project information, business context and deliverables confidential.',
      'Confidentiality survives the end of this project.',
      'Talents on the same team are bound to each other and may not share project information outside the team.',
      'Communication about this project stays on the platform.',
    ]
  }
  return [
    'All work produced for this project (code, design, documents) transfers to the project owner once payment for it completes.',
    'The talent may not reuse the owner material for other projects.',
    'The talent warrants the work is theirs to transfer and does not infringe a third party.',
    'Work not yet paid for remains the talent property.',
  ]
}

function contentFor(
  type: (typeof CONTRACT_TYPES)[number],
  parties: Party,
  roleLabel: string | null,
): Record<string, unknown> {
  return {
    title: type === 'standard_nda' ? 'Non-Disclosure Agreement' : 'IP Transfer Agreement',
    roleLabel,
    clauses: clausesFor(type),
    parties,
  }
}

/**
 * Create the NDA and IP transfer for every live assignment on a project.
 *
 * Called where the team completes, not from a route: the platform promised a
 * contract per talent on team completion and nothing had ever produced one, so
 * `contracts` held only rows a test wrote. Signing then gates the project into
 * in_progress.
 *
 * Idempotent by contracts_assignment_type_unique. Re-running skips what exists
 * rather than failing, because both the accept path and the owner transition
 * can reach `matched` for the same project.
 */
export async function ensureProjectContracts(tx: Tx, projectId: string): Promise<number> {
  const rows = await tx
    .select({
      assignmentId: projectAssignments.id,
      roleLabel: projectAssignments.roleLabel,
      talentName: user.name,
    })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .innerJoin(user, eq(user.id, talentProfiles.userId))
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        inArray(projectAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
      ),
    )
  if (rows.length === 0) return 0

  const [owner] = await tx
    .select({ name: user.name })
    .from(projects)
    .innerJoin(user, eq(user.id, projects.ownerId))
    .where(eq(projects.id, projectId))
    .limit(1)

  const existing = await tx
    .select({ assignmentId: contracts.assignmentId, type: contracts.type })
    .from(contracts)
    .where(eq(contracts.projectId, projectId))
  const already = new Set(existing.map((r) => `${r.assignmentId}:${r.type}`))

  let created = 0
  for (const row of rows) {
    for (const type of CONTRACT_TYPES) {
      if (already.has(`${row.assignmentId}:${type}`)) continue
      const id = uuidv7()
      await tx.insert(contracts).values({
        id,
        projectId,
        assignmentId: row.assignmentId,
        type,
        content: contentFor(
          type,
          { owner: owner?.name ?? null, talent: row.talentName },
          row.roleLabel,
        ),
        signedByOwner: false,
        signedByTalent: false,
      })
      await appendOutboxEvent(tx, {
        aggregateType: 'contract',
        aggregateId: id,
        eventType: 'contract.created',
        payload: { contractId: id, projectId, type },
      })
      created += 1
    }
  }
  return created
}

/**
 * Assignments whose agreements are not yet signed by both parties.
 *
 * Returns role labels rather than a boolean so the owner is told which position
 * is holding the project rather than that something is.
 */
export async function unsignedAssignments(db: Database | Tx, projectId: string): Promise<string[]> {
  const rows = await db
    .select({
      roleLabel: projectAssignments.roleLabel,
      type: contracts.type,
      signedByOwner: contracts.signedByOwner,
      signedByTalent: contracts.signedByTalent,
    })
    .from(projectAssignments)
    .leftJoin(contracts, eq(contracts.assignmentId, projectAssignments.id))
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        inArray(projectAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
      ),
    )

  const pending = new Set<string>()
  const seen = new Map<string, Set<string>>()
  for (const row of rows) {
    const label = row.roleLabel ?? 'Unnamed position'
    // A missing contract row counts as unsigned, not as nothing to sign.
    if (!row.type) {
      pending.add(label)
      continue
    }
    if (!(row.signedByOwner && row.signedByTalent)) pending.add(label)
    const types = seen.get(label) ?? new Set<string>()
    types.add(row.type)
    seen.set(label, types)
  }
  for (const [label, types] of seen) {
    if (types.size < CONTRACT_TYPES.length) pending.add(label)
  }
  return [...pending]
}

export { CONTRACT_TYPES }
