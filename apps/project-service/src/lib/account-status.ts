import { getDb, talentProfiles, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'

/**
 * What the account behind a still-valid cookie is allowed to do right now.
 *
 * `gone` is a soft-deleted account, `suspended` a talent the platform has
 * taken off the floor.
 */
export type AccountStatus = 'active' | 'suspended' | 'gone'

/**
 * Re-read the account behind a session on every request.
 *
 * Suspending a talent wrote talent_profiles.verification_status and nothing on
 * the request path read it, so an existing session kept working - submitting
 * milestones, reading project data, minting realtime tokens - until the cookie
 * expired a week later. Auth-service cannot answer this either: its own
 * session cookie cache is 5 minutes, so the payload it hands back is stale by
 * the same amount.
 *
 * Deliberately NOT cached alongside the session. The session cache saves the
 * HTTP hop to auth-service; this is one indexed local read on a primary key,
 * cheaper than the call it sits behind, and caching it would reintroduce
 * exactly the window the check exists to close. On a platform holding escrow,
 * paying a query per request to make a suspension take effect immediately is
 * the right side of that trade.
 *
 * users.is_verified is NOT checked, although admin suspension writes it false:
 * it is also the column's default at sign-up and no path sets it true, so
 * refusing on it would lock out every organically registered user rather than
 * the suspended ones. See the report note on that column.
 */
export async function getAccountStatus(userId: string): Promise<AccountStatus> {
  const db = getDb()

  const [row] = await db
    .select({
      deletedAt: userTable.deletedAt,
      verificationStatus: talentProfiles.verificationStatus,
    })
    .from(userTable)
    .leftJoin(talentProfiles, eq(talentProfiles.userId, userTable.id))
    .where(eq(userTable.id, userId))
    .limit(1)

  if (!row || row.deletedAt !== null) return 'gone'
  return row.verificationStatus === 'suspended' ? 'suspended' : 'active'
}
