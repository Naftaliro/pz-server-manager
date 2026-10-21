import { Component } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Copy } from 'lucide-react'

// If a screen crashes, show what happened instead of a blank window.
// Servers keep running either way, they live outside the app.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="card p-6 max-w-lg w-full space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={22} className="text-pz-red" />
            <h2 className="text-lg font-semibold text-pz-text">Something broke on this screen</h2>
          </div>
          <p className="text-sm text-pz-subtext">Your servers are fine, they keep running. Reloading usually fixes it.</p>
          <pre className="text-xs text-pz-muted bg-pz-darker rounded-md p-3 overflow-auto max-h-40 select-text">{error.message}</pre>
          <div className="flex gap-2">
            <button onClick={() => location.reload()} className="btn-primary"><RotateCcw size={14} /> Reload</button>
            <button onClick={() => navigator.clipboard.writeText(`${error.message}\n${error.stack || ''}`)} className="btn-outline"><Copy size={14} /> Copy error</button>
          </div>
        </div>
      </div>
    )
  }
}
