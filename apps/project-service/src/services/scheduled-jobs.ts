import { getDb, milestones, outboxEvents } from '@kerjacus/db'
import { AUTO_RELEASE_DAYS, TALENT_INACTIVITY_WARNING_DAYS } from '@kerjacus/shared'
import { and, eq, lt, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

/** Auto-approve milestones submitted > 14 days ago */
async function checkAutoRelease() {
  const db = getDb()
  const cutoff = new Date(Date.now() - AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000)

  const overdue = await db
    .select({
      id: milestones.id,
      projectId: milestones.projectId,
      assignedTalentId: milestones.assignedTalentId,
      amount: milestones.amount,
    })
    .from(milestones)
    .where(and(eq(milestones.status, 'submitted'), lt(milestones.submittedAt, cutoff)))

  for (const ms of overdue) {
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(milestones)
          .set({ status: 'approved', completedAt: new Date(), updatedAt: new Date() })
          .where(eq(milestones.id, ms.id))

        await tx.insert(outboxEvents).values({
          id: uuidv7(),
          aggregateType: 'milestone',
          aggregateId: ms.id,
          eventType: 'milestone.auto_released',
          payload: {
            milestoneId: ms.id,
            projectId: ms.projectId,
            talentId: ms.assignedTalentId,
            amount: ms.amount,
          },
        })
      })
      console.log(`[Scheduler] Auto-released milestone ${ms.id}`)
    } catch (err) {
      console.error(`[Scheduler] Auto-release failed for ${ms.id}:`, err)
    }
  }
}

/** Warn talents inactive for 7+ days on active projects */
async function checkTalentInactivity() {
  const db = getDb()
  const cutoff = new Date(
    Date.now() - TALENT_INACTIVITY_WARNING_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const inactive = await db.execute(sql`
    SELECT pa.id, pa.project_id, pa.talent_id, tp.user_id
    FROM project_assignments pa
    JOIN talent_profiles tp ON tp.id = pa.talent_id
    WHERE pa.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM time_logs tl
      JOIN tasks t ON t.id = tl.task_id
      JOIN milestones m ON m.id = t.milestone_id
      WHERE m.project_id = pa.project_id
      AND tl.talent_id = pa.talent_id
      AND tl.started_at > ${cutoff}
    )
    AND NOT EXISTS (
      SELECT 1 FROM milestones m2
      WHERE m2.project_id = pa.project_id
      AND m2.assigned_talent_id = pa.talent_id
      AND m2.updated_at > ${cutoff}
    )
  `)

  for (const row of inactive as unknown as Array<Record<string, unknown>>) {
    try {
      const r = row as { id: string; project_id: string; talent_id: string; user_id: string }
      await db.insert(outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'talent',
        aggregateId: r.talent_id,
        eventType: 'talent.inactive_warning',
        payload: {
          assignmentId: r.id,
          projectId: r.project_id,
          talentId: r.talent_id,
          userId: r.user_id,
          daysSinceLastActivity: TALENT_INACTIVITY_WARNING_DAYS,
        },
      })
      console.log(
        `[Scheduler] Inactivity warning: talent ${r.talent_id} on project ${r.project_id}`,
      )
    } catch (err) {
      console.error('[Scheduler] Inactivity check failed:', err)
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

export function startScheduledJobs() {
  const HOUR = 60 * 60 * 1000
  intervalId = setInterval(async () => {
    try {
      await checkAutoRelease()
      await checkTalentInactivity()
    } catch (err) {
      console.error('[Scheduler] Job failed:', err)
    }
  }, HOUR)

  // Initial run after 30s
  setTimeout(async () => {
    try {
      await checkAutoRelease()
      await checkTalentInactivity()
    } catch (err) {
      console.error('[Scheduler] Initial run failed:', err)
    }
  }, 30_000)

  console.log('[Scheduler] Started (hourly)')
}

export function stopScheduledJobs() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
