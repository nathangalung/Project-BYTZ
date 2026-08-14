import {
  brdDocuments,
  getDb,
  milestones,
  outboxEvents,
  prdDocuments,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startScheduledJobs, stopScheduledJobs } from './scheduled-jobs'

/**
 * The in-process scheduler, driven by the callbacks it registers.
 *
 * Every job here is a background repair: the inactivity warning that precedes a
 * reassignment, the abandon penalty that feeds pemerataan, the auto-release
 * that pays a talent when the owner never responded, and the embedding
 * backfill that keeps approved documents in the RAG corpus. Nothing calls any
 * of them directly - they exist only behind setInterval and a 30 second boot
 * timeout - so the module's reachable surface is the schedule itself.
 *
 * The timers are captured rather than faked. vitest's fake clock also fakes the
 * timers postgres.js needs to drive a query to completion, so every statement
 * under it deadlocks; a query on an already-warm pool hangs the same way, which
 * rules the approach out rather than being a matter of tuning. Capturing what
 * `startScheduledJobs` schedules and then awaiting those callbacks keeps the
 * database on real timers and asserts the periods explicitly, which is the
 * part of this module that is otherwise only readable.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

const HOUR = 60 * 60 * 1000
const SIX_HOURS = 6 * HOUR
const BOOT_DELAY = 30_000

type Scheduled = { kind: 'timeout' | 'interval'; ms: number; run: () => Promise<void> }

/**
 * Run startScheduledJobs with the timer constructors stubbed, so the callbacks
 * it registers can be awaited one at a time instead of waiting six hours.
 */
function captureSchedule(): Scheduled[] {
  const captured: Scheduled[] = []
  const record = (kind: Scheduled['kind']) => (fn: () => unknown, ms: number) => {
    captured.push({ kind, ms, run: async () => void (await fn()) })
    return 0 as unknown as ReturnType<typeof setTimeout>
  }

  vi.stubGlobal('setTimeout', record('timeout'))
  vi.stubGlobal('setInterval', record('interval'))
  try {
    startScheduledJobs()
  } finally {
    vi.unstubAllGlobals()
  }
  return captured
}

runIf('scheduled jobs against Postgres', () => {
  let handle: TestHandle
  let calls: string[]
  let restoreFetch: () => void

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let projectId: string
  let packageId: string

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
    calls = []

    // Drop anything an earlier file left on globalThis before capturing the
    // baseline. Files run sequentially against one shared database, so without
    // this the "real" fetch saved below can be a previous suite's stub, and the
    // restore at the end of this one hands that stub to the next.
    vi.unstubAllGlobals()

    // Stubbed by assignment rather than vi.stubGlobal: captureSchedule calls
    // unstubAllGlobals, which would put the real fetch back mid-test.
    const realFetch = globalThis.fetch
    restoreFetch = () => {
      globalThis.fetch = realFetch
    }
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url)
      calls.push(href)
      const body = href.includes('backfill-skill-embeddings')
        ? { written: 3 }
        : { success: true, data: { balance: 0 } }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Scheduled project',
      description: 'Exercises the background jobs',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 30,
      status: 'in_progress',
    })

    packageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: packageId,
      projectId,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 10_000_000,
      talentPayout: 7_150_000,
      status: 'in_progress',
    })
  })

  afterEach(() => {
    stopScheduledJobs()
    restoreFetch()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  /** The boot pass: every job runs once, 30 seconds after start. */
  async function boot(): Promise<void> {
    const schedule = captureSchedule()
    const bootPass = schedule.find((s) => s.kind === 'timeout' && s.ms === BOOT_DELAY)
    if (!bootPass) throw new Error('no boot pass scheduled')
    await bootPass.run()
  }

  function eventTypes(): Promise<{ type: string }[]> {
    return handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
  }

  /** An assignment old enough and quiet enough to count as inactive. */
  async function staleAssignment(): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projectAssignments).values({
      id,
      projectId,
      talentId,
      workPackageId: packageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
    await handle.db.execute(
      sql`UPDATE project_assignments SET created_at = now() - interval '30 days' WHERE id = ${id}`,
    )
    return id
  }

  async function overdueMilestone(title: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestones).values({
      id,
      projectId,
      workPackageId: packageId,
      assignedTalentId: talentId,
      title,
      description: 'Submitted and forgotten',
      orderIndex: 0,
      amount: 5_000_000,
      status: 'submitted',
      submittedAt: new Date(Date.now() - 20 * 24 * HOUR),
      dueDate: new Date(Date.now() - 25 * 24 * HOUR),
    })
    return id
  }

  describe('the schedule itself', () => {
    it('registers the three intervals and the boot pass at their documented periods', () => {
      const schedule = captureSchedule()

      expect(
        schedule
          .filter((s) => s.kind === 'interval')
          .map((s) => s.ms)
          .sort((a, b) => a - b),
      ).toEqual([HOUR, SIX_HOURS, SIX_HOURS])
      expect(schedule.filter((s) => s.kind === 'timeout').map((s) => s.ms)).toEqual([BOOT_DELAY])
    })

    it('clears every timer on shutdown', () => {
      const cleared: unknown[] = []
      startScheduledJobs()
      vi.stubGlobal('clearInterval', (id: unknown) => cleared.push(id))
      try {
        stopScheduledJobs()
      } finally {
        vi.unstubAllGlobals()
      }

      expect(cleared).toHaveLength(3)
    })

    it('is safe to stop twice', () => {
      startScheduledJobs()
      stopScheduledJobs()

      expect(() => stopScheduledJobs()).not.toThrow()
    })
  })

  describe('penalty jobs', () => {
    it('warns about a talent who has been silent past the inactivity window', async () => {
      await staleAssignment()

      await boot()

      expect(await eventTypes()).toContainEqual({ type: 'talent.inactive_warning' })
    })

    it('leaves a talent with recent milestone activity alone', async () => {
      await staleAssignment()
      await handle.db.insert(milestones).values({
        id: uuidv7(),
        projectId,
        workPackageId: packageId,
        assignedTalentId: talentId,
        title: 'Milestone one',
        description: 'Recent work',
        orderIndex: 0,
        amount: 1_000_000,
        dueDate: new Date(Date.now() + 86_400_000),
      })

      await boot()

      expect(await eventTypes()).not.toContainEqual({ type: 'talent.inactive_warning' })
    })

    /** Abandonment costs pemerataan standing, which is how the queue rebalances. */
    it('penalises a recently terminated assignment and records why', async () => {
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId: packageId,
        acceptanceStatus: 'accepted',
        status: 'terminated',
        completedAt: new Date(Date.now() - HOUR),
      })

      await boot()

      const [profile] = await handle.db
        .select({ penalty: talentProfiles.pemerataanPenalty })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, talentId))
      expect(profile?.penalty).toBeCloseTo(0.5)
      expect(await eventTypes()).toContainEqual({ type: 'talent.abandon_penalized' })
    })

    it('ignores a termination older than the lookback window', async () => {
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId: packageId,
        acceptanceStatus: 'accepted',
        status: 'terminated',
        completedAt: new Date(Date.now() - 48 * HOUR),
      })

      await boot()

      const [profile] = await handle.db
        .select({ penalty: talentProfiles.pemerataanPenalty })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, talentId))
      expect(profile?.penalty).toBe(0)
    })
  })

  describe('auto-release sweep', () => {
    /**
     * The reconciliation pass behind the Temporal timer. A milestone whose
     * 14 day review window expired gets approved and paid without the owner.
     */
    it('auto-releases a milestone whose review window has expired', async () => {
      const milestoneId = await overdueMilestone('Milestone one')

      await boot()

      const [row] = await handle.db
        .select({ status: milestones.status })
        .from(milestones)
        .where(eq(milestones.id, milestoneId))
      expect(row?.status).toBe('approved')
      expect(await eventTypes()).toContainEqual({ type: 'milestone.auto_released' })
      expect(calls.some((c) => c.includes('/payments/release'))).toBe(true)
    })

    it('leaves a milestone inside its review window submitted and unpaid', async () => {
      const milestoneId = uuidv7()
      await handle.db.insert(milestones).values({
        id: milestoneId,
        projectId,
        workPackageId: packageId,
        assignedTalentId: talentId,
        title: 'Milestone one',
        description: 'Submitted yesterday',
        orderIndex: 0,
        amount: 5_000_000,
        status: 'submitted',
        submittedAt: new Date(Date.now() - 24 * HOUR),
        dueDate: new Date(Date.now() + 5 * 24 * HOUR),
      })

      await boot()

      const [row] = await handle.db
        .select({ status: milestones.status })
        .from(milestones)
        .where(eq(milestones.id, milestoneId))
      expect(row?.status).toBe('submitted')
      expect(calls.some((c) => c.includes('/payments/release'))).toBe(false)
    })

    it('runs on its own hourly interval, separately from the six-hourly jobs', async () => {
      const milestoneId = await overdueMilestone('Late arrival')
      const schedule = captureSchedule()
      const hourly = schedule.find((s) => s.kind === 'interval' && s.ms === HOUR)
      if (!hourly) throw new Error('no hourly interval scheduled')

      await hourly.run()

      const [row] = await handle.db
        .select({ status: milestones.status })
        .from(milestones)
        .where(eq(milestones.id, milestoneId))
      expect(row?.status).toBe('approved')
      // The hourly job touches payments only; it does not re-run the backfill.
      expect(calls.some((c) => c.includes('backfill-skill-embeddings'))).toBe(false)
    })
  })

  describe('embedding backfill', () => {
    /**
     * An approved document with no embedding drops out of the RAG corpus
     * silently, because ai-service only ever reacts to the event.
     */
    it('re-requests embeddings for approved documents that never got one', async () => {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { summary: 'stranded' },
        price: 500_000,
        status: 'approved',
      })
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { stack: 'stranded' },
        price: 1_500_000,
        status: 'approved',
      })

      await boot()

      const types = await eventTypes()
      expect(types).toContainEqual({ type: 'ai.brd.embed_requested' })
      expect(types).toContainEqual({ type: 'ai.prd.embed_requested' })
    })

    it('leaves a draft document out of the backfill', async () => {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { summary: 'not ready' },
        price: 500_000,
        status: 'draft',
      })

      await boot()

      expect(await eventTypes()).not.toContainEqual({ type: 'ai.brd.embed_requested' })
    })

    it('asks ai-service to backfill skill embeddings once per pass', async () => {
      await boot()

      expect(calls.filter((c) => c.includes('backfill-skill-embeddings'))).toHaveLength(1)
    })

    it('pairs the document and skill backfills on the same six-hourly interval', async () => {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { summary: 'stranded' },
        price: 500_000,
        status: 'approved',
      })
      const schedule = captureSchedule()
      const sixHourly = schedule.filter((s) => s.kind === 'interval' && s.ms === SIX_HOURS)

      for (const job of sixHourly) await job.run()

      expect(calls.filter((c) => c.includes('backfill-skill-embeddings'))).toHaveLength(1)
      expect(await eventTypes()).toContainEqual({ type: 'ai.brd.embed_requested' })
    })
  })

  /** One failing job must not strand the rest of the pass. */
  describe('failure isolation', () => {
    it('still runs the database jobs when ai-service is down', async () => {
      globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url))
        return new Response('upstream down', { status: 500 })
      }) as typeof globalThis.fetch
      await staleAssignment()

      await boot()

      expect(await eventTypes()).toContainEqual({ type: 'talent.inactive_warning' })
    })

    it('still warns about inactivity when the payment service refuses a release', async () => {
      globalThis.fetch = (async (url: string | URL | Request) => {
        const href = String(url)
        calls.push(href)
        if (href.includes('/payments/')) return new Response('nope', { status: 500 })
        return new Response(JSON.stringify({ written: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof globalThis.fetch
      await staleAssignment()
      const milestoneId = await overdueMilestone('Will not settle')
      // findInactiveTalents reads milestones.updated_at as activity, so a
      // freshly inserted row would make this talent look busy.
      await handle.db.execute(
        sql`UPDATE milestones SET updated_at = now() - interval '30 days' WHERE id = ${milestoneId}`,
      )

      await boot()

      expect(await eventTypes()).toContainEqual({ type: 'talent.inactive_warning' })
    })
  })
})
