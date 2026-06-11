import { useState, useEffect } from 'react'
import { Minus, Square, X, Server, RefreshCw } from 'lucide-react'
import { triggerManualUpdateCheck } from './UpdateBanner'

export default function TitleBar() {
  const [version, setVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    window.electronAPI.updater.getVersion().then(({ version: v }) => {
      setVersion(v)
    }).catch(() => {
      setVersion('')
    })
  }, [])

  const handleCheckUpdate = () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    // Trigger the UpdateBanner's manual check
    if (triggerManualUpdateCheck) {
      triggerManualUpdateCheck()
    }
    // Reset the spinner after 3 seconds
    setTimeout(() => setCheckingUpdate(false), 3000)
  }

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

      {/* Center: Check for updates button */}
      <div className="flex-1 flex justify-center no-drag">
        <button
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
          className="flex items-center gap-1.5 text-xs text-pz-muted hover:text-pz-text transition-colors px-2 py-1 rounded hover:bg-pz-border disabled:opacity-50"
          title="Check for updates"
        >
          <RefreshCw size={11} className={checkingUpdate ? 'animate-spin' : ''} />
          Check for updates
        </button>
      </div>

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
