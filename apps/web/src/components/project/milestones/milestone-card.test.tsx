// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { MilestoneCard } from './milestone-card'
import type { MilestoneItem } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const PAST = '2020-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

function milestone(overrides: Partial<MilestoneItem> = {}): MilestoneItem {
  return {
    id: 'ms-1',
    title: 'Backend API',
    description: 'Endpoint autentikasi dan proyek',
    status: 'pending',
    amount: 5_000_000,
    dueDate: FUTURE,
    revisionCount: 0,
    assignedWorkerLabel: null,
    milestoneType: 'individual',
    orderIndex: 0,
    metadata: null,
    ...overrides,
  }
}

function renderCard(props: Partial<Parameters<typeof MilestoneCard>[0]> = {}) {
  return render(
    <MilestoneCard
      milestone={milestone()}
      onSelect={vi.fn()}
      onStatusChange={vi.fn()}
      isMutating={false}
      {...props}
    />,
  )
}

describe('MilestoneCard', () => {
  it('shows the title, the description and the amount', () => {
    renderCard()

    expect(screen.getByRole('heading', { name: 'Backend API' })).toBeDefined()
    expect(screen.getByText('Endpoint autentikasi dan proyek')).toBeDefined()
    expect(screen.getByText('Rp 5.000.000')).toBeDefined()
  })

  it('opens the detail when the card body is pressed', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderCard({ onSelect })

    await user.click(screen.getByRole('heading', { name: 'Backend API' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  describe('the overdue marker', () => {
    /**
     * Overdue is the state the owner has to act on, so it is flagged with an
     * icon and a colour rather than a colour alone. It is also suppressed once
     * the milestone is settled - a milestone approved after its due date is
     * finished, not late.
     */
    it('flags a milestone past its due date', () => {
      const { container } = renderCard({ milestone: milestone({ dueDate: PAST }) })

      expect((container.firstElementChild as HTMLElement).className).toContain(
        'border-accent-coral-500/30',
      )
    })

    it.each(['approved', 'rejected'])('does not flag a %s milestone as overdue', (status) => {
      const { container } = renderCard({ milestone: milestone({ dueDate: PAST, status }) })

      expect((container.firstElementChild as HTMLElement).className).not.toContain(
        'border-accent-coral-500/30',
      )
    })

    it('does not flag one that is still in time', () => {
      const { container } = renderCard({ milestone: milestone({ dueDate: FUTURE }) })

      expect((container.firstElementChild as HTMLElement).className).not.toContain(
        'border-accent-coral-500/30',
      )
    })

    it('does not flag one with no due date at all', () => {
      const { container } = renderCard({ milestone: milestone({ dueDate: null }) })

      expect((container.firstElementChild as HTMLElement).className).not.toContain(
        'border-accent-coral-500/30',
      )
      expect(screen.queryByText(/2020|2099/)).toBeNull()
    })
  })

  describe('the revision counter', () => {
    /**
     * Two rounds are free and the third costs the owner money, so the count is
     * shown against its ceiling rather than on its own.
     */
    it('counts revisions against the two free rounds', () => {
      renderCard({ milestone: milestone({ revisionCount: 1 }) })

      expect(screen.getByText('1/2')).toBeDefined()
    })

    it('stays hidden while no revision has been asked for', () => {
      renderCard({ milestone: milestone({ revisionCount: 0 }) })

      expect(screen.queryByText('0/2')).toBeNull()
    })
  })

  it('marks an integration milestone as one', () => {
    renderCard({ milestone: milestone({ milestoneType: 'integration' }) })

    expect(screen.getByText('Integrasi')).toBeDefined()
  })

  it('leaves an individual milestone unmarked', () => {
    renderCard({ milestone: milestone({ milestoneType: 'individual' }) })

    expect(screen.queryByText('Integrasi')).toBeNull()
  })

  it('names the talent when the milestone is assigned to one', () => {
    renderCard({ milestone: milestone({ assignedWorkerLabel: 'Frontend Developer' }) })

    expect(screen.getByText('Frontend Developer')).toBeDefined()
  })

  describe('the quick actions', () => {
    /**
     * Advancing a milestone is the talent's to do. Rendering the control for
     * an owner would offer an action the API refuses, so the role gate is
     * what keeps the card honest about what this user can do.
     */
    it('offers nothing to an owner', () => {
      renderCard({ role: 'owner', milestone: milestone({ status: 'pending' }) })

      expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    it('offers nothing when the role is unknown', () => {
      renderCard({ milestone: milestone({ status: 'pending' }) })

      expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    it('lets a talent start a pending milestone', async () => {
      const user = userEvent.setup()
      const onStatusChange = vi.fn()
      renderCard({ role: 'talent', milestone: milestone({ status: 'pending' }), onStatusChange })

      await user.click(screen.getByRole('button', { name: 'Dalam Proses' }))

      expect(onStatusChange).toHaveBeenCalledExactlyOnceWith('ms-1', 'in_progress')
    })

    it('lets a talent submit one already in progress', async () => {
      const user = userEvent.setup()
      const onStatusChange = vi.fn()
      renderCard({
        role: 'talent',
        milestone: milestone({ status: 'in_progress' }),
        onStatusChange,
      })

      await user.click(screen.getByRole('button', { name: 'Diajukan' }))

      expect(onStatusChange).toHaveBeenCalledExactlyOnceWith('ms-1', 'submitted')
    })

    it('offers no advance once the milestone is submitted', () => {
      renderCard({ role: 'talent', milestone: milestone({ status: 'submitted' }) })

      expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    /**
     * The action does not open the detail on the way past. Without the
     * stopPropagation the talent both advances the milestone and lands in a
     * panel they did not ask for.
     */
    it('does not open the detail on the way through', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      renderCard({ role: 'talent', milestone: milestone({ status: 'pending' }), onSelect })

      await user.click(screen.getByRole('button', { name: 'Dalam Proses' }))

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('refuses a second press while the first is still in flight', async () => {
      const user = userEvent.setup()
      const onStatusChange = vi.fn()
      renderCard({
        role: 'talent',
        milestone: milestone({ status: 'pending' }),
        onStatusChange,
        isMutating: true,
      })

      const action = screen.getByRole('button', { name: 'Dalam Proses' })
      expect((action as HTMLButtonElement).disabled).toBe(true)
      await user.click(action)

      expect(onStatusChange).not.toHaveBeenCalled()
    })
  })
})
