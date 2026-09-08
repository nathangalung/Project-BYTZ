// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import { chatConversations, chatParticipants, getDb, projects, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureScopingConversation } from './scoping-conversation'

/**
 * The scoping thread and the one row that made it readable.
 *
 * Both chat routes authorise on participation, and GET /conversations IS the
 * participant query, so a thread created without a chat_participants row is
 * invisible and unreadable to the owner who is talking in it. That is what
 * emptied the messages page for every user on the platform and lost the
 * scoping history on every reload.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('scoping conversation membership', () => {
  let handle: TestHandle
  let ownerId: string
  let projectId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Scoped project',
      description: 'Being scoped',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
      status: 'scoping',
    })
  })

  it('seats the owner in the thread it creates', async () => {
    const conversationId = await ensureScopingConversation(projectId)

    const rows = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, conversationId))

    expect(rows.map((r) => r.userId)).toEqual([ownerId])
  })

  it('repairs a thread that was created without membership', async () => {
    const orphan = uuidv7()
    await handle.db.insert(chatConversations).values({ id: orphan, projectId, type: 'ai_scoping' })

    const conversationId = await ensureScopingConversation(projectId)

    expect(conversationId).toBe(orphan)
    const rows = await handle.db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.conversationId, orphan))
    expect(rows.map((r) => r.userId)).toEqual([ownerId])
  })

  it('does not duplicate membership across calls', async () => {
    await ensureScopingConversation(projectId)
    await ensureScopingConversation(projectId)

    expect(await handle.db.select().from(chatParticipants)).toHaveLength(1)
    expect(await handle.db.select().from(chatConversations)).toHaveLength(1)
  })
})
