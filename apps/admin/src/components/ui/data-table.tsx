import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  // Presence makes the column sortable; absence leaves the header inert.
  sortValue?: (row: T) => string | number
  cellClassName?: string
}

type SortState = { key: string; direction: 'asc' | 'desc' }

type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  isLoading?: boolean
  isError?: boolean
  errorMessage: string
  emptyMessage: string
  emptyIcon?: React.ReactNode
  onRowSelect?: (row: T) => void
  rowLabel?: (row: T) => string
  skeletonRows?: number
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  isError,
  errorMessage,
  emptyMessage,
  emptyIcon,
  onRowSelect,
  rowLabel,
  skeletonRows = 5,
}: DataTableProps<T>) {
  // Unsorted by default so the server's ordering is what loads.
  const [sort, setSort] = useState<SortState | null>(null)

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    const sortValue = column.sortValue
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(sortValue(a), sortValue(b)) * factor)
  }, [rows, columns, sort])

  function toggleSort(key: string) {
    setSort((current) =>
      current?.key === key && current.direction === 'asc'
        ? { key, direction: 'desc' }
        : { key, direction: 'asc' },
    )
  }

  function handleRowKeyDown(e: React.KeyboardEvent, row: T) {
    if (!onRowSelect) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowSelect(row)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-primary-700/60">
              {columns.map((column) => {
                const active = sort?.key === column.key
                return (
                  <th
                    key={column.key}
                    aria-sort={
                      active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500"
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 hover:text-warning-600"
                      >
                        {column.header}
                        {!active && <ChevronsUpDown className="h-3 w-3 opacity-60" />}
                        {active && sort.direction === 'asc' && <ChevronUp className="h-3 w-3" />}
                        {active && sort.direction === 'desc' && <ChevronDown className="h-3 w-3" />}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-primary-700/40">
            {isError ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-error-500"
                >
                  {errorMessage}
                </td>
              </tr>
            ) : isLoading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                <tr key={`skeleton-${i}`}>
                  <td colSpan={columns.length} className="px-4 py-4">
                    <div className="h-6 animate-pulse rounded bg-primary-700/60" />
                  </td>
                </tr>
              ))
            ) : sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-neutral-300"
                >
                  {emptyIcon ? (
                    <div className="flex flex-col items-center gap-2">
                      {emptyIcon}
                      <p>{emptyMessage}</p>
                    </div>
                  ) : (
                    emptyMessage
                  )}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                // Row-level activation keeps table semantics intact; a button per
                // row would add a tab stop inside every cell.
                <tr
                  key={rowKey(row)}
                  onClick={onRowSelect ? () => onRowSelect(row) : undefined}
                  onKeyDown={onRowSelect ? (e) => handleRowKeyDown(e, row) : undefined}
                  tabIndex={onRowSelect ? 0 : undefined}
                  aria-label={rowLabel?.(row)}
                  className={cn(
                    onRowSelect &&
                      'cursor-pointer transition-colors hover:bg-primary-700/30 focus-visible:bg-primary-700/30 focus-visible:outline-none',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('whitespace-nowrap px-4 py-3', column.cellClassName)}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
