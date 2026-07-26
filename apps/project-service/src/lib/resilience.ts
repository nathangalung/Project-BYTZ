import {
  ConsecutiveBreaker,
  circuitBreaker,
  ExponentialBackoff,
  handleWhen,
  type IPolicy,
  retry,
  wrap,
} from 'cockatiel'
import { UpstreamError } from './http/upstream-error'

/**
 * Only transient faults count.
 *
 * The previous policy used handleAll, so a deterministic 400 from
 * /payments/release was retried three times with exponential backoff before
 * failing - about eleven seconds of held capacity per malformed request, and
 * five such requests would trip the breaker for a downstream that is healthy.
 */
const handleTransient = handleWhen((err) => err instanceof UpstreamError && err.retryable)

/**
 * One breaker per downstream.
 *
 * The old signature took a service name and ignored it, so every caller shared
 * a single policy instance: ai-service tripping the breaker would also reject
 * payment-service calls. Keyed maps keep the circuits independent.
 */
const breakers = new Map<string, IPolicy>()
const retryingPolicies = new Map<string, IPolicy>()

function breakerFor(service: string): IPolicy {
  const existing = breakers.get(service)
  if (existing) return existing
  const policy = circuitBreaker(handleTransient, {
    halfOpenAfter: 30_000,
    breaker: new ConsecutiveBreaker(5),
  })
  breakers.set(service, policy)
  return policy
}

export function makeServicePolicy(service: string, retryTransient: boolean): IPolicy {
  if (!retryTransient) return breakerFor(service)

  const existing = retryingPolicies.get(service)
  if (existing) return existing
  // ExponentialBackoff already applies decorrelated jitter by default.
  const policy = wrap(
    retry(handleTransient, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({ initialDelay: 1000, maxDelay: 8000 }),
    }),
    breakerFor(service),
  )
  retryingPolicies.set(service, policy)
  return policy
}

/** Test seam: circuits are process-wide, so suites must not inherit each other's state. */
export function resetServicePolicies(): void {
  breakers.clear()
  retryingPolicies.clear()
}
