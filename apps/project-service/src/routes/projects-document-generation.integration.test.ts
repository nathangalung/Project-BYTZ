// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  brdDocuments,
  chatConversations,
  chatMessages,
  getDb,
  prdDocuments,
  projectStatusLogs,
  projects as projectsTable,
  transactions,
  user,
  workPackageDependencies,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAIM_VERSION } from '../lib/document-claim'
import { resetServicePolicies } from '../lib/resilience'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { projectsRoute } from './projects'

/**
 * Who may spend a document generation, and what happens when the model does
 * not answer.
 *
 * Four gates stand in front of every BRD and PRD call and each one refuses for
 * a different reason: the caller is not the owner, the free allowance is spent,
 * today's free document is already used, or the scoping conversation is too
 * thin to generate from. They were reachable only through HTTP against a live
 * database, so none of them had ever executed.
 *
 * The part that matters most is what happens after the gates pass. The
 * allowance is claimed BEFORE the model call, so a failed generation has to
 * hand the slot back - document-generation.ts promises the owner in as many
 * words that "Nothing was saved and your daily quota is untouched", and that
 * promise is only kept if releaseClaim runs on every throw. A regression there
 * is invisible: the owner sees an error either way, and only notices the next
 * day when their free document is gone.
 *
 * The ai-service is stubbed because it is a true external. The database is
 * real, which is the point: the claim is an UPDATE guarded on the version it
 * was read at, and that is not a thing a mock can tell you the truth about.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'owner'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function app(caller: SessionUser | null) {
  const a = new Hono()
  a.onError(errorHandler)
  a.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  a.route('/', projectsRoute)
  return a
}

type ErrorBody = { success: false; error: { code: string; message: string } }

runIf('project document generation against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let strangerId: string
  let projectId: string

  /** What the stubbed ai-service returns next, and what it was asked. */
  let aiStatus: number
  let aiBody: unknown
  let aiCalls: { url: string; body: Record<string, unknown> }[]

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
    aiStatus = 200
    aiCalls = []
    aiBody = {
      brd: { executive_summary: 'A marketplace', estimated_price_min: 0, estimated_price_max: 0 },
      prd: { tech_stack: ['bun'], estimated_price_min: 0, estimated_price_max: 0 },
    }
    // Breakers are module-level, so every test in this file shares them and a
    // run of five failures with no success between would open the circuit.
    resetServicePolicies()

    // Drop anything an earlier file left on globalThis BEFORE capturing the
    // baseline below. Files share a worker process, so without this the
    // "real" fetch captured here can be a previous suite's stub.
    vi.unstubAllGlobals()

    // Only the ai-service is stubbed. Anything else is delegated to the real
    // fetch, because @react-pdf/renderer loads its layout engine as a WASM
    // module over fetch - answering that with the JSON below hands the
    // instantiator `{"br` where it wants the wasm magic word, and every PDF
    // download 500s for a reason that looks nothing like its cause.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (!href.includes('/api/v1/ai/')) return realFetch(url as string, init)

      aiCalls.push({
        url: href,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      if (aiStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'model overloaded' } }), {
          status: aiStatus,
        })
      }
      return new Response(JSON.stringify(aiBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    ownerId = await makeUser('owner')
    strangerId = await makeUser('stranger')
    projectId = await makeProject(ownerId)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function makeProject(owner: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projectsTable).values({
      id,
      ownerId: owner,
      title: 'Marketplace',
      description: 'A managed marketplace for digital projects',
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: 'scoping',
    })
    return id
  }

  /** A scoping thread with enough owner turns to pass the completeness gate. */
  async function scopeConversation(project = projectId, userTurns = 4): Promise<string> {
    const conversationId = uuidv7()
    await handle.db.insert(chatConversations).values({
      id: conversationId,
      projectId: project,
      type: 'ai_scoping',
      createdAt: new Date(),
    })
    for (let i = 0; i < userTurns; i += 1) {
      await handle.db.insert(chatMessages).values({
        id: uuidv7(),
        conversationId,
        senderType: 'user',
        senderId: ownerId,
        content: `Requirement number ${i}`,
        createdAt: new Date(Date.now() + i),
      })
    }
    return conversationId
  }

  function post(caller: SessionUser | null, path: string, body: unknown = {}) {
    return app(caller).request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function brdRow() {
    const [row] = await handle.db
      .select()
      .from(brdDocuments)
      .where(eq(brdDocuments.projectId, projectId))
    return row
  }

  async function prdRow() {
    const [row] = await handle.db
      .select()
      .from(prdDocuments)
      .where(eq(prdDocuments.projectId, projectId))
    return row
  }

  describe('POST /:id/generate-brd', () => {
    /**
     * The body carries only the document language, so a client that sends none
     * gets the default rather than a 500 out of the JSON parser.
     */
    it('defaults the language when the request carries no body', async () => {
      await scopeConversation()

      const res = await app(session(ownerId)).request(`/${projectId}/generate-brd`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      expect(await brdRow()).toBeDefined()
    })

    it('generates, prices and stores a BRD for the owner', async () => {
      await scopeConversation()

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(200)
      const row = await brdRow()
      expect(row.version).toBe(1)
      expect(row.status).toBe('review')
      // No usable estimate in the stub body, so the floor price applies.
      expect(row.price).toBe(99_000)
      expect(row.content).toMatchObject({ executive_summary: 'A marketplace' })
    })

    /**
     * This was a tripwire pinning a defect, and the defect is fixed, so the
     * expectation is flipped as its author asked.
     *
     * The route passed the literal 'system' as the actor and
     * project_status_logs.changed_by is a foreign key to user, so the insert
     * violated it and rolled the whole transaction back, status update
     * included. A bare catch commented "May already be in brd_generated state"
     * swallowed it, and the project stayed in scoping after every successful
     * generation. changed_by is nullable now and a platform transition writes
     * null.
     */
    it('moves the project to brd_generated with no actor recorded', async () => {
      await scopeConversation()

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      // The generation itself succeeded and the document was stored.
      expect(res.status).toBe(200)
      expect((await brdRow()).version).toBe(1)

      const [project] = await handle.db
        .select({ status: projectsTable.status })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
      expect(project.status).toBe('brd_generated')
      const logs = await handle.db
        .select()
        .from(projectStatusLogs)
        .where(eq(projectStatusLogs.projectId, projectId))
      expect(logs).toHaveLength(1)
      expect(logs[0]?.toStatus).toBe('brd_generated')
      // Null, because the platform generated it and no user did.
      expect(logs[0]?.changedBy).toBeNull()
    })

    it('refuses a caller who does not own the project', async () => {
      await scopeConversation()

      const res = await post(session(strangerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      // The gate has to precede the model call, or a stranger costs a Gemini bill.
      expect(aiCalls).toHaveLength(0)
    })

    /**
     * The completeness gate. Generating from two lines of chat produces a BRD
     * the owner will reject, having spent a generation on it.
     */
    it('refuses when the scoping conversation is too thin', async () => {
      await scopeConversation(projectId, 3)

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorBody
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toContain('Minimal 4 pesan')
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses when the project has no scoping conversation at all', async () => {
      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(400)
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses once the free generation allowance is spent', async () => {
      await scopeConversation()
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { executive_summary: 'existing' },
        version: 3,
        status: 'review',
        price: 99_000,
      })

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(402)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_GENERATION_LIMIT')
      expect(aiCalls).toHaveLength(0)
    })

    /**
     * The daily cap counts brand-new documents per owner, so it must be read
     * from the owner's other projects, not this one.
     */
    it('refuses a new BRD once today’s free document is used on another project', async () => {
      await scopeConversation()
      const otherProject = await makeProject(ownerId)
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId: otherProject,
        content: { executive_summary: 'today' },
        version: 1,
        status: 'review',
        price: 99_000,
      })

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(429)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_DAILY_LIMIT')
      expect(aiCalls).toHaveLength(0)
    })

    it("does not count another owner's document against the daily cap", async () => {
      await scopeConversation()
      const otherOwner = await makeUser('other-owner')
      const otherProject = await makeProject(otherOwner)
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId: otherProject,
        content: { executive_summary: 'theirs' },
        version: 1,
        status: 'review',
        price: 99_000,
      })

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(200)
    })

    /**
     * The promise in the error message, tested. The claim is taken before the
     * model call; if the failure path did not release it the owner would be
     * left holding a version-0 reservation and unable to generate again until
     * the TTL expired.
     */
    it('hands the allowance back when the AI service fails', async () => {
      await scopeConversation()
      aiStatus = 500

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(503)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AI_SERVICE_UNAVAILABLE')
      // The claim created the row, so releasing it removes the row entirely.
      expect(await brdRow()).toBeUndefined()
    }, 20_000)

    it('leaves the project in scoping when generation fails', async () => {
      await scopeConversation()
      aiStatus = 500

      await post(session(ownerId), `/${projectId}/generate-brd`)

      const [project] = await handle.db
        .select({ status: projectsTable.status })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
      expect(project.status).toBe('scoping')
    }, 20_000)

    /**
     * An empty body is a failed generation, not a document. Storing it would
     * spend the allowance on nothing and show the owner a blank BRD.
     */
    it('treats an empty document from the model as a failure', async () => {
      await scopeConversation()
      aiBody = { brd: {} }

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(503)
      expect(await brdRow()).toBeUndefined()
    })

    it('lets the owner retry after a failure, allowance intact', async () => {
      await scopeConversation()
      aiStatus = 500
      await post(session(ownerId), `/${projectId}/generate-brd`)

      aiStatus = 200
      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(200)
      expect((await brdRow()).version).toBe(1)
    }, 25_000)

    it('sends the scoping history and the project shape upstream', async () => {
      await scopeConversation()

      await post(session(ownerId), `/${projectId}/generate-brd`)

      const call = aiCalls.find((x) => x.url.includes('generate-brd'))
      if (!call) throw new Error('the AI service was never asked to generate a BRD')
      expect(call.body).toMatchObject({
        project_id: projectId,
        project_category: 'web_app',
        budget_min: 5_000_000,
        budget_max: 20_000_000,
        timeline_days: 60,
        language: 'id',
      })
      expect(call.body.conversation_history as unknown[]).toHaveLength(4)
    })

    it('honours an explicit English request and defaults to Indonesian', async () => {
      await scopeConversation()

      await post(session(ownerId), `/${projectId}/generate-brd`, { language: 'en' })
      expect(aiCalls.at(-1)?.body.language).toBe('en')

      await handle.db.delete(brdDocuments).where(eq(brdDocuments.projectId, projectId))
      await post(session(ownerId), `/${projectId}/generate-brd`, { language: 'fr' })
      expect(aiCalls.at(-1)?.body.language).toBe('id')
    })

    /**
     * A reservation is version 0 and is not a document. A second submit while
     * one is in flight must be refused rather than billed.
     */
    it('refuses a second generation while one is already reserved', async () => {
      await scopeConversation()
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: {},
        version: CLAIM_VERSION,
        status: 'draft',
        price: 0,
      })

      const res = await post(session(ownerId), `/${projectId}/generate-brd`)

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
      expect(aiCalls).toHaveLength(0)
    })

    /**
     * Two concurrent submits, which is what a double click is.
     *
     * Neither the split nor the refusal code is asserted. Which one the loser
     * gets depends on how the database round trips interleave, and there are
     * three correct answers: 409 when it finds the reservation in flight, 429
     * when it read before the reservation existed and the daily cap has since
     * been spent by the winner, and 200 when the two never overlapped at all
     * and it is simply an ordinary second generation. Pinning any of them
     * makes this a scheduling detector - it passed alone and failed under the
     * full suite, which is exactly that failure mode.
     *
     * What must hold under every interleaving is the invariant the claim
     * exists for: one billed model call per version. The bug it replaced broke
     * exactly this - two callers passed the same read-then-compare, both
     * called Gemini, and one slot covered two bills. That shows up here as
     * more AI calls than versions, whichever way the requests happened to
     * land. The mutual exclusion itself is asserted deterministically one
     * layer down, in document-claim.integration.test.ts.
     */
    it('never bills more generations than it advances versions', async () => {
      await scopeConversation()

      const results = await Promise.all([
        post(session(ownerId), `/${projectId}/generate-brd`),
        post(session(ownerId), `/${projectId}/generate-brd`),
      ])

      const accepted = results.filter((r) => r.status === 200).length
      expect(accepted).toBeGreaterThanOrEqual(1)

      // The invariant, true under every interleaving: one billed model call
      // per version advanced. The bug this replaced broke exactly this - two
      // callers passed the same read-then-compare, both called Gemini, and one
      // slot covered two bills, which shows up here as calls > version.
      const billed = aiCalls.filter((x) => x.url.includes('generate-brd')).length
      expect(billed).toBe(accepted)
      expect(await brdRow()).toMatchObject({ version: billed })
      // One document per project, never a duplicate row for the second caller.
      expect(
        await handle.db.select().from(brdDocuments).where(eq(brdDocuments.projectId, projectId)),
      ).toHaveLength(1)
    })
  })

  describe('POST /:id/generate-prd', () => {
    async function approvedBrd(): Promise<void> {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { executive_summary: 'A marketplace' },
        version: 1,
        status: 'approved',
        price: 99_000,
      })
      await handle.db
        .update(projectsTable)
        .set({ status: 'brd_approved' })
        .where(eq(projectsTable.id, projectId))
    }

    it('generates a PRD from the approved BRD', async () => {
      await approvedBrd()

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(200)
      const row = await prdRow()
      expect(row.version).toBe(1)
      expect(row.status).toBe('review')
      expect(row.price).toBe(199_000)
    })

    it('feeds the BRD body to the model', async () => {
      await approvedBrd()

      await post(session(ownerId), `/${projectId}/generate-prd`)

      const call = aiCalls.find((x) => x.url.includes('generate-prd'))
      expect(call?.body.brd_content).toMatchObject({ executive_summary: 'A marketplace' })
    })

    /**
     * The body carries only the document language, so a client that sends none
     * gets the default rather than a 500 out of the JSON parser.
     */
    it('defaults the language when the request carries no body', async () => {
      await approvedBrd()

      const res = await app(session(ownerId)).request(`/${projectId}/generate-prd`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      expect(await prdRow()).toBeDefined()
    })

    it('refuses a caller who does not own the project', async () => {
      await approvedBrd()

      const res = await post(session(strangerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(403)
      expect(aiCalls).toHaveLength(0)
    })

    it('hands the allowance back when the AI service fails', async () => {
      await approvedBrd()
      aiStatus = 500

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(503)
      expect(await prdRow()).toBeUndefined()
    }, 20_000)

    it('refuses once the free PRD allowance is spent', async () => {
      await approvedBrd()
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { tech_stack: ['bun'] },
        version: 3,
        status: 'review',
        price: 199_000,
      })

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(402)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_GENERATION_LIMIT')
      expect(aiCalls).toHaveLength(0)
    })

    it('treats an empty document from the model as a failure', async () => {
      await approvedBrd()
      aiBody = { prd: {} }

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(503)
      expect(await prdRow()).toBeUndefined()
    })

    /**
     * The daily cap is per owner per document type, so a PRD started on
     * another project today spends it. Asserted separately from the BRD case
     * because they are two independent gates reading two different tables:
     * covering one says nothing about the other.
     */
    it('refuses a new PRD once today’s free document is used on another project', async () => {
      await approvedBrd()
      const otherProject = await makeProject(ownerId)
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId: otherProject,
        content: { tech_stack: ['bun'] },
        version: 1,
        status: 'review',
        price: 199_000,
      })

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(429)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_DAILY_LIMIT')
      expect(aiCalls).toHaveLength(0)
    })
  })

  /**
   * Turning the PRD into rows the rest of the platform can act on.
   *
   * Without work packages, /matching/confirm throws MATCHING_NO_WORK_PACKAGES
   * on every project - the owner sees a finished PRD and then a dead end at the
   * one step that matters. The dependency edges have the same shape of failure:
   * they decide which position the owner staffs first, and nothing was writing
   * them, so every project's graph sat empty while the PRD described one.
   *
   * All of it is deliberately non-fatal. The PRD is already stored by the time
   * this runs, so a failure here must cost the decomposition and nothing else.
   */
  describe('work packages from the PRD', () => {
    async function approvedBrd(): Promise<void> {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { executive_summary: 'A marketplace' },
        version: 1,
        status: 'approved',
        price: 99_000,
      })
      await handle.db
        .update(projectsTable)
        .set({ status: 'brd_approved' })
        .where(eq(projectsTable.id, projectId))
    }

    /** A PRD the model wrote for a two-person team, with one ordering edge. */
    function teamPrd(over: { dependencies?: unknown[]; amount?: number } = {}) {
      return {
        tech_stack: ['bun'],
        team_composition: {
          team_size: 2,
          work_packages: [
            {
              name: 'Backend API',
              required_skills: ['typescript'],
              estimated_hours: 80,
              amount: over.amount ?? 6_000_000,
            },
            {
              name: 'Frontend',
              required_skills: ['react'],
              estimated_hours: 60,
              amount: over.amount ?? 4_000_000,
            },
          ],
        },
        dependencies: over.dependencies ?? [
          { from: 'Backend API', to: 'Frontend', type: 'finish_to_start' },
        ],
      }
    }

    async function packages() {
      return await handle.db
        .select({
          id: workPackages.id,
          title: workPackages.title,
          amount: workPackages.amount,
          orderIndex: workPackages.orderIndex,
        })
        .from(workPackages)
        .where(eq(workPackages.projectId, projectId))
        .orderBy(workPackages.orderIndex)
    }

    async function teamSizeOf() {
      const [row] = await handle.db
        .select({ teamSize: projectsTable.teamSize })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
      return row?.teamSize
    }

    it('creates one package per role and records the team size as the row count', async () => {
      await approvedBrd()
      aiBody = { prd: teamPrd() }

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(200)
      const rows = await packages()
      expect(rows.map((r) => r.title)).toEqual(['Backend API', 'Frontend'])
      expect(rows.map((r) => r.amount)).toEqual([6_000_000, 4_000_000])
      expect(await teamSizeOf()).toBe(2)
    })

    /** The edge the PRD describes: `from` finishes before `to` may start. */
    it('stores the dependency graph the PRD describes', async () => {
      await approvedBrd()
      aiBody = { prd: teamPrd() }

      await post(session(ownerId), `/${projectId}/generate-prd`)

      const rows = await packages()
      const backend = rows.find((r) => r.title === 'Backend API')?.id
      const frontend = rows.find((r) => r.title === 'Frontend')?.id
      const edges = await handle.db
        .select({
          workPackageId: workPackageDependencies.workPackageId,
          dependsOn: workPackageDependencies.dependsOnWorkPackageId,
        })
        .from(workPackageDependencies)
      expect(edges).toEqual([{ workPackageId: frontend, dependsOn: backend }])
    })

    /**
     * Regenerating is how an owner acts on a revision, so it must not double
     * the team. Both the packages and the edges are guarded on what is already
     * there rather than on the whole pass, so a PRD written before the graph
     * existed still backfills.
     */
    it('adds no second set of packages or edges when the PRD is regenerated', async () => {
      await approvedBrd()
      aiBody = { prd: teamPrd() }
      await post(session(ownerId), `/${projectId}/generate-prd`)
      const first = await packages()

      await handle.db
        .update(projectsTable)
        .set({ status: 'brd_approved' })
        .where(eq(projectsTable.id, projectId))
      await post(session(ownerId), `/${projectId}/generate-prd`)

      const second = await packages()
      expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id))
      expect(await handle.db.select().from(workPackageDependencies)).toHaveLength(1)
    })

    /**
     * One unusable edge must not take the graph with it. A cycle is the case
     * the model actually produces, and addDependency is what rejects it.
     */
    it('keeps the edges it can when the PRD describes a cycle', async () => {
      const errored = vi.spyOn(console, 'error').mockImplementation(() => {})
      await approvedBrd()
      aiBody = {
        prd: teamPrd({
          dependencies: [
            { from: 'Backend API', to: 'Frontend', type: 'finish_to_start' },
            { from: 'Frontend', to: 'Backend API', type: 'finish_to_start' },
          ],
        }),
      }

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(200)
      expect(await handle.db.select().from(workPackageDependencies)).toHaveLength(1)
      expect(errored).toHaveBeenCalledWith('work package dependency skipped', expect.anything())
      errored.mockRestore()
    })

    /**
     * The PRD is stored before this runs and the owner has already paid for the
     * generation, so a decomposition that cannot be written costs the packages
     * and nothing else. An amount past the integer column is the model's
     * favourite way to produce that.
     */
    it('still returns the PRD when the packages cannot be written', async () => {
      const errored = vi.spyOn(console, 'error').mockImplementation(() => {})
      await approvedBrd()
      aiBody = { prd: teamPrd({ amount: 9_000_000_000 }) }

      const res = await post(session(ownerId), `/${projectId}/generate-prd`)

      expect(res.status).toBe(200)
      expect(await prdRow()).toBeDefined()
      expect(await packages()).toHaveLength(0)
      expect(errored).toHaveBeenCalledWith(
        'work package creation from PRD failed',
        expect.anything(),
      )
      const [log] = await handle.db
        .select({ to: projectStatusLogs.toStatus })
        .from(projectStatusLogs)
        .where(eq(projectStatusLogs.projectId, projectId))
      expect(log?.to).toBe('prd_generated')
      errored.mockRestore()
    })

    /** One talent takes the whole project as a single package. */
    it('collapses a single-talent PRD into one package named after the project', async () => {
      await approvedBrd()
      aiBody = {
        prd: {
          tech_stack: ['bun'],
          team_composition: {
            team_size: 1,
            work_packages: teamPrd().team_composition.work_packages,
          },
        },
      }

      await post(session(ownerId), `/${projectId}/generate-prd`)

      const rows = await packages()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.amount).toBe(10_000_000)
      expect(await teamSizeOf()).toBe(1)
      expect(await handle.db.select().from(workPackageDependencies)).toHaveLength(0)
    })
  })

  /**
   * Repricing on revision, and where it must stop.
   *
   * A revision replaces the document body, and the body carries the estimate
   * the fee is derived from: revise a small project into a large one and a
   * stale price quotes a fee for a scope that no longer exists. Once paidAt is
   * set the owner has bought the document at an agreed figure, and moving it
   * afterwards rewrites a completed sale.
   */
  describe('POST /:id/brd/revision', () => {
    async function existingBrd(version = 1, paidAt: Date | null = null): Promise<void> {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: {
          executive_summary: 'small',
          estimated_price_min: 1_000_000,
          estimated_price_max: 1_000_000,
        },
        version,
        status: 'review',
        price: 99_000,
        paidAt,
      })
    }

    function bigger() {
      return {
        brd: {
          executive_summary: 'much larger',
          estimated_price_min: 100_000_000,
          estimated_price_max: 100_000_000,
        },
      }
    }

    it('reprices an unpaid BRD when the revision changes its scope', async () => {
      await existingBrd()
      aiBody = bigger()

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Add a payments module and a mobile app',
      })

      expect(res.status).toBe(200)
      const row = await brdRow()
      // 100,000,000 at the BRD factor of 0.05.
      expect(row.price).toBe(5_000_000)
      expect(row.version).toBe(2)
    })

    it('leaves a paid BRD at the price it was bought for', async () => {
      await existingBrd(1, new Date())
      aiBody = bigger()

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Add a payments module and a mobile app',
      })

      expect(res.status).toBe(200)
      const row = await brdRow()
      expect(row.price).toBe(99_000)
      // The body still updates; only the price is frozen.
      expect(row.content).toMatchObject({ executive_summary: 'much larger' })
    })

    it('reports the free revisions left', async () => {
      await existingBrd()

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Tighten the scope a little',
      })

      expect(await res.json()).toMatchObject({
        success: true,
        data: { version: 2, freeRevisionsRemaining: 1 },
      })
    })

    it('refuses a caller who does not own the project', async () => {
      await existingBrd()

      const res = await post(session(strangerId), `/${projectId}/brd/revision`, {
        description: 'Please change everything',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses when there is no BRD to revise', async () => {
      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Revise the document that does not exist',
      })

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })

    /** A reservation is version 0, and gt(version, 0) is what excludes it. */
    it('does not mistake an in-flight reservation for a document', async () => {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: {},
        version: CLAIM_VERSION,
        status: 'draft',
        price: 0,
      })

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Revise the reservation',
      })

      expect(res.status).toBe(404)
    })

    it('rejects a revision instruction that is too short', async () => {
      await existingBrd()

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, { description: 'no' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
      expect(aiCalls).toHaveLength(0)
    })

    /** Unpaid documents get two free revisions; the third needs payment. */
    it('sends an unpaid owner to payment once the free revisions are used', async () => {
      await existingBrd(3)

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'One more change please',
      })

      expect(res.status).toBe(402)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_NOT_PAID')
      expect(aiCalls).toHaveLength(0)
    })

    it('lets a paid owner past the free cap', async () => {
      await existingBrd(3, new Date())

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'One more change please',
      })

      expect(res.status).toBe(200)
      expect((await brdRow()).version).toBe(4)
    })

    /** Paying raises the cap to nine. Nine is a hard stop, not another sale. */
    it('refuses a paid owner at the maximum revision count', async () => {
      await existingBrd(9, new Date())

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Just one more change',
      })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_REVISION_LIMIT')
      expect(aiCalls).toHaveLength(0)
    })

    /**
     * A completed payment with no paidAt is a dropped payment callback. The
     * entitlement check backfills it so the download, the watermark and the
     * revision cap all agree.
     */
    it('honours a completed payment whose callback never set paidAt', async () => {
      await existingBrd(3)
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: 'brd_payment',
        amount: 99_000,
        status: 'completed',
        idempotencyKey: `brd-${projectId}`,
      })

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'One more change please',
      })

      expect(res.status).toBe(200)
      expect((await brdRow()).paidAt).not.toBeNull()
    })

    it('writes the instruction into the scoping thread and regenerates from it', async () => {
      const conversationId = await scopeConversation()
      await existingBrd()

      await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Add a payments module',
      })

      const messages = await handle.db
        .select({ content: chatMessages.content })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
      expect(messages.map((m) => m.content)).toContain('[Revisi BRD] Add a payments module')
      const call = aiCalls.find((x) => x.url.includes('generate-brd'))
      expect(call?.body.revision_instruction).toBe('Add a payments module')
      expect(call?.body.current_document).toMatchObject({ executive_summary: 'small' })
    })

    /**
     * The claim is taken before the instruction is written, so a caller that
     * loses the race leaves nothing behind in the thread. On failure the
     * version must roll back rather than stay spent.
     */
    it('rolls the version back when the AI service fails', async () => {
      await existingBrd()
      aiStatus = 500

      const res = await post(session(ownerId), `/${projectId}/brd/revision`, {
        description: 'Add a payments module',
      })

      expect(res.status).toBe(503)
      expect((await brdRow()).version).toBe(1)
    }, 20_000)
  })

  describe('POST /:id/prd/revision', () => {
    async function existingPrd(version = 1, paidAt: Date | null = null): Promise<void> {
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId,
        content: {
          tech_stack: ['bun'],
          estimated_price_min: 1_000_000,
          estimated_price_max: 1_000_000,
        },
        version,
        status: 'review',
        price: 199_000,
        paidAt,
      })
    }

    function bigger() {
      return {
        prd: {
          tech_stack: ['bun', 'go'],
          estimated_price_min: 100_000_000,
          estimated_price_max: 100_000_000,
        },
      }
    }

    it('reprices an unpaid PRD when the revision changes its scope', async () => {
      await existingPrd()
      aiBody = bigger()

      const res = await post(session(ownerId), `/${projectId}/prd/revision`, {
        description: 'Add a data pipeline and a second service',
      })

      expect(res.status).toBe(200)
      // 100,000,000 at the PRD factor of 0.08.
      expect((await prdRow()).price).toBe(8_000_000)
    })

    it('leaves a paid PRD at the price it was bought for', async () => {
      await existingPrd(1, new Date())
      aiBody = bigger()

      const res = await post(session(ownerId), `/${projectId}/prd/revision`, {
        description: 'Add a data pipeline and a second service',
      })

      expect(res.status).toBe(200)
      const row = await prdRow()
      expect(row.price).toBe(199_000)
      expect(row.content).toMatchObject({ tech_stack: ['bun', 'go'] })
    })

    it('refuses a caller who does not own the project', async () => {
      await existingPrd()

      const res = await post(session(strangerId), `/${projectId}/prd/revision`, {
        description: 'Please change everything',
      })

      expect(res.status).toBe(403)
      expect(aiCalls).toHaveLength(0)
    })

    it('refuses when there is no PRD to revise', async () => {
      const res = await post(session(ownerId), `/${projectId}/prd/revision`, {
        description: 'Revise the document that does not exist',
      })

      expect(res.status).toBe(404)
    })

    /** A revision with nothing to act on must not reach the model. */
    it('rejects a revision request the schema does not accept', async () => {
      await existingPrd()

      const res = await post(session(ownerId), `/${projectId}/prd/revision`, { description: 'no' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
      expect(aiCalls).toHaveLength(0)
    })

    it('sends an unpaid owner to payment once the free revisions are used', async () => {
      await existingPrd(3)

      const res = await post(session(ownerId), `/${projectId}/prd/revision`, {
        description: 'One more change please',
      })

      expect(res.status).toBe(402)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_NOT_PAID')
    })

    it('refuses a paid owner at the maximum revision count', async () => {
      await existingPrd(9, new Date())

      const res = await post(session(ownerId), `/${projectId}/prd/revision`, {
        description: 'Just one more change',
      })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_REVISION_LIMIT')
    })

    it('rolls the version back when the AI service fails', async () => {
      await existingPrd()
      aiStatus = 500

      const res = await post(session(ownerId), `/${projectId}/prd/revision`, {
        description: 'Add a data pipeline',
      })

      expect(res.status).toBe(503)
      expect((await prdRow()).version).toBe(1)
    }, 20_000)
  })

  /**
   * The clean PDF is the paid deliverable; the in-app preview is watermarked.
   *
   * The gate has to be the paid entitlement (paidAt), never the review
   * lifecycle (status), and the difference is not cosmetic: a revision resets
   * status to 'review', so a status gate would re-lock a document the owner
   * has already bought every time they asked for a change. Both routes are
   * owner-only - an assigned talent may read the PRD as their brief, but the
   * download is the thing that was sold.
   */
  describe('paid PDF downloads', () => {
    function get(caller: SessionUser | null, path: string) {
      return app(caller).request(path)
    }

    async function seedBrd(paidAt: Date | null, status = 'review'): Promise<void> {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: {
          executive_summary: 'A managed marketplace',
          business_objectives: ['Reduce time to hire'],
          estimated_timeline_days: 60,
        },
        version: 1,
        status: status as 'review',
        price: 99_000,
        paidAt,
      })
    }

    async function seedPrd(paidAt: Date | null, status = 'review'): Promise<void> {
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { tech_stack: ['bun', 'hono'], estimated_timeline_days: 60 },
        version: 1,
        status: status as 'review',
        price: 199_000,
        paidAt,
      })
    }

    it('serves the BRD as a PDF attachment once it is paid for', async () => {
      await seedBrd(new Date())

      const res = await get(session(ownerId), `/${projectId}/brd/pdf`)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      expect(res.headers.get('Content-Disposition')).toContain(`BRD-${projectId}.pdf`)
      const body = new Uint8Array(await res.arrayBuffer())
      // %PDF- magic, so this is a real document rather than an error body.
      expect(new TextDecoder().decode(body.slice(0, 5))).toBe('%PDF-')
    }, 30_000)

    it('serves the PRD as a PDF attachment once it is paid for', async () => {
      await seedPrd(new Date())

      const res = await get(session(ownerId), `/${projectId}/prd/pdf`)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      expect(res.headers.get('Content-Disposition')).toContain(`PRD-${projectId}.pdf`)
    }, 30_000)

    it.each([
      ['brd', 'brd/pdf'],
      ['prd', 'prd/pdf'],
    ])('refuses an unpaid %s download', async (kind, path) => {
      if (kind === 'brd') await seedBrd(null)
      else await seedPrd(null)

      const res = await get(session(ownerId), `/${projectId}/${path}`)

      expect(res.status).toBe(402)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_NOT_PAID')
    })

    /**
     * The status gate this replaced. A paid document sitting at 'review'
     * because the owner asked for a revision must still download.
     */
    it('downloads a paid document that a revision put back into review', async () => {
      await seedBrd(new Date(), 'review')

      const res = await get(session(ownerId), `/${projectId}/brd/pdf`)

      expect(res.status).toBe(200)
    }, 30_000)

    /** Approved but unpaid is still unpaid; the sale is what unlocks it. */
    it('refuses an approved but unpaid document', async () => {
      await seedBrd(null, 'approved')

      const res = await get(session(ownerId), `/${projectId}/brd/pdf`)

      expect(res.status).toBe(402)
    })

    /** A dropped payment callback is backfilled from the completed sale. */
    it('honours a completed payment whose callback never set paidAt', async () => {
      await seedBrd(null)
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: 'brd_payment',
        amount: 99_000,
        status: 'completed',
        idempotencyKey: `brd-pdf-${projectId}`,
      })

      const res = await get(session(ownerId), `/${projectId}/brd/pdf`)

      expect(res.status).toBe(200)
    }, 30_000)

    it('does not unlock a download from a payment that never completed', async () => {
      await seedBrd(null)
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: 'brd_payment',
        amount: 99_000,
        status: 'pending',
        idempotencyKey: `brd-pending-${projectId}`,
      })

      const res = await get(session(ownerId), `/${projectId}/brd/pdf`)

      expect(res.status).toBe(402)
    })

    it.each([
      ['brd', 'brd/pdf'],
      ['prd', 'prd/pdf'],
    ])('refuses a %s download by anyone but the owner', async (kind, path) => {
      if (kind === 'brd') await seedBrd(new Date())
      else await seedPrd(new Date())

      const res = await get(session(strangerId), `/${projectId}/${path}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it.each(['brd/pdf', 'prd/pdf'])('reports %s when no document exists', async (path) => {
      const res = await get(session(ownerId), `/${projectId}/${path}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })

    /** Version 0 is an in-flight reservation, not a document to download. */
    it('does not serve an in-flight reservation as a document', async () => {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: {},
        version: CLAIM_VERSION,
        status: 'draft',
        price: 0,
        paidAt: new Date(),
      })

      const res = await get(session(ownerId), `/${projectId}/brd/pdf`)

      expect(res.status).toBe(404)
    })
  })
})
