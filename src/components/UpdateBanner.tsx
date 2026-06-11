import { useState, useEffect } from 'react'
import { Download, X, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'

interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseUrl: string
  downloadUrl: string
  assetName: string
  assetSize: number
  publishedAt: string
}

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'done' | 'error' | 'uptodate'

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    // Check for updates on startup after a short delay
    const timer = setTimeout(() => {
      checkForUpdates()
    }, 3000)

    // Listen for download progress from main process
    const cleanup = window.electronAPI.updater.onProgress((data: { stage: string; pct: number }) => {
      setProgressStage(data.stage)
      setProgress(data.pct)
    })

    return () => {
      clearTimeout(timer)
      cleanup()
    }
  }, [])

  const checkForUpdates = async () => {
    setState('checking')
    setErrorMsg('')
    try {
      const result = await window.electronAPI.updater.check()
      if (!result.success) {
        // Silently fail on startup check — don't bother user if no internet
        setState('idle')
        return
      }
      if (result.available) {
        setUpdateInfo(result as UpdateInfo)
        setState('available')
      } else {
        setState('uptodate')
        // Auto-hide "up to date" after 4 seconds
        setTimeout(() => setState('idle'), 4000)
      }
    } catch {
      setState('idle')
    }
  }

  const handleInstall = async () => {
    if (!updateInfo) return
    setState('downloading')
    setProgress(0)
    setProgressStage('Starting download...')

    try {
      const result = await window.electronAPI.updater.install(updateInfo.downloadUrl, updateInfo.assetName)
      if (result.success) {
        setState('done')
        setProgressStage('Update ready — restarting...')
      } else {
        setErrorMsg(result.message || 'Installation failed')
        setState('error')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
      setState('error')
    }
  }

  const handleOpenReleasePage = () => {
    if (updateInfo) {
      window.electronAPI.updater.openReleasePage(updateInfo.releaseUrl)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return ''
    const mb = bytes / 1024 / 1024
    return ` (${mb.toFixed(0)} MB)`
  }

  // Nothing to show
  if (dismissed || state === 'idle') return null

  // Checking silently — no banner
  if (state === 'checking') return null

  // Up to date — small green pill
  if (state === 'uptodate') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-pz-green/10 border-b border-pz-green/20 text-xs text-pz-green">
        <CheckCircle size={12} />
        <span>PZ Server Manager is up to date (v{updateInfo?.currentVersion || ''})</span>
      </div>
    )
  }

  return (
    <div className="border-b border-pz-border bg-pz-darker flex-shrink-0">
      {/* Update available */}
      {state === 'available' && updateInfo && (
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-pz-green animate-pulse flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm text-pz-text font-medium">
              Update available: v{updateInfo.latestVersion}
            </span>
            <span className="text-xs text-pz-muted ml-2">
              (you have v{updateInfo.currentVersion})
            </span>
            {updateInfo.releaseNotes && (
              <button
                onClick={() => setShowNotes(n => !n)}
                className="text-xs text-pz-green ml-2 hover:underline"
              >
                {showNotes ? 'Hide notes' : 'What\'s new?'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleOpenReleasePage}
              className="btn-ghost text-xs py-1 px-2"
              title="View release on GitHub"
            >
              <ExternalLink size={12} />
              GitHub
            </button>
            <button
              onClick={handleInstall}
              className="btn-primary text-xs py-1 px-3"
            >
              <Download size={12} />
              Install{formatSize(updateInfo.assetSize)}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="btn-ghost p-1"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Release notes dropdown */}
      {state === 'available' && showNotes && updateInfo?.releaseNotes && (
        <div className="px-4 pb-3 max-h-32 overflow-y-auto">
          <pre className="text-xs text-pz-muted whitespace-pre-wrap font-sans leading-relaxed">
            {updateInfo.releaseNotes.substring(0, 800)}
            {updateInfo.releaseNotes.length > 800 ? '...' : ''}
          </pre>
        </div>
      )}

      {/* Downloading */}
      {state === 'downloading' && (
        <div className="px-4 py-2">
          <div className="flex items-center gap-3 mb-1.5">
            <RefreshCw size={12} className="text-pz-green animate-spin flex-shrink-0" />
            <span className="text-sm text-pz-text">{progressStage}</span>
            <span className="text-xs text-pz-muted ml-auto">{progress}%</span>
          </div>
          <div className="w-full bg-pz-border rounded-full h-1.5">
            <div
              className="bg-pz-green h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-pz-muted mt-1">
            Your server profiles and settings will be preserved.
          </p>
        </div>
      )}

      {/* Done / restarting */}
      {state === 'done' && (
        <div className="flex items-center gap-2 px-4 py-2">
          <CheckCircle size={14} className="text-pz-green flex-shrink-0" />
          <span className="text-sm text-pz-text">Update downloaded — restarting app...</span>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex items-center gap-3 px-4 py-2">
          <AlertCircle size={14} className="text-pz-red flex-shrink-0" />
          <span className="text-sm text-pz-red flex-1">Update failed: {errorMsg}</span>
          <button
            onClick={handleOpenReleasePage}
            className="btn-outline text-xs py-1 px-2"
          >
            <ExternalLink size={12} />
            Download manually
          </button>
          <button onClick={() => setDismissed(true)} className="btn-ghost p-1">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
