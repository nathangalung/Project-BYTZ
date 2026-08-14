import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from './auth'

vi.mock('@/lib/centrifugo', () => ({ disconnectCentrifugo: vi.fn() }))
vi.mock('@/lib/query-client', () => ({ queryClient: { clear: vi.fn() } }))

const { useAuthStore } = await import('./auth')

const SIGNED_IN: User = {
  id: 'u1',
  email: 'owner@kerjacus.id',
  name: 'Owner',
  role: 'owner',
  locale: 'id',
}

function stubFetch(impl: () => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true })
})

describe('hydrate on a live session', () => {
  it('adopts the user the session endpoint returns', async () => {
    stubFetch(async () => json({ data: SIGNED_IN }))

    await useAuthStore.getState().hydrate()

    const s = useAuthStore.getState()
    expect(s.user).toEqual(SIGNED_IN)
    expect(s.isAuthenticated).toBe(true)
    expect(s.isLoading).toBe(false)
  })

  /** Auth service answers `{ user }`; project service answers `{ data }`. */
  it('accepts the bare `user` envelope as well as `data`', async () => {
    stubFetch(async () => json({ user: SIGNED_IN }))

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().user).toEqual(SIGNED_IN)
  })

  it('treats a 200 carrying neither key as signed out', async () => {
    stubFetch(async () => json({ success: true }))

    await useAuthStore.getState().hydrate()

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isLoading).toBe(false)
  })
})

/**
 * The root route hydrates on mount while the login form may be resolving at
 * the same time. Both write the same three fields, so whichever lands second
 * wins - and hydrate losing that race used to sign the new user straight back
 * out. `isLoading` is the flag that says nobody has answered yet: once
 * setUser has cleared it, a late hydrate may only stop the spinner.
 */
describe('hydrate racing a concurrent sign-in', () => {
  it('does not clear a user that setUser wrote while the request was in flight', async () => {
    let release: (() => void) | undefined
    stubFetch(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return json({ error: 'no session' }, 401)
    })

    const pending = useAuthStore.getState().hydrate()
    useAuthStore.getState().setUser(SIGNED_IN)
    release?.()
    await pending

    const s = useAuthStore.getState()
    expect(s.user).toEqual(SIGNED_IN)
    expect(s.isAuthenticated).toBe(true)
    expect(s.isLoading).toBe(false)
  })

  it('clears the session when nothing else answered first', async () => {
    useAuthStore.setState({ user: SIGNED_IN, isAuthenticated: true, isLoading: true })
    stubFetch(async () => json({ error: 'no session' }, 401))

    await useAuthStore.getState().hydrate()

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isLoading).toBe(false)
  })

  it('applies the same guard when the request throws rather than 401s', async () => {
    let release: (() => void) | undefined
    stubFetch(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      throw new TypeError('Failed to fetch')
    })

    const pending = useAuthStore.getState().hydrate()
    useAuthStore.getState().setUser(SIGNED_IN)
    release?.()
    await pending

    expect(useAuthStore.getState().user).toEqual(SIGNED_IN)
  })

  it('clears the session on a network failure nobody else raced', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    await useAuthStore.getState().hydrate()

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isLoading).toBe(false)
  })
})

/**
 * The root route aborts hydrate on unmount. An abort is a cancelled question,
 * not a "signed out" answer, so it must leave every field alone - including
 * isLoading, which the next mount's hydrate owns.
 */
describe('hydrate after the caller aborted', () => {
  it('writes nothing when the signal aborts before the response is read', async () => {
    const controller = new AbortController()
    stubFetch(async () => {
      controller.abort()
      return json({ data: SIGNED_IN })
    })

    await useAuthStore.getState().hydrate(controller.signal)

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isLoading).toBe(true)
  })

  it('writes nothing when the fetch itself rejects with AbortError', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    await useAuthStore.getState().hydrate(new AbortController().signal)

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isLoading).toBe(true)
  })
})

describe('setUser and setLoading', () => {
  it('signing in stops the loading state and marks the session authenticated', () => {
    useAuthStore.getState().setUser(SIGNED_IN)

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isLoading).toBe(false)
  })

  it('signing out through setUser(null) drops authentication', () => {
    useAuthStore.getState().setUser(SIGNED_IN)
    useAuthStore.getState().setUser(null)

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  })

  it('setLoading touches only the loading flag', () => {
    useAuthStore.getState().setUser(SIGNED_IN)
    useAuthStore.getState().setLoading(true)

    const s = useAuthStore.getState()
    expect(s.isLoading).toBe(true)
    expect(s.user).toEqual(SIGNED_IN)
  })
})
