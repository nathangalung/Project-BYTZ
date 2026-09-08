import { API_BASE_URL, apiUrl, resolveUrl } from './api-url'
import { localizeErrorCode } from './error-messages'
import { isSessionEnded } from './session-ended'

// Re-exported so existing importers keep one import site.
export { API_BASE_URL, apiUrl }

/**
 * How long a request may stay unanswered before it is called a failure.
 *
 * fetch has no timeout of its own, so a connection that is accepted and never
 * answered - a service wedged on a query, an exhausted connection pool - left
 * every TanStack query pending forever. Pending has no error state and no
 * bound, which is what "the chart just keeps loading" is: not a slow request,
 * a request with nothing to end it.
 */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * The ceiling for work the server itself budgets a minute for.
 *
 * A client deadline has to sit ABOVE the server's, never below it. BRD
 * generation is measured at 34s against a 60s server budget, and the owner's
 * generation slot is claimed before the model is called - so a client that
 * gave up first would spend that slot on a document it then reported as
 * failed, which is the one thing document-generation.ts promises not to do.
 */
export const GENERATION_TIMEOUT_MS = 90_000

export const TIMEOUT_ERROR_CODE = 'REQUEST_TIMEOUT'

export type ApiFetchOptions = RequestInit & { timeoutMs?: number }

export async function apiFetch<T = unknown>(url: string, options?: ApiFetchOptions): Promise<T> {
  // A caller that brought its own signal owns its own deadline.
  const controller = options?.signal ? null : new AbortController()
  const timer = controller
    ? setTimeout(
        () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
        options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
      )
    : null

  let res: Response
  try {
    res = await fetch(resolveUrl(url), {
      ...options,
      signal: options?.signal ?? controller?.signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new ApiError(localizeErrorCode(TIMEOUT_ERROR_CODE), 408, TIMEOUT_ERROR_CODE)
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!res.ok) {
    // Message comes from the code, never from the server body: the body is one
    // hardcoded language and carries upstream detail users should not see.
    const errorBody = await res.json().catch(() => null)
    const code: string = errorBody?.error?.code ?? 'UNKNOWN_ERROR'

    if (isSessionEnded(res.status, errorBody)) {
      const { useAuthStore } = await import('@/stores/auth')
      void useAuthStore.getState().logout()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      throw new ApiError(localizeErrorCode('AUTH_SESSION_EXPIRED'), res.status, code)
    }

    throw new ApiError(localizeErrorCode(code), res.status, code)
  }

  return res.json() as Promise<T>
}

/**
 * For direct fetch() calls that need the API base URL.
 * Use this instead of hardcoding /api/v1/...
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Only a 404 means the thing is not there.
 *
 * The pages that load one project by id read a failed query as "project not
 * found", which turns a dropped request into an affirmative claim that the
 * owner's project does not exist. Same reasoning as the Go session middleware:
 * only the status that actually says "refused" is allowed to mean it, and
 * everything else means the question could not be answered.
 */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
