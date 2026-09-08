// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { QueryError } from './query-error'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

describe('QueryError', () => {
  /**
   * Announced, not just drawn. The panel replaces content that was already on
   * screen, so a reader who is not looking at that corner gets no other signal.
   */
  it('announces itself to assistive technology', () => {
    render(<QueryError message="Gagal memuat sengketa." onRetry={() => {}} />)

    expect(screen.getByRole('alert').textContent).toContain('Gagal memuat sengketa.')
  })

  it('names what failed rather than showing a generic banner', () => {
    render(<QueryError message="Gagal memuat invoice." onRetry={() => {}} />)

    expect(screen.getByRole('alert').textContent).toContain('invoice')
  })

  it('calls back once per press so the caller refetches only what it chose', () => {
    const onRetry = vi.fn()
    render(<QueryError message="Gagal." onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('labels the button through i18n', () => {
    render(<QueryError message="Gagal." onRetry={() => {}} />)

    expect(screen.getByRole('button').textContent).toContain('Coba Lagi')
  })
})
