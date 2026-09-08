import {
  chatConversations,
  chatParticipants,
  type Database,
  projectAssignments,
  projects,
  talentProfiles,
} from '@kerjacus/db'
import { and, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

/** Assignments that still hold their work package. */
const LIVE_ASSIGNMENT_STATUSES = ['active', 'completed'] as const

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Add a participant, tolerating one that is already there.
 *
 * Every provisioning path can run twice - the talent-accept branch and the
 * owner-driven arrival at matched both reach the same project - so membership
 * is written idempotently against chat_participants_unique rather than read
 * first.
 */
async function addParticipants(
  tx: Tx,
  conversationId: string,
  userIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return
  await tx
    .insert(chatParticipants)
    .values(
      unique.map((userId) => ({
        id: uuidv7(),
        conversationId,
        userId,
        role: 'member' as const,
      })),
    )
    .onConflictDoNothing()
}

/**
 * Create the threads a deal is supposed to come with.
 *
 * The conversation types were decorative. `createConversation` had exactly one
 * caller, a route no frontend ever posts to, so a matched project produced no
 * thread at all: the owner and the talent who had just signed an agreement had
 * nowhere on the platform to talk, while the ToS forbids talking anywhere else.
 *
 * One private thread per live assignment, plus one group thread once the
 * project carries more than one. talent_talent is deliberately not created -
 * it is one thread per pair with no caller and no UI, and CLAUDE.md's YAGNI
 * rule covers it.
 *
 * Idempotent through chat_conversations_assignment_unique and
 * chat_conversations_team_group_unique, so a replacement talent joining later
 * gets a thread without disturbing the ones already running.
 */
export async function ensureProjectConversations(tx: Tx, projectId: string): Promise<number> {
  const [project] = await tx
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) return 0

  const rows = await tx
    .select({
      assignmentId: projectAssignments.id,
      talentUserId: talentProfiles.userId,
    })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        inArray(projectAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
      ),
    )
  if (rows.length === 0) return 0

  const existing = await tx
    .select({ id: chatConversations.id, assignmentId: chatConversations.assignmentId })
    .from(chatConversations)
    .where(
      and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'owner_talent')),
    )
  const privateThreads = new Map(existing.map((row) => [row.assignmentId, row.id]))

  let created = 0
  for (const row of rows) {
    let conversationId = privateThreads.get(row.assignmentId)
    if (!conversationId) {
      const candidate = uuidv7()
      const [inserted] = await tx
        .insert(chatConversations)
        .values({
          id: candidate,
          projectId,
          type: 'owner_talent',
          assignmentId: row.assignmentId,
        })
        .onConflictDoNothing()
        .returning({ id: chatConversations.id })

      if (inserted) {
        conversationId = inserted.id
        created += 1
      } else {
        // Lost the insert race, or the thread arrived after the read above.
        // Fall through to the winner rather than skipping, so membership is
        // repaired on every run and not only on the run that created it.
        const [winner] = await tx
          .select({ id: chatConversations.id })
          .from(chatConversations)
          .where(
            and(
              eq(chatConversations.type, 'owner_talent'),
              eq(chatConversations.assignmentId, row.assignmentId),
            ),
          )
          .limit(1)
        if (!winner) continue
        conversationId = winner.id
      }
    }
    // Membership is repaired on every run, not only on the run that created
    // the thread. A conversation nobody participates in is unreadable by
    // everyone, including the two people it belongs to.
    await addParticipants(tx, conversationId, [project.ownerId, row.talentUserId])
  }

  if (rows.length > 1) {
    const [group] = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'team_group')),
      )
      .limit(1)

    let groupId: string | undefined = group?.id
    if (!groupId) {
      const candidate = uuidv7()
      const [inserted] = await tx
        .insert(chatConversations)
        .values({ id: candidate, projectId, type: 'team_group' })
        .onConflictDoNothing()
        .returning({ id: chatConversations.id })
      // Lost the insert race; the winner owns the thread.
      groupId = inserted?.id
      if (inserted) created += 1
    }
    if (groupId) {
      await addParticipants(tx, groupId, [project.ownerId, ...rows.map((r) => r.talentUserId)])
    }
  }

  return created
}
