import { aiInteractions, getDb, user } from '@kerjacus/db'
import { SYSTEM_SUBJECTS } from '@kerjacus/nats-events'
import { TALENT_INACTIVITY_WARNING_DAYS } from '@kerjacus/shared'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { notifyAutoRelease, releaseEscrow } from '../activities/milestone.activities'
import { env } from '../lib/env'
import { serviceFetch, TIMEOUT_MS } from '../lib/http/service-fetch'
import { appendOutboxEvent } from '../lib/outbox'
import { settleMilestoneEscrow } from '../lib/settle-milestone'
import {
  hasTeamFormationWorkflow,
  startTeamFormationWorkflow,
} from '../lib/team-formation-workflow'
import { MatchingRepository } from '../repositories/matching.repository'
import { MilestoneRepository } from '../repositories/milestone.repository'
import { ProjectRepository } from '../repositories/project.repository'
import { AiHealthSweepService, runAiHealthSweep } from './ai-health-sweep'
import { AutoReleaseSweepService, runAutoReleaseSweep } from './auto-release-sweep'
import { runEmbeddingBackfill } from './embedding-backfill'
import {
  MilestoneDeadlineSweepService,
  runMilestoneDeadlineSweep,
} from './milestone-deadline-sweep'
import { type OutboxPublisher, PenaltyService } from './penalty.service'
import { runTeamFormationSweep, TeamFormationSweepService } from './team-formation-sweep'

// NOTE: Milestone auto-release (14-day timer) is driven by the Temporal workflow
// `milestoneAutoReleaseWorkflow`, started from the milestones route when a
// milestone transitions to 'submitted'. The sweep below only reconciles
// milestones whose workflow was never started or died -- it shares the same
// compare-and-swap release, so it cannot double-process a live workflow.

// Outbox publisher backed by direct DB insert into outbox_events.
function createDbOutboxPublisher(): OutboxPublisher {
  return {
    async publish(event) {
      await appendOutboxEvent(getDb(), {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
      })
    },
  }
}

let penaltyIntervalId: ReturnType<typeof setInterval> | null = null
let autoReleaseIntervalId: ReturnType<typeof setInterval> | null = null
let embeddingBackfillIntervalId: ReturnType<typeof setInterval> | null = null
let teamFormationIntervalId: ReturnType<typeof setInterval> | null = null
let aiHealthIntervalId: ReturnType<typeof setInterval> | null = null
let deadlineIntervalId: ReturnType<typeof setInterval> | null = null

export function startScheduledJobs() {
  const HOUR = 60 * 60 * 1000
  const SIX_HOURS = 6 * HOUR

  const matchingRepo = new MatchingRepository(getDb())
  const penaltyService = new PenaltyService(matchingRepo, createDbOutboxPublisher())
  const deadlineSweep = new MilestoneDeadlineSweepService(new MilestoneRepository(getDb()))
  const sweepService = new AutoReleaseSweepService(
    new MilestoneRepository(getDb()),
    settleMilestoneEscrow,
    releaseEscrow,
    notifyAutoRelease,
  )
  const projectRepo = new ProjectRepository(getDb())
  const aiHealthSweep = new AiHealthSweepService(
    async (since) => {
      const rows = await getDb()
        .select({ status: aiInteractions.status, count: sql<number>`count(*)::int` })
        .from(aiInteractions)
        .where(gte(aiInteractions.createdAt, since))
        .groupBy(aiInteractions.status)
      let success = 0
      let error = 0
      for (const row of rows) {
        if (row.status === 'success') success += row.count
        else error += row.count
      }
      return { success, error }
    },
    async () => {
      const rows = await getDb()
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, 'admin'), isNull(user.deletedAt)))
      return rows.map((r) => r.id)
    },
    async (userId, title, message) => {
      // notification.send is the generic trigger notification-service already
      // handles, so this needs no new subject or consumer branch.
      await appendOutboxEvent(getDb(), {
        aggregateType: 'system',
        aggregateId: userId,
        eventType: SYSTEM_SUBJECTS.NOTIFICATION_SEND,
        payload: { userId, type: 'system', title, message, channels: ['in_app'] },
      })
    },
  )
  const teamFormationSweep = new TeamFormationSweepService(
    (limit) => projectRepo.findStalledTeamFormation(limit),
    hasTeamFormationWorkflow,
    startTeamFormationWorkflow,
  )

  const runPenaltyJobs = async () => {
    try {
      const inactiveCount = await penaltyService.processInactiveTalents(
        TALENT_INACTIVITY_WARNING_DAYS,
      )
      if (inactiveCount > 0) {
        console.log(`[Scheduler] Issued ${inactiveCount} inactivity warning(s)`)
      }
    } catch (err) {
      console.error('[Scheduler] Inactive talent scan failed:', err)
    }
    try {
      const abandonCount = await penaltyService.processAbandons(6)
      if (abandonCount > 0) {
        console.log(`[Scheduler] Penalized ${abandonCount} abandoned assignment(s)`)
      }
    } catch (err) {
      console.error('[Scheduler] Abandon penalty job failed:', err)
    }
  }

  const runAutoReleaseJob = async () => {
    try {
      const result = await runAutoReleaseSweep(sweepService)
      // null means another replica holds the lease; not an error.
      if (result && (result.settled > 0 || result.failed > 0)) {
        console.log(
          `[Scheduler] Auto-release sweep settled ${result.settled}, failed ${result.failed}`,
        )
      }
    } catch (err) {
      console.error('[Scheduler] Auto-release sweep failed:', err)
    }
  }

  const runDeadlineJob = async () => {
    try {
      const result = await runMilestoneDeadlineSweep(deadlineSweep)
      // null means another replica holds the lease; not an error.
      if (result && (result.overdue > 0 || result.dueSoon > 0 || result.failed > 0)) {
        console.log(
          `[Scheduler] Deadline sweep overdue ${result.overdue}, due soon ${result.dueSoon}, failed ${result.failed}`,
        )
      }
    } catch (err) {
      console.error('[Scheduler] Deadline sweep failed:', err)
    }
  }

  const runTeamFormationJob = async () => {
    try {
      const result = await runTeamFormationSweep(teamFormationSweep)
      // null means another replica holds the lease; not an error.
      if (result && (result.started > 0 || result.failed > 0)) {
        console.log(
          `[Scheduler] Team formation sweep started ${result.started}, failed ${result.failed}`,
        )
      }
    } catch (err) {
      console.error('[Scheduler] Team formation sweep failed:', err)
    }
  }

  const runAiHealthJob = async () => {
    try {
      const result = await runAiHealthSweep(aiHealthSweep)
      if (result && result.alerted > 0) {
        console.warn(
          `[Scheduler] AI health: ${result.errorCount} failed, ${result.successCount} ok; ` +
            `alerted ${result.alerted} admin(s)`,
        )
      }
    } catch (err) {
      console.error('[Scheduler] AI health sweep failed:', err)
    }
  }

  const runSkillEmbeddingJob = async () => {
    try {
      const res = await serviceFetch(
        `${env.AI_SERVICE_URL}/api/v1/ai/backfill-skill-embeddings`,
        { method: 'POST' },
        { service: 'ai-service', timeoutMs: TIMEOUT_MS.chat },
      )
      const body = (await res.json()) as { written?: number }
      if (body.written) {
        console.log(`[Scheduler] Embedded ${body.written} skill(s)`)
      }
    } catch (err) {
      console.error('[Scheduler] Skill embedding backfill failed:', err)
    }
  }

  const runEmbeddingBackfillJob = async () => {
    try {
      const { brd, prd } = await runEmbeddingBackfill()
      if (brd > 0 || prd > 0) {
        console.log(`[Scheduler] Re-requested embeddings for ${brd} BRD, ${prd} PRD`)
      }
    } catch (err) {
      console.error('[Scheduler] Embedding backfill failed:', err)
    }
  }

  penaltyIntervalId = setInterval(runPenaltyJobs, SIX_HOURS)
  autoReleaseIntervalId = setInterval(runAutoReleaseJob, HOUR)
  deadlineIntervalId = setInterval(runDeadlineJob, HOUR)
  teamFormationIntervalId = setInterval(runTeamFormationJob, HOUR)
  aiHealthIntervalId = setInterval(runAiHealthJob, HOUR)
  embeddingBackfillIntervalId = setInterval(async () => {
    await runEmbeddingBackfillJob()
    await runSkillEmbeddingJob()
  }, SIX_HOURS)

  // Initial run after 30s so service boot has time to settle.
  setTimeout(async () => {
    await runPenaltyJobs()
    await runAutoReleaseJob()
    await runDeadlineJob()
    await runTeamFormationJob()
    await runAiHealthJob()
    await runEmbeddingBackfillJob()
    await runSkillEmbeddingJob()
  }, 30_000)

  console.log(
    '[Scheduler] Started (penalty every 6h; auto-release, team-formation and ai-health ' +
      'sweeps every 1h; embedding backfill every 6h)',
  )
}

export function stopScheduledJobs() {
  if (penaltyIntervalId) {
    clearInterval(penaltyIntervalId)
    penaltyIntervalId = null
  }
  if (aiHealthIntervalId) {
    clearInterval(aiHealthIntervalId)
    aiHealthIntervalId = null
  }
  if (teamFormationIntervalId) {
    clearInterval(teamFormationIntervalId)
    teamFormationIntervalId = null
  }
  if (autoReleaseIntervalId) {
    clearInterval(autoReleaseIntervalId)
    autoReleaseIntervalId = null
  }
  if (deadlineIntervalId) {
    clearInterval(deadlineIntervalId)
    deadlineIntervalId = null
  }
  if (embeddingBackfillIntervalId) {
    clearInterval(embeddingBackfillIntervalId)
    embeddingBackfillIntervalId = null
  }
}
