import { getDb, talentProfiles } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq, lt } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { TIMEOUT_MS } from './http/service-fetch'

/**
 * CV parsing is the only vetting stage, so its confidence decides verification.
 *
 * 0.5 sits above an empty parse, which the AI service reports as 0.0 when the
 * document yields under 50 characters, and below the 0.7 ceiling of the regex
 * fallback, so a talent is not held back just because the LLM path was down.
 */
export const CV_VERIFY_MIN_CONFIDENCE = 0.5

type VerificationStatus = 'unverified' | 'cv_parsing' | 'verified' | 'suspended'

export function verificationFromParse(confidence: number | undefined): VerificationStatus {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'unverified'
  return confidence >= CV_VERIFY_MIN_CONFIDENCE ? 'verified' : 'unverified'
}

/**
 * Reserve the parse a talent is about to spend.
 *
 * Both routes that start a parse ran with no guard: two tabs meant two billed
 * Gemini calls over the same file. verification_status already declared
 * 'cv_parsing' and nothing ever wrote it, so marking it does double duty --
 * the documented unverified -> cv_parsing -> verified flow becomes real, and
 * the conditional UPDATE that writes it is the claim. It only lands while the
 * row still holds the status it was read at, so exactly one caller may enter
 * cv_parsing and the rest are refused before the model is called.
 *
 * A claim is taken BEFORE the call, which costs the talent their real status
 * if the call then fails, so every failure hands it back -- and hands back the
 * status the claim overwrote, because an outage says nothing about a CV and
 * must not revoke a verified talent's standing. The residue is a process
 * killed mid-parse, which strands the status rather than billing twice; the
 * reclaim below picks those up once the call could no longer be running.
 */

/** A claim whose parse could no longer be running is abandoned. */
const CLAIM_TTL_MS = TIMEOUT_MS.cvParse * 2

type CvParseClaim = {
  /** Status to put back if the parse fails. */
  previous: VerificationStatus
}

function inFlight(): never {
  throw new AppError('CONFLICT', 'CV sedang diproses. Tunggu sampai selesai sebelum mencoba lagi.')
}

/**
 * Move the talent into cv_parsing, or refuse.
 *
 * Throws CONFLICT (409) when another parse holds the state -- a double submit
 * gets the second, which is the point: one upload, one parse, one bill.
 */
export async function claimCvParse(userId: string): Promise<CvParseClaim> {
  const db = getDb()

  const [existing] = await db
    .select({
      verificationStatus: talentProfiles.verificationStatus,
      updatedAt: talentProfiles.updatedAt,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (!existing) {
    // Registration parses the CV before submitting the rest of the form, so
    // there is no row to update and the insert is the claim: user_id is
    // unique, so exactly one of two concurrent first parses creates it.
    const inserted = await db
      .insert(talentProfiles)
      .values({ id: uuidv7(), userId, verificationStatus: 'cv_parsing' })
      .onConflictDoNothing()
      .returning({ id: talentProfiles.id })

    if (inserted.length === 0) inFlight()
    // The stub carries no standing to restore; a failed parse leaves the same
    // unverified row the old failure path would have inserted.
    return { previous: 'unverified' }
  }

  if (existing.verificationStatus === 'cv_parsing') {
    // Take the state over only once the parse behind it could no longer be
    // running, so a killed process does not strand a talent permanently.
    const cutoff = new Date(Date.now() - CLAIM_TTL_MS)
    const reclaimed = await db
      .update(talentProfiles)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(talentProfiles.userId, userId),
          eq(talentProfiles.verificationStatus, 'cv_parsing'),
          lt(talentProfiles.updatedAt, cutoff),
        ),
      )
      .returning({ id: talentProfiles.id })

    if (reclaimed.length === 0) inFlight()
    // The status the abandoned claim overwrote went with the process that held
    // it. 'unverified' is the recoverable end: it is the one status whose
    // profile page offers a re-parse.
    return { previous: 'unverified' }
  }

  const claimed = await db
    .update(talentProfiles)
    .set({ verificationStatus: 'cv_parsing', updatedAt: new Date() })
    .where(
      and(
        eq(talentProfiles.userId, userId),
        eq(talentProfiles.verificationStatus, existing.verificationStatus),
      ),
    )
    .returning({ id: talentProfiles.id })

  if (claimed.length === 0) inFlight()
  return { previous: existing.verificationStatus }
}

/**
 * Put the talent's previous status back after a parse failed.
 *
 * The WHERE names the value the claim wrote, so this can only undo its own
 * claim: a parse that already landed a real status, or a reclaim that took the
 * state over, keeps it.
 */
export async function releaseCvParse(userId: string, claim: CvParseClaim): Promise<void> {
  try {
    await getDb()
      .update(talentProfiles)
      .set({ verificationStatus: claim.previous, updatedAt: new Date() })
      .where(
        and(eq(talentProfiles.userId, userId), eq(talentProfiles.verificationStatus, 'cv_parsing')),
      )
  } catch (err) {
    // The parse failure is the one worth reporting. Losing the release strands
    // a status until the TTL; letting it mask the original error costs the
    // diagnosis.
    console.error('failed to release cv parse claim', err)
  }
}
