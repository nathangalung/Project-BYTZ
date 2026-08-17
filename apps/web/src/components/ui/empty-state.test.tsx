// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state'

describe('EmptyState', () => {
  /**
   * The empty state is one of the four states every fetching component owes
   * the user, and it is the one that has to say what to do next rather than
   * leave a blank panel. The title is a heading so it lands in the document
   * outline instead of reading as loose text.
   */
  it('titles the empty state as a heading', () => {
    render(<EmptyState title="Belum ada proyek" />)

    expect(screen.getByRole('heading', { name: 'Belum ada proyek' })).toBeDefined()
  })

  it('omits the description when none is given', () => {
    const { container } = render(<EmptyState title="Belum ada proyek" />)

    expect(container.querySelector('p')).toBeNull()
  })

  it('renders the description when given', () => {
    render(<EmptyState title="Belum ada proyek" description="Buat proyek pertamamu" />)

    expect(screen.getByText('Buat proyek pertamamu')).toBeDefined()
  })

  it('omits the action slot when none is given', () => {
    render(<EmptyState title="Belum ada proyek" />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the call to action when given', () => {
    render(
      <EmptyState title="Belum ada proyek" action={<button type="button">Buat Proyek</button>} />,
    )

    expect(screen.getByRole('button', { name: 'Buat Proyek' })).toBeDefined()
  })

  /**
   * The default icon is decorative, and lucide marks its own svg aria-hidden.
   * A caller passing an icon replaces it rather than stacking a second one.
   */
  it('falls back to one decorative icon', () => {
    const { container } = render(<EmptyState title="Belum ada proyek" />)

    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0].getAttribute('aria-hidden')).toBe('true')
  })

  it('replaces the default icon rather than adding to it', () => {
    const { container } = render(
      <EmptyState title="Belum ada proyek" icon={<span data-icon="custom" />} />,
    )

    expect(container.querySelector('[data-icon="custom"]')).not.toBeNull()
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })
})
