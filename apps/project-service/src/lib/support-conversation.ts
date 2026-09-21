import {
  chatConversations,
  chatParticipants,
  projectAssignments,
  projects,
  talentProfiles,
  user,
} from '@kerjacus/db'
import { SYSTEM_SUBJECTS } from '@kerjacus/nats-events'
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { addParticipants, type Tx } from './chat-membership'
import { appendOutboxEvent } from './outbox'

/**
 * The rooms where a user can reach a human from KerjaCUS.
 *
 * Both are `admin_mediation`, which already exists in chat_conversation_type
 * and which apps/web already files under the "Support" tab, so neither needs a
 * migration. chat_conversations has no discriminator column and project_id is
 * NOT NULL, so the two kinds are told apart by who is in them:
 *
 *   project room  - the owner and the assigned talents, plus an admin. Created
 *                   once per project at the deal moment. Two or more non-admin
 *                   participants, always.
 *   personal room - exactly one non-admin participant, plus an admin. Created
 *                   on demand by the "Hubungi Admin/Support" button, one per
 *                   user per project.
 *
 * The two predicates are disjoint: a project room seats an owner and at least
 * one talent, so it can never be mistaken for a personal one, and the owner's
 * personal room can never be mistaken for the project room.
 *
 * There is no partial unique index covering admin_mediation - the schema says
 * so deliberately, because mediation threads are legitimately many per project
 * - so idempotency rests on the projects-row lock both callers take, in the
 * project -> assignment -> work package order every other handler uses.
 */

/** Non-admin participants of one conversation. The count is the discriminator. */
const memberCount = sql<number>`(
  SELECT count(*)::int FROM ${chatParticipants} cp
  JOIN ${user} cu ON cu.id = cp.user_id
  WHERE cp.conversation_id = ${chatConversations.id} AND cu.role <> 'admin'
)`

export type SupportRoom = {
  conversationId: string
  /** False when the room was already there, so callers stay quiet on a re-run. */
  created: boolean
  /** Null means admin-pending: no admin account exists to seat yet. */
  adminId: string | null
}

/**
 * Pick the admin who carries the fewest support rooms.
 *
 * Least-loaded rather than round-robin because there is no cursor to store
 * without a migration, and the participant count is already in the database.
 * Ties break on user id so the choice is deterministic and a test can assert
 * it. Soft-deleted accounts are excluded: seating one is seating nobody.
 */
export async function pickSupportAdmin(tx: Tx): Promise<string | null> {
  const [candidate] = await tx
    .select({ id: user.id })
    .from(user)
    .leftJoin(chatParticipants, eq(chatParticipants.userId, user.id))
    .leftJoin(
      chatConversations,
      and(
        eq(chatConversations.id, chatParticipants.conversationId),
        eq(chatConversations.type, 'admin_mediation'),
      ),
    )
    .where(and(eq(user.role, 'admin'), isNull(user.deletedAt)))
    .groupBy(user.id)
    .orderBy(sql`count(${chatConversations.id}) asc`, asc(user.id))
    .limit(1)

  return candidate?.id ?? null
}

/** Notify one participant that the room is open, through the outbox everything else uses. */
async function notifySupportRoom(tx: Tx, userId: string, conversationId: string): Promise<void> {
  await appendOutboxEvent(tx, {
    aggregateType: 'chat',
    aggregateId: conversationId,
    eventType: SYSTEM_SUBJECTS.NOTIFICATION_SEND,
    payload: {
      userId,
      type: 'system',
      templateKey: 'notification.support_room_opened',
      templateParams: {},
      channels: ['in_app'],
    },
  })
}

/**
 * The project support room: owner, assigned talents, and an admin.
 *
 * Called from ensureProjectConversations, which already runs at both deal
 * moments and nowhere else, so this room appears exactly when the engagement is
 * committed. `memberIds` is the deal membership the caller has already read, so
 * the assignment query is not run twice.
 *
 * With no admin account on the platform the room is still created, seating the
 * owner and the talents. An admin_mediation room with no admin participant *is*
 * the admin-pending marker - it needs no flag, and the next run repairs it.
 */
export async function ensureProjectSupportRoom(
  tx: Tx,
  projectId: string,
  memberIds: readonly string[],
): Promise<SupportRoom | null> {
  if (memberIds.length < 2) return null

  // Serialise on the project, as the matching handlers do. The only caller
  // already took this lock on its first read, precisely so that projects comes
  // first on both deal paths; re-taking a lock the transaction already holds is
  // a no-op, and keeping it here means the guarantee does not rest on a caller
  // remembering to.
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')

  const [existing] = await tx
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.projectId, projectId),
        eq(chatConversations.type, 'admin_mediation'),
        sql`${memberCount} > 1`,
      ),
    )
    .orderBy(asc(chatConversations.createdAt))
    .limit(1)

  const adminId = await pickSupportAdmin(tx)
  const participants = adminId ? [...memberIds, adminId] : [...memberIds]

  if (existing) {
    // Membership is repaired on every run, not only on the run that created the
    // room: a replacement talent, or an admin account that only exists now,
    // would otherwise never get a seat.
    await addParticipants(tx, existing.id, participants)
    return { conversationId: existing.id, created: false, adminId }
  }

  const conversationId = uuidv7()
  await tx
    .insert(chatConversations)
    .values({ id: conversationId, projectId, type: 'admin_mediation' })
  await addParticipants(tx, conversationId, participants)
  for (const participant of participants) {
    await notifySupportRoom(tx, participant, conversationId)
  }

  return { conversationId, created: true, adminId }
}

/**
 * The project a personal support room hangs off when the caller names none.
 *
 * chat_conversations.project_id is NOT NULL and references projects, so a
 * project-less thread is not expressible without a migration. The most recent
 * project the user is party to is the one their question is most likely about,
 * and it is the only one they can be seated on without widening
 * assertProjectParties. A user with no project at all gets null, and the route
 * turns that into a distinct error the web shell reads to hide the button.
 */
export async function findLatestPartyProject(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .selectDistinct({ id: projects.id, createdAt: projects.createdAt })
    .from(projects)
    .leftJoin(projectAssignments, eq(projectAssignments.projectId, projects.id))
    .leftJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(
      and(
        isNull(projects.deletedAt),
        or(eq(projects.ownerId, userId), eq(talentProfiles.userId, userId)),
      ),
    )
    .orderBy(desc(projects.createdAt))
    .limit(1)

  return row?.id ?? null
}

/**
 * Get or create the caller's own support room on one project.
 *
 * Idempotent on (user, project): the lookup is "the admin_mediation room on
 * this project whose only non-admin participant is this user", which the
 * projects-row lock keeps from being answered twice at once. Pressing the
 * button again lands in the same thread rather than opening a second one.
 */
export async function ensureUserSupportRoom(
  tx: Tx,
  input: { userId: string; projectId: string },
): Promise<SupportRoom> {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .for('update')

  const [existing] = await tx
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .innerJoin(chatParticipants, eq(chatParticipants.conversationId, chatConversations.id))
    .where(
      and(
        eq(chatConversations.projectId, input.projectId),
        eq(chatConversations.type, 'admin_mediation'),
        eq(chatParticipants.userId, input.userId),
        sql`${memberCount} = 1`,
      ),
    )
    .orderBy(asc(chatConversations.createdAt))
    .limit(1)

  const adminId = await pickSupportAdmin(tx)
  const participants = adminId ? [input.userId, adminId] : [input.userId]

  if (existing) {
    await addParticipants(tx, existing.id, participants)
    return { conversationId: existing.id, created: false, adminId }
  }

  const conversationId = uuidv7()
  await tx
    .insert(chatConversations)
    .values({ id: conversationId, projectId: input.projectId, type: 'admin_mediation' })
  await addParticipants(tx, conversationId, participants)
  // The caller is looking at the thread already; only the admin needs telling.
  if (adminId) await notifySupportRoom(tx, adminId, conversationId)

  return { conversationId, created: true, adminId }
}
