// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import { brdDocuments, getDb, prdDocuments, projects as projectsTable, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAIM_VERSION, claimGeneration, claimRevision, releaseClaim } from './document-claim'

/**
 * Who gets to spend a generation when two callers ask at once.
 *
 * The limit used to be read, compared and then written after the model
 * returned. Two concurrent submits read the same version, both passed the
 * comparison and both called Gemini: one slot spent, two bills, and no
 * duplicate row left behind for anyone to notice. The claim is now the UPDATE
 * itself, conditional on the row still holding the version it was read at,
 * which is a property that only means anything when it executes against a real
 * database - a mocked `update` will happily report whatever it was told to.
 *
 * Two branches here are not reachable from the HTTP routes at all and are the
 * reason this file exists separately from the route suite: the TTL reclaim,
 * which is what stops a process killed mid-generation from locking a project
 * out of ever generating again, and the distinction the loser of a race is
 * told - "out of allowance" when the winner pushed the document to the cap,
 * "already running" when it did not.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

/** CLAIM_TTL_MS is TIMEOUT_MS.document * 2, so two minutes. */
const BEYOND_TTL_MS = 3 * 60 * 1000

type AppErrorish = { code: string; message: string }

async function codeOf(run: () => Promise<unknown>): Promise<AppErrorish> {
  try {
    await run()
  } catch (err) {
    const e = err as AppErrorish
    return { code: e.code, message: e.message }
  }
  throw new Error('expected the call to be refused, but it succeeded')
}

runIf('document generation claims against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let projectId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    projectId = uuidv7()
    await handle.db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      title: 'Marketplace',
      description: 'A managed marketplace for digital projects',
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: 'scoping',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function seed(version: number, updatedAt = new Date()): Promise<void> {
    await handle.db.insert(brdDocuments).values({
      id: uuidv7(),
      projectId,
      content: version === CLAIM_VERSION ? {} : { executive_summary: 'existing' },
      version,
      status: version === CLAIM_VERSION ? 'draft' : 'review',
      price: 0,
      updatedAt,
    })
  }

  async function rows() {
    return await handle.db.select().from(brdDocuments).where(eq(brdDocuments.projectId, projectId))
  }

  async function versionOf(): Promise<number | undefined> {
    return (await rows())[0]?.version
  }

  describe('claimGeneration on a project with no document', () => {
    it('creates the reservation row and reports it created', async () => {
      const claim = await claimGeneration('brd', projectId, 3)

      expect(claim).toEqual({ version: 1, created: true })
      // Version 0 is the reservation marker: real documents start at 1, so
      // nothing else can ever sit here and reads cannot mistake it for a doc.
      expect(await versionOf()).toBe(CLAIM_VERSION)
    })

    /**
     * Two first-time submits. The unique project_id is what decides it, and
     * the loser has to be refused rather than left to call the model too.
     */
    it('lets exactly one of two concurrent first generations through', async () => {
      const results = await Promise.allSettled([
        claimGeneration('brd', projectId, 3),
        claimGeneration('brd', projectId, 3),
      ])

      const won = results.filter((r) => r.status === 'fulfilled')
      const lost = results.filter((r) => r.status === 'rejected')
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect((lost[0] as PromiseRejectedResult).reason.code).toBe('CONFLICT')
      expect(await rows()).toHaveLength(1)
    })
  })

  describe('claimGeneration against a live reservation', () => {
    it('refuses while a generation is still in flight', async () => {
      await seed(CLAIM_VERSION)

      const err = await codeOf(() => claimGeneration('brd', projectId, 3))

      expect(err.code).toBe('CONFLICT')
      expect(err.message).toContain('sedang berjalan')
    })

    /**
     * The residue the design accepts: a process killed mid-generation leaves
     * the slot spent. Without this reclaim the project could never generate
     * anything again, so the row is taken over once the call behind it could
     * no longer be running.
     */
    it('takes over a reservation whose generation could no longer be running', async () => {
      await seed(CLAIM_VERSION, new Date(Date.now() - BEYOND_TTL_MS))

      const claim = await claimGeneration('brd', projectId, 3)

      expect(claim).toEqual({ version: 1, created: true })
      expect(await rows()).toHaveLength(1)
    })

    /** One second short of the TTL is still in flight. */
    it('does not take over a reservation that is merely slow', async () => {
      await seed(CLAIM_VERSION, new Date(Date.now() - 60_000))

      expect((await codeOf(() => claimGeneration('brd', projectId, 3))).code).toBe('CONFLICT')
    })
  })

  describe('claimGeneration against an existing document', () => {
    it('advances the version and reports the row was not created', async () => {
      await seed(1)

      const claim = await claimGeneration('brd', projectId, 3)

      expect(claim).toEqual({ version: 2, created: false })
      expect(await versionOf()).toBe(2)
    })

    it('refuses once the free allowance is spent', async () => {
      await seed(3)

      const err = await codeOf(() => claimGeneration('brd', projectId, 3))

      expect(err.code).toBe('DOCUMENT_GENERATION_LIMIT')
      expect(err.message).toContain('3x')
      expect(await versionOf()).toBe(3)
    })

    /**
     * The loser of a race that did not reach the cap is late, not out of
     * allowance, and the two are told apart deliberately.
     */
    it('tells the loser of a race that a generation is already running', async () => {
      await seed(1)

      const results = await Promise.allSettled([
        claimGeneration('brd', projectId, 3),
        claimGeneration('brd', projectId, 3),
      ])

      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect(lost.reason.code).toBe('CONFLICT')
      expect(await versionOf()).toBe(2)
    })

    /**
     * The same race one version higher. Here the winner pushes the document
     * to the cap, so the loser is out of allowance rather than merely late -
     * a bare conflict would tell them to retry something that can never work.
     */
    it('tells the loser they are out of allowance when the winner hit the cap', async () => {
      await seed(2)

      const results = await Promise.allSettled([
        claimGeneration('brd', projectId, 3),
        claimGeneration('brd', projectId, 3),
      ])

      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect(lost.reason.code).toBe('DOCUMENT_GENERATION_LIMIT')
      expect(await versionOf()).toBe(3)
    })
  })

  describe('claimRevision', () => {
    it('advances the version from the one the caller read', async () => {
      await seed(2)

      expect(await claimRevision('brd', projectId, 2)).toEqual({ version: 3, created: false })
      expect(await versionOf()).toBe(3)
    })

    /** The version moved under the caller, so their read is stale. */
    it('refuses when the version has already been spent', async () => {
      await seed(3)

      expect((await codeOf(() => claimRevision('brd', projectId, 2))).code).toBe('CONFLICT')
      expect(await versionOf()).toBe(3)
    })

    it('refuses when there is no document at all', async () => {
      expect((await codeOf(() => claimRevision('brd', projectId, 1))).code).toBe('CONFLICT')
    })
  })

  describe('releaseClaim', () => {
    it('removes the row a first generation created', async () => {
      const claim = await claimGeneration('brd', projectId, 3)

      await releaseClaim('brd', projectId, claim)

      expect(await rows()).toHaveLength(0)
    })

    it('winds an advanced version back', async () => {
      await seed(1)
      const claim = await claimGeneration('brd', projectId, 3)

      await releaseClaim('brd', projectId, claim)

      expect(await versionOf()).toBe(1)
    })

    /**
     * Both statements name the value this claim wrote, so a release can only
     * undo its own reservation. A generation that landed in the meantime must
     * survive - otherwise a slow failure path deletes a good document.
     */
    it('leaves a document that landed after the claim alone', async () => {
      await seed(1)
      const claim = await claimGeneration('brd', projectId, 3)
      await handle.db
        .update(brdDocuments)
        .set({ version: 3 })
        .where(eq(brdDocuments.projectId, projectId))

      await releaseClaim('brd', projectId, claim)

      expect(await versionOf()).toBe(3)
    })

    it('does not delete a real document when releasing a created claim', async () => {
      const claim = await claimGeneration('brd', projectId, 3)
      await handle.db
        .update(brdDocuments)
        .set({ version: 1, content: { executive_summary: 'landed' } })
        .where(eq(brdDocuments.projectId, projectId))

      await releaseClaim('brd', projectId, claim)

      expect(await rows()).toHaveLength(1)
    })

    /**
     * The generation failure is the one worth reporting. If the release threw,
     * it would replace the original error with a database error and cost the
     * diagnosis; losing the release only costs a slot.
     */
    it('swallows and logs a failure to release rather than masking the original error', async () => {
      const db = getDb()
      const claim = await claimGeneration('brd', projectId, 3)
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(db, 'delete').mockImplementation(() => {
        throw new Error('connection terminated unexpectedly')
      })

      await expect(releaseClaim('brd', projectId, claim)).resolves.toBeUndefined()

      expect(logged).toHaveBeenCalledWith(
        'failed to release brd generation claim',
        expect.any(Error),
      )
    })
  })

  /** The same machinery drives PRDs off a different table. */
  describe('prd documents', () => {
    it('claims and releases against the prd table', async () => {
      const claim = await claimGeneration('prd', projectId, 3)

      expect(claim).toEqual({ version: 1, created: true })
      const [row] = await handle.db
        .select()
        .from(prdDocuments)
        .where(eq(prdDocuments.projectId, projectId))
      expect(row.version).toBe(CLAIM_VERSION)

      await releaseClaim('prd', projectId, claim)

      expect(
        await handle.db.select().from(prdDocuments).where(eq(prdDocuments.projectId, projectId)),
      ).toHaveLength(0)
    })

    it('names PRD in the limit message rather than BRD', async () => {
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { tech_stack: ['bun'] },
        version: 3,
        status: 'review',
        price: 0,
      })

      const err = await codeOf(() => claimGeneration('prd', projectId, 3))

      expect(err.message).toContain('PRD')
    })
  })
})
