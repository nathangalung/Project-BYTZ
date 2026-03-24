import { Inbox } from 'lucide-react'

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon ?? <Inbox className="h-12 w-12 text-neutral-300" />}
      <h3 className="mt-4 text-lg font-bold text-on-surface">{title}</h3>
      {description && <p className="mt-1 text-sm text-on-surface-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
