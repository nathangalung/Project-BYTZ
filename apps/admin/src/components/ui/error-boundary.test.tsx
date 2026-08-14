// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { ErrorBoundary } from './error-boundary'

/**
 * The admin panel had no error boundary anywhere: the root wrapped Outlet in
 * Suspense, which catches nothing a render throws, so one bad field in an API
 * response left an admin staring at a blank page with no way back.
 *
 * This is the component that has to answer that, so it is worth rendering
 * rather than reading. React logs the caught error to console.error on the way
 * past, which is noise here, not a failure.
 */

function Boom({ message = 'kolom tidak dikenal' }: { message?: string }): never {
  throw new Error(message)
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('ErrorBoundary', () => {
  it('renders its children untouched while nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>daftar transaksi</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('daftar transaksi')).toBeDefined()
  })

  it('replaces a thrown subtree with the translated fallback', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeDefined()
  })

  /** The admin needs the reason, not just that something broke. */
  it('surfaces the thrown message', () => {
    render(
      <ErrorBoundary>
        <Boom message="talent_payout melebihi amount" />
      </ErrorBoundary>,
    )

    expect(screen.getByText('talent_payout melebihi amount')).toBeDefined()
  })

  it('prefers a caller fallback over the default one', () => {
    render(
      <ErrorBoundary fallback={<p>panel keuangan tidak tersedia</p>}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('panel keuangan tidak tersedia')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull()
  })

  /**
   * Retry clears the flag and re-renders the children. That only recovers when
   * the child has stopped throwing, which is the point of it being a button
   * rather than an automatic reset.
   */
  it('re-renders the children when retry is pressed', async () => {
    const user = userEvent.setup()
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('sementara')
      return <p>berhasil dimuat</p>
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()

    shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }))

    expect(screen.getByText('berhasil dimuat')).toBeDefined()
  })

  it('falls straight back to the fallback when the child still throws', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Coba lagi' }))

    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeDefined()
  })
})
