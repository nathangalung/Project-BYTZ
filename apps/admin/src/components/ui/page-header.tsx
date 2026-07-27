export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-warning-500">{title}</h1>
        <p className="mt-1 text-sm text-neutral-300">{description}</p>
      </div>
      {actions}
    </div>
  )
}
