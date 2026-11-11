import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle, ChevronDown, ChevronRight, Loader } from 'lucide-react'
import type { BuildVersion } from '../store/useAppStore'
import { parseSteamProgress, gbDone } from '../lib/steamProgress'

type Phase = 'idle' | 'steamcmd' | 'server' | 'done' | 'error'

interface Props {
  steamcmdDir: string
  serverDir: string
  buildVersion: BuildVersion
  mode: 'install' | 'update'
  onDone?: () => void
}

// Runs SteamCMD to install or update the dedicated server and shows a friendly progress view.
// The raw SteamCMD output is tucked away behind "Show details".
export default function InstallRunner({ steamcmdDir, serverDir, buildVersion, mode, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pct, setPct] = useState<number | null>(null)
  const [stage, setStage] = useState('')
  const [bytes, setBytes] = useState<{ done: number; total: number } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (showLog) endRef.current?.scrollIntoView() }, [logs, showLog])

  const onLine = (line: string) => {
    setLogs(prev => [...prev.slice(-500), line])
    // steamcmd goes through several stages that each count 0-100, so say which one we're in
    const p = parseSteamProgress(line)
    if (p) {
      setStage(p.stage)
      setPct(p.pct)
      setBytes(p.done !== undefined && p.total ? { done: p.done, total: p.total } : null)
    }
  }

  const run = async () => {
    setLogs([])
    setError('')
    setPct(null)
    setStage('')
    setBytes(null)
    try {
      setPhase('steamcmd')
      onLine('Getting SteamCMD (Valve\'s download tool)...')
      const dl = await window.electronAPI.steamcmd.download(steamcmdDir)
      if (!dl.success) throw new Error(dl.message)
      const exe = dl.path || `${steamcmdDir}\\steamcmd.exe`

      setPhase('server')
      const fn = mode === 'install' ? window.electronAPI.steamcmd.installServer : window.electronAPI.steamcmd.updateServer
      const result = await fn(exe, serverDir, onLine, buildVersion)
      if (!result.success) throw new Error(result.message)

      setPhase('done')
      setPct(100)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
      setShowLog(true)
    }
  }

  const running = phase === 'steamcmd' || phase === 'server'

  return (
    <div className="space-y-3">
      {phase === 'idle' || phase === 'error' ? (
        <button onClick={run} className="btn-primary w-full justify-center py-3">
          {mode === 'install' ? <Download size={16} /> : <RefreshCw size={16} />}
          {phase === 'error' ? 'Try again' : mode === 'install' ? 'Install server' : 'Update server'}
        </button>
      ) : null}

      {running && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-pz-text">
            <Loader size={14} className="animate-spin text-pz-green" />
            {phase === 'steamcmd' ? 'Getting SteamCMD...' : mode === 'install' ? 'Downloading the game server (about 7 GB, this takes a while)...' : 'Checking for server updates...'}
          </div>
          <div className="h-2 bg-pz-darker rounded-full overflow-hidden">
            <div
              className={`h-full bg-pz-green transition-all duration-500 ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
          {pct !== null && (
            <p className="text-xs text-pz-muted">
              {stage === 'downloading' ? 'Downloading' : stage === 'committing' ? 'Installing files' : /^verifying/.test(stage) ? 'Checking files' : /^preallocating/.test(stage) ? 'Making room' : stage || 'Working'}: {pct.toFixed(0)}%
              {bytes && bytes.total > 0 && ` (${gbDone(bytes.done, bytes.total)})`}
            </p>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="flex items-center gap-2 text-sm text-pz-green">
          <CheckCircle size={16} /> {mode === 'install' ? 'Server installed!' : 'Server is up to date!'}
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-start gap-2 text-sm text-pz-red">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          {/* a full sentence is the app saying what to do (stop a server first...) or what went wrong, shown as it is */}
          <span>{/[.!]$/.test(error) ? error : <>Something went wrong: {error}.</>}</span>
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <button onClick={() => setShowLog(s => !s)} className="text-xs text-pz-muted hover:text-pz-text flex items-center gap-1">
            {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showLog ? 'Hide' : 'Show'} details
          </button>
          {showLog && (
            <div className="mt-2 max-h-56 overflow-y-auto bg-pz-darker border border-pz-border rounded-md p-3 console-output text-pz-subtext select-text">
              {logs.map((l, i) => <div key={i}>{l}</div>)}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
