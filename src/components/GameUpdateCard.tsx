import { useEffect, useState } from 'react'
import { Download, Loader, CheckCircle, AlertTriangle, Info, Copy, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import { shortVersion, steamSwitchSteps } from '../../shared/gameVersion'

const skipKey = (dir: string) => dir.toLowerCase()

// The game server's version on the Overview: a waiting update (held until the host says so,
// with a backup first), a fall-back branch players have to switch to, or a branch Steam dropped
export default function GameUpdateCard({ profile, update, onUpdated }: { profile: ServerProfile; update: ServerUpdateInfo | null; onUpdated: () => void }) {
  const { settings, setSettings, serverStatuses, profiles, setActiveView } = useAppStore()
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'working' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const installDir = profile.serverInstallPath

  useEffect(() => window.electronAPI.backups.onUpdateProgress((dir, text) => { if (skipKey(dir) === skipKey(installDir)) setProgress(text) }), [installDir])

  if (!update?.installed) return null
  const v = (version?: string, build?: string | null) => shortVersion(version) || (build ? `build ${build}` : '')
  const from = v(update.installedVersion, update.installed)
  const to = v(update.latestVersion, update.latest)
  const skipped = settings?.skippedServerUpdate?.[skipKey(installDir)] === update.latest
  const guard = settings?.askBeforeServerUpdate !== false
  // other servers on the same files stop and update too
  const sharing = profiles.filter(p => p.serverInstallPath.toLowerCase() === installDir.toLowerCase())
  const runningOnIt = sharing.filter(p => (serverStatuses[p.id] || 'stopped') !== 'stopped')

  const notNow = async () => {
    setSettings(await window.electronAPI.settings.set({ skippedServerUpdate: { ...settings?.skippedServerUpdate, [skipKey(installDir)]: update.latest || '' } }))
  }

  const run = async () => {
    setPhase('working')
    setProgress('Getting ready...')
    const r = await window.electronAPI.backups.updateGame(installDir, { warnMinutes: 1 })
    if (r.success) { setPhase('done'); onUpdated() } else { setError(r.message); setPhase('error') }
  }

  if (update.branchMissing) {
    return (
      <Box tone="red" icon={<AlertTriangle size={14} />}>
        <p className="flex-1">
          Steam doesn't offer the "{update.branch}" version of the game anymore, so this server can't get updates and new players can't get that version.
          Pick another version in App settings.
        </p>
        <button onClick={() => setActiveView('appsettings')} className="btn-outline text-xs py-1 px-2 flex-shrink-0">Go there</button>
      </Box>
    )
  }

  if (phase === 'done') {
    return (
      <Box tone="green" icon={<CheckCircle size={14} />}>
        <p className="flex-1">The game server is updated{to ? ` to ${to}` : ''}. The worlds were backed up first, "Roll back" can take them back.</p>
        <button onClick={() => setPhase('idle')} className="text-pz-muted hover:text-pz-text"><X size={14} /></button>
      </Box>
    )
  }

  if (update.updateAvailable && !update.steamManaged && (!skipped || phase !== 'idle')) {
    return (
      <div className="card p-4 border-pz-yellow/40 space-y-3">
        <div className="flex items-start gap-3">
          <Download size={16} className="text-pz-yellow flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="text-pz-text font-medium">Game server update{from && to ? `: ${from} → ${to}` : ''}</p>
            <p className="text-pz-subtext text-xs mt-0.5">
              Players on the new version can't join until the server updates. Every world on it gets backed up first, so you can roll back if the update breaks something.
              {!guard && ' It also updates by itself at the next daily or mod update restart.'}
            </p>
          </div>
        </div>
        {phase === 'working' ? (
          <p className="text-sm text-pz-text flex items-center gap-2"><Loader size={14} className="animate-spin text-pz-green" /> {progress}</p>
        ) : phase === 'confirm' ? (
          <div className="bg-pz-darker border border-pz-border rounded-md p-3 space-y-2 text-xs text-pz-subtext">
            <p>
              {runningOnIt.length
                ? `${runningOnIt.map(p => `"${p.name}"`).join(', ')} ${runningOnIt.length === 1 ? 'is' : 'are'} running and will stop (players get a 1 minute warning in chat), then start again after the update.`
                : 'The update takes a few minutes.'}
              {sharing.length > 1 && ` ${sharing.length} servers use these game files, they all get the update.`}
            </p>
            <div className="flex gap-2">
              <button onClick={run} className="btn-primary text-xs py-1 px-3"><Download size={12} /> {runningOnIt.length ? 'Stop, back up & update' : 'Back up & update'}</button>
              <button onClick={() => setPhase('idle')} className="btn-ghost text-xs py-1 px-3">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setPhase('confirm')} className="btn-primary text-xs py-1.5 px-3"><Download size={12} /> Back up & update</button>
            <button onClick={notNow} className="btn-ghost text-xs py-1.5 px-3">Not now</button>
            {phase === 'error' && <p className="text-xs text-pz-red w-full">{error}</p>}
          </div>
        )}
      </div>
    )
  }

  if (update.behindPublic) {
    const steps = steamSwitchSteps(update.branch)
    return (
      <Box tone="blue" icon={<Info size={14} />}>
        <p className="flex-1">
          This server runs game {from || update.branch} ({update.branchLabel}). Players on the normal version{update.publicVersion ? ` (${shortVersion(update.publicVersion)})` : ''} can't join until they switch: {steps}
        </p>
        <button
          onClick={() => { navigator.clipboard.writeText(steps); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="btn-outline text-xs py-1 px-2 flex-shrink-0" title="Copy for your group chat"
        >
          {copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </Box>
    )
  }
  return null
}

function Box({ tone, icon, children }: { tone: 'yellow' | 'red' | 'green' | 'blue'; icon: React.ReactNode; children: React.ReactNode }) {
  const styles = {
    yellow: ['bg-pz-yellow/10 border-pz-yellow/30', 'text-pz-yellow'],
    red: ['bg-pz-red/10 border-pz-red/30', 'text-pz-red'],
    green: ['bg-pz-green/10 border-pz-green/30', 'text-pz-green'],
    blue: ['bg-pz-blue/10 border-pz-blue/30', 'text-pz-blue'],
  }[tone]
  return (
    <div className={`flex items-center gap-3 text-sm rounded-lg px-4 py-3 border ${styles[0]} text-pz-text`}>
      <span className={styles[1]}>{icon}</span>
      {children}
    </div>
  )
}
