import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const FIELD_CLASS =
  'rounded-lg border border-neutral-600/30 bg-primary-700 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50'

export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative max-w-sm flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(FIELD_CLASS, 'w-full py-2.5 pl-9 pr-3 placeholder:text-neutral-300')}
      />
    </div>
  )
}

export function SelectFilter({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(FIELD_CLASS, 'appearance-none py-2.5 pl-3 pr-9')}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
    </div>
  )
}

export type SegmentedTab = {
  id: string
  label: string
  count?: number
}

export function SegmentedTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: SegmentedTab[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="mb-6 flex gap-1 rounded-lg bg-primary-700 p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            value === tab.id
              ? 'bg-neutral-600 text-warning-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {tab.label}
          {tab.count !== undefined && ` (${tab.count})`}
        </button>
      ))}
    </div>
  )
}
