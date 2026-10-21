import { LayoutDashboard, Package, Settings, Terminal, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerTab } from '../store/useAppStore'
import StatusBadge from '../components/StatusBadge'
import OverviewPanel from '../components/OverviewPanel'
import ModsPanel from '../components/ModsPanel'
import SettingsPanel from '../components/SettingsPanel'
import ConsolePanel from '../components/ConsolePanel'
import { missingRequirements, needsChoice } from '../lib/mods'

export default function ServerPage() {
  const { profiles, activeProfileId, serverStatuses, serverTab, setServerTab, problems } = useAppStore()
  const profile = profiles.find(p => p.id === activeProfileId)
  if (!profile) return null

  const status = serverStatuses[profile.id] || 'stopped'
  const modWarnings = missingRequirements(profile).length + profile.mods.filter(needsChoice).length

  const tabs: Array<{ id: ServerTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} />, badge: problems[profile.id]?.length || undefined },
    { id: 'mods', label: 'Mods', icon: <Package size={14} />, badge: modWarnings || undefined },
    { id: 'settings', label: 'Settings', icon: <Settings size={14} /> },
    { id: 'console', label: 'Console', icon: <Terminal size={14} /> },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-end gap-6 px-6 pt-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <div className="pb-3 min-w-0">
          <h1 className="text-lg font-semibold text-pz-text truncate">{profile.name}</h1>
          <StatusBadge status={status} />
        </div>
        <div className="flex">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setServerTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${serverTab === t.id ? 'tab-active' : 'tab-inactive'}`}
            >
              {t.icon} {t.label}
              {t.badge ? (
                <span className="ml-1 flex items-center gap-0.5 text-[10px] font-bold text-pz-darker bg-pz-yellow rounded-full px-1.5">
                  <AlertTriangle size={9} /> {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {serverTab === 'overview' && <OverviewPanel profile={profile} />}
        {serverTab === 'mods' && <ModsPanel profile={profile} />}
        {serverTab === 'settings' && <SettingsPanel profile={profile} />}
        {serverTab === 'console' && <ConsolePanel profile={profile} />}
      </div>
    </div>
  )
}
