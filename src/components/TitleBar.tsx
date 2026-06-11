import { useState, useEffect } from 'react'
import { Minus, Square, X, Server } from 'lucide-react'

export default function TitleBar() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    // Read the actual runtime version from the Electron main process
    // This ensures the correct version is shown even after an auto-update
    window.electronAPI.updater.getVersion().then(({ version: v }) => {
      setVersion(v)
    }).catch(() => {
      setVersion('')
    })
  }, [])

  return (
    <div className="flex items-center justify-between h-10 bg-pz-darker border-b border-pz-border drag-region px-4 flex-shrink-0">
      {/* Left: App icon + title */}
      <div className="flex items-center gap-2 no-drag">
        <div className="w-5 h-5 text-pz-green">
          <Server size={18} />
        </div>
        <span className="text-sm font-semibold text-pz-text">PZ Server Manager</span>
        {version && (
          <span className="text-xs text-pz-muted ml-1">v{version}</span>
        )}
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
