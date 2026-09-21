// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import {
  chatConversations,
  chatParticipants,
  getDb,
  outboxEvents,
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
import {
  ensureUserSupportRoom,
  findLatestPartyProject,
  pickSupportAdmin,
} from './support-conversation'

/**
 * The two rooms where a user reaches a human from KerjaCUS.
 *
 * Both are admin_mediation on an existing project - chat_conversations has no
 * discriminator column and project_id is NOT NULL - so these assert the thing
 * that actually tells them apart: how many non-admin participants a room has.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260921)`

runIf('support conversations', () => {
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

  async function makeUser(name: string, role = 'owner'): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false, role })
    return id
  }

  async function assign(index: number): Promise<string> {
    const userId = await makeUser(`talent-${index}`, 'talent')
    talentUsers.push(userId)
    const talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId, verificationStatus: 'verified' })
    const workPackageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: workPackageId,
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
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
    return userId
  }

  beforeEach(async () => {
    await handle.truncate()
    talentUsers.length = 0
    ownerId = await makeUser('owner')
    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Support fixture',
      description: 'A project that reached a deal.',
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 12_000_000,
      estimatedTimelineDays: 60,
      status: 'matched',
      teamSize: 2,
    })
  })

  async function memberIds(conversationId: string): Promise<Set<string>> {
    const rows = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, conversationId))
    return new Set(rows.map((r) => r.userId))
  }

  async function supportRooms(): Promise<{ id: string }[]> {
    return await handle.db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.projectId, projectId),
          eq(chatConversations.type, 'admin_mediation'),
        ),
      )
  }

  describe('the room a deal comes with', () => {
    it('seats the owner, the team and an admin', async () => {
      const adminId = await makeUser('admin', 'admin')
      const talentId = await assign(0)

      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

      const rooms = await supportRooms()
      expect(rooms).toHaveLength(1)
      expect(await memberIds(rooms[0]?.id ?? '')).toEqual(new Set([ownerId, talentId, adminId]))
    })

    /** The deal moment runs twice - talent accept and the owner transition. */
    it('opens exactly one room however often the deal fires', async () => {
      await makeUser('admin', 'admin')
      await assign(0)

      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

      expect(await supportRooms()).toHaveLength(1)
    })

    /**
     * No admin account is not a reason to withhold the room from the two people
     * who just signed. An admin_mediation room with no admin in it is the
     * admin-pending marker, and the next run seats one - which is why
     * membership is repaired on every run and not only on the creating one.
     */
    it('creates an admin-pending room when no admin exists, then seats one later', async () => {
      const talentId = await assign(0)

      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
      const [room] = await supportRooms()
      expect(await memberIds(room?.id ?? '')).toEqual(new Set([ownerId, talentId]))

      const adminId = await makeUser('admin', 'admin')
      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

      expect(await supportRooms()).toHaveLength(1)
      expect(await memberIds(room?.id ?? '')).toEqual(new Set([ownerId, talentId, adminId]))
    })

    it('tells every participant about the room through the outbox', async () => {
      const adminId = await makeUser('admin', 'admin')
      const talentId = await assign(0)

      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))

      const events = await handle.db
        .select({ payload: outboxEvents.payload, eventType: outboxEvents.eventType })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'notification.send'))
      const notified = new Set(
        events.map((e) => (e.payload as { userId: string; templateKey: string }).userId),
      )
      expect(notified).toEqual(new Set([ownerId, talentId, adminId]))
      expect(
        events.every(
          (e) =>
            (e.payload as { templateKey: string }).templateKey ===
            'notification.support_room_opened',
        ),
      ).toBe(true)
    })
  })

  describe('the room the support button opens', () => {
    it('seats only the caller and an admin', async () => {
      const adminId = await makeUser('admin', 'admin')

      const room = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: ownerId, projectId }),
      )

      expect(room.created).toBe(true)
      expect(room.adminId).toBe(adminId)
      expect(await memberIds(room.conversationId)).toEqual(new Set([ownerId, adminId]))
    })

    /**
     * admin_mediation has no partial unique index, so two presses arriving
     * together cannot lose an insert race against the database - the projects
     * row lock is what stops them, and this is what says so.
     */
    it('opens one room when two presses arrive at once', async () => {
      await makeUser('admin', 'admin')

      const [a, b] = await Promise.all([
        getDb().transaction((tx) => ensureUserSupportRoom(tx, { userId: ownerId, projectId })),
        getDb().transaction((tx) => ensureUserSupportRoom(tx, { userId: ownerId, projectId })),
      ])

      expect(a.conversationId).toBe(b.conversationId)
      expect(await supportRooms()).toHaveLength(1)
    })

    it('hands back the same room on a second press', async () => {
      await makeUser('admin', 'admin')

      const first = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: ownerId, projectId }),
      )
      const second = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: ownerId, projectId }),
      )

      expect(second.conversationId).toBe(first.conversationId)
      expect(second.created).toBe(false)
      expect(await supportRooms()).toHaveLength(1)
    })

    /**
     * The personal room and the project room are both admin_mediation on the
     * same project. Telling them apart by participant count is the whole of the
     * idempotency, so this is the test that would catch it collapsing.
     */
    it('does not hand back the project room the deal created', async () => {
      await makeUser('admin', 'admin')
      await assign(0)
      await getDb().transaction((tx) => ensureProjectConversations(tx, projectId))
      const [dealRoom] = await supportRooms()

      const personal = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: ownerId, projectId }),
      )

      expect(personal.conversationId).not.toBe(dealRoom?.id)
      expect(await supportRooms()).toHaveLength(2)
    })

    it('gives the owner and a talent separate rooms', async () => {
      await makeUser('admin', 'admin')
      const talentId = await assign(0)

      const ownerRoom = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: ownerId, projectId }),
      )
      const talentRoom = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: talentId, projectId }),
      )

      expect(ownerRoom.conversationId).not.toBe(talentRoom.conversationId)
      expect(await memberIds(talentRoom.conversationId)).not.toContain(ownerId)
    })
  })

  describe('choosing the admin', () => {
    it('returns null when the platform has no admin', async () => {
      expect(await getDb().transaction((tx) => pickSupportAdmin(tx))).toBeNull()
    })

    /** Least-loaded, ties broken on id, so the choice is reproducible. */
    it('picks the admin carrying the fewest support rooms', async () => {
      const first = await makeUser('admin-a', 'admin')
      const second = await makeUser('admin-b', 'admin')
      const busy = first < second ? first : second
      const idle = first < second ? second : first

      // The first room goes to whichever id sorts first on an equal count.
      const opened = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: ownerId, projectId }),
      )
      expect(opened.adminId).toBe(busy)

      const other = await makeUser('owner-2')
      const next = await getDb().transaction((tx) =>
        ensureUserSupportRoom(tx, { userId: other, projectId }),
      )
      expect(next.adminId).toBe(idle)
    })
  })

  describe('finding the project a support thread hangs off', () => {
    it('finds the project a user owns', async () => {
      expect(await getDb().transaction((tx) => findLatestPartyProject(tx, ownerId))).toBe(projectId)
    })

    it('finds the project a talent is assigned to', async () => {
      const talentId = await assign(0)

      expect(await getDb().transaction((tx) => findLatestPartyProject(tx, talentId))).toBe(
        projectId,
      )
    })

    it('returns null for someone party to no project at all', async () => {
      const stranger = await makeUser('stranger')

      expect(await getDb().transaction((tx) => findLatestPartyProject(tx, stranger))).toBeNull()
    })

    it('ignores a soft-deleted project', async () => {
      await handle.db
        .update(projects)
        .set({ deletedAt: new Date() })
        .where(eq(projects.id, projectId))

      expect(await getDb().transaction((tx) => findLatestPartyProject(tx, ownerId))).toBeNull()
    })
  })
})
