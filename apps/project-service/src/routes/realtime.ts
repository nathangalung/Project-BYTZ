import { chatParticipants, getDb } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../lib/env'
import { assertProjectAccess } from '../lib/project-access'
import { parseChannel, signSubscriptionToken } from '../lib/subscription-token'
import { getAuthUser } from '../middleware/session'

const querySchema = z.object({ channel: z.string().min(1).max(255) })

export const realtimeRoute = new Hono()

/**
 * Issue a Centrifugo subscription token for one channel.
 *
 * chat:, project: and milestone: carry no "#", so Centrifugo cannot decide who
 * may read them and used to accept anyone. They require a token now, and this
 * service mints it because it holds the rows that answer the question:
 * assignments for project and milestone, chat_participants for chat.
 *
 * notifications#<userId> is not issued here. Centrifugo enforces that form on
 * the connection token by itself.
 */
realtimeRoute.get('/subscription-token', async (c) => {
  const user = getAuthUser(c)

  const parsed = querySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'channel is required')
  }

  const ref = parseChannel(parsed.data.channel)
  if (!ref) {
    throw new AppError('AUTH_FORBIDDEN', 'Channel is not subscribable')
  }

  if (ref.namespace === 'chat') {
    const db = getDb()
    const [participant] = await db
      .select({ id: chatParticipants.id })
      .from(chatParticipants)
      .where(and(eq(chatParticipants.conversationId, ref.id), eq(chatParticipants.userId, user.id)))
      .limit(1)
    if (!participant) {
      throw new AppError('AUTH_FORBIDDEN', 'Not a participant in this conversation')
    }
  } else {
    // project: and milestone: are both keyed by project id.
    await assertProjectAccess(ref.id, user.id)
  }

  if (!env.CENTRIFUGO_SECRET) {
    throw new AppError('AI_SERVICE_UNAVAILABLE', 'Real-time transport is not configured')
  }

  return c.json({
    success: true,
    data: { token: signSubscriptionToken(parsed.data.channel, user.id, env.CENTRIFUGO_SECRET) },
  })
})
