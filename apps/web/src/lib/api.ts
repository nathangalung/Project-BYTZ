import { API_BASE_URL, apiUrl, resolveUrl } from './api-url'
import { localizeErrorCode } from './error-messages'

// Re-exported so existing importers keep one import site.
export { API_BASE_URL, apiUrl }

/**
 * The codes that mean this session is over, as opposed to unreachable.
 *
 * Signing out is destructive: it drops the page, the in-flight work and
 * anything the owner had not sent yet. Doing it for every 401 meant any
 * response that happened to carry that status ended the session, including
 * ones from services that were merely refusing to answer right now. A 401
 * whose body does not name one of these is reported like any other error, and
 * the caller can retry.
 */
const SESSION_ENDED_CODES = new Set(['AUTH_UNAUTHORIZED', 'AUTH_SESSION_EXPIRED'])

export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(resolveUrl(url), {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    // Message comes from the code, never from the server body: the body is one
    // hardcoded language and carries upstream detail users should not see.
    const errorBody = await res.json().catch(() => null)
    const code: string = errorBody?.error?.code ?? 'UNKNOWN_ERROR'

    if (res.status === 401 && SESSION_ENDED_CODES.has(code)) {
      const { useAuthStore } = await import('@/stores/auth')
      useAuthStore.getState().logout()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      throw new ApiError(localizeErrorCode('AUTH_SESSION_EXPIRED'), 401, 'AUTH_SESSION_EXPIRED')
    }

    throw new ApiError(localizeErrorCode(code), res.status, code)
  }

  return res.json() as Promise<T>
}

export async function apiFetchSafe<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T | null> {
  try {
    return await apiFetch<T>(url, options)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
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
