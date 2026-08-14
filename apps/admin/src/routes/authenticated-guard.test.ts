// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import { Route } from './_authenticated'

/**
 * Every admin screen sits under this layout route, so its beforeLoad is the
 * only thing standing between a signed-in owner and the finance, dispute and
 * user-suspension tools. It is a client-side gate over a server that checks
 * the session again, but it is the gate that decides what an operator ever
 * sees, and it is one boolean and one string comparison wide.
 *
 * The state it reads is rehydrated from localStorage by zustand's persist
 * middleware, so a tampered persisted blob reaches it directly. That makes the
 * role check, not just the isAuthenticated flag, the part that has to hold.
 */

type Guard = () => void

function runGuard(): { threw: boolean; redirectedTo?: string } {
  const beforeLoad = Route.options.beforeLoad as unknown as Guard
  try {
    beforeLoad()
    return { threw: false }
  } catch (e) {
    const to = (e as { options?: { to?: string } })?.options?.to
    return { threw: true, redirectedTo: to }
  }
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

describe('admin route guard', () => {
  it('admits a signed-in admin', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'u-1', email: 'admin@bytz.id', name: 'Admin', role: 'admin', locale: 'id' },
    })

    expect(runGuard().threw).toBe(false)
  })

  it('redirects an anonymous visitor to the login page', () => {
    const result = runGuard()

    expect(result.threw).toBe(true)
    expect(result.redirectedTo).toBe('/')
  })

  /**
   * The session endpoint is shared with the main app, so an owner or talent
   * holding a perfectly valid session is the expected attacker here, not a
   * hypothetical one.
   */
  it.each(['owner', 'talent'])('turns away a signed-in %s', (role) => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: {
        id: 'u-2',
        email: `${role}@bytz.id`,
        name: 'Bukan Admin',
        role: role as 'admin',
        locale: 'id',
      },
    })

    const result = runGuard()

    expect(result.threw).toBe(true)
    expect(result.redirectedTo).toBe('/')
  })

  /** A flag set without a user must not be enough on its own. */
  it('turns away an authenticated flag with no user behind it', () => {
    useAuthStore.setState({ isAuthenticated: true, user: null })

    expect(runGuard().threw).toBe(true)
  })

  /** Nor must an admin record with the flag cleared, e.g. after a failed hydrate. */
  it('turns away an admin record whose session was not confirmed', () => {
    useAuthStore.setState({
      isAuthenticated: false,
      user: { id: 'u-1', email: 'admin@bytz.id', name: 'Admin', role: 'admin', locale: 'id' },
    })

    expect(runGuard().threw).toBe(true)
  })
})
