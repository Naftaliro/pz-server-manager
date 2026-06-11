import { useState, useEffect } from 'react'
import { Save, FolderOpen, ArrowLeft, Settings2, Package, Sliders, Trash2, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import ConfirmDialog from '../components/ConfirmDialog'

const DEFAULT_PROFILE: Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  description: '',
  serverInstallPath: 'C:\\PZServer',
  port: 16261,
  udpPort: 16262,
  memory: 4096,
  adminPassword: '',
  serverPassword: '',
  maxPlayers: 16,
  mods: [],
  iniSettings: {},
  sandboxSettings: {},
}

const MAPS = [
  'Muldraugh, KY',
  'Riverside, KY',
  'West Point, KY',
  'March Ridge, KY',
  'Ekron, KY',
  'Louisville, KY',
  'Rosewood, KY',
  'Mul+West+Eki+Rvs',
]

export default function ServerEditor() {
  const { activeProfileId, setActiveView, setActiveProfileId, profiles, setProfiles, updateProfile } = useAppStore()
  const [form, setForm] = useState<Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'>>(DEFAULT_PROFILE)
  const [tab, setTab] = useState<'basic' | 'network' | 'gameplay' | 'advanced'>('basic')
  const [saving, setSaving] = useState(false)
  const [wipeConfirm, setWipeConfirm] = useState(false)
  const [wipeMsg, setWipeMsg] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const isNew = !activeProfileId
  const existingProfile = profiles.find(p => p.id === activeProfileId)

  useEffect(() => {
    if (existingProfile) {
      setForm({
        name: existingProfile.name,
        description: existingProfile.description,
        serverInstallPath: existingProfile.serverInstallPath,
        port: existingProfile.port,
        udpPort: existingProfile.udpPort || existingProfile.port + 1,
        memory: existingProfile.memory,
        adminPassword: existingProfile.adminPassword,
        serverPassword: existingProfile.serverPassword,
        maxPlayers: existingProfile.maxPlayers,
        mods: existingProfile.mods || [],
        iniSettings: existingProfile.iniSettings || {},
        sandboxSettings: existingProfile.sandboxSettings || {},
        lastStarted: existingProfile.lastStarted,
      })
    } else {
      setForm({ ...DEFAULT_PROFILE })
    }
  }, [activeProfileId])

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Server name is required'
    if (form.name.length > 50) errs.name = 'Name must be 50 characters or less'
    if (!form.serverInstallPath.trim()) errs.serverInstallPath = 'Install path is required'
    if (form.port < 1024 || form.port > 65535) errs.port = 'Port must be between 1024 and 65535'
    if (form.memory < 1024 || form.memory > 65536) errs.memory = 'Memory must be between 1024 and 65536 MB'
    if (form.maxPlayers < 1 || form.maxPlayers > 100) errs.maxPlayers = 'Max players must be between 1 and 100'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return

    setSaving(true)
    try {
      const serverName = form.name.replace(/[^a-zA-Z0-9_-]/g, '_')

      // Build INI settings
      const iniSettings = {
        ...(existingProfile?.iniSettings || {}),
        ...form.iniSettings,
        DefaultPort: form.port,
        MaxPlayers: form.maxPlayers,
        Password: form.serverPassword,
        Mods: form.mods.map(m => m.modId).join(';'),
        WorkshopItems: form.mods.map(m => m.workshopId).join(';'),
      }

      const profileData = {
        ...(existingProfile || {}),
        ...form,
        id: activeProfileId || '',
        iniSettings,
        sandboxSettings: existingProfile?.sandboxSettings || form.sandboxSettings || {},
        createdAt: existingProfile?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const saved = await window.electronAPI.profiles.save(profileData)

      // Write config files
      const dataPath = `%USERPROFILE%\\Zomboid`
      await window.electronAPI.config.writeIni(serverName, dataPath, iniSettings)

      // Refresh profiles list
      const updated = await window.electronAPI.profiles.list()
      setProfiles(updated)

      if (!activeProfileId) {
        setActiveProfileId(saved.id)
      }

      setActiveView('dashboard')
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save profile. Please check the console for details.')
    } finally {
      setSaving(false)
    }
  }

  const handleWipe = async () => {
    if (!existingProfile) return
    const serverName = existingProfile.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    const result = await window.electronAPI.world.wipe(serverName, `%USERPROFILE%\\Zomboid`)
    setWipeMsg(result.message)
    setWipeConfirm(false)
  }

  const browseFolder = async () => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (folder) setForm(prev => ({ ...prev, serverInstallPath: folder }))
  }

  const updateIni = (key: string, value: unknown) => {
    setForm(prev => ({
      ...prev,
      iniSettings: { ...prev.iniSettings, [key]: value }
    }))
  }

  const getIni = (key: string, fallback: unknown) => {
    return form.iniSettings[key] !== undefined ? form.iniSettings[key] : fallback
  }

  const tabs = [
    { id: 'basic', label: 'Basic', icon: <Settings2 size={14} /> },
    { id: 'network', label: 'Network', icon: <Package size={14} /> },
    { id: 'gameplay', label: 'Gameplay', icon: <Sliders size={14} /> },
    { id: 'advanced', label: 'Advanced', icon: <Settings2 size={14} /> },
  ] as const

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button
          onClick={() => setActiveView('dashboard')}
          className="btn-ghost p-1.5"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-pz-text">
            {isNew ? 'New Server Profile' : `Edit: ${existingProfile?.name}`}
          </h1>
          <p className="text-xs text-pz-muted">Configure server settings and options</p>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <>
              <button
                onClick={() => { setActiveProfileId(activeProfileId); setActiveView('sandbox') }}
                className="btn-outline"
              >
                <Sliders size={14} />
                Sandbox
              </button>
              <button
                onClick={() => { setActiveProfileId(activeProfileId); setActiveView('mods') }}
                className="btn-outline"
              >
                <Package size={14} />
                Mods
              </button>
            </>
          )}
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-pz-border bg-pz-darker px-6 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Basic Tab */}
          {tab === 'basic' && (
            <>
              <Section title="Identity">
                <FormField label="Server Name *" error={errors.name}>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    className="input"
                    placeholder="My Survival Server"
                    maxLength={50}
                  />
                  <p className="text-xs text-pz-muted mt-1">
                    Used as the server identifier. Only letters, numbers, underscores, and hyphens recommended.
                  </p>
                </FormField>

                <FormField label="Description">
                  <textarea
                    value={form.description}
                    onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                    className="input resize-none"
                    rows={2}
                    placeholder="Optional description for this server profile"
                  />
                </FormField>
              </Section>

              <Section title="Server Files">
                <FormField label="Server Install Path *" error={errors.serverInstallPath}>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.serverInstallPath}
                      onChange={e => setForm(prev => ({ ...prev, serverInstallPath: e.target.value }))}
                      className="input"
                      placeholder="C:\PZServer"
                    />
                    <button onClick={browseFolder} className="btn-outline flex-shrink-0">
                      <FolderOpen size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-pz-muted mt-1">
                    Directory where PZ dedicated server files are installed
                  </p>
                </FormField>

                <FormField label="Server Memory (MB)" error={errors.memory}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1024}
                      max={32768}
                      step={512}
                      value={form.memory}
                      onChange={e => setForm(prev => ({ ...prev, memory: Number(e.target.value) }))}
                      className="flex-1"
                    />
                    <div className="w-24">
                      <input
                        type="number"
                        value={form.memory}
                        onChange={e => setForm(prev => ({ ...prev, memory: Number(e.target.value) }))}
                        className="input text-center"
                        min={1024}
                        max={32768}
                        step={512}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-pz-muted mt-1">
                    Recommended: 4096 MB minimum, 8192 MB for modded servers
                  </p>
                </FormField>
              </Section>

              <Section title="Security">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Admin Password">
                    <input
                      type="password"
                      value={form.adminPassword}
                      onChange={e => setForm(prev => ({ ...prev, adminPassword: e.target.value }))}
                      className="input"
                      placeholder="Admin password"
                    />
                  </FormField>
                  <FormField label="Server Password">
                    <input
                      type="password"
                      value={form.serverPassword}
                      onChange={e => setForm(prev => ({ ...prev, serverPassword: e.target.value }))}
                      className="input"
                      placeholder="Leave empty for no password"
                    />
                  </FormField>
                </div>
              </Section>
            </>
          )}

          {/* Network Tab */}
          {tab === 'network' && (
            <>
              <Section title="Ports">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Game Port" error={errors.port}>
                    <input
                      type="number"
                      value={form.port}
                      onChange={e => setForm(prev => ({ ...prev, port: Number(e.target.value) }))}
                      className="input"
                      min={1024}
                      max={65535}
                    />
                    <p className="text-xs text-pz-muted mt-1">Default: 16261 (UDP)</p>
                  </FormField>
                  <FormField label="Direct Connect Port">
                    <input
                      type="number"
                      value={form.udpPort}
                      onChange={e => setForm(prev => ({ ...prev, udpPort: Number(e.target.value) }))}
                      className="input"
                      min={1024}
                      max={65535}
                    />
                    <p className="text-xs text-pz-muted mt-1">Default: 16262 (UDP)</p>
                  </FormField>
                </div>
                <div className="bg-pz-darker border border-pz-border rounded-md p-3 text-xs text-pz-muted">
                  <strong className="text-pz-text">Port Forwarding Required:</strong> Open UDP ports {form.port} and {form.udpPort} in your router/firewall for players to connect externally.
                </div>
              </Section>

              <Section title="Discovery">
                <ToggleField
                  label="Public Server"
                  description="List server in the in-game server browser"
                  value={!!getIni('Public', false)}
                  onChange={v => updateIni('Public', v)}
                />

                <FormField label="Public Name">
                  <input
                    type="text"
                    value={String(getIni('PublicName', ''))}
                    onChange={e => updateIni('PublicName', e.target.value)}
                    className="input"
                    placeholder="Server name shown in browser"
                  />
                </FormField>

                <FormField label="Public Description">
                  <textarea
                    value={String(getIni('PublicDescription', ''))}
                    onChange={e => updateIni('PublicDescription', e.target.value)}
                    className="input resize-none"
                    rows={2}
                    placeholder="Server description shown in browser"
                  />
                </FormField>
              </Section>

              <Section title="Connection">
                <FormField label="Max Players" error={errors.maxPlayers}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={form.maxPlayers}
                      onChange={e => setForm(prev => ({ ...prev, maxPlayers: Number(e.target.value) }))}
                      className="flex-1"
                    />
                    <div className="w-20">
                      <input
                        type="number"
                        value={form.maxPlayers}
                        onChange={e => setForm(prev => ({ ...prev, maxPlayers: Number(e.target.value) }))}
                        className="input text-center"
                        min={1}
                        max={100}
                      />
                    </div>
                  </div>
                </FormField>

                <ToggleField
                  label="Open Server"
                  description="Allow anyone to join (no whitelist)"
                  value={!!getIni('Open', true)}
                  onChange={v => updateIni('Open', v)}
                />

                <ToggleField
                  label="Auto-add to Whitelist"
                  description="Automatically whitelist new connecting users"
                  value={!!getIni('AutoCreateUserInWhiteList', false)}
                  onChange={v => updateIni('AutoCreateUserInWhiteList', v)}
                />

                <FormField label="Ping Limit (ms)">
                  <input
                    type="number"
                    value={Number(getIni('PingLimit', 250))}
                    onChange={e => updateIni('PingLimit', Number(e.target.value))}
                    className="input"
                    min={0}
                    max={10000}
                  />
                  <p className="text-xs text-pz-muted mt-1">0 = disabled. Players exceeding 5x this value get kicked.</p>
                </FormField>
              </Section>
            </>
          )}

          {/* Gameplay Tab */}
          {tab === 'gameplay' && (
            <>
              <Section title="Map & World">
                <FormField label="Map">
                  <select
                    value={String(getIni('Map', 'Muldraugh, KY'))}
                    onChange={e => updateIni('Map', e.target.value)}
                    className="select"
                  >
                    {MAPS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Welcome Message">
                  <textarea
                    value={String(getIni('ServerWelcomeMessage', 'Welcome to Project Zomboid!'))}
                    onChange={e => updateIni('ServerWelcomeMessage', e.target.value)}
                    className="input resize-none"
                    rows={3}
                    placeholder="Message shown to players on connect"
                  />
                </FormField>

                <ToggleField
                  label="Pause When Empty"
                  description="Pause the world simulation when no players are online"
                  value={!!getIni('PauseEmpty', true)}
                  onChange={v => updateIni('PauseEmpty', v)}
                />

                <FormField label="Save World Every (minutes)">
                  <input
                    type="number"
                    value={Number(getIni('SaveWorldEveryMinutes', 0))}
                    onChange={e => updateIni('SaveWorldEveryMinutes', Number(e.target.value))}
                    className="input"
                    min={0}
                    max={1440}
                  />
                  <p className="text-xs text-pz-muted mt-1">0 = only save on server stop</p>
                </FormField>
              </Section>

              <Section title="PvP">
                <ToggleField
                  label="Enable PvP"
                  description="Allow players to damage each other"
                  value={!!getIni('PVP', true)}
                  onChange={v => updateIni('PVP', v)}
                />
                <ToggleField
                  label="Safety System"
                  description="Players can individually toggle PvP on/off"
                  value={!!getIni('SafetySystem', true)}
                  onChange={v => updateIni('SafetySystem', v)}
                />
                <ToggleField
                  label="Announce Death"
                  description="Server-wide announcement when a player dies"
                  value={!!getIni('AnnounceDeath', true)}
                  onChange={v => updateIni('AnnounceDeath', v)}
                />
              </Section>

              <Section title="Safehouses">
                <ToggleField
                  label="Player Safehouses"
                  description="Allow players to claim safehouses"
                  value={!!getIni('PlayerSafehouse', true)}
                  onChange={v => updateIni('PlayerSafehouse', v)}
                />
                <ToggleField
                  label="Allow Safehouse Respawn"
                  description="Players respawn in their safehouse after death"
                  value={!!getIni('SafehouseAllowRespawn', false)}
                  onChange={v => updateIni('SafehouseAllowRespawn', v)}
                />
                <FormField label="Days Survived to Claim Safehouse">
                  <input
                    type="number"
                    value={Number(getIni('SafehouseDaySurvivedToClaim', 0))}
                    onChange={e => updateIni('SafehouseDaySurvivedToClaim', Number(e.target.value))}
                    className="input"
                    min={0}
                  />
                </FormField>
              </Section>

              <Section title="Chat">
                <ToggleField
                  label="Global Chat"
                  description="Enable /all global chat channel"
                  value={!!getIni('GlobalChat', true)}
                  onChange={v => updateIni('GlobalChat', v)}
                />
                <ToggleField
                  label="Display Usernames"
                  description="Show player usernames above their heads"
                  value={!!getIni('DisplayUserName', true)}
                  onChange={v => updateIni('DisplayUserName', v)}
                />
                <ToggleField
                  label="Show First & Last Name"
                  description="Display character names instead of usernames"
                  value={!!getIni('ShowFirstAndLastName', false)}
                  onChange={v => updateIni('ShowFirstAndLastName', v)}
                />
              </Section>

              <Section title="Sleep">
                <ToggleField
                  label="Sleep Allowed"
                  description="Allow players to sleep (requires all players in bed)"
                  value={!!getIni('SleepAllowed', false)}
                  onChange={v => updateIni('SleepAllowed', v)}
                />
                <ToggleField
                  label="Sleep Needed"
                  description="Players must sleep when exhausted"
                  value={!!getIni('SleepNeeded', false)}
                  onChange={v => updateIni('SleepNeeded', v)}
                />
              </Section>
            </>
          )}

          {/* Advanced Tab */}
          {tab === 'advanced' && (
            <>
              <Section title="Loot">
                <FormField label="Loot Respawn (hours, 0=never)">
                  <input
                    type="number"
                    value={Number(getIni('HoursForLootRespawn', 0))}
                    onChange={e => updateIni('HoursForLootRespawn', Number(e.target.value))}
                    className="input"
                    min={0}
                  />
                </FormField>
                <ToggleField
                  label="Construction Prevents Loot Respawn"
                  description="Player-built structures prevent loot from respawning nearby"
                  value={!!getIni('ConstructionPreventsLootRespawn', true)}
                  onChange={v => updateIni('ConstructionPreventsLootRespawn', v)}
                />
              </Section>

              <Section title="Factions">
                <ToggleField
                  label="Enable Factions"
                  description="Allow players to create and join factions"
                  value={!!getIni('Faction', true)}
                  onChange={v => updateIni('Faction', v)}
                />
                <FormField label="Days Survived to Create Faction">
                  <input
                    type="number"
                    value={Number(getIni('FactionDaySurvivedToCreate', 0))}
                    onChange={e => updateIni('FactionDaySurvivedToCreate', Number(e.target.value))}
                    className="input"
                    min={0}
                  />
                </FormField>
              </Section>

              <Section title="RCON">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="RCON Port">
                    <input
                      type="number"
                      value={Number(getIni('RCONPort', 27015))}
                      onChange={e => updateIni('RCONPort', Number(e.target.value))}
                      className="input"
                    />
                  </FormField>
                  <FormField label="RCON Password">
                    <input
                      type="password"
                      value={String(getIni('RCONPassword', ''))}
                      onChange={e => updateIni('RCONPassword', e.target.value)}
                      className="input"
                      placeholder="Leave empty to disable"
                    />
                  </FormField>
                </div>
              </Section>

              <Section title="Voice Chat">
                <ToggleField
                  label="Enable Voice Chat"
                  description="Built-in proximity voice chat"
                  value={!!getIni('VoiceEnable', true)}
                  onChange={v => updateIni('VoiceEnable', v)}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Min Distance (tiles)">
                    <input
                      type="number"
                      value={Number(getIni('VoiceMinDistance', 10))}
                      onChange={e => updateIni('VoiceMinDistance', Number(e.target.value))}
                      className="input"
                    />
                  </FormField>
                  <FormField label="Max Distance (tiles)">
                    <input
                      type="number"
                      value={Number(getIni('VoiceMaxDistance', 300))}
                      onChange={e => updateIni('VoiceMaxDistance', Number(e.target.value))}
                      className="input"
                    />
                  </FormField>
                </div>
              </Section>

              {/* World Wipe */}
              {!isNew && (
                <Section title="Danger Zone">
                  <div className="bg-pz-red/10 border border-pz-red/20 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="text-pz-red flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-pz-red">Wipe World Data</h4>
                        <p className="text-xs text-pz-muted mt-1">
                          Permanently deletes all world save data for this server. Player characters, base builds, and world state will be lost. Server settings and mods are preserved.
                        </p>
                        {wipeMsg && (
                          <p className="text-xs text-pz-green mt-2">{wipeMsg}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setWipeConfirm(true)}
                        className="btn-danger flex-shrink-0"
                      >
                        <Trash2 size={14} />
                        Wipe World
                      </button>
                    </div>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={wipeConfirm}
        title="Wipe World Data"
        message={`This will permanently delete all world save data for "${form.name}". This cannot be undone. Are you absolutely sure?`}
        confirmLabel="Yes, Wipe World"
        danger
        onConfirm={handleWipe}
        onCancel={() => setWipeConfirm(false)}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h2 className="section-title border-b border-pz-border pb-2">{title}</h2>
      {children}
    </div>
  )
}

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="text-xs text-pz-red mt-1">{error}</p>}
    </div>
  )
}

function ToggleField({
  label, description, value, onChange
}: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <div className="text-sm text-pz-text">{label}</div>
        <div className="text-xs text-pz-muted">{description}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
          value ? 'bg-pz-green' : 'bg-pz-border'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}
