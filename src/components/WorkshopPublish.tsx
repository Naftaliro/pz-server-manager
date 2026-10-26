import { useEffect, useState } from 'react'
import { CheckCircle, Loader, FolderOpen, Gamepad2, Upload, AlertTriangle, Info } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { downloadAndScan } from '../lib/mods'
import { cantUploadReason } from '../../shared/workshopItem'

// Walks the host through putting a local fix mod on the Workshop (unlisted), so
// players' games download it by themselves instead of needing a server pack for it
export default function WorkshopPublish({ profileId, modId, onDone }: { profileId: string; modId: string; onDone: () => void }) {
  const { modDownloads } = useAppStore()
  const [status, setStatus] = useState<{ prepared?: boolean; workshopId?: string | null; itemDir?: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [swappedId, setSwappedId] = useState<string | null>(null)

  const refresh = async () => {
    const r = await window.electronAPI.workshop.status(profileId, modId)
    if (r.success) setStatus(r)
    else setMsg({ tone: 'error', text: r.message || "Couldn't check." })
  }
  useEffect(() => { void refresh() }, [profileId, modId])

  const prepare = async () => {
    setBusy('prepare')
    const r = await window.electronAPI.workshop.prepare(profileId, modId)
    setBusy('')
    if (!r.success) { setMsg({ tone: 'error', text: r.message || "Couldn't get it ready." }); return }
    setMsg(null)
    setStatus({ prepared: true, workshopId: r.workshopId, itemDir: r.itemDir })
  }

  const checkUpload = async () => {
    setBusy('check')
    const r = await window.electronAPI.workshop.status(profileId, modId)
    if (!r.success || !r.workshopId) {
      setBusy('')
      setMsg({ tone: 'info', text: "No upload found yet. Finish the upload in the game first (it writes the Workshop number back when it's done)." })
      return
    }
    const swap = await window.electronAPI.workshop.useWorkshopCopy(profileId, modId, r.workshopId)
    setBusy('')
    if (!swap.success) { setMsg({ tone: 'error', text: swap.message || "Couldn't switch it over." }); return }
    setSwappedId(r.workshopId)
    setMsg(null)
    // the real test: can the server's own downloader (SteamCMD) get it?
    void downloadAndScan(profileId, [r.workshopId])
  }

  const dl = swappedId ? modDownloads[swappedId] : undefined
  const blocked = cantUploadReason(modId)

  if (blocked) {
    return (
      <Panel>
        <p className="text-xs text-pz-subtext flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 flex-shrink-0 text-pz-blue" /> {blocked}
        </p>
        <button onClick={onDone} className="btn-ghost text-xs py-1 px-2">Close</button>
      </Panel>
    )
  }

  if (swappedId) {
    return (
      <Panel>
        {dl?.state === 'done' ? (
          <p className="text-sm text-pz-green flex items-center gap-1.5">
            <CheckCircle size={14} /> Done. The server downloaded it from the Workshop, so friends' games will get it by themselves when they join.
          </p>
        ) : dl?.state === 'failed' ? (
          <div className="space-y-1.5 text-sm">
            <p className="text-pz-red flex items-center gap-1.5"><AlertTriangle size={14} /> The server couldn't download it from the Workshop.</p>
            <p className="text-xs text-pz-subtext">
              Steam sometimes won't hand out unlisted items. Open the item's Steam page, change Visibility to <b>Public</b>, then hit retry on the mod above.
            </p>
            <button onClick={() => window.electronAPI.shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${swappedId}`)} className="btn-outline text-xs py-1 px-2">Open its Steam page</button>
          </div>
        ) : (
          <p className="text-sm text-pz-subtext flex items-center gap-1.5"><Loader size={14} className="animate-spin" /> Switched over. Checking the server can download it...</p>
        )}
        <p className="text-xs text-pz-muted">
          Make a new server pack for your friends, this fix now comes from the Workshop instead.
        </p>
        <button onClick={onDone} className="btn-ghost text-xs py-1 px-2">Close</button>
      </Panel>
    )
  }

  return (
    <Panel>
      <p className="text-xs text-pz-subtext">
        Put this fix on the Steam Workshop (unlisted, so it won't show up in searches) and players' games download it
        by themselves when they join. No server pack needed for it any more.
      </p>

      <Step n={1} done={!!status?.prepared} title="Get it ready">
        {status?.prepared ? (
          <div className="flex items-center gap-2 text-xs text-pz-subtext">
            Ready in Zomboid\Workshop.
            {status.itemDir && <button onClick={() => window.electronAPI.workshop.openFolder(status.itemDir!)} className="btn-ghost text-xs py-0.5 px-2"><FolderOpen size={11} /> Open folder</button>}
            <button onClick={prepare} disabled={!!busy} className="underline text-pz-muted hover:text-pz-text">refresh the files</button>
          </div>
        ) : (
          <button onClick={prepare} disabled={!!busy} className="btn-outline text-xs py-1 px-2">
            {busy === 'prepare' ? <Loader size={11} className="animate-spin" /> : <Upload size={11} />} Get it ready for upload
          </button>
        )}
      </Step>

      <Step n={2} done={!!status?.workshopId} title="Upload it from the game">
        <ol className="text-xs text-pz-subtext list-decimal ml-4 space-y-0.5">
          <li>Start Project Zomboid and open <b>Workshop</b> on the main menu.</li>
          <li>Pick <b>Create and update items</b>, select this mod, then <b>Next</b>.</li>
          <li>Check the title and description, leave Visibility on <b>Unlisted</b>, tick a tag like Build 42 if you want, then <b>Upload</b>.</li>
          <li>The first time, Steam asks you to accept its Workshop agreement.</li>
        </ol>
        <button onClick={() => window.electronAPI.client.launch()} disabled={!status?.prepared} className="btn-ghost text-xs py-1 px-2 mt-1">
          <Gamepad2 size={11} /> Start the game
        </button>
      </Step>

      <Step n={3} done={false} title="Switch the server over">
        <button onClick={checkUpload} disabled={!!busy || !status?.prepared} className="btn-primary text-xs py-1 px-3">
          {busy === 'check' ? <Loader size={11} className="animate-spin" /> : <CheckCircle size={11} />} I've uploaded it
        </button>
      </Step>

      {msg && (
        <p className={`text-xs ${msg.tone === 'error' ? 'text-pz-red' : msg.tone === 'ok' ? 'text-pz-green' : 'text-pz-subtext'}`}>{msg.text}</p>
      )}
      <p className="text-xs text-pz-muted flex items-start gap-1.5">
        <Info size={11} className="mt-0.5 flex-shrink-0" />
        Optional: on the item's Steam page, "Add/Remove Required Items" links the mods it needs, so Steam fetches those too.
      </p>
    </Panel>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="ml-7 pl-3 border-l-2 border-pz-blue/50 space-y-3">{children}</div>
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-sm text-pz-text font-medium flex items-center gap-2">
        {done ? <CheckCircle size={14} className="text-pz-green" /> : <span className="w-[14px] h-[14px] rounded-full border border-pz-muted text-[9px] flex items-center justify-center text-pz-muted">{n}</span>}
        {title}
      </div>
      <div className="ml-6">{children}</div>
    </div>
  )
}
