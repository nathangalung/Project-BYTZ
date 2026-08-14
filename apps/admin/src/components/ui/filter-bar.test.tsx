// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar, SearchInput, SegmentedTabs, SelectFilter } from './filter-bar'

/**
 * The filter row above every admin table. Neither the search box nor the
 * select has a visible label, so the placeholder and the label prop are the
 * only accessible names they get -- worth asserting, because dropping them
 * leaves a screen reader with two unnamed controls and no way to tell which
 * narrows what.
 */

describe('FilterBar', () => {
  it('renders whatever controls it is given', () => {
    render(
      <FilterBar>
        <span>kontrol</span>
      </FilterBar>,
    )

    expect(screen.getByText('kontrol')).toBeDefined()
  })
})

describe('SearchInput', () => {
  it('takes its accessible name from the placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Cari nama atau email..." />)

    expect(screen.getByRole('textbox', { name: 'Cari nama atau email...' })).toBeDefined()
  })

  /**
   * Fully controlled: the value never moves unless the caller moves it, so a
   * pinned value reports each keystroke on its own rather than accumulating.
   * That is what lets useAdminList own the debounce.
   */
  it('reports every keystroke to the caller', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} placeholder="Cari" />)

    await user.type(screen.getByRole('textbox'), 'bu')

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls).toEqual([['b'], ['u']])
  })

  it('is fully controlled by the value it is handed', () => {
    render(<SearchInput value="budi" onChange={vi.fn()} placeholder="Cari" />)

    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('budi')
  })
})

describe('SelectFilter', () => {
  it('takes its accessible name from the label prop', () => {
    render(
      <SelectFilter value="" onChange={vi.fn()} label="Tipe transaksi">
        <option value="">Semua Tipe</option>
        <option value="refund">Refund</option>
      </SelectFilter>,
    )

    expect(screen.getByRole('combobox', { name: 'Tipe transaksi' })).toBeDefined()
  })

  it('reports the chosen option value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SelectFilter value="" onChange={onChange} label="Tipe">
        <option value="">Semua</option>
        <option value="refund">Refund</option>
      </SelectFilter>,
    )

    await user.selectOptions(screen.getByRole('combobox'), 'refund')

    expect(onChange).toHaveBeenCalledWith('refund')
  })
})

describe('SegmentedTabs', () => {
  const TABS = [
    { id: '', label: 'Semua', count: 128 },
    { id: 'owner', label: 'Pemilik Proyek', count: 40 },
    { id: 'talent', label: 'Talenta' },
  ]

  it('exposes the tabs with their roles', () => {
    render(<SegmentedTabs tabs={TABS} value="" onChange={vi.fn()} />)

    expect(screen.getByRole('tablist')).toBeDefined()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  /**
   * The counts used to come from the rendered rows, which was one page of an
   * already role-filtered query, so every tab but the active one read zero.
   * They are server totals now, and the tab is what publishes them.
   */
  it('appends the count when one is supplied', () => {
    render(<SegmentedTabs tabs={TABS} value="" onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Semua (128)' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Pemilik Proyek (40)' })).toBeDefined()
  })

  it('renders a bare label when the count is still unknown', () => {
    render(<SegmentedTabs tabs={TABS} value="" onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Talenta' })).toBeDefined()
  })

  /** A zero count is a real answer and must not be swallowed as absent. */
  it('shows a zero count rather than hiding it', () => {
    render(
      <SegmentedTabs
        tabs={[{ id: 'talent', label: 'Talenta', count: 0 }]}
        value=""
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Talenta (0)' })).toBeDefined()
  })

  it('marks only the active tab as selected', () => {
    render(<SegmentedTabs tabs={TABS} value="owner" onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: /Pemilik Proyek/ }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('tab', { name: /Semua/ }).getAttribute('aria-selected')).toBe('false')
  })

  it('reports the id of the tab that was clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedTabs tabs={TABS} value="" onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: /Talenta/ }))

    expect(onChange).toHaveBeenCalledWith('talent')
  })
})
