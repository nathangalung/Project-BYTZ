// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Input } from './input'

describe('Input', () => {
  /**
   * WCAG 2.1 AA wants a visible label, not a placeholder standing in for one,
   * so the label has to be wired to the control rather than merely sit above
   * it. getByLabelText only resolves when htmlFor and id actually agree.
   */
  it('associates the visible label with the control', () => {
    render(<Input label="Nama Proyek" />)

    const input = screen.getByLabelText('Nama Proyek')
    expect(input.tagName).toBe('INPUT')
  })

  it('derives the id from the label, lowercased and hyphenated', () => {
    render(<Input label="Nama Lengkap Anda" />)

    expect(screen.getByLabelText('Nama Lengkap Anda').id).toBe('nama-lengkap-anda')
  })

  it('prefers an explicit id over the derived one', () => {
    render(<Input label="Nama Proyek" id="title-field" />)

    expect(screen.getByLabelText('Nama Proyek').id).toBe('title-field')
  })

  it('renders no label element when none is given', () => {
    const { container } = render(<Input placeholder="Cari" />)

    expect(container.querySelector('label')).toBeNull()
    expect(screen.getByPlaceholderText('Cari').id).toBe('')
  })

  it('accepts typing and reports it to the caller', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input label="Judul" onChange={onChange} />)

    await user.type(screen.getByLabelText('Judul'), 'Halo')

    expect((screen.getByLabelText('Judul') as HTMLInputElement).value).toBe('Halo')
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  describe('without an error', () => {
    it('leaves the invalid flag off and describes nothing', () => {
      render(<Input label="Judul" />)

      const input = screen.getByLabelText('Judul')
      expect(input.getAttribute('aria-invalid')).toBeNull()
      expect(input.getAttribute('aria-describedby')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('with an error', () => {
    /**
     * The three pieces have to agree or the message is invisible to a screen
     * reader: aria-invalid marks the field, the alert role announces the text,
     * and aria-describedby is what ties the two together. Wiring two of the
     * three still reads as a valid field being narrated at random.
     */
    it('marks the field invalid and points it at the message', () => {
      render(<Input label="Judul" error="Judul wajib diisi" />)

      const input = screen.getByLabelText('Judul')
      const message = screen.getByRole('alert')

      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(message.textContent).toBe('Judul wajib diisi')
      expect(input.getAttribute('aria-describedby')).toBe(message.id)
      expect(message.id).toBe('judul-error')
    })

    it('swaps in the error border', () => {
      render(<Input label="Judul" error="Judul wajib diisi" />)

      expect(screen.getByLabelText('Judul').className).toContain('border-error-500')
    })

    /**
     * With no label and no id there is no id to hang the message off, so the
     * describedby link is dropped rather than pointed at nothing. The alert
     * role is what keeps the message announced in that case.
     */
    it('still announces the message when there is no id to reference', () => {
      render(<Input error="Wajib diisi" />)

      const message = screen.getByRole('alert')
      expect(message.textContent).toBe('Wajib diisi')
      expect(message.id).toBe('')
      expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBeNull()
    })
  })

  it('keeps the caller class alongside the base styling', () => {
    render(<Input label="Judul" className="max-w-xs" />)

    const className = screen.getByLabelText('Judul').className
    expect(className).toContain('max-w-xs')
    expect(className).toContain('rounded-xl')
  })

  it('forwards the ref to the underlying input', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input label="Judul" ref={ref} />)

    expect(ref.current).toBe(screen.getByLabelText('Judul'))
  })

  it('forwards arbitrary input attributes', () => {
    render(<Input label="Umur" type="number" required min={1} />)

    const input = screen.getByLabelText('Umur') as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.required).toBe(true)
    expect(input.min).toBe('1')
  })
})
