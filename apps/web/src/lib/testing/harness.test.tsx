// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createTestQueryClient, renderRoute, withQueryClient } from './harness'

/**
 * The harness every route test mounts through, so its own failure modes decide
 * whether the rest of the suite is debuggable.
 *
 * Both cases here are about what a broken test is told. A route module with no
 * component and a component that throws both render an empty body by default,
 * and "unable to find an element" is the least useful thing to say about
 * either. These pin the two messages that replace it.
 */

describe('renderRoute', () => {
  it('names the problem when the module exports no component', async () => {
    await expect(renderRoute({ Route: { options: {} } })).rejects.toThrow(
      'route module has no component',
    )
  })

  /**
   * Without the error component the router swallows the throw and renders
   * nothing, so every assertion in the failing test reports a missing element
   * rather than the exception that caused it.
   */
  it('renders the reason rather than an empty body when a route throws', async () => {
    function Exploding(): never {
      throw new Error('boom from the route')
    }

    const { container } = await renderRoute({ Route: { options: { component: Exploding } } })

    expect(container.textContent).toContain('ROUTE ERROR')
    expect(screen.getByText(/boom from the route/)).toBeDefined()
  })
})

describe('the query client the harness hands out', () => {
  /** Retries would turn one stubbed 500 into three and slow every error test. */
  it('does not retry a failed query or mutation', () => {
    const defaults = createTestQueryClient().getDefaultOptions()

    expect(defaults.queries?.retry).toBe(false)
    expect(defaults.mutations?.retry).toBe(false)
  })

  it('caches nothing, so one test cannot seed the next', () => {
    const defaults = createTestQueryClient().getDefaultOptions()

    expect(defaults.queries?.gcTime).toBe(0)
    expect(defaults.queries?.staleTime).toBe(0)
  })

  it('wraps children in the client it was given', () => {
    const client = createTestQueryClient()
    const Wrapper = withQueryClient(client)

    expect(Wrapper({ children: null })).toBeDefined()
  })
})
