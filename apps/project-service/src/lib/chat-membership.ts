import { chatParticipants, type Database } from '@kerjacus/db'
import { uuidv7 } from 'uuidv7'

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Add participants, tolerating ones that are already there.
 *
 * Every provisioning path can run twice - the talent-accept branch and the
 * owner-driven arrival at matched both reach the same project, and the support
 * button can be pressed twice - so membership is written idempotently against
 * chat_participants_unique rather than read first.
 *
 * Lives here rather than in conversation-provisioning.ts because the support
 * rooms seat people too and a second copy of this is a second place for the
 * conflict target to drift.
 */
export async function addParticipants(
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
