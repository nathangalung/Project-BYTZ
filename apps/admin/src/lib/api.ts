// Admin API client. Every admin endpoint is cookie-authenticated and answers
// { success, data } or { success, error }.

export type QueryParams = Record<string, string | number | undefined>

export type ListPage<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

type Envelope<T> = {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

export function apiUrl(path: string, params?: QueryParams): string {
  if (!params) return path
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  // Mutations may answer 204 with no body, so a parse failure is not an error.
  const body = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || body?.success === false) {
    // The server's reason is the actionable one; the status covers non-JSON failures.
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`)
  }
  return body?.data as T
}

export function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  return request<T>(apiUrl(path, params), { method: 'GET' })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
