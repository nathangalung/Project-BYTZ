// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetailField, DetailSection } from './detail-section'

/**
 * The card used by every slide-over detail view. The danger tone is the only
 * behaviour it has: it is what marks the penalty history apart from the rest
 * of a talent's profile, so the tone must reach both the border and the
 * heading or the section reads as ordinary.
 */

describe('DetailSection', () => {
  it('renders its heading and children', () => {
    render(
      <DetailSection title="Profil">
        <p>isi</p>
      </DetailSection>,
    )

    expect(screen.getByRole('heading', { name: 'Profil' })).toBeDefined()
    expect(screen.getByText('isi')).toBeDefined()
  })

  it('renders an icon alongside the heading', () => {
    render(
      <DetailSection title="Riwayat Penalti" icon={<span>!</span>}>
        <p>isi</p>
      </DetailSection>,
    )

    expect(screen.getByRole('heading', { name: /Riwayat Penalti/ }).textContent).toContain('!')
  })

  it('defaults to the neutral tone', () => {
    const { container } = render(
      <DetailSection title="Profil">
        <p>isi</p>
      </DetailSection>,
    )

    expect(screen.getByRole('heading', { name: 'Profil' }).className).toContain('text-warning-500')
    expect(container.firstElementChild?.className).toContain('border-neutral-600/30')
  })

  it('carries the danger tone to both the border and the heading', () => {
    const { container } = render(
      <DetailSection tone="danger" title="Riwayat Penalti">
        <p>isi</p>
      </DetailSection>,
    )

    expect(screen.getByRole('heading', { name: 'Riwayat Penalti' }).className).toContain(
      'text-error-500',
    )
    expect(container.firstElementChild?.className).toContain('border-error-500/30')
  })
})

describe('DetailField', () => {
  it('pairs a label with its value', () => {
    render(<DetailField label="Telepon">+62811000111</DetailField>)

    expect(screen.getByText('Telepon')).toBeDefined()
    expect(screen.getByText('+62811000111')).toBeDefined()
  })

  it('accepts a caller class for spanning the grid', () => {
    const { container } = render(
      <DetailField label="Pendidikan" className="col-span-2">
        ITB
      </DetailField>,
    )

    expect(container.firstElementChild?.className).toContain('col-span-2')
  })

  it('renders a node value, not only text', () => {
    render(
      <DetailField label="Peran">
        <span>Talenta</span>
      </DetailField>,
    )

    expect(screen.getByText('Talenta')).toBeDefined()
  })
})
