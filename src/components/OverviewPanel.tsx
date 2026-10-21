import { useEffect, useState } from 'react'
import {
  RotateCcw, Copy, CheckCircle, Users, Globe, Home as HomeIcon, Lock, Shield, ChevronDown, ChevronRight,
  AlertTriangle, X, FolderOpen, Trash2, Loader, Wifi, Package, MemoryStick,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import StartButton from './StartButton'
import ConfirmDialog from './ConfirmDialog'
import { getServerName, dataPath } from '../lib/profile'
import { downloadAndScan } from '../lib/mods'

export default function OverviewPanel({ profile }: { profile: ServerProfile }) {
  const { serverStatuses, players, problems, clearProblems, openServer, setActiveView } = useAppStore()
  const status = serverStatuses[profile.id] || 'stopped'
  const online = players[profile.id] || []
  const serverProblems = problems[profile.id] || []
  const [issues, setIssues] = useState<ServerPreflightIssue[]>([])
  const [net, setNet] = useState<{ publicIp: string | null; lanIps: string[] } | null>(null)
  const [world, setWorld] = useState<{ exists: boolean; sizeMb?: number; path?: string } | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)
  const [wipeMsg, setWipeMsg] = useState('')
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (status !== 'stopped') return
    window.electronAPI.server.preflight(profile.id).then(setIssues).catch(() => setIssues([]))
  }, [profile.id, profile.updatedAt, status])

  useEffect(() => {
    window.electronAPI.server.networkInfo().then(setNet).catch(() => setNet({ publicIp: null, lanIps: [] }))
  }, [])

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

  const fix = (issue: ServerPreflightIssue) => {
    if (issue.fix === 'install-server') setActiveView('appsettings')
    if (issue.fix === 'open-mods') openServer(profile.id, 'mods')
    if (issue.fix === 'open-settings') openServer(profile.id, 'settings')
    if (issue.fix === 'download-mods') {
      openServer(profile.id, 'mods')
      void downloadAndScan(profile.id, profile.mods.map(m => m.workshopId))
    }
  }

  const wipe = async () => {
    setWipeOpen(false)
    const r = await window.electronAPI.world.wipe(getServerName(profile), dataPath(profile))
    setWipeMsg(r.success ? 'World wiped. The next start makes a brand new map.' : r.message)
    loadWorld()
  }

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
          <InviteCard profile={profile} net={net} />

          <div className="space-y-4">
            {/* Players */}
            <div className="card p-5">
              <h3 className="section-title mb-3 flex items-center gap-2"><Users size={14} /> Players online</h3>
              {status !== 'running' ? (
                <p className="text-sm text-pz-muted">Start the server to see who's on.</p>
              ) : online.length === 0 ? (
                <p className="text-sm text-pz-muted">Nobody yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {online.map(name => <span key={name} className="text-sm bg-pz-darker border border-pz-border rounded-md px-2 py-1 text-pz-text">{name}</span>)}
                </div>
              )}
            </div>

            {/* Admin login */}
            <div className="card p-5">
              <h3 className="section-title mb-2 flex items-center gap-2"><Shield size={14} /> Be the admin in-game</h3>
              <p className="text-xs text-pz-subtext mb-3">Join with this username and password to get admin powers (spawn items, teleport, kick players and so on).</p>
              <div className="grid grid-cols-2 gap-2">
                <CopyField label="Username" value="admin" />
                <CopyField label="Password" value={profile.adminPassword || 'admin'} />
              </div>
            </div>

            {/* Quick facts */}
            <div className="card p-5 grid grid-cols-3 gap-3 text-center">
              <Fact icon={<Package size={14} />} label="Mods" value={String(profile.mods.length)} onClick={() => openServer(profile.id, 'mods')} />
              <Fact icon={<MemoryStick size={14} />} label="Memory" value={`${Math.round(profile.memory / 1024)} GB`} onClick={() => openServer(profile.id, 'settings')} />
              <Fact icon={<Globe size={14} />} label="World" value={world?.exists ? `${world.sizeMb} MB` : 'New'} />
            </div>
          </div>
        </div>

        {/* World tools */}
        <div className="card p-5 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <h3 className="text-sm font-semibold text-pz-text">World</h3>
            <p className="text-xs text-pz-subtext">{world?.exists ? 'Your saved world lives here. Wiping it starts a fresh map but keeps all settings and mods.' : 'No world yet, one gets made the first time you start.'}</p>
            {wipeMsg && <p className="text-xs text-pz-green mt-1">{wipeMsg}</p>}
          </div>
          {world?.path && (
            <button onClick={() => window.electronAPI.shell.openPath(world.path!)} className="btn-outline text-xs"><FolderOpen size={12} /> Open folder</button>
          )}
          <button onClick={() => setWipeOpen(true)} disabled={!world?.exists || status !== 'stopped'} className="btn-outline text-xs text-pz-red disabled:opacity-40">
            <Trash2 size={12} /> Wipe world
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={wipeOpen}
        title="Wipe this world?"
        message="Everything built, looted and explored is deleted for good. Settings and mods stay. Players start over as new characters."
        confirmLabel="Wipe it"
        danger
        onConfirm={wipe}
        onCancel={() => setWipeOpen(false)}
      />
    </div>
  )
}

function InviteCard({ profile, net }: { profile: ServerProfile; net: { publicIp: string | null; lanIps: string[] } | null }) {
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="section-title flex items-center gap-2"><Users size={14} /> Invite your friends</h3>
        <p className="text-xs text-pz-subtext mt-1">
          In Project Zomboid they click <b>Join</b>, then <b>Add server</b> (or the favorites tab), and type in:
        </p>
      </div>

      <div className="space-y-2">
        <CopyField
          label="Address (friends outside your house)"
          icon={<Globe size={12} />}
          value={net === null ? 'Looking up...' : net.publicIp || 'Couldn\'t find it, google "what is my ip"'}
          copyable={!!net?.publicIp}
        />
        <div className="grid grid-cols-2 gap-2">
          <CopyField label="Port" value={String(profile.port)} />
          <CopyField label="Password" icon={<Lock size={12} />} value={profile.serverPassword || '(none)'} copyable={!!profile.serverPassword} />
        </div>
        {net && net.lanIps.length > 0 && (
          <CopyField label="Address (people on the same Wi-Fi as you)" icon={<HomeIcon size={12} />} value={net.lanIps[0]} />
        )}
      </div>

      <div>
        <button onClick={() => setHelpOpen(o => !o)} className="text-xs text-pz-green hover:underline flex items-center gap-1">
          {helpOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Friends can't connect?
        </button>
        {helpOpen && (
          <div className="mt-2 text-xs text-pz-subtext space-y-2 bg-pz-darker rounded-lg p-3">
            <p><b className="text-pz-text">1. Allow it through Windows Firewall.</b> The first time the server starts, Windows asks if Java can use the network. Tick both boxes and click Allow. Missed it? Search "Allow an app through Windows Firewall" and turn on everything named Java / OpenJDK.</p>
            <p><b className="text-pz-text">2. Open the ports on your router.</b> The server tries to do this by itself (UPnP), but many routers block that. Log into your router (usually <code>192.168.1.1</code> or <code>192.168.0.1</code>, the login is often on a sticker on the router), find "Port Forwarding", and forward <b>UDP {profile.port} and {profile.udpPort}</b> to <b>{net?.lanIps[0] || 'this PC'}</b>.</p>
            <p><b className="text-pz-text">3. Same version.</b> Everyone needs the same game version as the server. If you updated the server, friends need the latest game too (and nobody should be on a beta branch in Steam).</p>
            <p><b className="text-pz-text">4. Wait for "Online".</b> Joining while it still says Starting up won't work.</p>
          </div>
        )}
      </div>
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
