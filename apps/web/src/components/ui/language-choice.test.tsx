// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { LanguageChoice } from './language-choice'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

describe('LanguageChoice', () => {
  /**
   * Two unlabelled toggle buttons side by side are ambiguous on their own, so
   * the group carries the name that says what is being chosen.
   */
  it('groups the options under a name', () => {
    render(<LanguageChoice value="id" onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Bahasa dokumen' })).toBeDefined()
  })

  it('labels each option in the reader language', () => {
    render(<LanguageChoice value="id" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Bahasa Indonesia' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'English' })).toBeDefined()
  })

  /**
   * aria-pressed is what announces which language is currently chosen. Exactly
   * one has to be pressed, or the control says nothing useful.
   */
  it.each([
    ['id', 'Bahasa Indonesia'],
    ['en', 'English'],
  ] as const)('marks %s as the pressed option', (value, expectedName) => {
    render(<LanguageChoice value={value} onChange={vi.fn()} />)

    const pressed = screen.getAllByRole('button', { pressed: true })
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toBe(expectedName)
  })

  it('reports the language that was picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LanguageChoice value="id" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('en')
  })

  it('reports a pick even when it is the one already active', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LanguageChoice value="id" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Bahasa Indonesia' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('id')
  })

  /**
   * The control is disabled while a document is generating. Dimming it is not
   * enough - the press has to be refused, or the language changes underneath a
   * request already in flight.
   */
  it('refuses the press while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LanguageChoice value="id" onChange={onChange} disabled />)

    const english = screen.getByRole('button', { name: 'English' })
    expect((english as HTMLButtonElement).disabled).toBe(true)
    await user.click(english)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('is enabled by default', () => {
    render(<LanguageChoice value="id" onChange={vi.fn()} />)

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('gives the chosen option the filled styling', () => {
    render(<LanguageChoice value="en" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'English' }).className).toContain('bg-brand')
    expect(screen.getByRole('button', { name: 'Bahasa Indonesia' }).className).toContain(
      'text-on-surface-muted',
    )
  })
})
