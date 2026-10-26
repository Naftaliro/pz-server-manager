import { useEffect, useState } from 'react'
import {
  Gamepad2, FolderOpen, Search, CheckCircle, AlertTriangle, Loader, Play as PlayIcon, Download, Trash2,
  FileUp, Wrench, Info, ChevronDown, ChevronRight, Copy, RefreshCw, User,
} from 'lucide-react'
import { accountProblem, suggestPassword } from '../../shared/serverPack'

// Play mode: join a friend's server with the same mods. The host sends a server pack
// (made in their Mods tab), this page compares it with this PC, installs the host's
// fix mods and starts the game.
export default function Play() {
  const [servers, setServers] = useState<PlayServer[]>([])
  const [gameDir, setGameDir] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<string[] | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const refresh = async () => {
    const r = await window.electronAPI.client.listServers()
    if (r.success) { setServers(r.servers || []); setGameDir(r.gameDir) }
    else setMsg({ tone: 'error', text: r.message || "Couldn't read your servers." })
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])

  const useDir = async (dir: string) => {
    const r = await window.electronAPI.client.useGameDir(dir)
    if (r.success) { setFound(null); setMsg(null); await refresh() }
    else setMsg({ tone: 'error', text: r.message || "That folder didn't work." })
  }

  const pickFolder = async () => {
    const dir = await window.electronAPI.dialog.openFolder()
    if (dir) await useDir(dir)
  }

  const findIt = async () => {
    setSearching(true)
    const r = await window.electronAPI.client.searchDrives()
    setSearching(false)
    const hits = r.found || []
    if (hits.length === 1) await useDir(hits[0])
    else setFound(hits)
  }

  const openPack = async () => {
    setMsg(null)
    const r = await window.electronAPI.client.openPack()
    if (!r.success) setMsg({ tone: 'error', text: r.message || "Couldn't open that pack." })
    else if (!r.cancelled) { setMsg({ tone: 'ok', text: 'Server added.' }); await refresh() }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-pz-text flex items-center gap-2"><Gamepad2 size={20} /> Play</h1>
          <p className="text-sm text-pz-subtext mt-1">Join a friend's server with exactly the mods and fixes they use.</p>
        </div>

        {/* the game itself */}
        <div className="card p-5 space-y-3">
          <h3 className="section-title">Your game</h3>
          {loading ? (
            <p className="text-sm text-pz-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Looking for Project Zomboid...</p>
          ) : gameDir ? (
            <p className="text-sm text-pz-green flex items-center gap-2"><CheckCircle size={14} /> Found it: <span className="text-pz-subtext truncate">{gameDir}</span></p>
          ) : (
            <p className="text-sm text-pz-yellow flex items-center gap-2"><AlertTriangle size={14} /> Couldn't find Project Zomboid through Steam.</p>
          )}
          <div className="flex gap-2 flex-wrap">
            <button onClick={findIt} disabled={searching} className="btn-outline text-xs">
              {searching ? <Loader size={12} className="animate-spin" /> : <Search size={12} />} Find it on my drives
            </button>
            <button onClick={pickFolder} className="btn-ghost text-xs"><FolderOpen size={12} /> Pick the folder myself</button>
          </div>
          {found && (
            found.length === 0 ? (
              <p className="text-xs text-pz-muted">Not in the usual Steam folders on any drive. Use "Pick the folder myself" and choose the ProjectZomboid folder.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-pz-subtext">Found more than one, which one do you play?</p>
                {found.map(d => (
                  <button key={d} onClick={() => useDir(d)} className="block w-full text-left text-xs text-pz-text hover:text-pz-green truncate">{d}</button>
                ))}
              </div>
            )
          )}
          <p className="text-xs text-pz-muted">"Find it" only looks in the usual Steam folders on each drive, nothing else on your PC.</p>
        </div>

        {/* servers from packs */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="section-title flex-1">Servers</h3>
            <button onClick={openPack} className="btn-primary text-xs"><FileUp size={12} /> Open a server pack</button>
          </div>
          {msg && <p className={`text-xs ${msg.tone === 'ok' ? 'text-pz-green' : 'text-pz-red'}`}>{msg.text}</p>}
          {!loading && servers.length === 0 && (
            <div className="text-sm text-pz-subtext space-y-1">
              <p>No servers yet. Ask whoever hosts for their <b>server pack</b> (a <code>.pzpack</code> file).</p>
              <p className="text-xs text-pz-muted">They make it in Knox Launcher: their server → Mods → Import / Export → Share with players.</p>
            </div>
          )}
          {servers.map(s => <ServerCard key={s.id} server={s} gameFound={!!gameDir} onChange={refresh} />)}
        </div>

        <p className="text-xs text-pz-muted flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          Only open server packs from people you trust: the fix mods inside run in your game like any other mod.
        </p>
      </div>
    </div>
  )
}

function ServerCard({ server, gameFound, onChange }: { server: PlayServer; gameFound: boolean; onChange: () => void }) {
  const { pack, check } = server
  const [busy, setBusy] = useState<'' | 'install' | 'launch'>('')
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const needFixes = check.localMods.filter(m => m.status !== 'ok')
  const address = pack.server.address ? `${pack.server.address}:${pack.server.port}` : ''
  const account = server.account
  const [editing, setEditing] = useState(!account)
  const [username, setUsername] = useState(account?.username || '')
  const [password, setPassword] = useState(account?.password || suggestPassword())
  const [showLogin, setShowLogin] = useState(false)

  const saveAccount = async () => {
    const problem = accountProblem({ username, password })
    if (problem) { setNote({ tone: 'error', text: problem }); return }
    const r = await window.electronAPI.client.setAccount(server.id, { username, password })
    if (!r.success) { setNote({ tone: 'error', text: r.message || "Couldn't save that." }); return }
    setNote(null)
    setEditing(false)
    onChange()
  }

  const install = async () => {
    setBusy('install')
    const r = await window.electronAPI.client.installFixes(server.id)
    setBusy('')
    if (!r.success) { setNote({ tone: 'error', text: r.message || "Couldn't install the fixes." }); return }
    setNote({
      tone: 'ok',
      text: `Installed ${r.installed?.length || 0} fix${r.installed?.length === 1 ? '' : 'es'}.`
        + (r.backedUp?.length ? ` Your old copy was moved to Zomboid\\pzm-mod-backups, just in case.` : ''),
    })
    onChange()
  }

  const launch = async (join: boolean) => {
    setBusy('launch')
    // the game's login box can't be filled in from outside, so the password goes on the
    // clipboard and the card shows exactly what to type
    if (join && account) await navigator.clipboard.writeText(account.password).catch(() => undefined)
    const r = await window.electronAPI.client.launch(server.id, join)
    setBusy('')
    if (!r.success) setNote({ tone: 'error', text: r.message || "Couldn't start the game." })
    else if (join) { setNote(null); setShowLogin(true) }
    else setNote({ tone: 'ok', text: 'Starting the game...' })
  }

  return (
    <div className="border border-pz-border rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-pz-text">{pack.server.name}</div>
          <div className="text-xs text-pz-muted flex items-center gap-2 mt-0.5 flex-wrap">
            {address ? (
              <button
                onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="flex items-center gap-1 hover:text-pz-text" title="Copy address"
              >
                {address} <Copy size={10} /> {copied && <span className="text-pz-green">copied</span>}
              </button>
            ) : <span>No address in the pack, ask the host for it</span>}
            <span>· {pack.server.build.toUpperCase()}</span>
            <span>· {pack.workshopItems.length} Workshop mods, {pack.localMods.length} fix{pack.localMods.length === 1 ? '' : 'es'}</span>
            {pack.server.password && <span>· password saved</span>}
          </div>
        </div>
        <button
          onClick={async () => { await window.electronAPI.client.removeServer(server.id); onChange() }}
          className="btn-ghost p-1.5 text-pz-red hover:text-pz-red" title="Remove from my list"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {needFixes.length > 0 ? (
        <div className="flex items-center gap-3 text-sm bg-pz-yellow/10 border border-pz-yellow/30 rounded-md px-3 py-2">
          <Wrench size={14} className="text-pz-yellow flex-shrink-0" />
          <span className="flex-1 text-pz-text">
            {needFixes.length === 1 ? 'One fix from the host needs' : `${needFixes.length} fixes from the host need`} installing
            {needFixes.some(m => m.status === 'different') ? ' (you have an older or different copy)' : ''}.
          </span>
          <button onClick={install} disabled={!!busy} className="btn-primary text-xs py-1 px-3">
            {busy === 'install' ? <Loader size={12} className="animate-spin" /> : <Download size={12} />} Install
          </button>
        </div>
      ) : (
        <p className="text-sm text-pz-green flex items-center gap-1.5"><CheckCircle size={14} /> Your mods match this server.</p>
      )}

      {check.toDownload.length > 0 && (
        <p className="text-xs text-pz-muted">
          {check.toDownload.length} Workshop mod{check.toDownload.length === 1 ? '' : 's'} will download by themselves the first time you join. That can take a few minutes.
        </p>
      )}

      {/* your account on this server */}
      {editing ? (
        <div className="bg-pz-darker border border-pz-border rounded-md p-3 space-y-2">
          <div className="text-sm text-pz-text font-medium">Your account on this server</div>
          <p className="text-xs text-pz-subtext">
            Pick a name for yourself. You don't need to sign up anywhere: the first time you join, typing a new name
            and password into the game's login box creates your account on the server.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} className="input text-sm" placeholder="What others see" autoFocus={!account} />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="flex gap-1">
                <input value={password} onChange={e => setPassword(e.target.value)} className="input text-sm font-mono" />
                <button onClick={() => setPassword(suggestPassword())} className="btn-ghost p-1.5" title="Make a new one"><RefreshCw size={12} /></button>
              </div>
            </div>
          </div>
          <p className="text-xs text-pz-muted">Don't reuse an important password (the game says the same). This app keeps a copy on your PC so you don't have to remember it.</p>
          <div className="flex gap-2">
            <button onClick={saveAccount} className="btn-primary text-xs py-1 px-3">Save</button>
            {account && <button onClick={() => setEditing(false)} className="btn-ghost text-xs py-1 px-3">Cancel</button>}
          </div>
        </div>
      ) : account && (
        <div className="text-xs text-pz-subtext flex items-center gap-2">
          <User size={12} /> You join as <b className="text-pz-text">{account.username}</b>
          <button onClick={() => setEditing(true)} className="underline text-pz-muted hover:text-pz-text">change</button>
        </div>
      )}

      {showLogin && account && (
        <div className="bg-pz-green/10 border border-pz-green/30 rounded-md p-3 space-y-1.5 text-sm">
          <div className="text-pz-text font-medium">The game is starting. When it asks you to log in, type:</div>
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 items-center">
            <span className="text-pz-muted text-xs">Account Username</span>
            <b className="text-pz-text font-mono">{account.username}</b>
            <CopyButton text={account.username} />
            <span className="text-pz-muted text-xs">Account Password</span>
            <span className="text-pz-text font-mono">{account.password}</span>
            <CopyButton text={account.password} />
          </div>
          <p className="text-xs text-pz-subtext">
            Your password is already copied, click the password box in the game and press <b>Ctrl+V</b>.
            {pack.server.password ? '"Server Password" is already filled in for you.' : 'Leave "Server Password" empty.'}
            The first time, this creates your account. After that it's how you log back in.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => launch(true)} disabled={!!busy || !gameFound || needFixes.length > 0 || !address || !account} className="btn-primary">
          {busy === 'launch' ? <Loader size={14} className="animate-spin" /> : <PlayIcon size={14} />} Play on this server
        </button>
        <button onClick={() => launch(false)} disabled={!!busy || !gameFound} className="btn-ghost text-xs">Just start the game</button>
        <button onClick={() => setOpen(o => !o)} className="btn-ghost text-xs ml-auto">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
        </button>
      </div>
      {!gameFound && <p className="text-xs text-pz-yellow">Find your game above first.</p>}
      {gameFound && !account && <p className="text-xs text-pz-muted">Pick your username above, then you can play.</p>}
      {note && <p className={`text-xs ${note.tone === 'ok' ? 'text-pz-green' : 'text-pz-red'}`}>{note.text}</p>}

      {open && (
        <div className="text-xs space-y-2 border-t border-pz-border pt-2">
          {pack.localMods.length > 0 && (
            <div>
              <div className="text-pz-subtext font-semibold mb-1">Fixes from the host</div>
              {check.localMods.map(m => (
                <div key={m.folder} className="flex items-center gap-2">
                  {m.status === 'ok' ? <CheckCircle size={11} className="text-pz-green" /> : <AlertTriangle size={11} className="text-pz-yellow" />}
                  <span className="text-pz-text">{m.name}</span>
                  <span className="text-pz-muted">{m.status === 'ok' ? 'installed' : m.status === 'missing' ? 'not installed' : 'different copy'}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="text-pz-subtext font-semibold mb-1">Workshop mods ({pack.workshopItems.length})</div>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {pack.workshopItems.map(w => (
                <div key={w.workshopId} className="flex items-center gap-2">
                  {check.toDownload.some(d => d.workshopId === w.workshopId)
                    ? <Download size={11} className="text-pz-muted" />
                    : <CheckCircle size={11} className="text-pz-green" />}
                  <span className="text-pz-text truncate">{w.name}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-pz-muted">Pack from {new Date(pack.createdAt).toLocaleString()}. If the host changes their mods, ask for a new pack and open it again.</p>
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="btn-ghost text-xs py-0.5 px-2"
    >
      <Copy size={11} /> {done ? 'Copied' : 'Copy'}
    </button>
  )
}
