import { useState } from 'react'
import { cn } from '@/lib/utils'

type Tab = { id: string; label: string }

export function Tabs({
  tabs,
  defaultTab,
  onChange,
  children,
}: {
  tabs: Tab[]
  defaultTab?: string
  onChange?: (id: string) => void
  children: (activeTab: string) => React.ReactNode
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? '')

  function handleChange(id: string) {
    setActive(id)
    onChange?.(id)
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-neutral-200" role="tablist">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => handleChange(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors',
              active === tab.id
                ? 'border-b-2 border-primary-600 text-primary-600'
                : 'text-neutral-500 hover:text-neutral-700',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4" role="tabpanel">
        {children(active)}
      </div>
    </div>
  )
}
