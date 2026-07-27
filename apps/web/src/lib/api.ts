import { localizeErrorCode } from './error-messages'

/**
 * API base URL — empty in dev (Vite proxies), absolute in production.
 * Set via VITE_API_URL build arg (e.g. https://api.kerjacus.id)
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL as string) ?? ''

/**
 * Prepend API_BASE_URL to relative paths.
 * Absolute URLs are passed through unchanged.
 */
function resolveUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${API_BASE_URL}${url}`
}

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
    if (res.status === 401) {
      const { useAuthStore } = await import('@/stores/auth')
      useAuthStore.getState().logout()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      throw new ApiError(localizeErrorCode('AUTH_SESSION_EXPIRED'), 401, 'AUTH_SESSION_EXPIRED')
    }

    // Message comes from the code, never from the server body: the body is one
    // hardcoded language and carries upstream detail users should not see.
    const errorBody = await res.json().catch(() => null)
    const code = errorBody?.error?.code ?? 'UNKNOWN_ERROR'
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
export function apiUrl(path: string): string {
  return resolveUrl(path)
}

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
