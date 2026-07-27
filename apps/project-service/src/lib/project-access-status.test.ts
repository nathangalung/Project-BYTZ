import { projectAssignments, talentProfiles } from '@kerjacus/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An assignment row survives the talent leaving the project: termination and
 * replacement are recorded as statuses, not deletions. The lookup matched any
 * of them, so a terminated talent kept full read access to the project -
 * milestones, files, activity, and a Centrifugo subscription token - for as
 * long as their session lasted.
 *
 * The fake below evaluates the WHERE tree instead of replaying a queued
 * result, so what is asserted is the filter itself rather than the order the
 * queries happen to run in.
 */

type Condition =
  | { op: 'and'; parts: Condition[] }
  | { op: 'eq'; col: unknown; val: unknown }
  | { op: 'in'; col: unknown; vals: readonly unknown[] }

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...parts: Condition[]) => ({ op: 'and', parts }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, vals: readonly unknown[]) => ({ op: 'in', col, vals }),
}))

type Assignment = { id: string; projectId: string; userId: string; status: string }

let assignments: Assignment[] = []
let ownerId: string | null = 'owner-1'

function field(col: unknown, row: Assignment): unknown {
  if (col === projectAssignments.projectId) return row.projectId
  if (col === talentProfiles.userId) return row.userId
  if (col === projectAssignments.status) return row.status
  return undefined
}

function matches(cond: Condition, row: Assignment): boolean {
  switch (cond.op) {
    case 'and':
      return cond.parts.every((part) => matches(part, row))
    case 'eq':
      return field(cond.col, row) === cond.val
    case 'in':
      return cond.vals.includes(field(cond.col, row))
  }
}

vi.mock('@kerjacus/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kerjacus/db')>()
  const from = (table: unknown) => {
    let where: Condition | undefined
    const node: Record<string, unknown> = {
      innerJoin: () => node,
      where: (cond: Condition) => {
        where = cond
        return node
      },
      limit: async () => {
        if (table === original.projects) return ownerId === null ? [] : [{ ownerId }]
        return assignments.filter((row) => (where ? matches(where, row) : true))
      },
    }
    return node
  }
  return { ...original, getDb: () => ({ select: () => ({ from }) }) }
})

const { assertProjectAccess, isAssignedTalent } = await import('./project-access')

const assignment = (status: string): Assignment => ({
  id: `assignment-${status}`,
  projectId: 'proj-1',
  userId: 'talent-user',
  status,
})

beforeEach(() => {
  ownerId = 'owner-1'
  assignments = []
})

describe('isAssignedTalent', () => {
  it('admits a talent still working on it', async () => {
    assignments = [assignment('active')]
    expect(await isAssignedTalent('proj-1', 'talent-user')).toBe(true)
  })

  // They delivered the work; their own milestones and invoices stay readable.
  it('admits a talent whose assignment has completed', async () => {
    assignments = [assignment('completed')]
    expect(await isAssignedTalent('proj-1', 'talent-user')).toBe(true)
  })

  it('refuses a terminated talent', async () => {
    assignments = [assignment('terminated')]
    expect(await isAssignedTalent('proj-1', 'talent-user')).toBe(false)
  })

  // Somebody else took the work package over.
  it('refuses a replaced talent', async () => {
    assignments = [assignment('replaced')]
    expect(await isAssignedTalent('proj-1', 'talent-user')).toBe(false)
  })

  it('still admits a talent who was terminated on one package and active on another', async () => {
    assignments = [assignment('terminated'), assignment('active')]
    expect(await isAssignedTalent('proj-1', 'talent-user')).toBe(true)
  })

  it('refuses an assignment on a different project', async () => {
    assignments = [{ ...assignment('active'), projectId: 'proj-2' }]
    expect(await isAssignedTalent('proj-1', 'talent-user')).toBe(false)
  })
})

describe('assertProjectAccess', () => {
  async function codeOf(p: Promise<unknown>): Promise<string> {
    try {
      await p
      return 'NO_THROW'
    } catch (e) {
      return (e as { code?: string }).code ?? 'UNKNOWN'
    }
  }

  it('refuses a terminated talent', async () => {
    assignments = [assignment('terminated')]
    expect(await codeOf(assertProjectAccess('proj-1', 'talent-user'))).toBe('AUTH_FORBIDDEN')
  })

  it('allows one still assigned', async () => {
    assignments = [assignment('active')]
    await expect(assertProjectAccess('proj-1', 'talent-user')).resolves.toBeUndefined()
  })
})
