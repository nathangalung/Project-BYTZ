import {
  ConsecutiveBreaker,
  circuitBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  wrap,
} from 'cockatiel'

export function makeResilientPolicy(_serviceName: string) {
  const retryPolicy = retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({ initialDelay: 1000, maxDelay: 8000 }),
  })
  const breaker = circuitBreaker(handleAll, {
    halfOpenAfter: 30_000,
    breaker: new ConsecutiveBreaker(5),
  })
  return wrap(retryPolicy, breaker)
}
