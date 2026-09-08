// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import {
  contracts,
  getDb,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureProjectContracts, unsignedAssignments } from './contract-generation'

/**
 * CLAUDE.md promised a contract per talent generated when a team completes.
 * Nothing produced one: no caller outside the manual CRUD route ever inserted
 * into `contracts`, and no code read signedByOwner or signedByTalent before
 * work began. The table existed and the promise did not.
 */
const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('generating and gating talent agreements', () => {
  let handle: TestHandle
  let db: ReturnType<typeof getDb>
  let ownerId: string
  let projectId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    db = getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function addAssignment(roleLabel: string): Promise<string> {
    const talentUserId = await makeUser(`talent-${roleLabel}`)
    const talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })
    const wpId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: wpId,
      projectId,
      title: roleLabel,
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'assigned',
    })
    const aid = uuidv7()
    await handle.db.insert(projectAssignments).values({
      id: aid,
      projectId,
      talentId,
      workPackageId: wpId,
      roleLabel,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
    return aid
  }

  beforeEach(async () => {
    await handle.truncate()
    ownerId = await makeUser('owner')
    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Contracted project',
      description: 'Exercises contract generation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'matched',
    })
  })

  async function sign(assignmentId: string, owner: boolean, talent: boolean) {
    await db
      .update(contracts)
      .set({ signedByOwner: owner, signedByTalent: talent })
      .where(eq(contracts.assignmentId, assignmentId))
  }

  it('writes both agreements for every talent on the team', async () => {
    await addAssignment('Backend Developer')
    await addAssignment('Frontend Developer')

    const created = await db.transaction((tx) => ensureProjectContracts(tx, projectId))

    expect(created).toBe(4)
    const rows = await db.select().from(contracts).where(eq(contracts.projectId, projectId))
    expect(rows.map((r) => r.type).sort()).toEqual([
      'ip_transfer',
      'ip_transfer',
      'standard_nda',
      'standard_nda',
    ])
    expect(rows.every((r) => r.signedByOwner === false && r.signedByTalent === false)).toBe(true)
  })

  /** The clauses travel with the row, so a later template edit cannot restate
   * what two people already signed. */
  it('stores the clauses and both party names on the contract', async () => {
    await addAssignment('Backend Developer')

    await db.transaction((tx) => ensureProjectContracts(tx, projectId))

    const [nda] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.type, 'standard_nda'))
      .limit(1)
    const content = nda?.content as {
      clauses: string[]
      parties: { owner: string; talent: string }
    }
    expect(content.clauses.length).toBeGreaterThan(0)
    expect(content.parties.owner).toBe('owner')
    expect(content.parties.talent).toBe('talent-Backend Developer')
  })

  /** Both the talent-accept path and the owner transition reach matched. */
  it('is idempotent when the same project completes twice', async () => {
    await addAssignment('Backend Developer')

    await db.transaction((tx) => ensureProjectContracts(tx, projectId))
    const second = await db.transaction((tx) => ensureProjectContracts(tx, projectId))

    expect(second).toBe(0)
    const rows = await db.select().from(contracts).where(eq(contracts.projectId, projectId))
    expect(rows).toHaveLength(2)
  })

  it('names every position whose agreements are not fully signed', async () => {
    const backend = await addAssignment('Backend Developer')
    await addAssignment('Frontend Developer')
    await db.transaction((tx) => ensureProjectContracts(tx, projectId))

    await sign(backend, true, true)

    expect(await unsignedAssignments(db, projectId)).toEqual(['Frontend Developer'])
  })

  it('still blocks when only one side has signed', async () => {
    const backend = await addAssignment('Backend Developer')
    await db.transaction((tx) => ensureProjectContracts(tx, projectId))

    await sign(backend, true, false)

    expect(await unsignedAssignments(db, projectId)).toEqual(['Backend Developer'])
  })

  /** A missing row is unsigned, not nothing to sign; otherwise deleting the
   * contracts would open the gate. */
  it('treats an assignment with no contracts as unsigned', async () => {
    await addAssignment('Backend Developer')

    expect(await unsignedAssignments(db, projectId)).toEqual(['Backend Developer'])
  })

  it('clears once both parties sign every agreement', async () => {
    const backend = await addAssignment('Backend Developer')
    await db.transaction((tx) => ensureProjectContracts(tx, projectId))

    await sign(backend, true, true)

    expect(await unsignedAssignments(db, projectId)).toEqual([])
  })
})
