// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logout = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: { getState: () => ({ logout }) },
}))

import { ApiError, apiFetch, apiFetchSafe } from './api'

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

function body(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status })
}

/** Return the ApiError a call rejected with, failing if it resolved instead. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  let caught: unknown
  let threw = false
  try {
    await promise
  } catch (err) {
    caught = err
    threw = true
  }
  if (!threw) throw new Error('expected the request to reject')
  return caught as ApiError
}

function setPath(pathname: string) {
  // jsdom forbids assigning window.location, so replace the descriptor.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname, href: `http://localhost${pathname}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setPath('/dashboard')
})

describe('apiFetch on success', () => {
  it('returns the parsed body', async () => {
    stubFetch(async () => body({ success: true, data: { id: 'p1' } }, 200))

    await expect(apiFetch('/api/v1/projects/p1')).resolves.toEqual({
      success: true,
      data: { id: 'p1' },
    })
  })

  /** The session cookie is the whole auth story, so it has to be sent. */
  it('always sends credentials and a JSON content type', async () => {
    const spy = stubFetch(async () => body({ success: true }, 200))

    await apiFetch('/api/v1/projects')

    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('lets a caller override the content type without losing credentials', async () => {
    const spy = stubFetch(async () => body({ success: true }, 200))

    await apiFetch('/api/v1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
    })

    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ 'Content-Type': 'text/plain' })
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
  })
})

/**
 * The server message is one hardcoded language and carries upstream detail, so
 * the thrown message is localized from the CODE instead. Asserting the code
 * and status is what callers branch on; the text only has to be human.
 */
describe('apiFetch on a failed response', () => {
  it('throws an ApiError carrying the server error code and status', async () => {
    stubFetch(async () =>
      body({ error: { code: 'PROJECT_NOT_FOUND', message: 'row 41 missing' } }, 404),
    )

    const err = await rejection(apiFetch('/api/v1/projects/x'))

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.code).toBe('PROJECT_NOT_FOUND')
  })

  it('never repeats the server message back to the user', async () => {
    stubFetch(async () =>
      body({ error: { code: 'PROJECT_NOT_FOUND', message: 'pg: relation does not exist' } }, 404),
    )

    const err = await rejection(apiFetch('/api/v1/projects/x'))

    expect(err.message).not.toContain('pg:')
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('falls back to UNKNOWN_ERROR when the body carries no code', async () => {
    stubFetch(async () => body({ nope: true }, 500))

    const err = await rejection(apiFetch('/api/v1/projects'))

    expect(err.code).toBe('UNKNOWN_ERROR')
    expect(err.status).toBe(500)
  })

  /** A gateway 502 answers with HTML, so the body parse has to be survivable. */
  it('survives an error response that is not JSON at all', async () => {
    stubFetch(async () => new Response('<html>bad gateway</html>', { status: 502 }))

    const err = await rejection(apiFetch('/api/v1/projects'))

    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('UNKNOWN_ERROR')
    expect(err.status).toBe(502)
  })
})

/**
 * An expired session must not leave the browser holding a signed-in shell
 * whose every request 401s. The store teardown is what clears the previous
 * account's cached data, so it has to run before the redirect.
 */
describe('apiFetch on 401', () => {
  it('signs the user out and sends them to the login page', async () => {
    stubFetch(async () => body({ error: { code: 'AUTH_SESSION_EXPIRED' } }, 401))

    const err = await rejection(apiFetch('/api/v1/projects'))

    expect(logout).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login')
    expect(err.code).toBe('AUTH_SESSION_EXPIRED')
    expect(err.status).toBe(401)
  })

  /** Redirecting from /login to /login is a reload loop on the login form. */
  it('does not redirect when the user is already on the login page', async () => {
    setPath('/login')
    stubFetch(async () => body({ error: { code: 'AUTH_SESSION_EXPIRED' } }, 401))

    await apiFetch('/api/v1/projects').catch(() => {})

    expect(logout).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('http://localhost/login')
  })

  it('reports the session code regardless of what the server body said', async () => {
    stubFetch(async () => body({ error: { code: 'SOMETHING_ELSE' } }, 401))

    const err = await rejection(apiFetch('/api/v1/projects'))

    expect(err.code).toBe('AUTH_SESSION_EXPIRED')
  })
})

/**
 * Public pages call endpoints that answer either way depending on whether a
 * session exists. They want "signed out" as data, not as a thrown error - but
 * a real failure still has to surface.
 */
describe('apiFetchSafe', () => {
  it('returns the body when the request succeeds', async () => {
    stubFetch(async () => body({ success: true, data: 1 }, 200))

    await expect(apiFetchSafe('/api/v1/me')).resolves.toEqual({ success: true, data: 1 })
  })

  it('returns null instead of throwing on 401', async () => {
    stubFetch(async () => body({ error: { code: 'AUTH_SESSION_EXPIRED' } }, 401))

    await expect(apiFetchSafe('/api/v1/me')).resolves.toBeNull()
  })

  it('still throws on any other failure', async () => {
    stubFetch(async () => body({ error: { code: 'PROJECT_NOT_FOUND' } }, 404))

    await expect(apiFetchSafe('/api/v1/projects/x')).rejects.toBeInstanceOf(ApiError)
  })

  it('still throws when the network is down', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(apiFetchSafe('/api/v1/me')).rejects.toBeInstanceOf(TypeError)
  })
})

describe('ApiError', () => {
  it('is identifiable by name after crossing a bundle boundary', () => {
    const err = new ApiError('nope', 403, 'AUTH_FORBIDDEN')

    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })
})
