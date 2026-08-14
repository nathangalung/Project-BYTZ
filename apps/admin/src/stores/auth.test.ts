// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'

/**
 * This store is half of the admin console's access control: the route guard
 * reads isAuthenticated and user.role straight out of it, so whatever hydrate
 * decides to trust is what the guard lets through.
 *
 * The session endpoint is shared with the main app, where owners and talents
 * sign in too. A valid non-admin session is therefore the normal case, not an
 * edge case, and it must land as unauthenticated rather than as a logged-in
 * admin.
 */

const ADMIN = { id: 'u-1', email: 'admin@bytz.id', name: 'Admin', role: 'admin', locale: 'id' }
const OWNER = { id: 'u-2', email: 'owner@bytz.id', name: 'Owner', role: 'owner', locale: 'id' }

function stubSession(response: { ok?: boolean; body?: unknown; throws?: boolean }) {
  const spy = vi.fn(async () => {
    if (response.throws) throw new TypeError('Failed to fetch')
    return { ok: response.ok ?? true, json: async () => response.body }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true })
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('setUser', () => {
  it('marks the session authenticated and settles the loading flag', () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.isLoading).toBe(false)
    expect(state.user?.email).toBe('admin@bytz.id')
  })

  it('clears the session when handed null', () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })
    useAuthStore.getState().setUser(null)

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('setLoading', () => {
  it('toggles the loading flag without touching the session', () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })
    useAuthStore.getState().setLoading(true)

    expect(useAuthStore.getState().isLoading).toBe(true)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})

describe('hydrate', () => {
  it('accepts an admin session', async () => {
    const spy = stubSession({ body: { user: ADMIN } })

    await useAuthStore.getState().hydrate()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.id).toBe('u-1')
    expect(state.isLoading).toBe(false)
    expect(spy).toHaveBeenCalledWith('/api/v1/auth/get-session', { credentials: 'include' })
  })

  /**
   * The same endpoint answers for owners and talents. A valid owner session
   * reaching the admin console must not become an admin session.
   */
  it('rejects a valid session belonging to a non-admin', async () => {
    stubSession({ body: { user: OWNER } })

    await useAuthStore.getState().hydrate()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })

  it('rejects a body with no user at all', async () => {
    stubSession({ body: {} })

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('rejects a null body', async () => {
    stubSession({ body: null })

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('treats an unauthorised response as signed out', async () => {
    stubSession({ ok: false })

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  /** A network failure must settle the flag, or the shell spins forever. */
  it('settles the loading flag when the request throws', async () => {
    stubSession({ throws: true })

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().isLoading).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('drops a stale persisted admin when the session no longer holds', async () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })
    stubSession({ ok: false })

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('logout', () => {
  it('ends the server session before clearing the local one', async () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })
    const spy = stubSession({ body: {} })

    await useAuthStore.getState().logout()

    expect(spy).toHaveBeenCalledWith('/api/v1/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })

  /**
   * A sign-out that cannot reach the network still has to clear the client.
   * Leaving the admin logged in locally is the worse of the two outcomes.
   */
  it('clears the local session even when the request fails', async () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })
    stubSession({ throws: true })

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('persistence', () => {
  /** isLoading is derived per page load; persisting it would restore a stuck shell. */
  it('persists the session but not the loading flag', () => {
    useAuthStore.getState().setUser({ ...ADMIN, role: 'admin', locale: 'id' })

    const raw = localStorage.getItem('kerjacus-admin-auth')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string).state
    expect(persisted.isAuthenticated).toBe(true)
    expect(persisted.user.email).toBe('admin@bytz.id')
    expect(persisted).not.toHaveProperty('isLoading')
  })
})
