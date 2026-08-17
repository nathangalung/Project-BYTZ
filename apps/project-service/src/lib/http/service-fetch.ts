import { captureTraceContext } from '@kerjacus/logger'
import { isBrokenCircuitError } from 'cockatiel'
import { makeServicePolicy } from '../resilience'
import { withServiceAuth } from '../service-auth'
import { UpstreamError, type UpstreamService } from './upstream-error'

/**
 * Per-attempt budgets. Payments are fast; document generation is not.
 *
 * `stream` is deliberately generous. The signal passed to fetch covers the
 * whole response including the body, so for a streamed SSE reply the deadline
 * bounds the entire generation, not the time to first byte. A tight value
 * would cut long chat completions off mid-stream; this is a safety net against
 * a hung upstream, which is still strictly better than the unbounded wait it
 * replaces.
 */
export const TIMEOUT_MS = {
  payment: 10_000,
  chat: 30_000,
  cvParse: 30_000,
  document: 60_000,
  stream: 180_000,
} as const

type ServiceFetchOptions = {
  /** Names the breaker. One circuit per downstream service. */
  service: UpstreamService
  /** Per-attempt budget, not a total budget across retries. */
  timeoutMs: number
  /**
   * Opt in only where the upstream is idempotent.
   *
   * /payments/release and /payments/refund carry an idempotency key, so a
   * retry replays rather than double-paying. /generate-brd does not: a retry
   * is a second billed Gemini call that also burns a slot in the owner's
   * free-generation quota.
   */
  retryTransient?: boolean
  /** Caller cancellation - request abort, SSE unmount. Distinct from timeout. */
  signal?: AbortSignal
}

// Body is a string so a retry can replay it; a stream body cannot be re-read.
type ServiceFetchInit = Omit<RequestInit, 'signal' | 'body'> & { body?: string }

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body?.error?.message ?? ''
  } catch {
    // Non-JSON error body; the status alone has to do.
    return ''
  }
}

/**
 * The one way project-service talks to another service.
 *
 * Every call gets a deadline, a circuit and W3C trace context. Previously
 * eight of nine outbound calls had none of the three: a hung ai-service could
 * pin request handlers on the single project-service instance indefinitely,
 * and a slow BRD generation could not be followed into the ai-service span
 * even though the NATS path has propagated trace context all along.
 */
export async function serviceFetch(
  url: string,
  init: ServiceFetchInit,
  opts: ServiceFetchOptions,
): Promise<Response> {
  const policy = makeServicePolicy(opts.service, opts.retryTransient === true)
  const headers = withServiceAuth({
    ...(init.headers as Record<string, string> | undefined),
    // Same carrier the outbox uses, so HTTP and NATS spans join up.
    ...(captureTraceContext() ?? {}),
  })

  try {
    return await policy.execute(async () => {
      // Built per attempt: a signal created once outside the policy would
      // already be aborted by the time a second attempt ran.
      const deadline = AbortSignal.timeout(opts.timeoutMs)
      const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline

      let res: Response
      try {
        res = await fetch(url, { ...init, headers, signal })
      } catch (cause) {
        // Caller cancellation is not an upstream fault and must not trip the
        // breaker - an owner navigating away from a streaming chat is normal.
        if (opts.signal?.aborted) throw cause
        const reason = cause instanceof Error ? cause.message : 'transport failure'
        throw new UpstreamError(opts.service, null, reason)
      }

      if (!res.ok) {
        throw new UpstreamError(opts.service, res.status, await readErrorDetail(res))
      }
      return res
    })
  } catch (err) {
    // An open circuit is a fast local rejection, not an upstream response.
    if (isBrokenCircuitError(err)) {
      throw new UpstreamError(opts.service, null, 'circuit open')
    }
    throw err
  }
}
