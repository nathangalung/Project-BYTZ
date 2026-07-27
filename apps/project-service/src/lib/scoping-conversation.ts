import { chatConversations, getDb } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

/**
 * A project has exactly one AI scoping thread, and five routes needed to reach
 * it. Three of them wrote their own find-or-create and two their own lookup,
 * all with the same predicate spelled out again.
 *
 * The three writers were check-then-act. Two concurrent sends - a double click,
 * or the SSE client retrying - both saw no row and both inserted, and the
 * project ended up with two scoping threads holding half the history each.
 * Nothing failed loudly: the readers take `.limit(1)` with no ORDER BY, so
 * Postgres hands back whichever one it likes, and BRD generation runs on
 * whichever half that was. The completeness gate counts the messages in that
 * half too.
 *
 * chat_conversations_scoping_unique is what actually decides the race. These
 * helpers are the one place that knows the predicate.
 */

const SCOPING_TYPE = 'ai_scoping' as const

export async function findScopingConversation(projectId: string): Promise<string | undefined> {
  const db = getDb()
  const [conversation] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(
      and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, SCOPING_TYPE)),
    )
    .limit(1)

  return conversation?.id
}

export async function ensureScopingConversation(projectId: string): Promise<string> {
  const existing = await findScopingConversation(projectId)
  if (existing) return existing

  const db = getDb()
  const [created] = await db
    .insert(chatConversations)
    .values({ id: uuidv7(), projectId, type: SCOPING_TYPE, createdAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: chatConversations.id })

  if (created) return created.id

  // Lost the insert race. The winner is committed, so this read finds it.
  const winner = await findScopingConversation(projectId)
  if (!winner) {
    throw new AppError('INTERNAL_ERROR', 'Scoping conversation missing after insert')
  }
  return winner
}
