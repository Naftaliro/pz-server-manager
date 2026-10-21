import { useEffect, useState } from 'react'
import {
  RotateCcw, Copy, CheckCircle, Users, Globe, Home as HomeIcon, Lock, Shield, ChevronDown, ChevronRight,
  AlertTriangle, X, FolderOpen, Trash2, Loader, Wifi, Package, MemoryStick, MessageSquare, Zap,
  UserX, Ban, Crown, Archive, History, Radar, Download,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import StartButton from './StartButton'
import ConfirmDialog from './ConfirmDialog'
import { getServerName, dataPath, patchProfile } from '../lib/profile'
import { applyFix, inviteMessage, splitAddress } from '../lib/fixes'
import { PLAYIT_INTEGRATION } from '../lib/features'

export default function OverviewPanel({ profile }: { profile: ServerProfile }) {
  const { serverStatuses, players, problems, clearProblems, openServer, modUpdates, setModUpdates, settings, setActiveView } = useAppStore()
  const status = serverStatuses[profile.id] || 'stopped'
  const online = players[profile.id] || []
  const serverProblems = problems[profile.id] || []
  const updatedMods = modUpdates[profile.id] || []
  const [issues, setIssues] = useState<ServerPreflightIssue[]>([])
  const [net, setNet] = useState<{ publicIp: string | null; lanIps: string[] } | null>(null)
  const [world, setWorld] = useState<{ exists: boolean; sizeMb?: number; path?: string } | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [restarting, setRestarting] = useState(false)
  const [serverUpdate, setServerUpdate] = useState<{ updateAvailable: boolean; steamManaged: boolean } | null>(null)

  const say = (msg?: string) => { if (msg) { setNotice(msg); setTimeout(() => setNotice(''), 6000) } }

  useEffect(() => {
    if (status !== 'stopped') return
    window.electronAPI.server.preflight(profile.id).then(setIssues).catch(() => setIssues([]))
  }, [profile.id, profile.updatedAt, status])

  useEffect(() => {
    window.electronAPI.server.networkInfo().then(setNet).catch(() => setNet({ publicIp: null, lanIps: [] }))
    window.electronAPI.steamcmd.checkUpdate(profile.serverInstallPath).then(setServerUpdate).catch(() => undefined)
  }, [profile.id])

  const loadWorld = () => {
    window.electronAPI.world.getSize(getServerName(profile), dataPath(profile)).then(r => {
      setWorld(r.success ? { exists: !!r.exists, sizeMb: r.sizeMb, path: r.path } : null)
    })
  }
  useEffect(loadWorld, [profile.id, status])

  const restart = async () => {
    setRestarting(true)
    try { await window.electronAPI.server.restart(profile.id) } finally { setRestarting(false) }
  }

  const fix = async (issue: ServerPreflightIssue) => {
    say(await applyFix(issue, profile))
    window.electronAPI.server.preflight(profile.id).then(setIssues).catch(() => undefined)
  }

  const wipe = async () => {
    setWipeOpen(false)
    const r = await window.electronAPI.world.wipe(getServerName(profile), dataPath(profile))
    say(r.success ? 'World wiped. The next start makes a brand new map.' : r.message)
    loadWorld()
  }

  // only show "update the server" when stopped (preflight covers it then) or as a running banner
  const showServerUpdate = !!serverUpdate?.updateAvailable && status !== 'stopped'

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Status + main button */}
        <div className={`card p-6 flex items-center gap-5 ${status === 'running' ? 'border-pz-green/40' : ''}`}>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            status === 'running' ? 'bg-pz-green/20' : status === 'stopped' ? 'bg-pz-border' : 'bg-pz-yellow/15'
          }`}>
            {status === 'running' ? <Wifi size={26} className="text-pz-green" /> :
              status === 'stopped' ? <Wifi size={26} className="text-pz-muted" /> :
              <Loader size={26} className="text-pz-yellow animate-spin" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-pz-text">
              {status === 'running' ? 'Online, friends can join' :
                status === 'starting' ? 'Starting up...' :
                status === 'stopping' ? 'Saving and shutting down...' : 'Offline'}
            </h2>
            <p className="text-sm text-pz-subtext">
              {status === 'running' ? `${online.length} player${online.length !== 1 ? 's' : ''} online` :
                status === 'starting' ? 'Loading the world and mods. The first start can take several minutes, especially with big mods.' :
                status === 'stopping' ? 'Hang tight, the world is being saved.' : 'Hit Start when you\'re ready to play.'}
            </p>
          </div>
          {status === 'running' && (
            <button onClick={restart} disabled={restarting} className="btn-outline" title="Restart (applies mod and setting changes)">
              <RotateCcw size={14} /> {restarting ? 'Restarting...' : 'Restart'}
            </button>
          )}
          <StartButton profile={profile} big />
        </div>

        {notice && <p className="text-sm text-pz-green bg-pz-green/10 border border-pz-green/30 rounded-lg px-3 py-2">{notice}</p>}

        {/* Mods updated on the Workshop while running */}
        {updatedMods.length > 0 && status === 'running' && (
          <Banner icon={<Package size={14} />} tone="yellow" onClose={() => setModUpdates(profile.id, [])}>
            <p className="flex-1">
              {updatedMods.length === 1 ? `"${updatedMods[0]}" was updated` : `${updatedMods.length} mods were updated`} on the Workshop.
              Players with the new version can't join until the server restarts.
              {profile.restartOnModUpdate !== false && ' It will restart by itself in a few minutes (players get a warning in chat).'}
            </p>
            {profile.restartOnModUpdate === false && (
              <button onClick={async () => { await window.electronAPI.server.restartWithWarning(profile.id, 2); setModUpdates(profile.id, []) }} className="btn-outline text-xs py-1 px-2">
                Restart in 2 min
              </button>
            )}
          </Banner>
        )}

        {showServerUpdate && (
          <Banner icon={<Download size={14} />} tone="yellow">
            <p className="flex-1">
              The game got an update. Friends on the new version can't join this server until it's updated.
              {serverUpdate?.steamManaged ? ' Stop the server and let Steam update "Project Zomboid Dedicated Server".' : ' Stop the server, then update it in App settings.'}
            </p>
            {!serverUpdate?.steamManaged && <button onClick={() => setActiveView('appsettings')} className="btn-outline text-xs py-1 px-2">Go there</button>}
          </Banner>
        )}

        {/* Things that went wrong while running */}
        {serverProblems.length > 0 && (
          <div className="card p-4 border-pz-red/40 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-pz-red flex items-center gap-2"><AlertTriangle size={14} /> The server ran into problems</h3>
              <button onClick={() => clearProblems(profile.id)} className="text-pz-muted hover:text-pz-text" title="Dismiss"><X size={14} /></button>
            </div>
            {serverProblems.map((p, i) => (
              <div key={i} className="text-sm">
                <p className="text-pz-text">{p.hint}</p>
                <p className="text-xs text-pz-muted font-mono truncate" title={p.line}>{p.line}</p>
              </div>
            ))}
            <button onClick={() => openServer(profile.id, 'console')} className="text-xs text-pz-green hover:underline">See the full log</button>
          </div>
        )}

        {/* Pre-start check results */}
        {status === 'stopped' && issues.length > 0 && (
          <div className="card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-pz-text">Before you start</h3>
            {issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-3">
                <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${issue.level === 'error' ? 'text-pz-red' : 'text-pz-yellow'}`} />
                <p className="text-sm text-pz-subtext flex-1">{issue.message}</p>
                {issue.fix && <button onClick={() => fix(issue)} className="btn-outline text-xs py-1 px-2 flex-shrink-0">Fix</button>}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InviteCard profile={profile} net={net} playitOn={!!settings?.playitEnabled} running={status === 'running'} />

          <div className="space-y-4">
            <PlayersCard profile={profile} online={online} running={status === 'running'} say={say} />

            {/* Admin login */}
            <div className="card p-5">
              <h3 className="section-title mb-2 flex items-center gap-2"><Shield size={14} /> Be the admin in-game</h3>
              <p className="text-xs text-pz-subtext mb-3">Join with this username and password to get admin powers (spawn items, teleport, kick players and so on).</p>
              <div className="grid grid-cols-2 gap-2">
                <CopyField label="Username" value="admin" />
                <CopyField label="Password" value={profile.adminPassword || 'admin'} />
              </div>
            </div>

            <div className="card p-5 grid grid-cols-3 gap-3 text-center">
              <Fact icon={<Package size={14} />} label="Mods" value={String(profile.mods.length)} onClick={() => openServer(profile.id, 'mods')} />
              <Fact icon={<MemoryStick size={14} />} label="Memory" value={`${Math.round(profile.memory / 1024)} GB`} onClick={() => openServer(profile.id, 'settings')} />
              <Fact icon={<Globe size={14} />} label="World" value={world?.exists ? `${world.sizeMb} MB` : 'New'} />
            </div>
          </div>
        </div>

        <WorldCard profile={profile} world={world} stopped={status === 'stopped'} onWipe={() => setWipeOpen(true)} say={say} />
      </div>

      <ConfirmDialog
        isOpen={wipeOpen}
        title="Wipe this world?"
        message="Everything built, looted and explored is gone and players start over as new characters. Settings and mods stay. A backup is made first, just in case."
        confirmLabel="Wipe it"
        danger
        onConfirm={async () => { await window.electronAPI.server.backupNow(profile.id); await wipe() }}
        onCancel={() => setWipeOpen(false)}
      />
    </div>
  )
}

function Banner({ icon, tone, children, onClose }: { icon: React.ReactNode; tone: 'yellow' | 'red'; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className={`flex items-center gap-3 text-sm rounded-lg px-4 py-3 border ${tone === 'yellow' ? 'bg-pz-yellow/10 border-pz-yellow/30' : 'bg-pz-red/10 border-pz-red/30'} text-pz-text`}>
      <span className={tone === 'yellow' ? 'text-pz-yellow' : 'text-pz-red'}>{icon}</span>
      {children}
      {onClose && <button onClick={onClose} className="text-pz-muted hover:text-pz-text"><X size={14} /></button>}
    </div>
  )
}

// ── Invite card ────────────────────────────────────────────────────────────────

function InviteCard({ profile, net, playitOn, running }: {
  profile: ServerProfile
  net: { publicIp: string | null; lanIps: string[] } | null
  playitOn: boolean
  running: boolean
}) {
  const { setActiveView } = useAppStore()
  const [helpOpen, setHelpOpen] = useState(false)
  const [playit, setPlayit] = useState<PlayitState | null>(null)
  const [pasted, setPasted] = useState(profile.playitAddress || '')
  const [copied, setCopied] = useState(false)
  const [upnp, setUpnp] = useState<UpnpReport | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!playitOn || !PLAYIT_INTEGRATION) return
    const load = () => window.electronAPI.playit.state().then(setPlayit).catch(() => undefined)
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [playitOn])

  // the playit tunnel pointing at this server's port, or what the user pasted in
  const tunnel = playit?.tunnels.find(t => !t.disabled && new RegExp(`:${profile.port}$`).test(t.destination.trim()))
  const playitAddress = tunnel?.address || profile.playitAddress || ''
  const [host, tunnelPort] = splitAddress(playitAddress)
  const usePlayit = playitOn && !!playitAddress

  const address = usePlayit ? host : net?.publicIp || ''
  const port = usePlayit ? (tunnelPort || String(profile.port)) : String(profile.port)

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteMessage(profile, address || 'YOUR-ADDRESS', port))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const runCheck = async () => {
    setChecking(true)
    try { setUpnp(await window.electronAPI.network.checkUpnp(profile.port, net?.publicIp || null)) } finally { setChecking(false) }
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="section-title flex items-center gap-2"><Users size={14} /> Invite your friends</h3>
        <p className="text-xs text-pz-subtext mt-1">
          In Project Zomboid they click <b>Join</b>, then <b>Add server</b>, and type in:
        </p>
      </div>

      {usePlayit && (
        <p className="text-xs text-pz-green flex items-center gap-1.5"><Zap size={12} /> Using your playit.gg address{PLAYIT_INTEGRATION ? ', no router setup needed' : ' (keep playit running while you play)'}.</p>
      )}

      <div className="space-y-2">
        <CopyField
          label={usePlayit ? 'Address (playit.gg)' : 'Address (friends outside your house)'}
          icon={<Globe size={12} />}
          value={net === null && !usePlayit ? 'Looking up...' : address || 'Couldn\'t find it, google "what is my ip"'}
          copyable={!!address}
        />
        <div className="grid grid-cols-2 gap-2">
          <CopyField label="Port" value={port} />
          <CopyField label="Password" icon={<Lock size={12} />} value={profile.serverPassword || '(none)'} copyable={!!profile.serverPassword} />
        </div>
        {!usePlayit && net && net.lanIps.length > 0 && (
          <CopyField label="Address (people on the same Wi-Fi as you)" icon={<HomeIcon size={12} />} value={net.lanIps[0]} />
        )}
      </div>

      <button onClick={copyInvite} disabled={!address} className="btn-primary w-full justify-center">
        {copied ? <CheckCircle size={14} /> : <MessageSquare size={14} />} {copied ? 'Copied! Paste it in your group chat' : 'Copy invite message'}
      </button>

      {/* playit on, but we couldn't find a tunnel for this port */}
      {playitOn && !tunnel && (
        <div className="text-xs bg-pz-darker rounded-lg p-3 space-y-2">
          {PLAYIT_INTEGRATION && playit && playit.phase !== 'running' ? (
            <p className="text-pz-yellow">playit isn't ready ({playit.phase.replace(/_/g, ' ')}). <button onClick={() => setActiveView('appsettings')} className="underline">Finish setting it up</button></p>
          ) : (
            <p className="text-pz-subtext">
              {PLAYIT_INTEGRATION ? `No playit tunnel for port ${profile.port} yet. ` : 'Paste the address playit gives your tunnel for '}
              {PLAYIT_INTEGRATION ? <><button onClick={() => window.electronAPI.playit.openDashboard()} className="text-pz-green underline">Make one on playit.gg</button> (UDP, local port {profile.port}), or paste your playit address here:</> : <>port {profile.port} (<button onClick={() => window.electronAPI.playit.openDashboard()} className="text-pz-green underline">open my playit tunnels</button>):</>}
            </p>
          )}
          <div className="flex gap-2">
            <input value={pasted} onChange={e => setPasted(e.target.value)} placeholder="something.gl.joinmc.link:12345" className="input text-xs py-1.5 font-mono" />
            <button onClick={() => patchProfile(profile.id, () => ({ playitAddress: pasted.trim() }))} className="btn-outline text-xs py-1 px-2 flex-shrink-0">Save</button>
          </div>
        </div>
      )}

      {!usePlayit && (
        <div>
          <button onClick={() => setHelpOpen(o => !o)} className="text-xs text-pz-green hover:underline flex items-center gap-1">
            {helpOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Friends can't connect?
          </button>
          {helpOpen && (
            <div className="mt-2 text-xs text-pz-subtext space-y-2 bg-pz-darker rounded-lg p-3">
              <p>
                <b className="text-pz-text">Easiest fix: playit.gg.</b> A free service that gives you an address that works from anywhere, no router setup.{' '}
                <button onClick={() => setActiveView('appsettings')} className="text-pz-green underline">Set it up in App settings</button>.
              </p>
              <div className="flex items-center gap-2">
                <button onClick={runCheck} disabled={checking} className="btn-outline text-xs py-1 px-2">
                  {checking ? <Loader size={12} className="animate-spin" /> : <Radar size={12} />} Check my router
                </button>
                {!running && <span className="text-pz-muted">(works best while the server is running)</span>}
              </div>
              {upnp && <p className={upnp.portOpen ? 'text-pz-green' : 'text-pz-yellow'}>{upnp.summary}</p>}
              <p><b className="text-pz-text">Doing it by hand:</b> log into your router (usually <code>192.168.1.1</code> or <code>192.168.0.1</code>, the login is often on a sticker), find "Port Forwarding", and forward <b>UDP {profile.port} and {profile.udpPort}</b> to <b>{net?.lanIps[0] || 'this PC'}</b>.</p>
              <p><b className="text-pz-text">Same version:</b> everyone needs the same game version as the server, and nobody should be on a beta branch in Steam.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Players with kick/ban/admin buttons ───────────────────────────────────────

function PlayersCard({ profile, online, running, say }: { profile: ServerProfile; online: string[]; running: boolean; say: (m?: string) => void }) {
  const [confirm, setConfirm] = useState<{ action: 'kick' | 'ban' | 'admin'; name: string } | null>(null)

  const act = async () => {
    if (!confirm) return
    const { action, name } = confirm
    setConfirm(null)
    const r = await window.electronAPI.server.playerAction(profile.id, action, name)
    say(r.success
      ? { kick: `Kicked ${name}.`, ban: `Banned ${name}.`, admin: `${name} is an admin now.` }[action]
      : `Didn't work: ${r.message}`)
  }

  return (
    <div className="card p-5">
      <h3 className="section-title mb-3 flex items-center gap-2"><Users size={14} /> Players online</h3>
      {!running ? (
        <p className="text-sm text-pz-muted">Start the server to see who's on.</p>
      ) : online.length === 0 ? (
        <p className="text-sm text-pz-muted">Nobody yet.</p>
      ) : (
        <div className="space-y-1.5">
          {online.map(name => (
            <div key={name} className="flex items-center gap-2 bg-pz-darker border border-pz-border rounded-md px-3 py-1.5">
              <span className="text-sm text-pz-text flex-1 truncate">{name}</span>
              <button onClick={() => setConfirm({ action: 'admin', name })} className="text-pz-muted hover:text-pz-yellow" title="Make admin"><Crown size={13} /></button>
              <button onClick={() => setConfirm({ action: 'kick', name })} className="text-pz-muted hover:text-pz-text" title="Kick"><UserX size={13} /></button>
              <button onClick={() => setConfirm({ action: 'ban', name })} className="text-pz-muted hover:text-pz-red" title="Ban"><Ban size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm ? { kick: `Kick ${confirm.name}?`, ban: `Ban ${confirm.name}?`, admin: `Make ${confirm.name} an admin?` }[confirm.action] : ''}
        message={confirm ? {
          kick: 'They get thrown out but can join again.',
          ban: "They get thrown out and can't come back. You can unban them later with the unbanuser command in the Console.",
          admin: 'Admins can spawn items, teleport, kick and ban people. Only do this for people you trust.',
        }[confirm.action] : ''}
        confirmLabel={confirm ? { kick: 'Kick', ban: 'Ban', admin: 'Make admin' }[confirm.action] : ''}
        danger={confirm?.action === 'ban'}
        onConfirm={act}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

// ── World + backups ──────────────────────────────────────────────────────────

function WorldCard({ profile, world, stopped, onWipe, say }: {
  profile: ServerProfile
  world: { exists: boolean; sizeMb?: number; path?: string } | null
  stopped: boolean
  onWipe: () => void
  say: (m?: string) => void
}) {
  const [backups, setBackups] = useState<Array<{ name: string; sizeMb: number }>>([])
  const [showBackups, setShowBackups] = useState(false)
  const [restore, setRestore] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => window.electronAPI.server.listBackups(profile.id).then(setBackups).catch(() => setBackups([]))
  useEffect(() => { load() }, [profile.id, stopped])

  // "2026-10-21_19-04-33_manual" -> "Oct 21, 7:04 PM (manual)"
  const pretty = (name: string) => {
    const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_(.+))?$/)
    if (!m) return name
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    const label = m[7] === 'manual' ? ' (made by you)' : m[7] === 'before-restore' ? ' (before a restore)' : ''
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + label
  }

  const backupNow = async () => {
    setBusy(true)
    const r = await window.electronAPI.server.backupNow(profile.id)
    setBusy(false)
    say(r.message)
    load()
  }

  const doRestore = async () => {
    if (!restore) return
    const name = restore
    setRestore(null)
    setBusy(true)
    const r = await window.electronAPI.server.restoreBackup(profile.id, name)
    setBusy(false)
    say(r.message)
    load()
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <h3 className="text-sm font-semibold text-pz-text">World</h3>
          <p className="text-xs text-pz-subtext">
            {world?.exists ? 'Your saved world. ' : 'No world yet, one gets made the first time you start. '}
            {profile.backupsEnabled !== false ? `A backup is made every time the server starts (last ${profile.backupsToKeep || 5} kept).` : 'Automatic backups are off.'}
          </p>
        </div>
        <button onClick={backupNow} disabled={busy || !world?.exists} className="btn-outline text-xs disabled:opacity-40"><Archive size={12} /> Back up now</button>
        <button onClick={() => setShowBackups(s => !s)} className="btn-outline text-xs"><History size={12} /> Backups ({backups.length})</button>
        {world?.path && <button onClick={() => window.electronAPI.shell.openPath(world.path!)} className="btn-outline text-xs"><FolderOpen size={12} /> Open folder</button>}
        <button onClick={onWipe} disabled={!world?.exists || !stopped} className="btn-outline text-xs text-pz-red disabled:opacity-40"><Trash2 size={12} /> Wipe world</button>
      </div>

      {showBackups && (
        <div className="bg-pz-darker rounded-lg p-3 space-y-1.5">
          {backups.length === 0 ? (
            <p className="text-xs text-pz-muted">No backups yet. One gets made the next time the server starts.</p>
          ) : backups.map(b => (
            <div key={b.name} className="flex items-center gap-3 text-sm">
              <span className="text-pz-text flex-1">{pretty(b.name)}</span>
              <span className="text-xs text-pz-muted">{b.sizeMb} MB</span>
              <button onClick={() => setRestore(b.name)} disabled={!stopped || busy} className="btn-ghost text-xs py-0.5 px-2 disabled:opacity-40" title={stopped ? 'Go back to this backup' : 'Stop the server first'}>
                Restore
              </button>
            </div>
          ))}
          <button
            onClick={async () => window.electronAPI.shell.openPath(await window.electronAPI.server.openBackups(profile.id))}
            className="text-xs text-pz-green hover:underline"
          >
            Open backups folder
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!restore}
        title="Go back to this backup?"
        message={`The world goes back to how it was at ${restore ? pretty(restore) : ''}. Anything since then is lost, but the current world is backed up first so you can undo this.`}
        confirmLabel="Restore"
        onConfirm={doRestore}
        onCancel={() => setRestore(null)}
      />
    </div>
  )
}

function CopyField({ label, value, icon, copyable = true }: { label: string; value: string; icon?: React.ReactNode; copyable?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="text-[11px] text-pz-muted mb-0.5 flex items-center gap-1">{icon}{label}</div>
      <div className="flex items-center gap-2 bg-pz-darker border border-pz-border rounded-md px-3 py-1.5">
        <span className="text-sm text-pz-text font-mono flex-1 truncate select-text">{value}</span>
        {copyable && (
          <button
            onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="text-pz-muted hover:text-pz-text flex-shrink-0" title="Copy"
          >
            {copied ? <CheckCircle size={13} className="text-pz-green" /> : <Copy size={13} />}
          </button>
        )}
      </div>
    </div>
  )
}

function Fact({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="rounded-md py-1 hover:bg-pz-darker transition-colors disabled:hover:bg-transparent">
      <div className="text-pz-muted flex items-center justify-center gap-1 text-xs">{icon}{label}</div>
      <div className="text-base font-semibold text-pz-text">{value}</div>
    </button>
  )
}
