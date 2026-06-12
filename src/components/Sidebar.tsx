import { LayoutDashboard, Plus, Download, Github } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export default function Sidebar() {
  const { activeView, setActiveView, setActiveProfileId, profiles, serverStatuses } = useAppStore()

  const runningCount = Object.values(serverStatuses).filter(s => s === 'running' || s === 'starting').length

  return (
    <div className="w-56 bg-pz-darker border-r border-pz-border flex flex-col flex-shrink-0 overflow-hidden">
      {/* Navigation */}
      <div className="p-3 border-b border-pz-border">
        <nav className="space-y-0.5">
          <NavItem
            icon={<LayoutDashboard size={16} />}
            label="Dashboard"
            active={activeView === 'dashboard'}
            badge={runningCount > 0 ? runningCount : undefined}
            onClick={() => {
              setActiveView('dashboard')
              setActiveProfileId(null)
            }}
          />
          <NavItem
            icon={<Download size={16} />}
            label="Install Server"
            active={activeView === 'install'}
            onClick={() => {
              setActiveView('install')
              setActiveProfileId(null)
            }}
          />
        </nav>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-pz-muted uppercase tracking-wider">Servers</span>
          <button
            onClick={() => {
              setActiveProfileId(null)
              setActiveView('editor')
            }}
            className="w-5 h-5 flex items-center justify-center text-pz-muted hover:text-pz-green transition-colors rounded"
            title="New Server"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="space-y-0.5">
          {profiles.length === 0 && (
            <div className="text-xs text-pz-muted text-center py-4 px-2">
              No servers yet.<br />
              <button
                onClick={() => {
                  setActiveProfileId(null)
                  setActiveView('editor')
                }}
                className="text-pz-green hover:underline mt-1"
              >
                Create one
              </button>
            </div>
          )}
          {profiles.map(profile => {
            const status = serverStatuses[profile.id] || 'stopped'
            return (
              <button
                key={profile.id}
                onClick={() => {
                  setActiveProfileId(profile.id)
                  setActiveView('editor')
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-pz-border transition-colors group"
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  status === 'running' ? 'bg-pz-green pulse-green' :
                  status === 'starting' ? 'bg-pz-yellow pulse-green' :
                  status === 'stopping' ? 'bg-pz-red' :
                  'bg-pz-muted'
                }`} />
                <span className="text-xs text-pz-text truncate flex-1">{profile.name}</span>
                <span className="text-xs text-pz-muted opacity-0 group-hover:opacity-100">
                  :{profile.port}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-pz-border">
        <button
          onClick={() => window.electronAPI.shell.openExternal('https://pzwiki.net/wiki/Dedicated_server')}
          className="flex items-center gap-2 text-xs text-pz-muted hover:text-pz-text transition-colors w-full"
        >
          <Github size={12} />
          <span>PZ Wiki</span>
        </button>
      </div>
    </div>
  )
}

interface NavItemProps {
  icon: React.ReactNode
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}

function NavItem({ icon, label, active, badge, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
        active
          ? 'bg-pz-green/10 text-pz-green'
          : 'text-pz-muted hover:text-pz-text hover:bg-pz-border'
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && (
        <span className="bg-pz-green text-pz-darker text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  )
}
