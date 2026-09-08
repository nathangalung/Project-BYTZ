// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { lazy, type ReactElement } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { LazyPanel } from './lazy-panel'

vi.setConfig({ testTimeout: 30_000 })

/**
 * The pairing is the point.
 *
 * Suspense alone has no error path, so a rejected dynamic import leaves the
 * fallback on screen with nothing to end it - the Gantt tab sitting on
 * "Loading..." for as long as the owner was willing to wait.
 */

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

describe('LazyPanel', () => {
  it('shows the fallback while the child suspends', () => {
    const Never = lazy(() => new Promise<{ default: () => ReactElement }>(() => {}))
    render(
      <LazyPanel fallback={<p>memuat</p>}>
        <Never />
      </LazyPanel>,
    )

    expect(screen.getByText('memuat')).toBeDefined()
  })

  it('renders the child once it resolves', async () => {
    const Chunk = lazy(async () => ({ default: () => <p>bagan</p> }))
    render(
      <LazyPanel fallback={<p>memuat</p>}>
        <Chunk />
      </LazyPanel>,
    )

    expect(await screen.findByText('bagan')).toBeDefined()
  })

  /** A chunk that never arrives must end the wait, not extend it. */
  it('replaces the fallback with a reload offer when the chunk fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazy(async () => {
      throw new Error('Failed to fetch dynamically imported module')
    })

    render(
      <LazyPanel fallback={<p>memuat</p>}>
        <Broken />
      </LazyPanel>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /muat ulang|reload/i })).toBeDefined()
    })
    expect(screen.queryByText('memuat')).toBeNull()
    spy.mockRestore()
  })

  /**
   * Reloading is offered, never automatic: a page that reloads itself takes an
   * unsent message or a running timer with it.
   */
  it('does not reload on its own', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const Broken = lazy(async () => {
      throw new Error('nope')
    })

    render(
      <LazyPanel fallback={<p>memuat</p>}>
        <Broken />
      </LazyPanel>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /muat ulang|reload/i })).toBeDefined()
    })
    expect(reload).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    spy.mockRestore()
  })
})
