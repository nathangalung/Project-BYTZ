import {
  chatConversations,
  chatMessages,
  chatParticipants,
  outboxEvents,
  projects,
  user,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { asc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ChatRepository } from './chat.repository'

/**
 * ChatRepository against Postgres.
 *
 * Opening a conversation wrote the conversation, then looped inserting one
 * participant at a time outside any transaction. Reading a conversation is
 * gated on being a participant, so a failure partway left a conversation that
 * existed and could not be read - and the creator, inserted first only by
 * accident of Set ordering, could be the one locked out. That is a claim about
 * what survives a failed write, which only a database can answer.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('ChatRepository', () => {
  let handle: TestHandle
  let repo: ChatRepository
  let ownerId: string
  let talentUserId: string
  let projectId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new ChatRepository(handle.db)

    ownerId = uuidv7()
    talentUserId = uuidv7()
    await handle.db.insert(user).values([
      { id: ownerId, email: `owner-${ownerId}@example.test`, name: 'Owner', emailVerified: false },
      {
        id: talentUserId,
        email: `talent-${talentUserId}@example.test`,
        name: 'Talent',
        emailVerified: false,
        role: 'talent',
      },
    ])

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Chat project',
      description: 'Exercises the chat repository',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
    })
  })

  async function outbox() {
    return await handle.db
      .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
      .from(outboxEvents)
      .orderBy(asc(outboxEvents.id))
  }

  describe('createConversation', () => {
    it('stores the conversation and returns its participants', async () => {
      const { conversation, participants } = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })

      expect(conversation.type).toBe('owner_talent')
      expect(conversation.projectId).toBe(projectId)
      expect(new Set(participants)).toEqual(new Set([ownerId, talentUserId]))

      const rows = await handle.db
        .select({ userId: chatParticipants.userId, role: chatParticipants.role })
        .from(chatParticipants)
        .where(eq(chatParticipants.conversationId, conversation.id))
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.role === 'member')).toBe(true)
    })

    /** Reading is participant-gated, so the person who opened it must be in. */
    it('adds the creator even when they are not in the list', async () => {
      const { conversation } = await repo.createConversation({
        projectId,
        type: 'team_group',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })

      expect(await repo.isParticipant(conversation.id, ownerId)).toBe(true)
    })

    /** chat_participants_unique would reject the second row outright. */
    it('does not write the creator twice when they are also listed', async () => {
      const { conversation, participants } = await repo.createConversation({
        projectId,
        type: 'team_group',
        creatorId: ownerId,
        participantIds: [ownerId, talentUserId, talentUserId],
      })

      expect(participants).toHaveLength(2)
      const rows = await handle.db
        .select()
        .from(chatParticipants)
        .where(eq(chatParticipants.conversationId, conversation.id))
      expect(rows).toHaveLength(2)
    })

    it('opens a conversation with the creator alone', async () => {
      const { participants } = await repo.createConversation({
        projectId,
        type: 'ai_scoping',
        creatorId: ownerId,
        participantIds: [],
      })

      expect(participants).toEqual([ownerId])
    })

    /**
     * The failure the transaction exists for, executed: an unknown participant
     * fails the participant insert, which runs after the conversation. A
     * conversation with an incomplete participant list is unreadable and there
     * is no route to repair it, so nothing may survive.
     */
    it('leaves no unreadable conversation behind when a participant is invalid', async () => {
      await expect(
        repo.createConversation({
          projectId,
          type: 'team_group',
          creatorId: ownerId,
          participantIds: [uuidv7()],
        }),
      ).rejects.toThrow()

      expect(await handle.db.select().from(chatConversations)).toHaveLength(0)
      expect(await handle.db.select().from(chatParticipants)).toHaveLength(0)
    })

    /** One AI scoping thread per project, enforced by a partial unique index. */
    it('lets the database refuse a second scoping thread for one project', async () => {
      await repo.createConversation({
        projectId,
        type: 'ai_scoping',
        creatorId: ownerId,
        participantIds: [],
      })

      await expect(
        repo.createConversation({
          projectId,
          type: 'ai_scoping',
          creatorId: ownerId,
          participantIds: [],
        }),
      ).rejects.toMatchObject({
        cause: { code: '23505', constraint_name: 'chat_conversations_scoping_unique' },
      })
    })
  })

  describe('findConversation', () => {
    it('returns the id of a conversation that exists', async () => {
      const { conversation } = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })

      expect(await repo.findConversation(conversation.id)).toEqual({ id: conversation.id })
    })

    it('answers undefined for an unknown conversation', async () => {
      expect(await repo.findConversation(uuidv7())).toBeUndefined()
    })
  })

  describe('isParticipant', () => {
    it('recognises somebody who was added', async () => {
      const { conversation } = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })

      expect(await repo.isParticipant(conversation.id, talentUserId)).toBe(true)
    })

    it('refuses somebody who was not', async () => {
      const stranger = uuidv7()
      await handle.db.insert(user).values({
        id: stranger,
        email: `s-${stranger}@example.test`,
        name: 'Stranger',
        emailVerified: false,
      })
      const { conversation } = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })

      expect(await repo.isParticipant(conversation.id, stranger)).toBe(false)
    })

    /** Membership of one thread must not read across to another. */
    it('does not carry membership between conversations', async () => {
      const mine = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })
      const theirs = await repo.createConversation({
        projectId,
        type: 'team_group',
        creatorId: ownerId,
        participantIds: [],
      })

      expect(await repo.isParticipant(theirs.conversation.id, talentUserId)).toBe(false)
      expect(await repo.isParticipant(mine.conversation.id, talentUserId)).toBe(true)
    })
  })

  describe('listMessages', () => {
    async function seedConversation(): Promise<string> {
      const { conversation } = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })
      return conversation.id
    }

    async function seedMessage(conversationId: string, content: string, createdAt: Date) {
      await handle.db.insert(chatMessages).values({
        id: uuidv7(),
        conversationId,
        senderType: 'user',
        senderId: ownerId,
        content,
        createdAt,
      })
    }

    it('returns the newest messages first with a total', async () => {
      const conversationId = await seedConversation()
      await seedMessage(conversationId, 'first', new Date('2026-01-01T00:00:00Z'))
      await seedMessage(conversationId, 'second', new Date('2026-02-01T00:00:00Z'))

      const { items, total } = await repo.listMessages(conversationId, { page: 1, pageSize: 10 })

      expect(items.map((m) => m.content)).toEqual(['second', 'first'])
      expect(total).toBe(2)
    })

    it('pages without changing the total', async () => {
      const conversationId = await seedConversation()
      await seedMessage(conversationId, 'a', new Date('2026-01-01T00:00:00Z'))
      await seedMessage(conversationId, 'b', new Date('2026-02-01T00:00:00Z'))
      await seedMessage(conversationId, 'c', new Date('2026-03-01T00:00:00Z'))

      const { items, total } = await repo.listMessages(conversationId, { page: 2, pageSize: 2 })

      expect(items.map((m) => m.content)).toEqual(['a'])
      expect(total).toBe(3)
    })

    it('does not read another conversation messages', async () => {
      const mine = await seedConversation()
      const theirs = await seedConversation()
      await seedMessage(theirs, 'not mine', new Date())

      expect(await repo.listMessages(mine, { page: 1, pageSize: 10 })).toEqual({
        items: [],
        total: 0,
      })
    })
  })

  describe('createMessage', () => {
    async function seedConversation(): Promise<string> {
      const { conversation } = await repo.createConversation({
        projectId,
        type: 'owner_talent',
        creatorId: ownerId,
        participantIds: [talentUserId],
      })
      return conversation.id
    }

    it('stores the message and publishes that it was sent', async () => {
      const conversationId = await seedConversation()

      const msg = await repo.createMessage({
        conversationId,
        senderType: 'user',
        senderId: ownerId,
        content: 'Halo, ada update?',
        metadata: { locale: 'id' },
        bypassPatterns: [],
      })

      expect(msg.content).toBe('Halo, ada update?')
      expect(msg.metadata).toEqual({ locale: 'id' })

      const events = await outbox()
      expect(events.map((e) => e.eventType)).toEqual(['chat.message.sent'])
      expect(events[0]?.payload).toMatchObject({
        messageId: msg.id,
        conversationId,
        senderId: ownerId,
        senderType: 'user',
      })
    })

    /**
     * The warning has to land with the message it describes. Published
     * separately, a rolled-back message still raises a disintermediation
     * warning against a user for something they never said.
     */
    it('publishes the bypass warning alongside the message', async () => {
      const conversationId = await seedConversation()

      const msg = await repo.createMessage({
        conversationId,
        senderType: 'user',
        senderId: ownerId,
        content: 'WA saya di 0812xxxx',
        metadata: null,
        bypassPatterns: ['phone_number'],
      })

      const events = await outbox()
      expect(events.map((e) => e.eventType)).toEqual(['chat.message.sent', 'chat.bypass_detected'])
      expect(events[1]?.payload).toMatchObject({
        conversationId,
        messageId: msg.id,
        senderId: ownerId,
        matchedPatterns: ['phone_number'],
      })
    })

    it('raises no warning when nothing matched', async () => {
      const conversationId = await seedConversation()

      await repo.createMessage({
        conversationId,
        senderType: 'user',
        senderId: ownerId,
        content: 'Sudah saya kerjakan',
        metadata: null,
        bypassPatterns: [],
      })

      expect((await outbox()).map((e) => e.eventType)).not.toContain('chat.bypass_detected')
    })

    /** A service posting as the platform has no user to warn about. */
    it('raises no warning for a message with no sender', async () => {
      const conversationId = await seedConversation()

      await repo.createMessage({
        conversationId,
        senderType: 'ai',
        senderId: null,
        content: 'Ringkasan kebutuhan proyek',
        metadata: { model: 'glm-5.3' },
        bypassPatterns: ['phone_number'],
      })

      const events = await outbox()
      expect(events.map((e) => e.eventType)).toEqual(['chat.message.sent'])
      expect(events[0]?.payload).not.toHaveProperty('senderId')
    })

    /** No message means no warning: the pair is what the transaction protects. */
    it('publishes nothing when the message itself cannot be stored', async () => {
      await expect(
        repo.createMessage({
          conversationId: uuidv7(),
          senderType: 'user',
          senderId: ownerId,
          content: 'Into the void',
          metadata: null,
          bypassPatterns: ['phone_number'],
        }),
      ).rejects.toThrow()

      expect(await handle.db.select().from(chatMessages)).toHaveLength(0)
      expect(await outbox()).toHaveLength(0)
    })
  })
})
