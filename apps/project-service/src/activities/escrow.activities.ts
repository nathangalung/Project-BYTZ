import { getDb, projects } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { appendOutboxEvent } from '../lib/outbox'

/** Reserve escrow funds for a project (emits outbox event for payment-service). */
export async function reserveEscrow(input: {
  projectId: string
  amount: number
}): Promise<{ reserved: boolean }> {
  await appendOutboxEvent(getDb(), {
    aggregateType: 'project',
    aggregateId: input.projectId,
    eventType: 'payment.escrow.requested',
    payload: { projectId: input.projectId, amount: input.amount, source: 'temporal' },
  })
  return { reserved: true }
}

/** Compensating action: refund escrow when downstream step fails. */
export async function refundEscrow(input: {
  projectId: string
  amount: number
  reason: string
}): Promise<void> {
  await appendOutboxEvent(getDb(), {
    aggregateType: 'project',
    aggregateId: input.projectId,
    eventType: 'payment.refund.requested',
    payload: { ...input, source: 'temporal_compensation' },
  })
}

/** Update project status as part of saga. Returns false if no row updated. */
export async function setProjectStatus(input: {
  projectId: string
  status: 'in_progress' | 'matched'
}): Promise<{ updated: boolean }> {
  const db = getDb()
  const result = await db
    .update(projects)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(projects.id, input.projectId))
    .returning({ id: projects.id })
  return { updated: result.length > 0 }
}

/** Emit notification outbox event for saga completion. */
export async function notifySagaComplete(input: {
  projectId: string
  event: string
}): Promise<void> {
  await appendOutboxEvent(getDb(), {
    aggregateType: 'project',
    aggregateId: input.projectId,
    eventType: input.event,
    payload: { ...input, source: 'temporal' },
  })
}
