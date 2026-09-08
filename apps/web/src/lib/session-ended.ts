/**
 * The answers that mean this session is over, as opposed to unreachable.
 *
 * Signing out is destructive: it drops the page, the in-flight work and
 * anything the owner had not sent yet. So it may only follow a response that
 * actually says "you are not signed in" - the auth service names the reason in
 * `error.code`, and nothing else is allowed to mean it. A 429 from the shared
 * rate limiter, a 500 because the session lookup hit the database, a 502 while
 * a service restarts and a dropped connection all mean the question could not
 * be answered, which is not the same answer as no.
 *
 * AUTH_FORBIDDEN is deliberately NOT here. Every service raises it for
 * ordinary authorization - "not authorized to view project tasks" - and ending
 * the session on that would sign people out for opening the wrong page.
 */
export const SESSION_ENDED_CODES: ReadonlySet<string> = new Set([
  'AUTH_UNAUTHORIZED',
  'AUTH_SESSION_EXPIRED',
])

/** Reads the error code out of the standard envelope. */
export function errorCodeOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function isSessionEnded(status: number, body: unknown): boolean {
  if (status !== 401) return false
  const code = errorCodeOf(body)
  return code !== null && SESSION_ENDED_CODES.has(code)
}
