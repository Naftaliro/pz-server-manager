import { useState, useEffect } from 'react'
import {
  Plus, Play, Square, RotateCcw, Terminal, Settings,
  Trash2, Copy, Server, Cpu, MemoryStick, Globe, Zap
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import type { ServerProfile, ServerStatus } from '../store/useAppStore'

export default function Dashboard() {
  const {
    profiles, setProfiles, removeProfile,
    serverStatuses, setServerStatus,
    setActiveProfileId, setActiveView,
    appendConsoleLog,
  } = useAppStore()

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({})
  const [worldSizes, setWorldSizes] = useState<Record<string, string>>({})

  useEffect(() => {
    // Subscribe to console output for all profiles
    const unsubs = profiles.map(p => {
      return window.electronAPI.server.onConsoleOutput(p.id, (line) => {
        appendConsoleLog(p.id, line)
      })
    })
    return () => unsubs.forEach(fn => fn())
  }, [profiles.length])

  useEffect(() => {
    // Load world sizes
    profiles.forEach(async (p) => {
      const result = await window.electronAPI.world.getSize(
        p.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
        `%USERPROFILE%\\Zomboid`
      )
      if (result.success && result.exists) {
        setWorldSizes(prev => ({ ...prev, [p.id]: `${result.sizeMb} MB` }))
      } else {
        setWorldSizes(prev => ({ ...prev, [p.id]: 'No world' }))
      }
    })
  }, [profiles])

  const handleStart = async (profile: ServerProfile) => {
    setActionLoading(prev => ({ ...prev, [profile.id]: 'starting' }))
    const result = await window.electronAPI.server.start(profile.id)
    if (!result.success) {
      alert(`Failed to start server: ${result.message}`)
    }
    setActionLoading(prev => { const n = { ...prev }; delete n[profile.id]; return n })
  }

  const handleStop = async (profile: ServerProfile) => {
    setActionLoading(prev => ({ ...prev, [profile.id]: 'stopping' }))
    const result = await window.electronAPI.server.stop(profile.id)
    if (!result.success) {
      alert(`Failed to stop server: ${result.message}`)
    }
    setActionLoading(prev => { const n = { ...prev }; delete n[profile.id]; return n })
  }

  const handleDuplicate = async (profileId: string) => {
    const dup = await window.electronAPI.profiles.duplicate(profileId)
    if (dup) {
      const updated = await window.electronAPI.profiles.list()
      setProfiles(updated)
    }
  }

  const handleDelete = async (profileId: string) => {
    const status = serverStatuses[profileId]
    if (status === 'running' || status === 'starting') {
      alert('Please stop the server before deleting it.')
      return
    }
    await window.electronAPI.profiles.delete(profileId)
    removeProfile(profileId)
    setDeleteTarget(null)
  }

  const openConsole = (profileId: string) => {
    setActiveProfileId(profileId)
    setActiveView('console')
  }

  const openEditor = (profileId: string) => {
    setActiveProfileId(profileId)
    setActiveView('editor')
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="w-20 h-20 rounded-full bg-pz-card border border-pz-border flex items-center justify-center">
          <Server size={36} className="text-pz-muted" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-pz-text mb-2">No Servers Yet</h2>
          <p className="text-pz-muted max-w-sm">
            Create your first Project Zomboid dedicated server profile to get started.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { setActiveProfileId(null); setActiveView('install') }}
            className="btn-outline"
          >
            <Zap size={16} />
            Install Server Files
          </button>
          <button
            onClick={() => { setActiveProfileId(null); setActiveView('editor') }}
            className="btn-primary"
          >
            <Plus size={16} />
            New Server Profile
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-pz-text">Server Dashboard</h1>
          <p className="text-sm text-pz-muted mt-0.5">
            {profiles.length} server{profiles.length !== 1 ? 's' : ''} configured
            {Object.values(serverStatuses).filter(s => s === 'running').length > 0 && (
              <span className="text-pz-green ml-2">
                · {Object.values(serverStatuses).filter(s => s === 'running').length} running
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { setActiveProfileId(null); setActiveView('editor') }}
          className="btn-primary"
        >
          <Plus size={16} />
          New Server
        </button>
      </div>

      {/* Server grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {profiles.map(profile => {
          const status = (serverStatuses[profile.id] || 'stopped') as ServerStatus
          const isRunning = status === 'running' || status === 'starting'
          const loading = actionLoading[profile.id]

          return (
            <div key={profile.id} className={`card p-5 transition-all ${
              isRunning ? 'border-pz-green/30 shadow-lg shadow-pz-green/5' : ''
            }`}>
              {/* Card header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isRunning ? 'bg-pz-green/20' : 'bg-pz-border'
                  }`}>
                    <Server size={20} className={isRunning ? 'text-pz-green' : 'text-pz-muted'} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-pz-text">{profile.name}</h3>
                    {profile.description && (
                      <p className="text-xs text-pz-muted truncate max-w-48">{profile.description}</p>
                    )}
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatItem icon={<Globe size={12} />} label="Port" value={String(profile.port)} />
                <StatItem icon={<Cpu size={12} />} label="Players" value={`0/${profile.maxPlayers}`} />
                <StatItem icon={<MemoryStick size={12} />} label="Memory" value={`${profile.memory}MB`} />
              </div>

              {/* Mods & world info */}
              <div className="flex items-center gap-4 mb-4 text-xs text-pz-muted">
                <span>{profile.mods?.length || 0} mod{(profile.mods?.length || 0) !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>World: {worldSizes[profile.id] || '...'}</span>
                {profile.lastStarted && (
                  <>
                    <span>·</span>
                    <span>Last run: {new Date(profile.lastStarted).toLocaleDateString()}</span>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {!isRunning ? (
                  <button
                    onClick={() => handleStart(profile)}
                    disabled={!!loading}
                    className="btn-primary flex-1 justify-center"
                  >
                    <Play size={14} />
                    {loading === 'starting' ? 'Starting...' : 'Start'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStop(profile)}
                    disabled={!!loading}
                    className="btn-danger flex-1 justify-center"
                  >
                    <Square size={14} />
                    {loading === 'stopping' ? 'Stopping...' : 'Stop'}
                  </button>
                )}

                <button
                  onClick={() => openConsole(profile.id)}
                  className="btn-outline"
                  title="Open Console"
                >
                  <Terminal size={14} />
                </button>

                <button
                  onClick={() => openEditor(profile.id)}
                  className="btn-outline"
                  title="Edit Server"
                >
                  <Settings size={14} />
                </button>

                <button
                  onClick={() => handleDuplicate(profile.id)}
                  className="btn-ghost"
                  title="Duplicate"
                >
                  <Copy size={14} />
                </button>

                <button
                  onClick={() => setDeleteTarget(profile.id)}
                  className="btn-ghost text-pz-red hover:text-pz-red"
                  title="Delete"
                  disabled={isRunning}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Server Profile"
        message="Are you sure you want to delete this server profile? This will NOT delete the server files or world data — only the profile configuration."
        confirmLabel="Delete Profile"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-pz-darker rounded-md px-3 py-2">
      <div className="flex items-center gap-1 text-pz-muted mb-0.5">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-sm font-medium text-pz-text">{value}</div>
    </div>
  )
}
