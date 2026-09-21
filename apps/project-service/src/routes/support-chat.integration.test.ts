// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

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
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { chatRoute } from './chat'
import { realtimeRoute } from './realtime'

/**
 * The "Hubungi Admin/Support" endpoint, and the channel the room rides on.
 *
 * The button is in the shell on both the talent and the owner side, so it can
 * be pressed from anywhere and pressed twice. One open room per user per
 * project is what keeps that from filling the support queue with duplicates.
 *
 * The admin seated in the room is a chat participant like anyone else, which is
 * the whole reason realtime.ts needs no new branch - but "needs no change" is a
 * claim, so it is asserted here rather than assumed.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'owner'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/chat', chatRoute)
  app.route('/realtime', realtimeRoute)
  return app
}

type SupportBody = {
  success: true
  data: { id: string; projectId: string; type: string; created: boolean; adminId: string | null }
}
type ErrorBody = { success: false; error: { code: string; message: string } }

runIf('support conversation route', () => {
  let handle: TestHandle
  let ownerId: string
  let talentUserId: string
  let adminId: string
  let projectId: string

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

  function support(caller: SessionUser, body: unknown = {}) {
    return appAs(caller).request('/chat/conversations/support', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    adminId = await makeUser('admin', 'admin')
    talentUserId = await makeUser('talent', 'talent')
    const talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Supported project',
      description: 'Exercises the support button',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
    })
    const wpId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: wpId,
      projectId,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
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
      workPackageId: wpId,
      status: 'active',
    })
  })

  it('opens a room with an admin for an owner who names no project', async () => {
    const res = await support(session(ownerId))

    expect(res.status).toBe(201)
    const body = (await res.json()) as SupportBody
    expect(body.data.type).toBe('admin_mediation')
    expect(body.data.projectId).toBe(projectId)
    expect(body.data.adminId).toBe(adminId)

    const members = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, body.data.id))
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([ownerId, adminId]))
  })

  it('does the same for a talent, from their assignment', async () => {
    const res = await support(session(talentUserId, 'talent'))

    expect(res.status).toBe(201)
    const body = (await res.json()) as SupportBody
    expect(body.data.projectId).toBe(projectId)
  })

  /** The button is persistent, so a second press must not open a second room. */
  it('hands back the same room, with 200 rather than 201, on a second press', async () => {
    const first = (await (await support(session(ownerId))).json()) as SupportBody

    const res = await support(session(ownerId))

    expect(res.status).toBe(200)
    const second = (await res.json()) as SupportBody
    expect(second.data.id).toBe(first.data.id)
    expect(second.data.created).toBe(false)
    expect(
      await handle.db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.type, 'admin_mediation')),
    ).toHaveLength(1)
  })

  it('refuses a project the caller is not party to', async () => {
    const stranger = await makeUser('stranger')
    const other = uuidv7()
    await handle.db.insert(projects).values({
      id: other,
      ownerId: stranger,
      title: 'Somebody else',
      description: 'Not the caller',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 2_000_000,
      estimatedTimelineDays: 30,
      status: 'draft',
    })

    const res = await support(session(ownerId), { projectId: other })

    expect(res.status).toBe(403)
    expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
  })

  /**
   * chat_conversations.project_id is NOT NULL, so a user party to no project
   * has nothing to hang a thread off. Saying so beats inventing a project.
   */
  it('says so when the caller belongs to no project at all', async () => {
    const stranger = await makeUser('stranger')

    const res = await support(session(stranger))

    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorBody).error.code).toBe('SUPPORT_NO_PROJECT')
  })

  it('accepts a request with no body at all', async () => {
    const res = await appAs(session(ownerId)).request('/chat/conversations/support', {
      method: 'POST',
    })

    expect(res.status).toBe(201)
  })

  it('lists the room for the caller', async () => {
    const opened = (await (await support(session(ownerId))).json()) as SupportBody

    const res = await appAs(session(ownerId)).request('/chat/conversations')
    const body = (await res.json()) as { data: { id: string; type: string }[] }

    expect(body.data.find((row) => row.id === opened.data.id)?.type).toBe('admin_mediation')
  })

  describe('the admin seated in the room', () => {
    it('is admitted to the chat channel, like any other participant', async () => {
      const opened = (await (await support(session(ownerId))).json()) as SupportBody

      const res = await appAs(session(adminId, 'admin')).request(
        `/realtime/subscription-token?channel=chat:${opened.data.id}`,
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { token: string } }
      expect(body.data.token.split('.')).toHaveLength(3)
    })

    it('is still refused a conversation nobody seated them in', async () => {
      const outsider = uuidv7()
      await handle.db
        .insert(chatConversations)
        .values({ id: outsider, projectId, type: 'owner_talent' })

      const res = await appAs(session(adminId, 'admin')).request(
        `/realtime/subscription-token?channel=chat:${outsider}`,
      )

      expect(res.status).toBe(403)
    })

    it('can read and post in the room', async () => {
      const opened = (await (await support(session(ownerId))).json()) as SupportBody

      const sent = await appAs(session(adminId, 'admin')).request(
        `/chat/conversations/${opened.data.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Halo, ada yang bisa kami bantu?' }),
          headers: { 'Content-Type': 'application/json' },
        },
      )
      expect(sent.status).toBe(201)

      const read = await appAs(session(adminId, 'admin')).request(
        `/chat/conversations/${opened.data.id}/messages`,
      )
      const body = (await read.json()) as { data: { items: { content: string }[] } }
      expect(body.data.items[0]?.content).toBe('Halo, ada yang bisa kami bantu?')
    })
  })

  it('keeps the personal room apart from the project room the deal opened', async () => {
    // The deal room seats the owner, the team and an admin; the personal one
    // seats the caller alone with an admin. Both are admin_mediation on the
    // same project, so this is the assertion that the participant-count
    // discriminator still holds through the route.
    const dealRoom = uuidv7()
    await handle.db
      .insert(chatConversations)
      .values({ id: dealRoom, projectId, type: 'admin_mediation' })
    await handle.db.insert(chatParticipants).values(
      [ownerId, talentUserId, adminId].map((userId) => ({
        id: uuidv7(),
        conversationId: dealRoom,
        userId,
      })),
    )

    const body = (await (await support(session(ownerId))).json()) as SupportBody

    expect(body.data.id).not.toBe(dealRoom)
    expect(
      await handle.db
        .select()
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.projectId, projectId),
            eq(chatConversations.type, 'admin_mediation'),
          ),
        ),
    ).toHaveLength(2)
  })
})
