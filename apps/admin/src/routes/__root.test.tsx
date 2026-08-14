// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import { Route } from './__root'

/**
 * The shell every admin page renders inside.
 *
 * Two things here are load-bearing and invisible until they break: the session
 * is hydrated once on mount, so a reload keeps the operator signed in, and the
 * error boundary sits *inside* the full-height shell, so a render throw shows
 * a message on the console's own background rather than a white page.
 */

const RootComponent = Route.options.component as () => React.ReactNode

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
  vi.restoreAllMocks()
})

describe('the admin root route', () => {
  it('hydrates the session once on mount', () => {
    const hydrate = vi.fn()
    useAuthStore.setState({ hydrate })

    const { rerender } = render(<RootComponent />)
    rerender(<RootComponent />)

    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it('keeps the console background behind whatever the outlet renders', () => {
    useAuthStore.setState({ hydrate: vi.fn() })

    const { container } = render(<RootComponent />)

    const shell = container.querySelector('.min-h-screen')
    expect(shell?.className).toContain('bg-primary-600')
  })
})
