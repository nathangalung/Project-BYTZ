// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card, CardContent, CardHeader } from './card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>Isi kartu</Card>)

    expect(screen.getByText('Isi kartu')).toBeDefined()
  })

  it('composes header and content inside one card', () => {
    render(
      <Card>
        <CardHeader>
          <h2>Judul</h2>
        </CardHeader>
        <CardContent>Detail</CardContent>
      </Card>,
    )

    expect(screen.getByRole('heading', { name: 'Judul' })).toBeDefined()
    expect(screen.getByText('Detail')).toBeDefined()
  })

  it('keeps the card shell classes when a caller adds its own', () => {
    const { container } = render(<Card className="mt-4">Isi</Card>)

    const className = (container.firstElementChild as HTMLElement).className
    expect(className).toContain('rounded-2xl')
    expect(className).toContain('bg-surface-bright')
    expect(className).toContain('mt-4')
  })

  it('gives the header its divider and the content its padding', () => {
    const { container } = render(
      <div>
        <CardHeader>Judul</CardHeader>
        <CardContent>Detail</CardContent>
      </div>,
    )

    const [header, content] = Array.from(container.firstElementChild?.children ?? [])
    expect((header as HTMLElement).className).toContain('border-b')
    expect((content as HTMLElement).className).toContain('px-6 py-4')
  })

  it('lets a caller override the header and content padding', () => {
    const { container } = render(
      <div>
        <CardHeader className="px-2">Judul</CardHeader>
        <CardContent className="p-0">Detail</CardContent>
      </div>,
    )

    const [header, content] = Array.from(container.firstElementChild?.children ?? [])
    expect((header as HTMLElement).className).toContain('px-2')
    expect((content as HTMLElement).className).toContain('p-0')
  })
})
