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
      <div className="flex gap-1 rounded-2xl bg-surface-container p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => handleChange(tab.id)}
            className={cn(
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition-all',
              active === tab.id
                ? 'bg-surface-bright text-primary-600 shadow-sm'
                : 'text-on-surface-muted hover:text-primary-600',
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
