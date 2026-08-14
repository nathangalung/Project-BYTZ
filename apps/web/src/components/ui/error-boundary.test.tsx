// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { ErrorBoundary } from './error-boundary'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

/**
 * React prints the caught error and a component stack to stderr before the
 * boundary renders. That is the boundary working, not the test failing, so the
 * noise is silenced rather than left to read as a broken run.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Gagal memuat milestone')
  return <p>Konten</p>
}

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Konten')).toBeDefined()
  })

  describe('once a child throws', () => {
    it('replaces the subtree with the fallback instead of blanking the page', () => {
      render(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )

      expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()
      expect(screen.queryByText('Konten')).toBeNull()
    })

    it('shows the message from the error it caught', () => {
      render(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )

      expect(screen.getByText('Gagal memuat milestone')).toBeDefined()
    })

    /**
     * The error state is one of the four states a fetching section owes the
     * user, and the retry is what makes it a state rather than a dead end.
     */
    it('offers a retry', () => {
      render(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )

      expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeDefined()
    })

    it('takes the caller fallback over the built-in one', () => {
      render(
        <ErrorBoundary fallback={<p>Bagian ini sedang bermasalah</p>}>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )

      expect(screen.getByText('Bagian ini sedang bermasalah')).toBeDefined()
      expect(screen.queryByRole('heading', { name: 'Terjadi kesalahan' })).toBeNull()
    })

    it('translates the fallback rather than hardcoding it', async () => {
      await i18n.changeLanguage('en')
      render(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )

      expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeDefined()
      await i18n.changeLanguage('id')
    })
  })

  describe('retrying', () => {
    /**
     * Retry only clears the boundary's own flag. Re-rendering the same failing
     * child throws straight back, so the recovery worth pinning is the one
     * where the cause is gone by the time the user presses it.
     */
    it('brings the children back when the cause has cleared', async () => {
      const user = userEvent.setup()

      function Harness() {
        const [broken, setBroken] = useState(true)
        return (
          <>
            <button type="button" onClick={() => setBroken(false)}>
              Perbaiki
            </button>
            <ErrorBoundary>
              <Boom shouldThrow={broken} />
            </ErrorBoundary>
          </>
        )
      }

      render(<Harness />)
      expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()

      await user.click(screen.getByRole('button', { name: 'Perbaiki' }))
      await user.click(screen.getByRole('button', { name: 'Coba Lagi' }))

      expect(screen.getByText('Konten')).toBeDefined()
      expect(screen.queryByRole('heading', { name: 'Terjadi kesalahan' })).toBeNull()
    })

    it('falls back again when the cause is still there', async () => {
      const user = userEvent.setup()
      render(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )

      await user.click(screen.getByRole('button', { name: 'Coba Lagi' }))

      expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()
    })
  })

  it('contains the failure rather than letting it reach a sibling section', () => {
    render(
      <div>
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>
        <p>Bagian lain</p>
      </div>,
    )

    expect(screen.getByText('Bagian lain')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()
  })
})
