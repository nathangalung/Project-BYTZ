// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { type Column, DataTable } from './data-table'

/**
 * Every admin list renders through this table: users, projects, transactions.
 * The existing coverage for it asserted against the source text, which pins
 * that a branch was written but not that it behaves. These render it.
 *
 * The four data states are the reason it exists. An admin table that answers a
 * failed fetch with a blank body is the failure mode CLAUDE.md's four-state
 * rule is written against, and the branch order decides which state wins when
 * two are true at once.
 */

type Row = { id: string; name: string; amount: number }

const ROWS: Row[] = [
  { id: 'a', name: 'Budi', amount: 900_000 },
  { id: 'b', name: 'Ani', amount: 1_000_000 },
]

const NAME_COLUMN: Column<Row> = {
  key: 'name',
  header: 'Nama',
  sortValue: (r) => r.name,
  cell: (r) => r.name,
}

const AMOUNT_COLUMN: Column<Row> = {
  key: 'amount',
  header: 'Jumlah',
  sortValue: (r) => r.amount,
  cell: (r) => String(r.amount),
}

/** Absence of sortValue is what makes a header inert. */
const INERT_COLUMN: Column<Row> = { key: 'id', header: 'ID', cell: (r) => r.id }

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      columns={[NAME_COLUMN, AMOUNT_COLUMN]}
      rows={ROWS}
      rowKey={(r) => r.id}
      errorMessage="Gagal memuat data"
      emptyMessage="Tidak ada data"
      {...props}
    />,
  )
}

describe('DataTable data states', () => {
  it('renders a row per record once loaded', () => {
    renderTable()

    expect(screen.getByText('Budi')).toBeDefined()
    expect(screen.getByText('Ani')).toBeDefined()
    expect(screen.queryByText('Tidak ada data')).toBeNull()
  })

  it('shows the error message instead of an empty body', () => {
    renderTable({ isError: true })

    expect(screen.getByText('Gagal memuat data')).toBeDefined()
    expect(screen.queryByText('Budi')).toBeNull()
  })

  /**
   * A background refetch after a failure leaves both flags true. The error has
   * to win, because the alternative shows an admin a skeleton that never
   * resolves and gives them nothing to retry.
   */
  it('prefers the error over the skeleton when a failed query is refetching', () => {
    renderTable({ isError: true, isLoading: true })

    expect(screen.getByText('Gagal memuat data')).toBeDefined()
  })

  it('renders the requested number of skeleton rows while loading', () => {
    renderTable({ isLoading: true, skeletonRows: 3 })

    // One header row plus the skeletons; no data and no empty message.
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByText('Budi')).toBeNull()
    expect(screen.queryByText('Tidak ada data')).toBeNull()
  })

  it('defaults to five skeleton rows', () => {
    renderTable({ isLoading: true })

    expect(screen.getAllByRole('row')).toHaveLength(6)
  })

  it('shows the empty message when the query succeeded with no rows', () => {
    renderTable({ rows: [] })

    expect(screen.getByText('Tidak ada data')).toBeDefined()
  })

  it('renders the empty icon alongside the message when one is given', () => {
    renderTable({ rows: [], emptyIcon: <span data-icon>ikon</span> })

    expect(screen.getByText('ikon')).toBeDefined()
    expect(screen.getByText('Tidak ada data')).toBeDefined()
  })
})

describe('DataTable sorting', () => {
  it('leaves the server ordering alone until a header is clicked', () => {
    renderTable()

    const cells = screen.getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(0, 2)).toEqual(['Budi', '900000'])
  })

  it('renders no sort control for a column without a sort value', () => {
    renderTable({ columns: [INERT_COLUMN] })

    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'ID' })).toBeNull()
  })

  it('cycles a column ascending, descending, then ascending again', async () => {
    const user = userEvent.setup()
    renderTable()
    const header = screen.getByRole('button', { name: 'Nama' })

    await user.click(header)
    expect(screen.getAllByRole('cell')[0].textContent).toBe('Ani')
    expect(screen.getByRole('columnheader', { name: /Nama/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    )

    await user.click(header)
    expect(screen.getAllByRole('cell')[0].textContent).toBe('Budi')
    expect(screen.getByRole('columnheader', { name: /Nama/ }).getAttribute('aria-sort')).toBe(
      'descending',
    )

    // There is no third state; descending goes back to ascending.
    await user.click(header)
    expect(screen.getByRole('columnheader', { name: /Nama/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    )
  })

  it('starts a newly chosen column ascending rather than inheriting the old direction', async () => {
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: 'Nama' }))
    await user.click(screen.getByRole('button', { name: 'Nama' }))
    await user.click(screen.getByRole('button', { name: 'Jumlah' }))

    expect(screen.getByRole('columnheader', { name: /Jumlah/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    )
    expect(screen.getByRole('columnheader', { name: /Nama/ }).getAttribute('aria-sort')).toBeNull()
  })

  /**
   * compare only subtracts when both sides are numbers; anything else goes to
   * localeCompare. On a money column that difference is the whole point: as
   * strings "1000000" sorts before "900000", so the largest transaction would
   * present itself as the smallest.
   */
  it('orders a numeric column by magnitude, not by digit string', async () => {
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: 'Jumlah' }))

    const amounts = screen
      .getAllByRole('cell')
      .map((c) => c.textContent)
      .filter((v) => v === '900000' || v === '1000000')
    expect(amounts).toEqual(['900000', '1000000'])
  })

  it('falls back to a locale comparison for text', async () => {
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: 'Nama' }))

    const names = screen
      .getAllByRole('cell')
      .map((c) => c.textContent)
      .filter((v) => v === 'Ani' || v === 'Budi')
    expect(names).toEqual(['Ani', 'Budi'])
  })

  it('leaves rows untouched when the sorted column has since lost its sort value', async () => {
    const user = userEvent.setup()
    const { rerender } = renderTable()

    await user.click(screen.getByRole('button', { name: 'Nama' }))
    rerender(
      <DataTable<Row>
        columns={[{ ...NAME_COLUMN, sortValue: undefined }, AMOUNT_COLUMN]}
        rows={ROWS}
        rowKey={(r) => r.id}
        errorMessage="Gagal memuat data"
        emptyMessage="Tidak ada data"
      />,
    )

    expect(screen.getAllByRole('cell')[0].textContent).toBe('Budi')
  })
})

describe('DataTable row selection', () => {
  it('opens the detail panel on click', async () => {
    const user = userEvent.setup()
    const onRowSelect = vi.fn()
    renderTable({ onRowSelect, rowLabel: (r) => r.name })

    await user.click(screen.getByRole('row', { name: 'Budi' }))

    expect(onRowSelect).toHaveBeenCalledWith(ROWS[0])
  })

  /** Rows were click-only, which left the whole table unreachable by keyboard. */
  it.each(['{Enter}', ' '])('activates the focused row on %s', async (key) => {
    const user = userEvent.setup()
    const onRowSelect = vi.fn()
    renderTable({ onRowSelect, rowLabel: (r) => r.name })

    screen.getByRole('row', { name: 'Ani' }).focus()
    await user.keyboard(key)

    expect(onRowSelect).toHaveBeenCalledWith(ROWS[1])
  })

  it('ignores keys that are not an activation', async () => {
    const user = userEvent.setup()
    const onRowSelect = vi.fn()
    renderTable({ onRowSelect, rowLabel: (r) => r.name })

    screen.getByRole('row', { name: 'Ani' }).focus()
    await user.keyboard('{ArrowDown}')

    expect(onRowSelect).not.toHaveBeenCalled()
  })

  it('adds no tab stop when rows are not selectable', () => {
    renderTable({ rowLabel: (r) => r.name })

    expect(screen.getByRole('row', { name: 'Budi' }).getAttribute('tabindex')).toBeNull()
  })

  it('makes selectable rows focusable', () => {
    renderTable({ onRowSelect: vi.fn(), rowLabel: (r) => r.name })

    expect(screen.getByRole('row', { name: 'Budi' }).getAttribute('tabindex')).toBe('0')
  })
})

/**
 * Rows are the only way into a detail panel, and a selectable row carries
 * tabindex="0" but no button role, so the keyboard contract is this handler.
 * ARIA asks a control to answer to both Enter and Space.
 */
describe('DataTable keyboard selection', () => {
  it.each([
    ['{Enter}', 'Enter'],
    [' ', 'Space'],
  ])('selects the focused row on %s', async (key) => {
    const user = userEvent.setup()
    const onRowSelect = vi.fn()
    renderTable({ onRowSelect, rowLabel: (r) => r.name })
    screen.getByRole('row', { name: 'Budi' }).focus()

    await user.keyboard(key)

    expect(onRowSelect).toHaveBeenCalledTimes(1)
    expect((onRowSelect.mock.calls[0][0] as { name: string }).name).toBe('Budi')
  })

  it('ignores a key that is neither', async () => {
    const user = userEvent.setup()
    const onRowSelect = vi.fn()
    renderTable({ onRowSelect, rowLabel: (r) => r.name })
    screen.getByRole('row', { name: 'Budi' }).focus()

    await user.keyboard('{ArrowDown}')

    expect(onRowSelect).not.toHaveBeenCalled()
  })

  it('stays inert when rows are not selectable', async () => {
    const user = userEvent.setup()
    renderTable({ rowLabel: (r) => r.name })
    const row = screen.getByRole('row', { name: 'Budi' })
    row.focus()

    await user.keyboard('{Enter}')

    expect(document.body.contains(row)).toBe(true)
  })
})
