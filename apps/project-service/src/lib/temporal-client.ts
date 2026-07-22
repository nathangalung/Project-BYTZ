import { Client, Connection } from '@temporalio/client'
import { env } from './env'

let cachedClient: Client | null = null

/**
 * Cached Temporal client, or null if the connection fails.
 *
 * Null is deliberate: a milestone submission must still succeed when Temporal is
 * unreachable. But every call site does `if (!client) return`, so a failure here
 * silently skips starting a workflow - and the workflows are escrow auto-release,
 * dispute resolution and team formation. This logs at error, not warn, because
 * the visible consequence is that a talent never gets paid.
 */
export async function getTemporalClient(): Promise<Client | null> {
  if (cachedClient) return cachedClient
  try {
    const connection = await Connection.connect({ address: env.TEMPORAL_URL })
    cachedClient = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE })
    return cachedClient
  } catch (err) {
    console.error(
      `[temporal-client] connect to ${env.TEMPORAL_URL} ns=${env.TEMPORAL_NAMESPACE} failed; ` +
        'auto-release, dispute and team-formation workflows will NOT be started:',
      err,
    )
    return null
  }
}

export const TEMPORAL_TASK_QUEUE = env.TEMPORAL_TASK_QUEUE

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
