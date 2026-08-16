// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('renders as a button carrying its label as the accessible name', () => {
    render(<Button>Kirim</Button>)

    expect(screen.getByRole('button', { name: 'Kirim' })).toBeDefined()
  })

  it('calls onClick once per press', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Kirim</Button>)

    await user.click(screen.getByRole('button', { name: 'Kirim' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  /**
   * Disabled is the branch worth pinning: the variant classes carry
   * `disabled:opacity-50`, which only dims it. The prop has to reach the
   * element for the press to actually be swallowed.
   */
  it('swallows the press while disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Kirim
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Kirim' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await user.click(button)

    expect(onClick).not.toHaveBeenCalled()
  })

  it.each([
    ['primary', 'bg-brand'],
    ['secondary', 'bg-accent-coral-600'],
    ['outline', 'bg-surface-bright'],
    ['ghost', 'text-on-surface-muted'],
    ['danger', 'bg-error-600'],
  ] as const)('applies the %s variant', (variant, expectedClass) => {
    render(<Button variant={variant}>Label</Button>)

    expect(screen.getByRole('button').className).toContain(expectedClass)
  })

  it.each([
    ['sm', 'text-xs'],
    ['md', 'text-sm'],
    ['lg', 'text-base'],
  ] as const)('applies the %s size', (size, expectedClass) => {
    render(<Button size={size}>Label</Button>)

    expect(screen.getByRole('button').className).toContain(expectedClass)
  })

  it('defaults to the primary variant at medium size', () => {
    render(<Button>Label</Button>)

    const className = screen.getByRole('button').className
    expect(className).toContain('bg-brand')
    expect(className).toContain('px-4 py-2.5')
  })

  /**
   * The focus ring is the only visible focus indicator, and WCAG 2.1 AA needs
   * one. It rides on the shared class string, so a caller class must not be
   * able to displace it.
   */
  it('keeps the focus ring when a caller adds its own class', () => {
    render(<Button className="w-full">Label</Button>)

    const className = screen.getByRole('button').className
    expect(className).toContain('focus-visible:ring-2')
    expect(className).toContain('w-full')
  })

  it('forwards arbitrary button attributes', () => {
    render(
      <Button type="button" aria-label="Tutup" form="intake">
        X
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Tutup' })
    expect((button as HTMLButtonElement).type).toBe('button')
    expect(button.getAttribute('form')).toBe('intake')
  })
})
