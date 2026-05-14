import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'

interface Props extends WithTranslation {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  copied: boolean
}

class ErrorBoundaryBase extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, copied: false }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleGoHome = (): void => {
    this.setState({ hasError: false, error: null, copied: false })
    window.location.hash = '#/compress'
  }

  handleCopyError = async (): Promise<void> => {
    const { error } = this.state
    if (!error) return
    const text = `${error.message}\n${error.stack || ''}`
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch {
      // Clipboard API may fail in some environments
    }
  }

  render(): ReactNode {
    const { t } = this.props
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <svg className="h-16 w-16 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <h2 className="text-xl font-bold text-sidebar-text">{t('errorBoundary.title')}</h2>
          <p className="text-sm text-sidebar-muted max-w-md">{t('errorBoundary.message')}</p>
          {this.state.error && (
            <p className="max-w-lg truncate text-xs text-red-400/70">{this.state.error.message}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={this.handleGoHome}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-workspace-bg hover:bg-accent-hover transition-colors"
            >
              {t('errorBoundary.goHome')}
            </button>
            <button
              onClick={this.handleCopyError}
              className="rounded-lg border border-sidebar-active px-4 py-2 text-sm font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors"
            >
              {this.state.copied ? t('errorBoundary.copied') : t('errorBoundary.copyError')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const ErrorBoundary = withTranslation()(ErrorBoundaryBase)
export default ErrorBoundary
