import { Home, Plus, Settings } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export default function Sidebar() {
  const { activeView, setActiveView, activeProfileId, setActiveProfileId, openServer, profiles, serverStatuses, players } = useAppStore()
  const inServer = ['server', 'editor', 'sandbox', 'raweditor'].includes(activeView)

  return (
    <div className="w-56 bg-pz-darker border-r border-pz-border flex flex-col flex-shrink-0 overflow-hidden">
      <div className="p-3 border-b border-pz-border">
        <NavItem
          icon={<Home size={16} />}
          label="Home"
          active={activeView === 'home'}
          onClick={() => { setActiveProfileId(null); setActiveView('home') }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-semibold text-pz-muted uppercase tracking-wider">Servers</span>
          <button
            onClick={() => setActiveView('create')}
            className="w-5 h-5 flex items-center justify-center text-pz-muted hover:text-pz-green transition-colors rounded"
            title="New server"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="space-y-0.5">
          {profiles.length === 0 && (
            <button onClick={() => setActiveView('create')} className="w-full text-xs text-pz-green hover:underline text-center py-4">
              Create your first server
            </button>
          )}
          {profiles.map(profile => {
            const status = serverStatuses[profile.id] || 'stopped'
            const selected = inServer && activeProfileId === profile.id
            const online = players[profile.id]?.length || 0
            return (
              <button
                key={profile.id}
                onClick={() => openServer(profile.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                  selected ? 'bg-pz-green/10 text-pz-green' : 'hover:bg-pz-border text-pz-text'
                }`}
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  status === 'running' ? 'bg-pz-green' :
                  status === 'starting' ? 'bg-pz-yellow pulse-green' :
                  status === 'stopping' ? 'bg-pz-red pulse-green' :
                  'bg-pz-muted'
                }`} />
                <span className="text-sm truncate flex-1">{profile.name}</span>
                {status === 'running' && <span className="text-xs text-pz-muted">{online}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-3 border-t border-pz-border">
        <NavItem
          icon={<Settings size={16} />}
          label="App settings"
          active={activeView === 'appsettings'}
          onClick={() => { setActiveProfileId(null); setActiveView('appsettings') }}
        />
      </div>
    </div>
  )
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
        active ? 'bg-pz-green/10 text-pz-green' : 'text-pz-muted hover:text-pz-text hover:bg-pz-border'
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}
