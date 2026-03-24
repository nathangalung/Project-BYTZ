import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <h3 className="text-lg font-bold text-error-600">Something went wrong</h3>
            <p className="mt-1 text-sm text-on-surface-muted">{this.state.error?.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="mt-4 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
            >
              Try Again
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
