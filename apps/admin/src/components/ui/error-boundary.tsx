import { Component, type ReactNode } from 'react'
import i18n from '@/lib/i18n'

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
          <div className="flex min-h-screen flex-col items-center justify-center bg-primary-600 p-6 text-center">
            <h3 className="text-lg font-bold text-error-500">{i18n.t('something_wrong')}</h3>
            <p className="mt-1 text-sm text-neutral-300">{this.state.error?.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="mt-4 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-bold text-warning-500 transition-all hover:opacity-90"
            >
              {i18n.t('retry')}
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
