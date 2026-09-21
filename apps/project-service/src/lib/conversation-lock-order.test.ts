import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where the projects row is locked, not whether it is.
 *
 * The support room has no partial unique index to lose an insert race against
 * - the schema leaves admin_mediation out of them deliberately - so it
 * serialises on the projects row instead. That lock was first taken at the
 * point of use, which is after the owner_talent and team_group inserts, and
 * that inverted the order between the two callers that reach this function:
 *
 *   matching.ts     locks projects, then inserts conversations
 *   projects.ts     locks nothing, so it inserted conversations, then locked
 *
 * Those two race - the fall-through branches in this file exist because they
 * do - and an inverted pair deadlocks: each waits on a row the other holds, and
 * Postgres aborts one of them. The deal path answering 500 because two people
 * completed the same team at once is not a failure a retry hides.
 *
 * A concurrency test cannot pin this down: a deadlock needs a specific
 * interleaving, so the broken order passes most runs. The order itself is what
 * has to hold, so the order itself is what is asserted.
 */

const source = readFileSync(path.resolve(__dirname, './conversation-provisioning.ts'), 'utf8')

describe('ensureProjectConversations', () => {
  it('locks the projects row on its very first read', () => {
    const firstRead = source.indexOf('.from(projects)')
    const lock = source.indexOf(".for('update')")

    expect(firstRead).toBeGreaterThan(-1)
    expect(lock).toBeGreaterThan(firstRead)
    // Nothing between the read and its FOR UPDATE but the where clause.
    expect(source.slice(firstRead, lock)).not.toContain('insert')
  })

  it('takes that lock before it writes any conversation', () => {
    const lock = source.indexOf(".for('update')")
    const firstInsert = source.indexOf('.insert(chatConversations)')

    expect(firstInsert).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(firstInsert)
  })
})
