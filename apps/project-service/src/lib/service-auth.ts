/**
 * Inter-service authentication headers.
 *
 * Outbound calls to other internal services (ai-service, payment-service,
 * notification-service, admin-service) must carry the shared
 * `X-Service-Auth` secret. The Go services use constant-time compare on the
 * receiving end and reject anything else, so missing headers surface as 401s.
 */

import { env } from './env'

export function getServiceAuthHeader(): Record<string, string> {
  return { 'X-Service-Auth': env.SERVICE_AUTH_SECRET }
}

export function withServiceAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, ...getServiceAuthHeader() }
}
