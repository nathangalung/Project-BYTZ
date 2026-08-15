// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  outboxEvents,
  projectAssignments,
  projectStatusLogs,
  projects,
  skills,
  talentProfiles,
  talentSkills,
  user,
  workPackageDependencies,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { matchingRoute } from './matching'

/**
 * Team formation: who may staff, who may answer, and what each side is shown.
 *
 * Two confidentiality rules meet here. /recommend carries userId and the
 * internal rating and fairness signals, so it is service-auth only. The
 * owner-facing /positions is built from the same scoring and must strip both -
 * that is the anonymity rule, and it is the difference between an owner
 * judging on competence and an owner judging on a rating the platform keeps
 * internal precisely so it does not compound.
 *
 * Then the staffing itself: confirm only makes offers, and `matched` is
 * reached by the last talent accepting, never by the owner deciding.
 */

/**
 * Temporal absent by default, which is what a deployment without a Temporal
 * server looks like. A couple of cases need it to fail loudly instead, because
 * both calls the route makes are fire-and-forget and that shape swallows an
 * outage unless something asserts on the log it leaves.
 */
const temporal = vi.hoisted(() => ({ connectError: null as Error | null }))

vi.mock('../lib/temporal-client', () => ({
  getTemporalClient: async () => {
    if (temporal.connectError) throw temporal.connectError
    return null
  },
  TEMPORAL_TASK_QUEUE: 'test',
  teamFormationWorkflowId: (id: string) => `team-formation-${id}`,
  disputeResolutionWorkflowId: (id: string) => `dispute-${id}`,
  milestoneAutoReleaseWorkflowId: (id: string) => `auto-release-${id}`,
}))

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`
// Pinned by vitest.setup.ts; read rather than restated so a change there breaks
// the test instead of leaving it passing against a stale literal.
const SERVICE_SECRET = process.env.SERVICE_AUTH_SECRET as string

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', matchingRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }

function json(
  caller: SessionUser | null,
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return appAs(caller).request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Wait until `n` backends are queued on a lock somebody else holds.
 *
 * Only this file runs while it holds the integration advisory lock, so an
 * ungranted lock here is one of the requests under test waiting on the row the
 * gate holds. Polling this rather than sleeping is what makes the interleaving
 * a fact instead of a hope.
 *
 * Asked on the application pool, never on the test handle: that handle is
 * `max: 1`, so a query issued while the gate holds its transaction queues
 * behind the very lock this is waiting to observe.
 */
async function waitForBlockedBackends(n: number): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const rows = (await getDb().execute(
      sql`SELECT count(*)::int AS blocked FROM pg_locks WHERE NOT granted`,
    )) as unknown as { blocked: number }[]
    if ((rows?.[0]?.blocked ?? 0) >= n) return
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${n} blocked backends`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

runIf('matching routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let strangerId: string
  let talentUserA: string
  let talentA: string
  let talentUserB: string
  let talentB: string

  let projectId: string
  let packageA: string
  let packageB: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function makeTalent(userId: string, skillId: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(talentProfiles).values({
      id,
      userId,
      yearsOfExperience: 5,
      verificationStatus: 'verified',
      availabilityStatus: 'available',
      averageRating: 4.5,
    })
    await handle.db
      .insert(talentSkills)
      .values({ talentId: id, skillId, proficiencyLevel: 'expert', isPrimary: true })
    return id
  }

  async function makePackage(title: string, order: number, skill: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(workPackages).values({
      id,
      projectId,
      title,
      description: 'Package',
      orderIndex: order,
      requiredSkills: [skill],
      estimatedHours: 40,
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'unassigned',
    })
    return id
  }

  beforeEach(async () => {
    await handle.truncate()
    temporal.connectError = null

    ownerId = await makeUser('owner')
    strangerId = await makeUser('stranger')

    const backendSkill = uuidv7()
    await handle.db
      .insert(skills)
      .values({ id: backendSkill, name: 'TypeScript', category: 'backend' })

    talentUserA = await makeUser('talent-a')
    talentA = await makeTalent(talentUserA, backendSkill)
    talentUserB = await makeUser('talent-b')
    talentB = await makeTalent(talentUserB, backendSkill)

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Team project',
      description: 'Exercises team formation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: 'matching',
      teamSize: 2,
    })

    packageA = await makePackage('Backend API', 0, 'TypeScript')
    packageB = await makePackage('Frontend', 1, 'TypeScript')
  })

  describe('POST /recommend', () => {
    const body = { requiredSkills: ['TypeScript'], limit: 5 }

    it('scores candidates for an inter-service caller', async () => {
      const res = await json(null, '/recommend', 'POST', body, {
        'X-Service-Auth': SERVICE_SECRET,
      })

      expect(res.status).toBe(200)
      const parsed = (await res.json()) as { data: { recommendations: unknown[] } }
      expect(parsed.data.recommendations.length).toBeGreaterThan(0)
    })

    /**
     * The payload carries userId and the internal rating and fairness signals.
     * A session caller reaching it would be reading exactly what the anonymity
     * rule keeps from owners and talents.
     */
    it('refuses the project owner', async () => {
      const res = await json(session(ownerId, 'owner'), '/recommend', 'POST', body)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Service credentials')
    })

    it('refuses a wrong service secret', async () => {
      const res = await json(null, '/recommend', 'POST', body, { 'X-Service-Auth': 'nope' })

      expect(res.status).toBe(403)
    })

    /** Callers that name no limit get the default rather than everybody. */
    it('caps an unbounded request at the default shortlist size', async () => {
      const res = await json(
        null,
        '/recommend',
        'POST',
        { requiredSkills: ['TypeScript'] },
        { 'X-Service-Auth': SERVICE_SECRET },
      )

      expect(res.status).toBe(200)
      const parsed = (await res.json()) as { data: { recommendations: unknown[] } }
      expect(parsed.data.recommendations.length).toBeLessThanOrEqual(10)
      expect(parsed.data.recommendations.length).toBeGreaterThan(0)
    })

    it('reports no eligible talents rather than an empty list', async () => {
      await handle.db.delete(talentSkills)
      await handle.db.update(talentProfiles).set({ verificationStatus: 'unverified' })

      const res = await json(null, '/recommend', 'POST', body, {
        'X-Service-Auth': SERVICE_SECRET,
      })

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('MATCHING_NO_TALENTS_FOUND')
    })

    it('rejects a limit outside the allowed range', async () => {
      const res = await json(
        null,
        '/recommend',
        'POST',
        { ...body, limit: 999 },
        {
          'X-Service-Auth': SERVICE_SECRET,
        },
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('excludes the talents the caller names', async () => {
      const res = await json(
        null,
        '/recommend',
        'POST',
        { ...body, excludeTalentIds: [talentA, talentB] },
        { 'X-Service-Auth': SERVICE_SECRET },
      )

      expect(res.status).toBe(404)
    })
  })

  describe('GET /:projectId/positions', () => {
    it('returns one ranked shortlist per open package to the owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/${projectId}/positions`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { positions: { workPackageId: string; title: string; recommendations: unknown[] }[] }
      }
      expect(body.data.positions.map((p) => p.title)).toEqual(['Backend API', 'Frontend'])
      expect(body.data.positions[0]?.recommendations.length).toBeGreaterThan(0)
    })

    /**
     * ai-service reads the same positions to draft a team, and it holds no
     * session. Service auth stands in for the ownership check rather than
     * bypassing authorisation entirely.
     */
    it('answers an inter-service caller with no session', async () => {
      const res = await appAs(null).request(`/${projectId}/positions`, {
        headers: { 'X-Service-Auth': SERVICE_SECRET },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { positions: { title: string }[] } }
      expect(body.data.positions.map((p) => p.title)).toEqual(['Backend API', 'Frontend'])
    })

    /**
     * A JSONB column that is NOT NULL still accepts the JSON value `null`, and
     * the model writes one whenever it decides a package needs no named skill.
     * Read straight through it is `null.length` and the whole page 500s.
     */
    it('serves a package whose required skills are a JSON null', async () => {
      await handle.db.execute(
        sql`UPDATE work_packages SET required_skills = 'null'::jsonb WHERE id = ${packageA}`,
      )

      const res = await appAs(session(ownerId, 'owner')).request(`/${projectId}/positions`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { positions: { title: string; requiredSkills: string[] }[] }
      }
      const position = body.data.positions.find((p) => p.title === 'Backend API')
      expect(position?.requiredSkills).toEqual([])
    })

    /**
     * The anonymity rule, on the response the owner actually receives: the
     * internal signals are what the score is built from, and none may ship.
     */
    it('strips the user id and every internal signal from the shortlist', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/${projectId}/positions`)

      const raw = JSON.stringify(await res.json())
      expect(raw).not.toContain(talentUserA)
      expect(raw).not.toContain('"userId"')
      expect(raw).not.toContain('pemerataan')
      expect(raw).not.toContain('trackRecord')
      expect(raw).not.toContain('"rating"')
      // What the owner is meant to see.
      expect(raw).toContain('skillMatch')
      expect(raw).toContain('isExploration')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/${projectId}/positions`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a talent who is a candidate for it', async () => {
      const res = await appAs(session(talentUserA)).request(`/${projectId}/positions`)

      expect(res.status).toBe(403)
    })

    /** The PRD graph decides which role blocks the others, so the owner staffs it first. */
    it('names the packages each open position waits on', async () => {
      await handle.db.insert(workPackageDependencies).values({
        id: uuidv7(),
        workPackageId: packageB,
        dependsOnWorkPackageId: packageA,
      })

      const res = await appAs(session(ownerId, 'owner')).request(`/${projectId}/positions`)

      const body = (await res.json()) as { data: { positions: { dependsOn: string[] }[] } }
      expect(body.data.positions[0]?.dependsOn).toEqual([])
      expect(body.data.positions[1]?.dependsOn).toEqual(['Backend API'])
    })

    it('returns no positions once every package is staffed', async () => {
      await handle.db.update(workPackages).set({ status: 'assigned' })

      const res = await appAs(session(ownerId, 'owner')).request(`/${projectId}/positions`)

      const body = (await res.json()) as { data: { positions: unknown[] } }
      expect(body.data.positions).toEqual([])
    })
  })

  describe('POST /confirm', () => {
    const confirm = (assignments: { workPackageId: string; talentId: string }[]) => ({
      projectId,
      assignments,
    })

    it('offers each position and moves the project into team forming', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([
          { workPackageId: packageA, talentId: talentA },
          { workPackageId: packageB, talentId: talentB },
        ]),
      )

      expect(res.status).toBe(200)
      const rows = await handle.db.select().from(projectAssignments)
      expect(rows).toHaveLength(2)
      // Offers, not hires: the talent has not answered yet.
      expect(rows.every((r) => r.acceptanceStatus === 'pending')).toBe(true)
      const pkgs = await handle.db.select({ status: workPackages.status }).from(workPackages)
      expect(pkgs.every((p) => p.status === 'pending_acceptance')).toBe(true)
      const [proj] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(proj?.status).toBe('team_forming')
    })

    it('audits the move out of matching exactly once', async () => {
      await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageA, talentId: talentA }]),
      )
      // Restaffing the second position is already team_forming, not a transition.
      await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageB, talentId: talentB }]),
      )

      const logs = await handle.db
        .select({ from: projectStatusLogs.fromStatus, to: projectStatusLogs.toStatus })
        .from(projectStatusLogs)
      expect(logs).toEqual([{ from: 'matching', to: 'team_forming' }])
    })

    /** Picking the team is the owner's decision alone. */
    it('refuses a signed-in stranger', async () => {
      const res = await json(
        session(strangerId),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageA, talentId: talentA }]),
      )

      expect(res.status).toBe(403)
      expect(await handle.db.select().from(projectAssignments)).toHaveLength(0)
    })

    it('refuses a talent staffing themselves', async () => {
      const res = await json(
        session(talentUserA),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageA, talentId: talentA }]),
      )

      expect(res.status).toBe(403)
    })

    it('refuses a package that is not open', async () => {
      await handle.db
        .update(workPackages)
        .set({ status: 'assigned' })
        .where(eq(workPackages.id, packageA))

      const res = await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageA, talentId: talentA }]),
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('MATCHING_INVALID_ASSIGNMENT')
    })

    /** One talent per package, or the same person holds two positions. */
    it('refuses the same talent on two positions in one request', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([
          { workPackageId: packageA, talentId: talentA },
          { workPackageId: packageB, talentId: talentA },
        ]),
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('two positions')
      expect(await handle.db.select().from(projectAssignments)).toHaveLength(0)
    })

    it('refuses a talent already on the team', async () => {
      await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageA, talentId: talentA }]),
      )

      const res = await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageB, talentId: talentA }]),
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('two positions')
    })

    it('reports a project with no open packages', async () => {
      await handle.db.update(workPackages).set({ status: 'assigned' })

      const res = await json(
        session(ownerId, 'owner'),
        '/confirm',
        'POST',
        confirm([{ workPackageId: packageA, talentId: talentA }]),
      )

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('MATCHING_NO_WORK_PACKAGES')
    })

    it('rejects an empty assignment list', async () => {
      const res = await json(session(ownerId, 'owner'), '/confirm', 'POST', confirm([]))

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('offers and answers', () => {
    async function offerBoth() {
      await json(session(ownerId, 'owner'), '/confirm', 'POST', {
        projectId,
        assignments: [
          { workPackageId: packageA, talentId: talentA },
          { workPackageId: packageB, talentId: talentB },
        ],
      })
      const rows = await handle.db
        .select({ id: projectAssignments.id, talentId: projectAssignments.talentId })
        .from(projectAssignments)
      return {
        a: rows.find((r) => r.talentId === talentA)?.id as string,
        b: rows.find((r) => r.talentId === talentB)?.id as string,
      }
    }

    it('shows a talent only their own pending offers', async () => {
      await offerBoth()

      const res = await appAs(session(talentUserA)).request('/my-offers')

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { workPackageId: string; payout: number }[]
      }
      expect(body.data).toHaveLength(1)
      expect(body.data[0]?.workPackageId).toBe(packageA)
      expect(body.data[0]?.payout).toBe(3_575_000)
    })

    it('shows nothing to someone with no talent profile', async () => {
      await offerBoth()

      const res = await appAs(session(ownerId, 'owner')).request('/my-offers')

      expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
    })

    /** `matched` is reached by the last talent accepting, never by the owner. */
    it('promotes the project to matched only once every offer is accepted', async () => {
      const { a, b } = await offerBoth()

      const first = await json(session(talentUserA), `/assignments/${a}/accept`, 'POST')
      expect(((await first.json()) as { data: { complete: boolean } }).data.complete).toBe(false)
      let [proj] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(proj?.status).toBe('team_forming')

      const second = await json(session(talentUserB), `/assignments/${b}/accept`, 'POST')

      expect(((await second.json()) as { data: { complete: boolean } }).data.complete).toBe(true)
      ;[proj] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(proj?.status).toBe('matched')
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events.filter((e) => e.type === 'project.team.complete')).toHaveLength(1)
    })

    /** Answering somebody else's offer decides their work for them. */
    it('refuses a talent answering an offer that is not theirs', async () => {
      const { a } = await offerBoth()

      const res = await json(session(talentUserB), `/assignments/${a}/accept`, 'POST')

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Assignment not found')
    })

    it('refuses the owner answering on the talent behalf', async () => {
      const { a } = await offerBoth()

      const res = await json(session(ownerId, 'owner'), `/assignments/${a}/accept`, 'POST')

      expect(res.status).toBe(404)
    })

    it('reopens the package when the talent declines', async () => {
      const { a } = await offerBoth()

      const res = await json(session(talentUserA), `/assignments/${a}/decline`, 'POST')

      expect(res.status).toBe(200)
      const [wp] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageA))
      expect(wp?.status).toBe('unassigned')
      const [row] = await handle.db
        .select({
          acceptance: projectAssignments.acceptanceStatus,
          status: projectAssignments.status,
        })
        .from(projectAssignments)
        .where(eq(projectAssignments.id, a))
      expect(row).toEqual({ acceptance: 'declined', status: 'terminated' })
    })

    /**
     * A second answer on the same offer is what would reopen a package the
     * first answer already counted towards `matched`.
     */
    it('refuses a second answer on an offer already accepted', async () => {
      const { a } = await offerBoth()
      await json(session(talentUserA), `/assignments/${a}/accept`, 'POST')

      const res = await json(session(talentUserA), `/assignments/${a}/decline`, 'POST')

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('MATCHING_INVALID_ASSIGNMENT')
      const [wp] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageA))
      expect(wp?.status).toBe('assigned')
    })

    it('refuses a second answer on an offer already declined', async () => {
      const { a } = await offerBoth()
      await json(session(talentUserA), `/assignments/${a}/decline`, 'POST')

      const res = await json(session(talentUserA), `/assignments/${a}/accept`, 'POST')

      expect(res.status).toBe(400)
    })

    it('reports an unknown assignment as not found', async () => {
      const res = await json(session(talentUserA), `/assignments/${uuidv7()}/accept`, 'POST')

      expect(res.status).toBe(404)
    })

    /** A declined position is restaffable, and the second talent completes the team. */
    it('reaches matched after the owner restaffs a declined position', async () => {
      const { a, b } = await offerBoth()
      await json(session(talentUserA), `/assignments/${a}/decline`, 'POST')
      await json(session(talentUserB), `/assignments/${b}/accept`, 'POST')

      const replacementUser = await makeUser('replacement')
      const [skill] = await handle.db.select({ id: skills.id }).from(skills).limit(1)
      const replacement = await makeTalent(replacementUser, skill?.id as string)
      await json(session(ownerId, 'owner'), '/confirm', 'POST', {
        projectId,
        assignments: [{ workPackageId: packageA, talentId: replacement }],
      })
      const [offer] = await handle.db
        .select({ id: projectAssignments.id })
        .from(projectAssignments)
        .where(eq(projectAssignments.talentId, replacement))

      const res = await json(session(replacementUser), `/assignments/${offer?.id}/accept`, 'POST')

      expect(((await res.json()) as { data: { complete: boolean } }).data.complete).toBe(true)
      const [proj] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(proj?.status).toBe('matched')
    })

    /**
     * Two answers to one offer, both of which read `pending` before either
     * wrote.
     *
     * The loser must be told, not silently ignored. A decline that landed after
     * an accept used to reopen the package the accept had just counted towards
     * `matched`, leaving the project holding a position /positions offers to
     * somebody else, and each repeated answer emitted its outbox event a second
     * time. assertAssignmentPending cannot catch this - it gates on a read
     * taken on the pool, before the transaction - so the compare-and-set inside
     * the claim is the only thing standing between the two writers.
     */
    it('tells the second answer it lost rather than letting it write', {
      timeout: 20_000,
    }, async () => {
      const { a } = await offerBoth()

      /**
       * Firing both requests and hoping they interleave is a coin flip - the
       * first often finished before the second had read anything, and then the
       * pre-check refused it and the claim was never exercised. So the
       * interleaving is constructed: hold the project row both handlers lock
       * first, let both get past their pool read and queue behind it, and only
       * then release. Both have now read `pending`, which is the state the
       * claim exists for.
       */
      let release: () => void = () => {}
      let acquired: () => void = () => {}
      const locked = new Promise<void>((resolve) => {
        acquired = resolve
      })
      const gate = handle.db.transaction(async (tx) => {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .for('update')
        acquired()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      // Firing before the gate holds the row would let both requests run
      // straight through, which is the coin flip this exists to remove.
      await locked

      const first = json(session(talentUserA), `/assignments/${a}/accept`, 'POST')
      const second = json(session(talentUserA), `/assignments/${a}/decline`, 'POST')
      await waitForBlockedBackends(2)

      release()
      await gate
      const [firstRes, secondRes] = await Promise.all([first, second])

      const statuses = [firstRes.status, secondRes.status].sort()
      expect(statuses).toEqual([200, 409])
      const loser = firstRes.status === 409 ? firstRes : secondRes
      expect(((await loser.json()) as ErrorBody).error.message).toMatch(/already/)

      // Exactly one answer survived, and the package matches it.
      const [assignment] = await handle.db
        .select({
          acceptanceStatus: projectAssignments.acceptanceStatus,
          status: projectAssignments.status,
        })
        .from(projectAssignments)
        .where(eq(projectAssignments.id, a))
      const [pkg] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageA))
      const accepted = assignment?.acceptanceStatus === 'accepted'
      expect(pkg?.status).toBe(accepted ? 'assigned' : 'unassigned')

      const declines = await handle.db
        .select({ type: outboxEvents.eventType })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'talent.assignment.declined'))
      expect(declines.length).toBe(accepted ? 0 : 1)
    })

    /**
     * The final acceptance of a project another transaction already promoted.
     *
     * The promotion is guarded so only the transaction that actually flips
     * team_forming -> matched logs and emits; a second one finds zero rows
     * updated and stays quiet, rather than writing a duplicate status log and a
     * second project.team.complete for one team.
     */
    it('emits nothing extra when the project is already matched', async () => {
      const { a, b } = await offerBoth()
      await json(session(talentUserA), `/assignments/${a}/accept`, 'POST')
      // The state a losing concurrent accept observes: every package staffed
      // and the project already promoted by the winner.
      await handle.db.update(projects).set({ status: 'matched' }).where(eq(projects.id, projectId))

      const res = await json(session(talentUserB), `/assignments/${b}/accept`, 'POST')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { complete: boolean } }).data.complete).toBe(false)
      const completions = await handle.db
        .select({ type: outboxEvents.eventType })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'project.team.complete'))
      expect(completions).toHaveLength(0)
      const promotions = await handle.db
        .select({ to: projectStatusLogs.toStatus })
        .from(projectStatusLogs)
        .where(eq(projectStatusLogs.toStatus, 'matched'))
      expect(promotions).toHaveLength(0)
    })

    /** The escalation timer is a safety net; losing it must not lose the team. */
    it('completes the team even when the completion signal cannot be sent', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { a, b } = await offerBoth()
      await json(session(talentUserA), `/assignments/${a}/accept`, 'POST')
      temporal.connectError = new Error('temporal unreachable')

      const res = await json(session(talentUserB), `/assignments/${b}/accept`, 'POST')

      expect(res.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(warned).toHaveBeenCalledWith(
        '[temporal] team complete signal failed',
        expect.objectContaining({ projectId }),
      )
      const [proj] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(proj?.status).toBe('matched')
      warned.mockRestore()
    })

    /** Same for the timer that starts when the owner staffs the team. */
    it('staffs the team even when the escalation timer cannot be started', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      temporal.connectError = new Error('temporal unreachable')

      const res = await json(session(ownerId, 'owner'), '/confirm', 'POST', {
        projectId,
        assignments: [
          { workPackageId: packageA, talentId: talentA },
          { workPackageId: packageB, talentId: talentB },
        ],
      })

      expect(res.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(warned).toHaveBeenCalledWith(
        '[temporal] team formation start failed',
        expect.objectContaining({ projectId }),
      )
      const [proj] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(proj?.status).toBe('team_forming')
      warned.mockRestore()
    })
  })
})
