import { Plus, Server, Users, Package, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import StatusBadge from '../components/StatusBadge'
import StartButton from '../components/StartButton'

export default function Home() {
  const { profiles, serverStatuses, players, setActiveView, openServer } = useAppStore()

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-pz-card border border-pz-border flex items-center justify-center">
          <Server size={36} className="text-pz-green" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-pz-text mb-2">No servers yet</h2>
          <p className="text-pz-subtext max-w-sm">Make your first one, it takes about a minute.</p>
        </div>
        <button onClick={() => setActiveView('create')} className="btn-primary px-6 py-3">
          <Plus size={16} /> Create a server
        </button>
      </div>
    )
  }

  const running = Object.values(serverStatuses).filter(s => s === 'running').length

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-pz-text">Your servers</h1>
          <p className="text-sm text-pz-muted mt-0.5">
            {profiles.length} server{profiles.length !== 1 ? 's' : ''}
            {running > 0 && <span className="text-pz-green ml-2">· {running} running</span>}
          </p>
        </div>
        <button onClick={() => setActiveView('create')} className="btn-primary"><Plus size={16} /> New server</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {profiles.map(profile => (
          <ServerCard
            key={profile.id}
            profile={profile}
            status={serverStatuses[profile.id] || 'stopped'}
            playerCount={players[profile.id]?.length || 0}
            onOpen={() => openServer(profile.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ServerCard({ profile, status, playerCount, onOpen }: {
  profile: ServerProfile
  status: 'stopped' | 'starting' | 'running' | 'stopping'
  playerCount: number
  onOpen: () => void
}) {
  const active = status !== 'stopped'
  return (
    <div className={`card p-5 transition-all ${active ? 'border-pz-green/40 shadow-lg shadow-pz-green/5' : ''}`}>
      <button onClick={onOpen} className="w-full flex items-start justify-between mb-4 text-left group">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-pz-green/20' : 'bg-pz-border'}`}>
            <Server size={20} className={active ? 'text-pz-green' : 'text-pz-muted'} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-pz-text truncate group-hover:text-pz-green transition-colors">{profile.name}</h3>
            <StatusBadge status={status} />
          </div>
        </div>
        <ChevronRight size={18} className="text-pz-muted group-hover:text-pz-text mt-2" />
      </button>

      <div className="flex items-center gap-4 mb-4 text-xs text-pz-subtext">
        <span className="flex items-center gap-1"><Users size={12} /> {status === 'running' ? `${playerCount} online` : `${profile.maxPlayers} max`}</span>
        <span className="flex items-center gap-1"><Package size={12} /> {profile.mods.length} mod{profile.mods.length !== 1 ? 's' : ''}</span>
        {profile.lastStarted && <span>Last played {new Date(profile.lastStarted).toLocaleDateString()}</span>}
      </div>

      <div className="flex gap-2">
        <StartButton profile={profile} className="flex-1 justify-center" />
        <button onClick={onOpen} className="btn-outline">Manage</button>
      </div>
    </div>
  )
}

