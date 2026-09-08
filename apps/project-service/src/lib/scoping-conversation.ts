import { chatConversations, chatParticipants, getDb, projects } from '@kerjacus/db'
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

/**
 * Put the owner in their own scoping thread.
 *
 * The thread was created with no chat_participants row at all, and both chat
 * routes gate on participation - GET /conversations IS the participant query.
 * So the messages page was empty for every user on the platform, and reloading
 * the scoping page silently lost the history: the client looks the thread up
 * through that list, finds nothing, and renders an empty conversation.
 *
 * Repaired on every ensure call rather than only on creation, so threads
 * written before this self-heal without a backfill. AI and system writes are
 * unaffected: the service path skips the participant check.
 */
async function ensureOwnerParticipant(conversationId: string, projectId: string): Promise<void> {
  const db = getDb()
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  // Projects are soft deleted and this read does not filter deleted_at, so the
  // row is still there for every caller that got this far. Reachable only if
  // something hard deletes a project mid-request.
  /* v8 ignore next */
  if (!project) return

  await db
    .insert(chatParticipants)
    .values({ id: uuidv7(), conversationId, userId: project.ownerId, role: 'member' })
    .onConflictDoNothing()
}

export async function ensureScopingConversation(projectId: string): Promise<string> {
  const existing = await findScopingConversation(projectId)
  if (existing) {
    await ensureOwnerParticipant(existing, projectId)
    return existing
  }

  const db = getDb()
  const [created] = await db
    .insert(chatConversations)
    .values({ id: uuidv7(), projectId, type: SCOPING_TYPE, createdAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: chatConversations.id })

  if (created) {
    await ensureOwnerParticipant(created.id, projectId)
    return created.id
  }

  // Lost the insert race. The winner is committed, so this read finds it.
  const winner = await findScopingConversation(projectId)
  if (!winner) {
    throw new AppError('INTERNAL_ERROR', 'Scoping conversation missing after insert')
  }
  await ensureOwnerParticipant(winner, projectId)
  return winner
}
