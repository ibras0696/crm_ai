import type { ReactNode } from 'react'
import React from 'react'

type Props = {
  title?: string
  children: ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('UI crash:', error)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 space-y-3">
          <div>
            <h1 className="text-lg font-bold">{this.props.title || 'Ошибка интерфейса'}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Страница упала с ошибкой. Обновите страницу или попробуйте позже.
            </p>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words bg-secondary/30 border border-border rounded-lg p-3 max-h-56 overflow-auto">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <div className="flex gap-2">
            <button
              className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Обновить
            </button>
            <button
              className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-secondary/30"
              onClick={() => this.setState({ error: null })}
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    )
  }
}

