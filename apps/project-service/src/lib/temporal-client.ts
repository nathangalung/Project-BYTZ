import { Client, Connection } from '@temporalio/client'

let cachedClient: Client | null = null

/** Cached Temporal client. Returns null if connection fails (Temporal is optional). */
export async function getTemporalClient(): Promise<Client | null> {
  if (cachedClient) return cachedClient
  try {
    const address = process.env.TEMPORAL_URL || 'localhost:7233'
    const namespace = process.env.TEMPORAL_NAMESPACE || 'kerjacus'
    const connection = await Connection.connect({ address })
    cachedClient = new Client({ connection, namespace })
    return cachedClient
  } catch (err) {
    console.warn('[temporal-client] connect failed (Temporal optional):', err)
    return null
  }
}

export const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'project-service'

/** Build a stable workflow ID for milestone auto-release. */
export function milestoneAutoReleaseWorkflowId(milestoneId: string): string {
  return `auto-release-${milestoneId}`
}

/** Build a stable workflow ID for dispute resolution. */
export function disputeResolutionWorkflowId(disputeId: string): string {
  return `dispute-${disputeId}`
}

/** Build a stable workflow ID for team formation. */
export function teamFormationWorkflowId(projectId: string): string {
  return `team-formation-${projectId}`
}

/** Build a stable workflow ID for the escrow saga. */
export function escrowSagaWorkflowId(projectId: string): string {
  return `escrow-saga-${projectId}`
}
