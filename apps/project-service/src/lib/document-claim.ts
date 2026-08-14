import { brdDocuments, getDb, prdDocuments } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq, lt } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { TIMEOUT_MS } from './http/service-fetch'

type DocKind = 'brd' | 'prd'

/**
 * Reserve the free-generation slot a BRD or PRD call is about to spend.
 *
 * The limit used to be read, compared and then written after the model
 * returned. Two concurrent submits read the same version, both passed the
 * comparison and both called Gemini: one slot spent, two bills, and no
 * duplicate row left behind to notice it. The claim here is the UPDATE itself,
 * conditional on the row still holding the version it was read at, so exactly
 * one caller may proceed and the rest are turned away before the model call.
 *
 * A claim is taken BEFORE the call. That costs an owner their slot if the call
 * then fails, so every failure hands it back -- document-generation.ts already
 * tells them "Nothing was saved and your daily quota is untouched", and this
 * keeps that promise. The residue is a process killed mid-generation, which
 * leaves the slot spent rather than the platform billed twice; the reclaim
 * below picks those up once the call could no longer be running.
 */

/**
 * Version of a row that reserves a first generation but holds no document yet.
 *
 * Real documents start at 1, so nothing else can ever sit here, which makes
 * the marker unambiguous for both the release and the reads that must not
 * mistake a reservation for a document.
 */
export const CLAIM_VERSION = 0

/** A claim row whose generation could no longer be running is abandoned. */
const CLAIM_TTL_MS = TIMEOUT_MS.document * 2

export type DocumentClaim = {
  /** Version the document carries once this generation is stored. */
  version: number
  /** This claim created the row, so releasing it means removing the row. */
  created: boolean
}

function tableFor(kind: DocKind) {
  return kind === 'brd' ? brdDocuments : prdDocuments
}

function inFlight(kind: DocKind): never {
  throw new AppError(
    'CONFLICT',
    `Pembuatan ${kind.toUpperCase()} sedang berjalan. Tunggu sampai selesai sebelum mencoba lagi.`,
  )
}

function limitReached(kind: DocKind, limit: number): never {
  throw new AppError(
    'DOCUMENT_GENERATION_LIMIT',
    `Batas generasi ${kind.toUpperCase()} gratis (${limit}x) sudah tercapai. Generasi tambahan memerlukan biaya.`,
  )
}

/**
 * Take the next free-generation slot, or refuse.
 *
 * Throws DOCUMENT_GENERATION_LIMIT (402) when the allowance is spent and
 * CONFLICT (409) when another generation holds the slot -- a double submit
 * gets the second, which is the point: one click, one document, one bill.
 */
export async function claimGeneration(
  kind: DocKind,
  projectId: string,
  freeLimit: number,
): Promise<DocumentClaim> {
  const db = getDb()
  const table = tableFor(kind)

  const [existing] = await db
    .select({ version: table.version, updatedAt: table.updatedAt })
    .from(table)
    .where(eq(table.projectId, projectId))
    .limit(1)

  if (!existing) {
    // No row to update, so the insert is the claim: the unique project_id lets
    // exactly one of two concurrent first generations create it.
    const inserted = await db
      .insert(table)
      .values({
        id: uuidv7(),
        projectId,
        content: {},
        version: CLAIM_VERSION,
        status: 'draft',
        price: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: table.id })

    if (inserted.length === 0) inFlight(kind)
    return { version: 1, created: true }
  }

  if (existing.version === CLAIM_VERSION) {
    // Someone else reserved the first generation. Take it over only once the
    // call behind it could no longer be running, so a killed process does not
    // leave a project unable to generate anything ever again.
    const cutoff = new Date(Date.now() - CLAIM_TTL_MS)
    const reclaimed = await db
      .update(table)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(table.projectId, projectId),
          eq(table.version, CLAIM_VERSION),
          lt(table.updatedAt, cutoff),
        ),
      )
      .returning({ id: table.id })

    if (reclaimed.length === 0) inFlight(kind)
    return { version: 1, created: true }
  }

  if (existing.version >= freeLimit) limitReached(kind, freeLimit)

  const claimed = await claim(kind, projectId, existing.version)
  if (claimed) return claimed

  // Lost the race. Say which wall was hit rather than a bare conflict: a
  // double submit that pushed the document to the cap is out of allowance,
  // not merely late.
  const [current] = await db
    .select({ version: table.version })
    .from(table)
    .where(eq(table.projectId, projectId))
    .limit(1)
  if (current && current.version >= freeLimit) limitReached(kind, freeLimit)
  inFlight(kind)
}

/**
 * Claim the next version of an existing document for a revision.
 *
 * The caller has already decided the request is allowed (revisionGate reads
 * the paid state and the cap); this only settles who gets to spend it.
 */
export async function claimRevision(
  kind: DocKind,
  projectId: string,
  fromVersion: number,
): Promise<DocumentClaim> {
  const claimed = await claim(kind, projectId, fromVersion)
  if (!claimed) inFlight(kind)
  return claimed
}

// Advance the version, but only while the row still holds the value read.
async function claim(
  kind: DocKind,
  projectId: string,
  fromVersion: number,
): Promise<DocumentClaim | null> {
  const table = tableFor(kind)
  const claimed = await getDb()
    .update(table)
    .set({ version: fromVersion + 1, updatedAt: new Date() })
    .where(and(eq(table.projectId, projectId), eq(table.version, fromVersion)))
    .returning({ id: table.id })

  return claimed.length === 0 ? null : { version: fromVersion + 1, created: false }
}

/**
 * Give an unspent slot back after a generation failed.
 *
 * Both statements name the value this claim wrote, so a caller that has
 * already moved the document on keeps it: the release can only undo its own
 * reservation, never a generation that landed in the meantime.
 */
export async function releaseClaim(
  kind: DocKind,
  projectId: string,
  claimed: DocumentClaim,
): Promise<void> {
  const db = getDb()
  const table = tableFor(kind)

  try {
    if (claimed.created) {
      await db
        .delete(table)
        .where(and(eq(table.projectId, projectId), eq(table.version, CLAIM_VERSION)))
      return
    }

    await db
      .update(table)
      .set({ version: claimed.version - 1, updatedAt: new Date() })
      .where(and(eq(table.projectId, projectId), eq(table.version, claimed.version)))
  } catch (err) {
    // The generation failure is the one worth reporting. Losing the release
    // costs a slot; letting it mask the original error costs the diagnosis.
    console.error(`failed to release ${kind} generation claim`, err)
  }
}
