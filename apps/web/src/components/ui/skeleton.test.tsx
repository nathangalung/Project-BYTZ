// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton } from './skeleton'

describe('Skeleton', () => {
  /**
   * A loading placeholder carries no information, so it has to stay out of the
   * accessibility tree. Without aria-hidden a screen reader walks a page of
   * empty boxes while the real content is still loading.
   */
  it('stays out of the accessibility tree', () => {
    const { container } = render(<Skeleton />)

    expect((container.firstElementChild as HTMLElement).getAttribute('aria-hidden')).toBe('true')
  })

  it('animates so it reads as loading rather than as an empty box', () => {
    const { container } = render(<Skeleton />)

    expect((container.firstElementChild as HTMLElement).className).toContain('animate-pulse')
  })

  it('takes the size from the caller and keeps the placeholder styling', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)

    const className = (container.firstElementChild as HTMLElement).className
    expect(className).toContain('h-4')
    expect(className).toContain('w-32')
    expect(className).toContain('bg-surface-container')
  })
})
