// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Tabs } from './tabs'

const TABS = [
  { id: 'overview', label: 'Ringkasan' },
  { id: 'milestones', label: 'Milestone' },
  { id: 'documents', label: 'Dokumen' },
]

describe('Tabs', () => {
  it('renders one tab per entry inside a tablist', () => {
    render(<Tabs tabs={TABS}>{(active) => <p>{active}</p>}</Tabs>)

    expect(screen.getByRole('tablist')).toBeDefined()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'Milestone' })).toBeDefined()
  })

  /**
   * aria-selected is what a screen reader reads out as the current tab. It has
   * to be exclusive: two tabs claiming selection is worse than none, because
   * the user is told they are in a place they are not.
   */
  it('selects the first tab when no default is given', () => {
    render(<Tabs tabs={TABS}>{(active) => <p>{active}</p>}</Tabs>)

    const selected = screen.getAllByRole('tab', { selected: true })
    expect(selected).toHaveLength(1)
    expect(selected[0].textContent).toBe('Ringkasan')
  })

  it('honours an explicit default tab', () => {
    render(
      <Tabs tabs={TABS} defaultTab="documents">
        {(active) => <p>{active}</p>}
      </Tabs>,
    )

    expect(screen.getAllByRole('tab', { selected: true })[0].textContent).toBe('Dokumen')
  })

  it('hands the active id to the panel renderer', () => {
    render(
      <Tabs tabs={TABS} defaultTab="milestones">
        {(active) => <p>panel:{active}</p>}
      </Tabs>,
    )

    expect(screen.getByRole('tabpanel').textContent).toBe('panel:milestones')
  })

  it('moves the selection and re-renders the panel on click', async () => {
    const user = userEvent.setup()
    render(<Tabs tabs={TABS}>{(active) => <p>panel:{active}</p>}</Tabs>)

    await user.click(screen.getByRole('tab', { name: 'Dokumen' }))

    expect(screen.getByRole('tabpanel').textContent).toBe('panel:documents')
    const selected = screen.getAllByRole('tab', { selected: true })
    expect(selected).toHaveLength(1)
    expect(selected[0].textContent).toBe('Dokumen')
  })

  it('notifies the caller of the tab that was chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Tabs tabs={TABS} onChange={onChange}>
        {(active) => <p>{active}</p>}
      </Tabs>,
    )

    await user.click(screen.getByRole('tab', { name: 'Milestone' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('milestones')
  })

  it('works without an onChange handler', async () => {
    const user = userEvent.setup()
    render(<Tabs tabs={TABS}>{(active) => <p>panel:{active}</p>}</Tabs>)

    await user.click(screen.getByRole('tab', { name: 'Milestone' }))

    expect(screen.getByRole('tabpanel').textContent).toBe('panel:milestones')
  })

  it('gives the active tab the raised styling and the rest the muted one', () => {
    render(<Tabs tabs={TABS}>{(active) => <p>{active}</p>}</Tabs>)

    const [first, second] = screen.getAllByRole('tab')
    expect(first.className).toContain('bg-surface-bright')
    expect(second.className).toContain('text-on-surface-muted')
  })

  /**
   * An empty tab list is reachable: a project with no documents renders the
   * shell before the rows arrive. Falling back to '' rather than indexing
   * undefined is what keeps the panel rendering instead of throwing.
   */
  it('renders an empty tablist without throwing', () => {
    render(<Tabs tabs={[]}>{(active) => <p>panel:{active || 'none'}</p>}</Tabs>)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('tabpanel').textContent).toBe('panel:none')
  })
})
