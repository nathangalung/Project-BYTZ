// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './status-badge'

/**
 * These badges carry financial and account meaning -- suspended, refunded,
 * escrow held -- so the state must never be conveyed by colour alone. The
 * label is a required prop for that reason, and the tone map is the component.
 */

describe('StatusBadge', () => {
  it('always renders the label as text', () => {
    render(<StatusBadge label="Ditangguhkan" />)

    expect(screen.getByText('Ditangguhkan')).toBeDefined()
  })

  it('renders the icon beside the label without replacing it', () => {
    render(<StatusBadge label="Terverifikasi" icon={<span>✓</span>} />)

    expect(screen.getByText('Terverifikasi')).toBeDefined()
    expect(screen.getByText('✓')).toBeDefined()
  })

  it.each([
    ['neutral', 'bg-neutral-500/20'],
    ['success', 'bg-success-500/20'],
    ['warning', 'bg-warning-500/20'],
    ['error', 'bg-error-500/20'],
  ] as const)('applies the %s tone', (tone, expected) => {
    render(<StatusBadge label="Label" tone={tone} />)

    expect(screen.getByText('Label').className).toContain(expected)
  })

  it('defaults to the neutral tone', () => {
    render(<StatusBadge label="Label" />)

    expect(screen.getByText('Label').className).toContain('bg-neutral-500/20')
  })

  it.each([
    ['xs', 'text-[10px]'],
    ['sm', 'text-xs'],
  ] as const)('applies the %s size', (size, expected) => {
    render(<StatusBadge label="Label" size={size} />)

    expect(screen.getByText('Label').className).toContain(expected)
  })

  it('defaults to the small size', () => {
    render(<StatusBadge label="Label" />)

    expect(screen.getByText('Label').className).toContain('text-xs')
  })

  /**
   * Domain status maps (role colours in users, type colours in finance) pass
   * an exact intensity through className and twMerge lets them win. If the
   * tone default survived the merge the role colours would all read neutral.
   */
  it('lets a caller class override the tone rather than stack with it', () => {
    render(<StatusBadge label="Owner" className="bg-warning-500/20 text-warning-500" />)

    const className = screen.getByText('Owner').className
    expect(className).toContain('bg-warning-500/20')
    expect(className).not.toContain('bg-neutral-500/20')
  })

  it('keeps the shared shape classes alongside the tone', () => {
    render(<StatusBadge label="Label" tone="error" />)

    const className = screen.getByText('Label').className
    expect(className).toContain('rounded-full')
    expect(className).toContain('whitespace-nowrap')
  })
})
