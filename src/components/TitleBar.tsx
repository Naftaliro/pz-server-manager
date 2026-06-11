import { Minus, Square, X, Server } from 'lucide-react'

export default function TitleBar() {
  return (
    <div className="flex items-center justify-between h-10 bg-pz-darker border-b border-pz-border drag-region px-4 flex-shrink-0">
      {/* Left: App icon + title */}
      <div className="flex items-center gap-2 no-drag">
        <div className="w-5 h-5 text-pz-green">
          <Server size={18} />
        </div>
        <span className="text-sm font-semibold text-pz-text">PZ Server Manager</span>
        <span className="text-xs text-pz-muted ml-1">v1.0.0</span>
      </div>

      {/* Center: Drag region */}
      <div className="flex-1" />

      {/* Right: Window controls */}
      <div className="flex items-center no-drag">
        <button
          onClick={() => window.electronAPI.window.minimize()}
          className="w-10 h-10 flex items-center justify-center text-pz-muted hover:text-pz-text hover:bg-pz-border transition-colors"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.electronAPI.window.maximize()}
          className="w-10 h-10 flex items-center justify-center text-pz-muted hover:text-pz-text hover:bg-pz-border transition-colors"
          title="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => window.electronAPI.window.close()}
          className="w-10 h-10 flex items-center justify-center text-pz-muted hover:text-white hover:bg-pz-red transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
