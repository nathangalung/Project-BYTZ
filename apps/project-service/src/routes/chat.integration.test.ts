// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  chatConversations,
  chatMessages,
  chatParticipants,
  getDb,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { chatRoute } from './chat'

/**
 * Platform-mediated messaging, and the two things it has to enforce.
 *
 * Membership: creating a conversation makes the creator a participant, and
 * being a participant is what grants the read, so creation itself has to be
 * gated on the project or anyone could grant themselves access to a project
 * thread by opening one on it.
 *
 * Authorship: a session caller is always a `user`. senderType comes from the
 * body, so without the service check a signed-in caller could post as the
 * platform - null sender, and no disintermediation scan on the content.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`
// Pinned by vitest.setup.ts. Read rather than restated, so a change there
// breaks the test instead of silently making it pass against a stale literal.
const SERVICE_SECRET = process.env.SERVICE_AUTH_SECRET as string

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', chatRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }

function json(
  caller: SessionUser | null,
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return appAs(caller).request(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

runIf('chat routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let strangerId: string
  let projectId: string

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

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })
    strangerId = await makeUser('stranger')

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Chatty project',
      description: 'Exercises the chat rules',
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
      status: 'in_progress',
    })
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: wpId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
  })

  async function makeConversation(participants: string[]): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(chatConversations).values({ id, projectId, type: 'owner_talent' })
    await handle.db
      .insert(chatParticipants)
      .values(participants.map((userId) => ({ id: uuidv7(), conversationId: id, userId })))
    return id
  }

  describe('POST /conversations', () => {
    const body = () => ({
      projectId,
      type: 'owner_talent' as const,
      participantIds: [talentUserId],
    })

    it('opens a thread and enrols the creator alongside the named participants', async () => {
      const res = await json(session(ownerId, 'owner'), '/conversations', 'POST', body())

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(chatParticipants)
      expect(rows.map((r) => r.userId).sort()).toEqual([ownerId, talentUserId].sort())
    })

    it('does not duplicate the creator when they are also named', async () => {
      const res = await json(session(ownerId, 'owner'), '/conversations', 'POST', {
        ...body(),
        participantIds: [ownerId, talentUserId, ownerId],
      })

      expect(res.status).toBe(201)
      expect(await handle.db.select().from(chatParticipants)).toHaveLength(2)
    })

    /**
     * Creation grants membership, and membership grants the read - so without
     * this gate anyone could open a thread on a project they have no part in
     * and become authorised on it.
     */
    it('refuses a signed-in stranger to the project', async () => {
      const res = await json(session(strangerId), '/conversations', 'POST', body())

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await handle.db.select().from(chatConversations)).toHaveLength(0)
    })

    it('lets an assigned talent open one', async () => {
      const res = await json(session(talentUserId), '/conversations', 'POST', {
        ...body(),
        participantIds: [ownerId],
      })

      expect(res.status).toBe(201)
    })

    it('rejects a body with no participants', async () => {
      const res = await json(session(ownerId, 'owner'), '/conversations', 'POST', {
        ...body(),
        participantIds: [],
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a conversation type outside the enum', async () => {
      const res = await json(session(ownerId, 'owner'), '/conversations', 'POST', {
        ...body(),
        type: 'smoke_signal',
      })

      expect(res.status).toBe(400)
    })

    /** chat_conversations_scoping_unique: one AI scoping thread per project. */
    it('refuses a second ai_scoping thread on the same project', async () => {
      await json(session(ownerId, 'owner'), '/conversations', 'POST', {
        ...body(),
        type: 'ai_scoping',
      })

      const res = await json(session(ownerId, 'owner'), '/conversations', 'POST', {
        ...body(),
        type: 'ai_scoping',
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(
        await handle.db
          .select()
          .from(chatConversations)
          .where(eq(chatConversations.type, 'ai_scoping')),
      ).toHaveLength(1)
    })
  })

  describe('GET /conversations', () => {
    it('lists the threads the caller belongs to', async () => {
      await makeConversation([ownerId, talentUserId])

      const res = await appAs(session(talentUserId)).request('/conversations')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    it('returns nothing to someone who belongs to none', async () => {
      await makeConversation([ownerId, talentUserId])

      const res = await appAs(session(strangerId)).request('/conversations')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
    })

    /**
     * The list needs something to label a thread with. Without the title the
     * client built one from the project id, and every seeded project shares an
     * id prefix, so every row read "Project 00000000".
     */
    it('carries the project title', async () => {
      await makeConversation([ownerId, talentUserId])

      const res = await appAs(session(ownerId, 'owner')).request('/conversations')

      const rows = ((await res.json()) as { data: Array<{ projectTitle?: string }> }).data
      expect(rows).toHaveLength(1)
      expect(rows[0]?.projectTitle).toBe('Chatty project')
    })
  })

  describe('GET /conversations/:id/messages', () => {
    let conversationId: string

    beforeEach(async () => {
      conversationId = await makeConversation([ownerId, talentUserId])
      await handle.db.insert(chatMessages).values({
        id: uuidv7(),
        conversationId,
        senderType: 'user',
        senderId: ownerId,
        content: 'How is the API coming along',
      })
    })

    it('returns the thread to a participant', async () => {
      const res = await appAs(session(talentUserId)).request(
        `/conversations/${conversationId}/messages`,
      )

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(1)
    })

    it('refuses a non-participant', async () => {
      const res = await appAs(session(strangerId)).request(
        `/conversations/${conversationId}/messages`,
      )

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('participant')
    })

    it('reports an unknown conversation as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/conversations/${uuidv7()}/messages`,
      )

      expect(res.status).toBe(404)
    })

    it('rejects an out-of-range page size', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/conversations/${conversationId}/messages?pageSize=99999`,
      )

      expect(res.status).toBe(400)
    })
  })

  describe('POST /conversations/:id/messages', () => {
    let conversationId: string

    beforeEach(async () => {
      conversationId = await makeConversation([ownerId, talentUserId])
    })

    it('records a message from a participant', async () => {
      const res = await json(
        session(talentUserId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: 'On track for Friday',
        },
      )

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(chatMessages)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.senderType).toBe('user')
      expect(rows[0]?.senderId).toBe(talentUserId)
    })

    it('refuses a non-participant', async () => {
      const res = await json(
        session(strangerId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: 'Let me in',
        },
      )

      expect(res.status).toBe(403)
      expect(await handle.db.select().from(chatMessages)).toHaveLength(0)
    })

    it('reports an unknown conversation as not found', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/conversations/${uuidv7()}/messages`,
        'POST',
        {
          content: 'Anyone there',
        },
      )

      expect(res.status).toBe(404)
    })

    /**
     * senderType is a body field, so without the service check a signed-in
     * caller could post as the platform: null sender, and no bypass scan on
     * what they wrote.
     */
    it('forces a session caller message to sender type user', async () => {
      await json(session(talentUserId), `/conversations/${conversationId}/messages`, 'POST', {
        content: 'This is an official platform notice',
        senderType: 'system',
      })

      const rows = await handle.db.select().from(chatMessages)
      expect(rows[0]?.senderType).toBe('user')
      expect(rows[0]?.senderId).toBe(talentUserId)
    })

    it('lets an inter-service caller post as the assistant', async () => {
      const res = await json(
        null,
        `/conversations/${conversationId}/messages`,
        'POST',
        { content: 'Generated answer', senderType: 'ai' },
        { 'X-Service-Auth': SERVICE_SECRET },
      )

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(chatMessages)
      expect(rows[0]?.senderType).toBe('ai')
      expect(rows[0]?.senderId).toBeNull()
    })

    /** A wrong secret is a session caller, and there is no session here. */
    it('refuses a caller presenting the wrong service secret and no session', async () => {
      const res = await json(
        null,
        `/conversations/${conversationId}/messages`,
        'POST',
        { content: 'Pretending to be the platform', senderType: 'system' },
        { 'X-Service-Auth': 'wrong-secret' },
      )

      expect(res.status).toBe(401)
      expect(await handle.db.select().from(chatMessages)).toHaveLength(0)
    })

    it('flags a phone number as a bypass attempt but still records the message', async () => {
      const res = await json(
        session(talentUserId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: 'Reach me on 081234567890 instead',
        },
      )

      expect(res.status).toBe(201)
      expect(res.headers.get('X-Bypass-Warning')).toBe('1')
      expect(await handle.db.select().from(chatMessages)).toHaveLength(1)
    })

    it('flags an email address too', async () => {
      const res = await json(
        session(talentUserId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: 'Email me at someone@example.com',
        },
      )

      expect(res.headers.get('X-Bypass-Warning')).toBe('1')
    })

    it('leaves an ordinary message unflagged', async () => {
      const res = await json(
        session(talentUserId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: 'The endpoint is ready for review',
        },
      )

      expect(res.headers.get('X-Bypass-Warning')).toBeNull()
    })

    /** Only user content is scanned; a service message is the platform speaking. */
    it('does not scan a service message', async () => {
      const res = await json(
        null,
        `/conversations/${conversationId}/messages`,
        'POST',
        { content: 'Contact support at help@kerjacus.id', senderType: 'system' },
        { 'X-Service-Auth': SERVICE_SECRET },
      )

      expect(res.status).toBe(201)
      expect(res.headers.get('X-Bypass-Warning')).toBeNull()
    })

    it('rejects an empty message', async () => {
      const res = await json(
        session(talentUserId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: '',
        },
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a message past the length cap', async () => {
      const res = await json(
        session(talentUserId),
        `/conversations/${conversationId}/messages`,
        'POST',
        {
          content: 'x'.repeat(10_001),
        },
      )

      expect(res.status).toBe(400)
    })
  })
})
