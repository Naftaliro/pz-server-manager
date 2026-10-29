import { useEffect, useState } from 'react'
import { Archive, FolderOpen, Loader, CheckCircle } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../lib/profile'

// App settings: keep a copy of every Workshop mod the servers use, all in one folder
export default function ModBackupsCard() {
  const { profiles, setSettings } = useAppStore()
  const [status, setStatus] = useState<{ enabled: boolean; dir: string; count: number; sizeBytes?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async (withSize = true) => {
    const r = await window.electronAPI.modBackups.status(withSize)
    if (r.success) setStatus({ enabled: !!r.enabled, dir: r.dir || '', count: Object.keys(r.items || {}).length, sizeBytes: r.sizeBytes })
  }
  useEffect(() => { void load() }, [])

  const configure = async (patch: { enabled?: boolean; dir?: string }) => {
    await window.electronAPI.modBackups.configure(patch)
    setSettings(await window.electronAPI.settings.get())
    await load(false)
  }

  const pickDir = async () => {
    const dir = await window.electronAPI.dialog.openFolder()
    if (dir) await configure({ dir })
  }

  // every Workshop mod on any server, once
  const allMods = () => {
    const seen = new Map<string, string>()
    for (const p of profiles) for (const m of p.mods) if (m.workshopId && !seen.has(m.workshopId)) seen.set(m.workshopId, m.name)
    return [...seen].map(([workshopId, name]) => ({ workshopId, name }))
  }

  const backupNow = async () => {
    setBusy(true)
    setMsg('')
    const r = await window.electronAPI.modBackups.backupNow(allMods())
    setBusy(false)
    if (!r.success) { setMsg(r.message || "Couldn't make the backups."); return }
    setMsg([
      r.saved ? `Saved ${r.saved} mod${r.saved === 1 ? '' : 's'}.` : '',
      r.same ? `${r.same} already up to date.` : '',
      r.missing ? `${r.missing} not downloaded yet.` : '',
    ].filter(Boolean).join(' ') || 'Nothing to back up yet.')
    await load()
  }

  const on = !!status?.enabled

  return (
    <div className="card p-5 space-y-3">
      <h3 className="section-title flex items-center gap-2"><Archive size={14} /> Mod backups</h3>
      <p className="text-sm text-pz-subtext">
        Keeps a copy of every Workshop mod your servers use, all in one folder. If a mod gets taken off the Workshop
        or an update breaks it, the Mods tab can switch to your saved copy.
      </p>
      <button onClick={() => configure({ enabled: !on })} className="w-full flex items-center gap-3 text-left">
        <div className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-pz-green' : 'bg-pz-border'}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-pz-text transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </div>
        <div>
          <div className="text-sm text-pz-text">Back up mods after they download</div>
          <div className="text-xs text-pz-muted">The last 2 versions of each mod are kept. Big modpacks can take a few GB.</div>
        </div>
      </button>
      {status && (
        <>
          <div>
            <label className="label">Saved in</label>
            <div className="flex gap-2">
              <input value={status.dir} readOnly className="input text-xs font-mono" />
              <button onClick={pickDir} className="btn-outline flex-shrink-0" title="Pick another folder"><FolderOpen size={14} /></button>
            </div>
          </div>
          <p className="text-xs text-pz-muted">
            {status.count > 0
              ? <><CheckCircle size={11} className="inline text-pz-green mr-1" />{status.count} mod{status.count === 1 ? '' : 's'} saved{status.sizeBytes ? `, ${formatBytes(status.sizeBytes)}` : ''}.</>
              : 'Nothing saved yet.'}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={backupNow} disabled={busy} className="btn-outline text-xs">
              {busy ? <Loader size={12} className="animate-spin" /> : <Archive size={12} />} {busy ? 'Copying...' : 'Back up every mod now'}
            </button>
            {status.count > 0 && (
              <button onClick={() => window.electronAPI.shell.openPath(status.dir)} className="btn-ghost text-xs"><FolderOpen size={12} /> Open folder</button>
            )}
          </div>
          {msg && <p className="text-xs text-pz-green">{msg}</p>}
        </>
      )}
    </div>
  )
}
