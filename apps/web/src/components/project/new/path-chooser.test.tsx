// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { PathChooser } from './path-chooser'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

describe('PathChooser', () => {
  /**
   * Both cards are the whole click target, so both have to be buttons rather
   * than decorated divs - a keyboard user reaches the intake flow through
   * these two and nothing else on the page.
   */
  it('offers exactly two paths, both reachable as buttons', () => {
    render(<PathChooser onSelect={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('names the path for an owner who already has a brief', () => {
    render(<PathChooser onSelect={vi.fn()} />)

    const card = screen.getByRole('button', { name: /Upload Dokumen Kebutuhan/ })
    expect(card.textContent).toContain('Sudah punya dokumen BRD/PRD')
  })

  it('names the path for an owner with no brief yet', () => {
    render(<PathChooser onSelect={vi.fn()} />)

    const card = screen.getByRole('button', { name: /Bantu Saya Buat Dokumen/ })
    expect(card.textContent).toContain('AI akan bantu menyusun BRD')
  })

  it('reports path A when the upload card is chosen', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PathChooser onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: /Upload Dokumen Kebutuhan/ }))

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('A')
  })

  it('reports path B when the AI card is chosen', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PathChooser onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: /Bantu Saya Buat Dokumen/ }))

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('B')
  })

  it('marks the AI path as the popular one', () => {
    render(<PathChooser onSelect={vi.fn()} />)

    expect(screen.getByText('Populer')).toBeDefined()
  })

  it('is reachable by keyboard in reading order', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PathChooser onSelect={onSelect} />)

    await user.tab()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('A')
  })
})
