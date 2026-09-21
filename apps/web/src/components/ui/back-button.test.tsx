// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { BackButton } from './back-button'

/**
 * The control needs a router around it either way: the `to` form renders a
 * Link, and the fallback reads router history. The harness mounts a component
 * as a route, so a one-off module stands in for a page.
 */
function page(node: () => React.ReactNode) {
  return { Route: { options: { component: node } } }
}

describe('BackButton', () => {
  it('links to the named parent', async () => {
    await renderRoute(
      page(() => <BackButton to="/payments" />),
      {
        path: '/payments/$transactionId',
        entry: '/payments/t-1',
        destinations: ['/payments'],
      },
    )

    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/payments')
  })

  it('fills the parent route params', async () => {
    await renderRoute(
      page(() => <BackButton to="/projects/$projectId" params={{ projectId: 'p-1' }} />),
      {
        path: '/projects/$projectId/brd',
        entry: '/projects/p-1/brd',
        destinations: ['/projects/$projectId'],
      },
    )

    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/projects/p-1')
  })

  /** A named parent reads better than "Back" when the list has a name. */
  it('prefers the given label over the generic one', async () => {
    await renderRoute(
      page(() => <BackButton to="/payments" label="Payment history" />),
      {
        path: '/payments/$transactionId',
        entry: '/payments/t-1',
        destinations: ['/payments'],
      },
    )

    expect(screen.getByRole('link', { name: 'Payment history' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull()
  })

  /**
   * Pages reachable from anywhere have no parent to name, so the control is a
   * button that steps back through history instead of a link to a fixed place.
   */
  it('steps back through history when no parent is named', async () => {
    const { router } = await renderRoute(
      page(() => <BackButton />),
      {
        path: '/notifications',
        destinations: ['/dashboard'],
      },
    )
    // A step out and back in, so the previous address is the dashboard rather
    // than the entry the router opened on.
    await router.navigate({ to: '/dashboard' })
    await router.navigate({ to: '/notifications' })

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(router.state.location.pathname).toBe('/dashboard')
  })

  it('names the fallback control for screen readers too', async () => {
    await renderRoute(
      page(() => <BackButton label="Kembali ke Pesan" />),
      {
        path: '/notifications',
      },
    )

    expect(screen.getByRole('button', { name: 'Kembali ke Pesan' })).toBeDefined()
  })

  /** The chevron is decoration beside a label that already says the same. */
  it('hides the icon from the accessibility tree', async () => {
    const { container } = await renderRoute(
      page(() => <BackButton to="/dashboard" />),
      {
        path: '/settings',
        destinations: ['/dashboard'],
      },
    )

    const icon = container.querySelector('svg')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes a caller override for its spacing', async () => {
    const { container } = await renderRoute(
      page(() => <BackButton to="/dashboard" className="mb-0" />),
      { path: '/settings', destinations: ['/dashboard'] },
    )

    expect(container.querySelector('a')?.className).toContain('mb-0')
  })
})
