import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div>
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-xl border bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:outline-none focus:ring-1',
            error
              ? 'border-error-500 focus:border-error-500 focus:ring-error-500/20'
              : 'border-outline-dim/30 focus:border-primary-500 focus:ring-primary-500/30',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={error && inputId ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={inputId ? `${inputId}-error` : undefined}
            className="mt-1 text-xs text-error-600"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'
