// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

/**
 * First component test in the repo, so it is also the pattern.
 *
 * v8 can only count statements in a file it transformed, and a component no
 * test imports never is, so before this every .tsx in web reported zero
 * statements rather than zero percent. Ninety-three files were unmeasured
 * rather than uncovered, and the workspace total was computed over the eight
 * utility modules that happened to be imported.
 *
 * The environment is set per file rather than for the workspace, so the
 * existing logic tests keep running in node.
 */

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Menunggu</Badge>)

    expect(screen.getByText('Menunggu')).toBeDefined()
  })

  /**
   * The variant map is the component. Asserting one class per variant is what
   * catches a duplicated or dropped entry, which a snapshot would happily
   * record as the new truth.
   */
  it.each([
    ['default', 'bg-surface-container'],
    ['success', 'bg-success-500/15'],
    ['warning', 'bg-accent-cream-500/30'],
    ['error', 'bg-error-500/15'],
    ['info', 'bg-brand-accent/10'],
    ['primary', 'bg-brand-accent/10'],
    ['teal', 'bg-brand-accent/10'],
    ['violet', 'bg-accent-coral-500/15'],
    ['green', 'bg-success-500/15'],
    ['coral', 'bg-accent-coral-500/15'],
    ['cream', 'bg-accent-cream-500/30'],
  ] as const)('applies the %s variant', (variant, expectedClass) => {
    render(<Badge variant={variant}>Label</Badge>)

    expect(screen.getByText('Label').className).toContain(expectedClass)
  })

  it('defaults to the neutral variant when none is given', () => {
    render(<Badge>Label</Badge>)

    expect(screen.getByText('Label').className).toContain('bg-surface-container')
  })

  it('keeps the shared shape classes alongside the variant', () => {
    render(<Badge variant="error">Label</Badge>)

    const className = screen.getByText('Label').className
    expect(className).toContain('rounded-full')
    expect(className).toContain('text-xs')
  })

  it('appends a caller class without dropping the variant', () => {
    render(
      <Badge variant="success" className="ml-2">
        Label
      </Badge>,
    )

    const className = screen.getByText('Label').className
    expect(className).toContain('ml-2')
    expect(className).toContain('bg-success-500/15')
  })
})
