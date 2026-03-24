import {
  chatConversations,
  chatMessages,
  chatParticipants,
  getDb,
  outboxEvents,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'

const conversationTypeValues = [
  'ai_scoping',
  'owner_talent',
  'team_group',
  'talent_talent',
  'admin_mediation',
] as const

const senderTypeValues = ['user', 'ai', 'system'] as const

const createConversationSchema = z.object({
  projectId: z.string(),
  type: z.enum(conversationTypeValues),
  participantIds: z.array(z.string()).min(1),
})

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  senderType: z.enum(senderTypeValues).default('user'),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
})

export const chatRoute = new Hono()

// POST /conversations - create conversation
chatRoute.post('/conversations', async (c) => {
  const body = await c.req.json()

  const parsed = createConversationSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid conversation data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const userId = user.id

  const db = getDb()
  const conversationId = uuidv7()
  const now = new Date()

  // Create conversation
  const [conversation] = await db
    .insert(chatConversations)
    .values({
      id: conversationId,
      projectId: parsed.data.projectId,
      type: parsed.data.type,
      createdAt: now,
    })
    .returning()

  // Add creator as participant
  const allParticipantIds = [...new Set([userId, ...parsed.data.participantIds])]

  for (const participantId of allParticipantIds) {
    await db.insert(chatParticipants).values({
      id: uuidv7(),
      conversationId,
      userId: participantId,
      role: participantId === userId ? 'member' : 'member',
      joinedAt: now,
    })
  }

  return c.json(
    {
      success: true,
      data: {
        ...conversation,
        participants: allParticipantIds,
      },
    },
    201,
  )
})

// GET /conversations - list user conversations
chatRoute.get('/conversations', async (c) => {
  const user = getAuthUser(c)
  const userId = user.id

  const db = getDb()

  // Find conversations via participation
  const participations = await db
    .select({
      conversationId: chatParticipants.conversationId,
    })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.userId, userId),
        // Only active participants
      ),
    )

  if (participations.length === 0) {
    return c.json({
      success: true,
      data: [],
    })
  }

  const conversationIds = participations.map((p) => p.conversationId)

  const conversations = await db
    .select()
    .from(chatConversations)
    .where(inArray(chatConversations.id, conversationIds))
    .orderBy(desc(chatConversations.createdAt))

  return c.json({
    success: true,
    data: conversations,
  })
})

// GET /conversations/:id/messages - paginated messages
chatRoute.get('/conversations/:id/messages', async (c) => {
  const user = getAuthUser(c)
  const conversationId = c.req.param('id')
  const parsed = listMessagesQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const { page, pageSize } = parsed.data
  const db = getDb()

  // Verify conversation exists
  const [conversation] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)

  if (!conversation) {
    throw new AppError('NOT_FOUND', 'Conversation not found')
  }

  // Verify user is a participant
  const [participant] = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.userId, user.id),
      ),
    )
    .limit(1)
  if (!participant) {
    throw new AppError('AUTH_FORBIDDEN', 'Not a participant in this conversation')
  }

  const offset = (page - 1) * pageSize

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(pageSize)
    .offset(offset)

  // Count total messages
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))

  return c.json({
    success: true,
    data: {
      items: messages,
      total: countResult?.count ?? 0,
      page,
      pageSize,
    },
  })
})

// POST /conversations/:id/messages - send message
chatRoute.post('/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id')
  const body = await c.req.json()

  const parsed = sendMessageSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid message data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  let userId: string | undefined
  try {
    userId = getAuthUser(c).id
  } catch {
    // Allow unauthenticated for system/ai messages
  }
  if (!userId && parsed.data.senderType === 'user') {
    throw new AppError('AUTH_UNAUTHORIZED', 'Authentication required')
  }

  const db = getDb()

  // Verify conversation exists
  const [conversation] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)

  if (!conversation) {
    throw new AppError('NOT_FOUND', 'Conversation not found')
  }

  const msgId = uuidv7()
  const message = await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(chatMessages)
      .values({
        id: msgId,
        conversationId,
        senderType: parsed.data.senderType,
        senderId: parsed.data.senderType === 'user' ? userId : null,
        content: parsed.data.content,
        metadata: parsed.data.metadata ?? null,
      })
      .returning()

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'chat',
      aggregateId: msgId,
      eventType: 'chat.message.sent',
      payload: {
        messageId: msgId,
        conversationId,
        senderId: userId,
        senderType: parsed.data.senderType,
      },
    })

    return msg
  })

  return c.json(
    {
      success: true,
      data: message,
    },
    201,
  )
})
