import {
  chatConversations,
  chatMessages,
  chatParticipants,
  type Database,
  getDb,
} from '@kerjacus/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { appendOutboxEvent } from '../lib/outbox'

type ConversationSelect = typeof chatConversations.$inferSelect
type MessageSelect = typeof chatMessages.$inferSelect

export class ChatRepository {
  constructor(private db: Database = getDb()) {}

  /**
   * Open a conversation with its participants, atomically.
   *
   * These were separate inserts in a loop. A failure partway left a
   * conversation whose participant list was incomplete - and since the read
   * check is participant-based and the creator is inserted first only by
   * accident of ordering, the creator could be locked out of the conversation
   * they had just opened, with no route to repair it.
   */
  async createConversation(input: {
    projectId: string
    type: ConversationSelect['type']
    creatorId: string
    participantIds: string[]
  }): Promise<{ conversation: ConversationSelect; participants: string[] }> {
    const conversationId = uuidv7()
    const now = new Date()
    // The creator is always a participant, and duplicates in the request
    // must not become duplicate rows.
    const participants = [...new Set([input.creatorId, ...input.participantIds])]

    return await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(chatConversations)
        .values({
          id: conversationId,
          projectId: input.projectId,
          type: input.type,
          createdAt: now,
        })
        .returning()

      await tx.insert(chatParticipants).values(
        participants.map((userId) => ({
          id: uuidv7(),
          conversationId,
          userId,
          role: 'member' as const,
          joinedAt: now,
        })),
      )

      return { conversation, participants }
    })
  }

  async findConversation(id: string): Promise<{ id: string } | undefined> {
    const [conversation] = await this.db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(eq(chatConversations.id, id))
      .limit(1)
    return conversation
  }

  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const [participant] = await this.db
      .select({ id: chatParticipants.id })
      .from(chatParticipants)
      .where(
        and(
          eq(chatParticipants.conversationId, conversationId),
          eq(chatParticipants.userId, userId),
        ),
      )
      .limit(1)
    return !!participant
  }

  async listMessages(
    conversationId: string,
    pagination: { page: number; pageSize: number },
  ): Promise<{ items: MessageSelect[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize
    const where = eq(chatMessages.conversationId, conversationId)

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(chatMessages)
        .where(where)
        .orderBy(desc(chatMessages.createdAt))
        .limit(pagination.pageSize)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(chatMessages).where(where),
    ])

    return { items, total: countResult[0]?.count ?? 0 }
  }

  /**
   * Store a message and publish what it implies, atomically.
   *
   * The bypass event has to land with the message. Publishing it separately
   * would let a rolled-back message still raise a disintermediation warning
   * against a user for something they never said.
   */
  async createMessage(input: {
    conversationId: string
    senderType: MessageSelect['senderType']
    senderId: string | null
    content: string
    metadata: unknown
    bypassPatterns: string[]
  }): Promise<MessageSelect> {
    const msgId = uuidv7()

    return await this.db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(chatMessages)
        .values({
          id: msgId,
          conversationId: input.conversationId,
          senderType: input.senderType,
          senderId: input.senderId,
          content: input.content,
          metadata: input.metadata as never,
        })
        .returning()

      await appendOutboxEvent(tx, {
        aggregateType: 'chat',
        aggregateId: msgId,
        eventType: 'chat.message.sent',
        payload: {
          messageId: msgId,
          conversationId: input.conversationId,
          senderId: input.senderId ?? undefined,
          senderType: input.senderType,
        },
      })

      if (input.bypassPatterns.length > 0 && input.senderId) {
        await appendOutboxEvent(tx, {
          aggregateType: 'chat',
          aggregateId: msgId,
          eventType: 'chat.bypass_detected',
          payload: {
            conversationId: input.conversationId,
            messageId: msgId,
            senderId: input.senderId,
            matchedPatterns: input.bypassPatterns,
            timestamp: new Date().toISOString(),
          },
        })
      }

      return msg
    })
  }
}
