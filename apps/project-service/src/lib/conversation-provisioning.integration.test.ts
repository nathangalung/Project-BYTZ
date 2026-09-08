// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import {
  chatConversations,
  chatParticipants,
  getDb,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { and, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureProjectConversations } from './conversation-provisioning'

/**
 * The threads a deal is supposed to come with.
 *
 * A matched project produced no conversation at all, so the two people who had
 * just signed an agreement had nowhere on the platform to talk while the ToS
 * forbids talking anywhere else.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('conversation provisioning', () => {
  let handle: TestHandle
  let ownerId: string
  let projectId: string
  const talentUsers: string[] = []

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
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

  async function assign(index: number, status: 'active' | 'terminated' = 'active') {
    const userId = await makeUser(`talent-${index}`)
    talentUsers.push(userId)
    const talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId, verificationStatus: 'verified' })
    const wpId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: wpId,
      projectId,
      title: `Package ${index}`,
      description: 'Package',
      orderIndex: index,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'assigned',
    })
    const assignmentId = uuidv7()
    await handle.db.insert(projectAssignments).values({
      id: assignmentId,
      projectId,
      talentId,
      workPackageId: wpId,
      acceptanceStatus: 'accepted',
      status,
    })
    return { assignmentId, userId }
  }

  beforeEach(async () => {
    await handle.truncate()
    talentUsers.length = 0

    ownerId = await makeUser('owner')
    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Matched project',
      description: 'Has a team',
      category: 'web_app',
      budgetMin: 8_000_000,
      budgetMax: 12_000_000,
      estimatedTimelineDays: 60,
      status: 'matched',
      teamSize: 2,
    })
  })

  it('opens one private thread per assignment, seating both sides', async () => {
    const a = await assign(0)

    const created = await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

    expect(created).toBe(1)
    const [thread] = await handle.db
      .select({ id: chatConversations.id, assignmentId: chatConversations.assignmentId })
      .from(chatConversations)
      .where(eq(chatConversations.type, 'owner_talent'))
    expect(thread?.assignmentId).toBe(a.assignmentId)

    const members = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, thread?.id ?? ''))
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([ownerId, a.userId]))
  })

  it('adds a group thread only once the project carries more than one talent', async () => {
    await assign(0)
    await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
    expect(
      await handle.db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.type, 'team_group')),
    ).toHaveLength(0)

    await assign(1)
    await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

    const group = await handle.db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(eq(chatConversations.type, 'team_group'))
    expect(group).toHaveLength(1)
    const members = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, group[0]?.id ?? ''))
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([ownerId, ...talentUsers]))
  })

  /** Both the accept branch and the owner transition reach the same project. */
  /**
   * A project that is gone has nobody to seat. Reading the owner off an absent
   * row is how a thread ends up owned by nobody.
   */
  it('creates nothing for a project that does not exist', async () => {
    const created = await getDb().transaction((tx) => ensureProjectConversations(tx, uuidv7()))

    expect(created).toBe(0)
  })

  it('creates nothing on a second run', async () => {
    await assign(0)
    await assign(1)

    await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
    const created = await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

    expect(created).toBe(0)
    expect(await handle.db.select().from(chatConversations)).toHaveLength(3)
    // Two private threads of two, plus a group of three.
    expect(await handle.db.select().from(chatParticipants)).toHaveLength(7)
  })

  /**
   * The insert loses to a concurrent one, or the thread arrived after the read
   * at the top of the function. Skipping it would leave a thread that exists
   * with nobody seated in it, which is unreadable by the two people it belongs
   * to - the exact failure the scoping thread had.
   */
  it('seats both sides in a thread it did not create', async () => {
    const a = await assign(0)
    const orphan = uuidv7()
    await handle.db.insert(chatConversations).values({
      id: orphan,
      projectId,
      type: 'owner_talent',
      assignmentId: a.assignmentId,
    })

    const created = await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

    expect(created).toBe(0)
    const members = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, orphan))
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([ownerId, a.userId]))
  })

  it('skips an assignment that is no longer live', async () => {
    await assign(0, 'terminated')

    const created = await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

    expect(created).toBe(0)
    expect(await handle.db.select().from(chatConversations)).toHaveLength(0)
  })

  it('gives a replacement talent their own thread without disturbing the running ones', async () => {
    const first = await assign(0)
    await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
    const [before] = await handle.db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.type, 'owner_talent'),
          eq(chatConversations.assignmentId, first.assignmentId),
        ),
      )

    const second = await assign(1)
    await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

    const threads = await handle.db
      .select({ id: chatConversations.id, assignmentId: chatConversations.assignmentId })
      .from(chatConversations)
      .where(eq(chatConversations.type, 'owner_talent'))
    expect(threads).toHaveLength(2)
    expect(threads.find((t) => t.assignmentId === first.assignmentId)?.id).toBe(before?.id)
    expect(threads.some((t) => t.assignmentId === second.assignmentId)).toBe(true)
  })
})
