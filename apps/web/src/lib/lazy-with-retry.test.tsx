// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { lazyWithRetry } from './lazy-with-retry'

vi.setConfig({ testTimeout: 30_000 })

/**
 * Why the Gantt tab could sit on "Loading..." forever.
 *
 * Suspense has no error path of its own, so a rejected dynamic import leaves
 * the fallback rendered until something above catches the throw, and `lazy`
 * caches the rejection so the component never tries again.
 */

function Loaded() {
  return <p>chart</p>
}

describe('a lazily loaded chunk that fails to arrive', () => {
  it('renders the component when the import succeeds first time', async () => {
    const factory = vi.fn(async () => ({ default: Loaded }))
    const Chunk = lazyWithRetry(factory)

    render(
      <Suspense fallback={<p>loading</p>}>
        <Chunk />
      </Suspense>,
    )

    expect(await screen.findByText('chart')).toBeDefined()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  /** One dropped request must not cost the tab. */
  it('retries a failed import and renders once it arrives', async () => {
    let calls = 0
    const factory = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error('Failed to fetch dynamically imported module')
      return { default: Loaded }
    })
    const Chunk = lazyWithRetry(factory, 3, 1)

    render(
      <Suspense fallback={<p>loading</p>}>
        <Chunk />
      </Suspense>,
    )

    expect(await screen.findByText('chart')).toBeDefined()
    expect(factory).toHaveBeenCalledTimes(3)
  })

  /**
   * A chunk deleted by a deploy never arrives, however often it is asked for.
   * What matters is that the owner is told, instead of watching a spinner.
   */
  it('surfaces the failure to the boundary instead of hanging', async () => {
    const factory = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const Chunk = lazyWithRetry(factory, 2, 1)

    render(
      <ErrorBoundary fallback={<p>could not load</p>}>
        <Suspense fallback={<p>loading</p>}>
          <Chunk />
        </Suspense>
      </ErrorBoundary>,
    )

    await waitFor(() => expect(screen.getByText('could not load')).toBeDefined())
    expect(factory).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('loading')).toBeNull()
  })

  it('gives up after the configured number of attempts', async () => {
    const factory = vi.fn(async () => {
      throw new Error('nope')
    })
    const Chunk = lazyWithRetry(factory, 4, 1)

    render(
      <ErrorBoundary fallback={<p>could not load</p>}>
        <Suspense fallback={<p>loading</p>}>
          <Chunk />
        </Suspense>
      </ErrorBoundary>,
    )

    await waitFor(() => expect(screen.getByText('could not load')).toBeDefined())
    expect(factory).toHaveBeenCalledTimes(4)
  })
})
