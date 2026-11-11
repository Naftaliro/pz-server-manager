import { useState } from 'react'
import { Play, Square, Loader, AlertTriangle, X, AlertCircle } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import { applyFix } from '../lib/fixes'
import { useBusyFor } from '../lib/leaveGuard'

// Start/Stop in one button. Before starting it runs the pre-start checks and,
// if something would break the server, explains it with a button to fix it.
export default function StartButton({ profile, className = '', big = false }: { profile: ServerProfile; className?: string; big?: boolean }) {
  const { serverStatuses, clearProblems } = useAppStore()
  const status = serverStatuses[profile.id] || 'stopped'
  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<ServerPreflightIssue[] | null>(null)
  const [error, setError] = useState('')
  // its game files are updating or its world is being rolled back: not now, and why
  const { blocked } = useBusyFor(profile)

  // the backup before a new game version converts the world failed: Start anyway means without it
  const [noBackup, setNoBackup] = useState(false)

  const start = async (force = false, withoutBackup = false) => {
    setBusy(true)
    setError('')
    try {
      if (!force) {
        const found = await window.electronAPI.server.preflight(profile.id)
        if (found.some(i => i.level === 'error')) {
          setNoBackup(false)
          setIssues(found)
          return
        }
      }
      setIssues(null)
      clearProblems(profile.id)
      const result = await window.electronAPI.server.start(profile.id, withoutBackup ? { withoutBackup: true } : undefined)
      if (result.needsConfirm === 'no-backup') {
        setNoBackup(true)
        setIssues([{ level: 'error', message: result.message }])
      } else if (!result.success) setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try { await window.electronAPI.server.stop(profile.id) } finally { setBusy(false) }
  }

  const fix = async (issue: ServerPreflightIssue) => {
    setIssues(null)
    const msg = await applyFix(issue, profile)
    if (msg) setError(msg)
  }

  const size = big ? 'px-6 py-3 text-base' : ''

  return (
    <>
      {status === 'stopped' ? (
        blocked ? (
          <span className={`flex flex-col items-center gap-1 ${className}`} title={blocked}>
            <button disabled className={`btn-primary w-full justify-center ${size}`}>
              <Play size={big ? 18 : 14} /> Start
            </button>
            {big && <span className="text-[11px] text-pz-muted max-w-48 text-center leading-tight">{blocked}</span>}
          </span>
        ) : (
          <button onClick={() => start()} disabled={busy} className={`btn-primary ${size} ${className}`}>
            {busy ? <Loader size={big ? 18 : 14} className="animate-spin" /> : <Play size={big ? 18 : 14} />}
            {busy ? 'Checking...' : 'Start'}
          </button>
        )
      ) : status === 'stopping' ? (
        <button disabled className={`btn-outline ${size} ${className}`}>
          <Loader size={big ? 18 : 14} className="animate-spin" /> Stopping...
        </button>
      ) : (
        <button onClick={stop} disabled={busy} className={`btn-danger ${size} ${className}`}>
          <Square size={big ? 18 : 14} /> Stop
        </button>
      )}

      {error && (
        <div className="fixed bottom-6 right-6 z-50 card p-4 max-w-sm shadow-2xl border-pz-red/40 flex gap-3">
          <AlertCircle size={18} className="text-pz-red flex-shrink-0" />
          <div className="text-sm text-pz-text flex-1">{error}</div>
          <button onClick={() => setError('')} className="text-pz-muted hover:text-pz-text"><X size={14} /></button>
        </div>
      )}

      {issues && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setIssues(null)}>
          <div className="bg-pz-card border border-pz-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pz-red/20 text-pz-red flex items-center justify-center flex-shrink-0"><AlertTriangle size={20} /></div>
              <div className="flex-1">
                <h3 className="font-semibold text-pz-text">{noBackup ? "The world couldn't be backed up" : "Hold on, this server won't start properly yet"}</h3>
                <p className="text-sm text-pz-subtext mt-1">{noBackup ? 'So it was left off:' : 'Fix these first:'}</p>
              </div>
              <button onClick={() => setIssues(null)} className="text-pz-muted hover:text-pz-text"><X size={16} /></button>
            </div>
            <div className="space-y-2 mb-5 max-h-72 overflow-y-auto">
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-3 bg-pz-darker rounded-lg p-3">
                  <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${issue.level === 'error' ? 'text-pz-red' : 'text-pz-yellow'}`} />
                  <p className="text-sm text-pz-text flex-1">{issue.message}</p>
                  {issue.fix && <button onClick={() => fix(issue)} className="btn-outline text-xs py-1 px-2 flex-shrink-0">Fix</button>}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => start(true, noBackup)} className="btn-ghost text-xs">Start anyway</button>
              <button onClick={() => setIssues(null)} className="btn-primary">OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
