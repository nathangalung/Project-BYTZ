// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { TalentHoursChart } from './talent-hours-chart'

/**
 * ResponsiveContainer measures its parent and renders nothing at zero size,
 * which jsdom always reports. Standing in for it with a fixed box is what lets
 * the bars, the axes and the tooltip formatter actually render, so the rest of
 * recharts stays real rather than being asserted against an empty div.
 */
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={640} height={224}>
        {children as React.ReactElement}
      </actual.ResponsiveContainer>
    ),
  }
})

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

describe('TalentHoursChart', () => {
  it('plots one bar per talent', () => {
    const { container } = render(
      <TalentHoursChart
        data={[
          { name: 'Talenta #1', totalHours: 12 },
          { name: 'Talenta #2', totalHours: 30 },
        ]}
      />,
    )

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2)
  })

  it('labels the horizontal axis with the talent names', () => {
    render(<TalentHoursChart data={[{ name: 'Talenta #1', totalHours: 12 }]} />)

    expect(screen.getByText('Talenta #1')).toBeDefined()
  })

  /**
   * An empty summary is reachable - a project where nobody has logged time yet
   * renders the chart shell. It has to draw the axes rather than throw.
   */
  it('renders the axes with no rows to plot', () => {
    const { container } = render(<TalentHoursChart data={[]} />)

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(0)
    expect(container.querySelector('.recharts-surface')).not.toBeNull()
  })

  it('plots a talent who has logged nothing yet', () => {
    const { container } = render(
      <TalentHoursChart data={[{ name: 'Talenta #1', totalHours: 0 }]} />,
    )

    expect(container.querySelector('.recharts-surface')).not.toBeNull()
  })

  it('keeps a fixed height so the surrounding panel does not jump', () => {
    const { container } = render(<TalentHoursChart data={[]} />)

    expect((container.firstElementChild as HTMLElement).className).toContain('h-56')
  })
})
