import { hc } from 'hono/client'

export const apiClient = hc('/')

export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    // On 401, clear auth state and redirect to login
    if (res.status === 401) {
      const { useAuthStore } = await import('@/stores/auth')
      useAuthStore.getState().logout()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      throw new ApiError('Session expired', 401, 'AUTH_SESSION_EXPIRED')
    }

    const errorBody = await res.json().catch(() => null)
    const message = errorBody?.error?.message ?? `Request failed: ${res.status}`
    const code = errorBody?.error?.code ?? 'UNKNOWN_ERROR'
    throw new ApiError(message, res.status, code)
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
