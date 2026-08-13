import { chatConversations, chatMessages, chatParticipants, getDb } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../lib/env'
import { assertProjectAccess } from '../lib/project-access'
import { getAuthUser } from '../middleware/session'
import { ChatRepository } from '../repositories/chat.repository'
import { detectBypassAttempts } from '../services/disintermediation.service'

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
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const userId = user.id

  // Creating a conversation makes the creator a participant, which then
  // satisfies the read check, so this has to be gated on the project.
  await assertProjectAccess(parsed.data.projectId, userId)

  const { conversation, participants } = await new ChatRepository().createConversation({
    projectId: parsed.data.projectId,
    type: parsed.data.type,
    creatorId: userId,
    participantIds: parsed.data.participantIds,
  })

  return c.json({ success: true, data: { ...conversation, participants } }, 201)
})

// GET /conversations - list user conversations
chatRoute.get('/conversations', async (c) => {
  const user = getAuthUser(c)
  const userId = user.id

  const db = getDb()

  // Find conversations via participation. Membership is set when the
  // conversation is created and nothing ever removes a participant, so there
  // is no departure state to filter on here. Adding one means adding the
  // writer and filtering all four participant checks together - this route,
  // the message read below, ChatRepository.isParticipant and realtime.ts.
  const participations = await db
    .select({
      conversationId: chatParticipants.conversationId,
    })
    .from(chatParticipants)
    .where(eq(chatParticipants.userId, userId))

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
      issues: z.flattenError(parsed.error).fieldErrors,
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
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  // Only a service may post as ai or system. A session caller is always a
  // user, so senderType from the body would let them post as the platform,
  // with a null sender and no disintermediation scan.
  const isService = c.req.header('X-Service-Auth') === env.SERVICE_AUTH_SECRET
  const senderType = isService ? parsed.data.senderType : 'user'

  let userId: string | undefined
  if (!isService) {
    userId = getAuthUser(c).id
  }

  const repo = new ChatRepository()

  if (!(await repo.findConversation(conversationId))) {
    throw new AppError('NOT_FOUND', 'Conversation not found')
  }

  // Same participant check the read route applies.
  if (userId && !(await repo.isParticipant(conversationId, userId))) {
    throw new AppError('AUTH_FORBIDDEN', 'Not a participant in this conversation')
  }

  const bypassMatches = senderType === 'user' ? detectBypassAttempts(parsed.data.content) : []

  const message = await repo.createMessage({
    conversationId,
    senderType,
    senderId: senderType === 'user' ? (userId ?? null) : null,
    content: parsed.data.content,
    metadata: parsed.data.metadata ?? null,
    bypassPatterns: bypassMatches.map((m) => m.pattern),
  })

  if (bypassMatches.length > 0) {
    c.header('X-Bypass-Warning', '1')
  }

  return c.json(
    {
      success: true,
      data: message,
    },
    201,
  )
})
