// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './page-header'

/**
 * Semantic landmark for every admin screen: this is the only h1 on the page,
 * so a screen reader's heading list is whatever this renders.
 */

describe('PageHeader', () => {
  it('renders the title as the page-level heading', () => {
    render(<PageHeader title="Manajemen User" description="Kelola semua user platform" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Manajemen User' })).toBeDefined()
    expect(screen.getByText('Kelola semua user platform')).toBeDefined()
  })

  it('renders caller actions beside the title', () => {
    render(
      <PageHeader
        title="Keuangan"
        description="Overview keuangan"
        actions={<button type="button">Export CSV</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDefined()
  })

  it('omits the action slot when nothing is passed', () => {
    render(<PageHeader title="Keuangan" description="Overview keuangan" />)

    expect(screen.queryByRole('button')).toBeNull()
  })
})
