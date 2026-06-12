import { useState, useEffect } from 'react'
import { Save, FolderOpen, ArrowLeft, Settings2, Package, Sliders, Trash2, AlertTriangle, RotateCcw, CheckCircle, XCircle, Loader, Download, Upload, FileCode2, Search, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile, BuildVersion, LaunchMode } from '../store/useAppStore'
import ConfirmDialog from '../components/ConfirmDialog'

const DEFAULT_PROFILE: Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  description: '',
  buildVersion: 'b42',
  serverInstallPath: 'C:\\PZServer',
  worldSavePath: '',
  port: 16261,
  udpPort: 16262,
  memory: 4096,
  adminPassword: '',
  serverPassword: '',
  maxPlayers: 16,
  mods: [],
  launchMode: 'managed' as LaunchMode,
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
  const { activeProfileId, setActiveView, setActiveProfileId, profiles, setProfiles } = useAppStore()
  const [form, setForm] = useState<Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'>>(DEFAULT_PROFILE)
  const [tab, setTab] = useState<'basic' | 'network' | 'gameplay' | 'pvp' | 'safehouses' | 'advanced' | 'discord' | 'danger'>('basic')
  const [saving, setSaving] = useState(false)
  const [wipeConfirm, setWipeConfirm] = useState(false)
  const [wipeMsg, setWipeMsg] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [importMsg, setImportMsg] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchLower = searchQuery.toLowerCase().trim()

  const isNew = !activeProfileId
  const existingProfile = profiles.find(p => p.id === activeProfileId)

  useEffect(() => {
    if (existingProfile) {
      setForm({
        name: existingProfile.name,
        description: existingProfile.description,
        buildVersion: existingProfile.buildVersion || 'b42',
        serverInstallPath: existingProfile.serverInstallPath,
        worldSavePath: existingProfile.worldSavePath || '',
        port: existingProfile.port,
        udpPort: existingProfile.udpPort || existingProfile.port + 1,
        memory: existingProfile.memory,
        adminPassword: existingProfile.adminPassword,
        serverPassword: existingProfile.serverPassword,
        maxPlayers: existingProfile.maxPlayers,
        mods: existingProfile.mods || [],
        launchMode: existingProfile.launchMode || 'managed',
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
      const dataPath = form.worldSavePath || `%USERPROFILE%\\Zomboid`
      await window.electronAPI.config.writeIni(serverName, dataPath, iniSettings)
      const updated = await window.electronAPI.profiles.list()
      setProfiles(updated)
      if (!activeProfileId) setActiveProfileId(saved.id)
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
    const dataPath = form.worldSavePath || `%USERPROFILE%\\Zomboid`
    const result = await window.electronAPI.world.wipe(serverName, dataPath)
    setWipeMsg(result.message)
    setWipeConfirm(false)
  }

  // Import INI from file
  const handleImportIni = async () => {
    try {
      const filePath = await window.electronAPI.dialog.openFile({ filters: [{ name: 'INI Files', extensions: ['ini'] }, { name: 'All Files', extensions: ['*'] }] })
      if (!filePath) return
      const fileResult = await window.electronAPI.fs.readFile(filePath)
      if (!fileResult.success || !fileResult.content) {
        setImportMsg('Failed to read file: ' + (fileResult.message || 'Unknown error'))
        setTimeout(() => setImportMsg(''), 4000)
        return
      }
      const parsed: Record<string, unknown> = {}
      fileResult.content.split('\n').forEach((line: string) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) return
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim()
        if (val === 'true') parsed[key] = true
        else if (val === 'false') parsed[key] = false
        else if (!isNaN(Number(val)) && val !== '') parsed[key] = Number(val)
        else parsed[key] = val
      })
      setForm(prev => ({ ...prev, iniSettings: { ...prev.iniSettings, ...parsed } }))
      setImportMsg(`Imported ${Object.keys(parsed).length} settings from INI file`)
      setTimeout(() => setImportMsg(''), 4000)
    } catch (err) {
      setImportMsg('Failed to import INI file')
      setTimeout(() => setImportMsg(''), 4000)
    }
  }

  // Export INI to file
  const handleExportIni = async () => {
    try {
      const serverName = form.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'server'
      const iniSettings = {
        ...(existingProfile?.iniSettings || {}),
        ...form.iniSettings,
        DefaultPort: form.port,
        MaxPlayers: form.maxPlayers,
        Password: form.serverPassword,
        Mods: form.mods.map(m => m.modId).join(';'),
        WorkshopItems: form.mods.map(m => m.workshopId).join(';'),
      }
      const lines = Object.entries(iniSettings).map(([k, v]) => `${k}=${v}`)
      const content = lines.join('\n')
      const savePath = await window.electronAPI.dialog.saveFile({ defaultPath: `${serverName}.ini`, filters: [{ name: 'INI Files', extensions: ['ini'] }] })
      if (!savePath) return
      await window.electronAPI.fs.writeFile(savePath, content)
      setExportMsg('INI exported successfully')
      setTimeout(() => setExportMsg(''), 4000)
    } catch (err) {
      setExportMsg('Failed to export INI file')
      setTimeout(() => setExportMsg(''), 4000)
    }
  }

  const [pathStatus, setPathStatus] = useState<'idle' | 'checking' | 'ok' | 'found' | 'notfound'>('idle')
  const [pathFoundAt, setPathFoundAt] = useState('')

  const checkPath = async (dir: string) => {
    if (!dir.trim()) { setPathStatus('idle'); return }
    setPathStatus('checking')
    const result = await window.electronAPI.fs.findServerBat(dir)
    if (result.success) {
      if (result.path !== dir) {
        setPathFoundAt(result.path || '')
        setPathStatus('found')
      } else {
        setPathStatus('ok')
        setPathFoundAt('')
      }
    } else {
      setPathStatus('notfound')
      setPathFoundAt('')
    }
  }

  const applyFoundPath = () => {
    setForm(prev => ({ ...prev, serverInstallPath: pathFoundAt }))
    setPathStatus('ok')
    setPathFoundAt('')
  }

  const browseFolder = async () => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (folder) {
      setForm(prev => ({ ...prev, serverInstallPath: folder }))
      checkPath(folder)
    }
  }

  const browseWorldSave = async () => {
    const folder = await window.electronAPI.dialog.openFolder()
    if (folder) setForm(prev => ({ ...prev, worldSavePath: folder }))
  }

  const resetIniToDefaults = () => {
    if (!window.confirm('Reset all server config settings to defaults? Basic info (name, path, password) will be kept.')) return
    setForm(prev => ({ ...prev, port: 16261, udpPort: 16262, memory: 4096, maxPlayers: 16, iniSettings: {} }))
  }

  const updateIni = (key: string, value: unknown) => {
    setForm(prev => ({ ...prev, iniSettings: { ...prev.iniSettings, [key]: value } }))
  }

  const getIni = (key: string, fallback: unknown) => {
    return form.iniSettings[key] !== undefined ? form.iniSettings[key] : fallback
  }

  const tabs = [
    { id: 'basic', label: 'Basic' },
    { id: 'network', label: 'Network' },
    { id: 'gameplay', label: 'Gameplay' },
    { id: 'pvp', label: 'PvP' },
    { id: 'safehouses', label: 'Safehouses' },
    { id: 'advanced', label: 'Advanced' },
    { id: 'discord', label: 'Discord' },
    { id: 'danger', label: 'Danger Zone' },
  ] as const

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={() => setActiveView('dashboard')} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-pz-text">
            {isNew ? 'New Server Profile' : `Edit: ${existingProfile?.name}`}
          </h1>
          <p className="text-xs text-pz-muted">Configure server settings and options</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isNew && (
            <>
              <button onClick={() => { setActiveProfileId(activeProfileId); setActiveView('sandbox') }} className="btn-outline">
                <Sliders size={14} /> Sandbox
              </button>
              <button onClick={() => { setActiveProfileId(activeProfileId); setActiveView('mods') }} className="btn-outline">
                <Package size={14} /> Mods
              </button>
            </>
          )}
          <button onClick={handleImportIni} className="btn-outline text-xs" title="Import settings from .ini file">
            <Upload size={12} /> Import INI
          </button>
          <button onClick={handleExportIni} className="btn-outline text-xs" title="Export settings to .ini file">
            <Download size={12} /> Export INI
          </button>
          <button onClick={resetIniToDefaults} className="btn-outline text-xs" title="Reset server config to defaults">
            <RotateCcw size={12} /> Reset Defaults
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Import/Export messages */}
      {(importMsg || exportMsg) && (
        <div className="px-6 py-2 bg-pz-green/10 border-b border-pz-green/20 text-xs text-pz-green">
          {importMsg || exportMsg}
        </div>
      )}

      {/* Search bar */}
      <div className="px-6 py-2 border-b border-pz-border bg-pz-darker flex items-center gap-2 flex-shrink-0">
        <Search size={14} className="text-pz-muted flex-shrink-0" />
        <input
          type="text"
          placeholder="Search settings…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-pz-text placeholder:text-pz-muted outline-none"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-pz-muted hover:text-pz-text">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Tabs — hidden when searching */}
      {!searchLower && (
        <div className="flex gap-0 border-b border-pz-border bg-pz-darker px-6 flex-shrink-0 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t.id ? 'tab-active' : 'tab-inactive'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* ── SEARCH RESULTS ── */}
          {searchLower && (
            <div className="card p-5 space-y-4">
              <h2 className="section-title border-b border-pz-border pb-2">Search results for "{searchQuery}"</h2>
              <IniSearchResults query={searchLower} getIni={getIni} updateIni={updateIni} />
            </div>
          )}

          {/* ── BASIC TAB ── */}
          {!searchLower && tab === 'basic' && (
            <>
              <Section title="Identity">
                <FormField label="Server Name *" error={errors.name}>
                  <input type="text" value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    className="input" placeholder="My Survival Server" maxLength={50} />
                  <p className="text-xs text-pz-muted mt-1">Used as the server identifier. Only letters, numbers, underscores, and hyphens recommended.</p>
                </FormField>

                <FormField label="Description">
                  <textarea value={form.description}
                    onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                    className="input resize-none" rows={2} placeholder="Optional description for this server profile" />
                </FormField>

                <FormField label="Build Version">
                  <div className="flex gap-3">
                    {(['b41', 'b42'] as BuildVersion[]).map(v => (
                      <button
                        key={v}
                        onClick={() => setForm(prev => ({ ...prev, buildVersion: v }))}
                        className={`flex-1 py-2 rounded-md border text-sm font-semibold transition-colors ${
                          form.buildVersion === v
                            ? 'bg-pz-green/20 border-pz-green text-pz-green'
                            : 'border-pz-border text-pz-muted hover:border-pz-text'
                        }`}
                      >
                        {v === 'b41' ? 'Build 41 (Stable)' : 'Build 42 (Unstable)'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-pz-muted mt-1">
                    {form.buildVersion === 'b41'
                      ? 'B41 is the stable release. Mods and Workshop search will be filtered to B41-compatible items.'
                      : 'B42 is the current unstable branch with animals, crafting, and new game modes. Mods will be filtered to B42-compatible items.'}
                  </p>
                </FormField>
              </Section>

              <Section title="Launch Mode">
                <div className="space-y-3">
                  <div className="flex gap-3">
                    {(['managed', 'passthrough'] as LaunchMode[]).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setForm(prev => ({ ...prev, launchMode: mode }))}
                        className={`flex-1 py-3 px-4 rounded-md border text-sm font-semibold transition-colors text-left ${
                          form.launchMode === mode
                            ? 'bg-pz-green/20 border-pz-green text-pz-green'
                            : 'border-pz-border text-pz-muted hover:border-pz-text'
                        }`}
                      >
                        <div className="font-semibold">{mode === 'managed' ? '⚙ Managed (Recommended)' : '📄 Use Files As-Is'}</div>
                        <div className="text-xs font-normal mt-0.5 opacity-80">
                          {mode === 'managed'
                            ? 'App writes INI & SandboxVars from your profile settings before each launch'
                            : 'App launches the server without touching any config files — your manual edits are preserved'}
                        </div>
                      </button>
                    ))}
                  </div>
                  {form.launchMode === 'passthrough' && (
                    <div className="flex items-start gap-2 p-3 bg-amber-900/20 border border-amber-700/30 rounded-md">
                      <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-300">
                        <strong>Files As-Is mode:</strong> The app will NOT overwrite your config files on launch. Use the Raw File Editor to edit them directly. Make sure your files exist in <code>%USERPROFILE%\Zomboid\Server\</code> before starting.
                      </div>
                    </div>
                  )}
                  {!isNew && (
                    <button
                      onClick={() => { setActiveView('raweditor') }}
                      className="btn-outline text-xs w-full"
                    >
                      <FileCode2 size={13} /> Open Raw File Editor (edit .ini and _SandboxVars.lua directly)
                    </button>
                  )}
                </div>
              </Section>

              <Section title="Server Files">
                <FormField label="Server Install Path *" error={errors.serverInstallPath}>
                  <div className="flex gap-2">
                    <input type="text" value={form.serverInstallPath}
                      onChange={e => { setForm(prev => ({ ...prev, serverInstallPath: e.target.value })); setPathStatus('idle') }}
                      onBlur={e => checkPath(e.target.value)}
                      className="input" placeholder="C:\PZServer" />
                    <button onClick={browseFolder} className="btn-outline flex-shrink-0" title="Browse for folder">
                      <FolderOpen size={14} />
                    </button>
                    <button onClick={() => checkPath(form.serverInstallPath)} className="btn-outline flex-shrink-0"
                      title="Verify path" disabled={!form.serverInstallPath.trim()}>
                      {pathStatus === 'checking' ? <Loader size={14} className="animate-spin" /> : 'Verify'}
                    </button>
                  </div>
                  {pathStatus === 'ok' && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-pz-green">
                      <CheckCircle size={12} /><span>StartServer64.bat found — path is valid</span>
                    </div>
                  )}
                  {pathStatus === 'found' && (
                    <div className="mt-1.5 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs">
                      <div className="flex items-center gap-1.5 text-yellow-400 mb-1">
                        <AlertTriangle size={12} /><span className="font-medium">Server found in a subdirectory</span>
                      </div>
                      <p className="text-pz-muted mb-1.5">Found at: <code className="text-pz-text">{pathFoundAt}</code></p>
                      <button onClick={applyFoundPath} className="btn-primary text-xs py-1 px-2">Use this path</button>
                    </div>
                  )}
                  {pathStatus === 'notfound' && (
                    <div className="mt-1.5 p-2 bg-pz-red/10 border border-pz-red/30 rounded text-xs">
                      <div className="flex items-center gap-1.5 text-pz-red mb-1">
                        <XCircle size={12} /><span className="font-medium">StartServer64.bat not found</span>
                      </div>
                      <p className="text-pz-muted">Common Steam paths to try:</p>
                      <ul className="text-pz-muted mt-0.5 space-y-0.5">
                        <li><code className="text-pz-text">C:\Program Files (x86)\Steam\steamapps\common\Project Zomboid Dedicated Server</code></li>
                        <li><code className="text-pz-text">C:\PZServer</code> (SteamCMD default)</li>
                      </ul>
                    </div>
                  )}
                  {pathStatus === 'idle' && (
                    <p className="text-xs text-pz-muted mt-1">
                      Point to your PZ dedicated server folder. Common Steam path: <code>C:\Program Files (x86)\Steam\steamapps\common\Project Zomboid Dedicated Server</code>
                    </p>
                  )}
                </FormField>

                <FormField label="World Save Path (optional)">
                  <div className="flex gap-2">
                    <input type="text" value={form.worldSavePath || ''}
                      onChange={e => setForm(prev => ({ ...prev, worldSavePath: e.target.value }))}
                      className="input" placeholder="%USERPROFILE%\Zomboid (default)" />
                    <button onClick={browseWorldSave} className="btn-outline flex-shrink-0" title="Browse for world save folder">
                      <FolderOpen size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-pz-muted mt-1">
                    Override where world saves are stored. Leave empty to use the default <code>%USERPROFILE%\Zomboid</code>. Used by the World Wipe feature.
                  </p>
                </FormField>

                <FormField label="Server Memory (MB)" error={errors.memory}>
                  <div className="flex items-center gap-3">
                    <input type="range" min={1024} max={32768} step={512} value={form.memory}
                      onChange={e => setForm(prev => ({ ...prev, memory: Number(e.target.value) }))} className="flex-1" />
                    <div className="w-24">
                      <input type="number" value={form.memory}
                        onChange={e => setForm(prev => ({ ...prev, memory: Number(e.target.value) }))}
                        className="input text-center" min={1024} max={32768} step={512} />
                    </div>
                  </div>
                  <p className="text-xs text-pz-muted mt-1">
                    {form.buildVersion === 'b42'
                      ? 'B42 recommended: 8192 MB minimum, 12288+ MB for modded servers with animals'
                      : 'Recommended: 4096 MB minimum, 8192 MB for modded servers'}
                  </p>
                </FormField>
              </Section>

              <Section title="Security">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Admin Password">
                    <input type="password" value={form.adminPassword}
                      onChange={e => setForm(prev => ({ ...prev, adminPassword: e.target.value }))}
                      className="input" placeholder="Admin password (required to start)" />
                    <p className="text-xs text-pz-muted mt-1">Required — passed via -adminpassword flag on server start</p>
                  </FormField>
                  <FormField label="Server Password">
                    <input type="password" value={form.serverPassword}
                      onChange={e => setForm(prev => ({ ...prev, serverPassword: e.target.value }))}
                      className="input" placeholder="Leave empty for no password" />
                  </FormField>
                </div>
              </Section>
            </>
          )}

          {/* ── NETWORK TAB ── */}
          {!searchLower && tab === 'network' && (
            <>
              <Section title="Ports">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Game Port" error={errors.port}>
                    <input type="number" value={form.port}
                      onChange={e => setForm(prev => ({ ...prev, port: Number(e.target.value) }))}
                      className="input" min={1024} max={65535} />
                    <p className="text-xs text-pz-muted mt-1">Default: 16261 (UDP)</p>
                  </FormField>
                  <FormField label="Direct Connect Port">
                    <input type="number" value={form.udpPort}
                      onChange={e => setForm(prev => ({ ...prev, udpPort: Number(e.target.value) }))}
                      className="input" min={1024} max={65535} />
                    <p className="text-xs text-pz-muted mt-1">Default: 16262 (UDP)</p>
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Steam Port 1">
                    <input type="number" value={Number(getIni('SteamPort1', 8766))}
                      onChange={e => updateIni('SteamPort1', Number(e.target.value))} className="input" />
                  </FormField>
                  <FormField label="Steam Port 2">
                    <input type="number" value={Number(getIni('SteamPort2', 8767))}
                      onChange={e => updateIni('SteamPort2', Number(e.target.value))} className="input" />
                  </FormField>
                </div>
                <div className="bg-pz-darker border border-pz-border rounded-md p-3 text-xs text-pz-muted">
                  <strong className="text-pz-text">Port Forwarding Required:</strong> Open UDP ports {form.port} and {form.udpPort} in your router/firewall for external players.
                </div>
              </Section>

              <Section title="Discovery">
                <ToggleField label="Public Server" description="List server in the in-game server browser"
                  value={!!getIni('Public', false)} onChange={v => updateIni('Public', v)} />
                <FormField label="Public Name">
                  <input type="text" value={String(getIni('PublicName', ''))}
                    onChange={e => updateIni('PublicName', e.target.value)} className="input" placeholder="Server name shown in browser" />
                </FormField>
                <FormField label="Public Description">
                  <textarea value={String(getIni('PublicDescription', ''))}
                    onChange={e => updateIni('PublicDescription', e.target.value)}
                    className="input resize-none" rows={2} placeholder="Server description (use \n for newlines)" />
                </FormField>
              </Section>

              <Section title="Connection">
                <FormField label="Max Players" error={errors.maxPlayers}>
                  <div className="flex items-center gap-3">
                    <input type="range" min={1} max={100} value={form.maxPlayers}
                      onChange={e => setForm(prev => ({ ...prev, maxPlayers: Number(e.target.value) }))} className="flex-1" />
                    <div className="w-20">
                      <input type="number" value={form.maxPlayers}
                        onChange={e => setForm(prev => ({ ...prev, maxPlayers: Number(e.target.value) }))}
                        className="input text-center" min={1} max={100} />
                    </div>
                  </div>
                  <p className="text-xs text-pz-muted mt-1">Warning: counts above 32 may cause desync issues</p>
                </FormField>
                <FormField label="Max Accounts Per User">
                  <input type="number" value={Number(getIni('MaxAccountsPerUser', 0))}
                    onChange={e => updateIni('MaxAccountsPerUser', Number(e.target.value))} className="input" min={0} />
                  <p className="text-xs text-pz-muted mt-1">0 = unlimited</p>
                </FormField>
                <ToggleField label="Open Server" description="Allow anyone to join (no whitelist)"
                  value={!!getIni('Open', true)} onChange={v => updateIni('Open', v)} />
                <ToggleField label="Auto-add to Whitelist" description="Automatically whitelist new connecting users"
                  value={!!getIni('AutoCreateUserInWhiteList', false)} onChange={v => updateIni('AutoCreateUserInWhiteList', v)} />
                <ToggleField label="Drop from Whitelist After Death" description="Remove player from whitelist when their character dies"
                  value={!!getIni('DropOffWhiteListAfterDeath', false)} onChange={v => updateIni('DropOffWhiteListAfterDeath', v)} />
                <FormField label="Ping Limit (ms)">
                  <input type="number" value={Number(getIni('PingLimit', 250))}
                    onChange={e => updateIni('PingLimit', Number(e.target.value))} className="input" min={0} max={10000} />
                  <p className="text-xs text-pz-muted mt-1">0 = disabled. Players exceeding 5x this value get kicked.</p>
                </FormField>
                <FormField label="Ping Frequency (seconds)">
                  <input type="number" value={Number(getIni('PingFrequency', 10))}
                    onChange={e => updateIni('PingFrequency', Number(e.target.value))} className="input" min={1} />
                </FormField>
                <ToggleField label="Deny Login on Overloaded Server" description="Prevent new logins when server is overloaded"
                  value={!!getIni('DenyLoginOnOverloadedServer', true)} onChange={v => updateIni('DenyLoginOnOverloadedServer', v)} />
                <ToggleField label="Kick Fast Players" description="Kick players moving faster than possible (may be buggy)"
                  value={!!getIni('KickFastPlayers', false)} onChange={v => updateIni('KickFastPlayers', v)} />
                <ToggleField label="Allow Co-op / Splitscreen" description="Allow co-op splitscreen players"
                  value={!!getIni('AllowCoop', true)} onChange={v => updateIni('AllowCoop', v)} />
              </Section>

              <Section title="Steam">
                <ToggleField label="Steam VAC" description="Enable Steam VAC anti-cheat"
                  value={!!getIni('SteamVAC', true)} onChange={v => updateIni('SteamVAC', v)} />
                <ToggleField label="Steam Scoreboard" description="Show Steam usernames/avatars in player list"
                  value={!!getIni('SteamScoreboard', true)} onChange={v => updateIni('SteamScoreboard', v)} />
                <ToggleField label="UPnP" description="Automatically configure port forwarding via UPnP"
                  value={!!getIni('UPnP', true)} onChange={v => updateIni('UPnP', v)} />
              </Section>

              <Section title="Login Queue">
                <ToggleField label="Enable Login Queue" description="Queue players when server is full"
                  value={!!getIni('LoginQueueEnabled', false)} onChange={v => updateIni('LoginQueueEnabled', v)} />
                <FormField label="Login Queue Connect Timeout (seconds)">
                  <input type="number" value={Number(getIni('LoginQueueConnectTimeout', 60))}
                    onChange={e => updateIni('LoginQueueConnectTimeout', Number(e.target.value))} className="input" min={20} max={1200} />
                </FormField>
              </Section>

              <Section title="Backups">
                <ToggleField label="Backup on Start" description="Create a backup after each server restart"
                  value={!!getIni('BackupsOnStart', true)} onChange={v => updateIni('BackupsOnStart', v)} />
                <ToggleField label="Backup on Version Change" description="Create a backup when the game version changes"
                  value={!!getIni('BackupsOnVersionChange', true)} onChange={v => updateIni('BackupsOnVersionChange', v)} />
                <FormField label="Backup Count">
                  <input type="number" value={Number(getIni('BackupsCount', 5))}
                    onChange={e => updateIni('BackupsCount', Number(e.target.value))} className="input" min={1} max={300} />
                  <p className="text-xs text-pz-muted mt-1">How many backups to keep before oldest is deleted</p>
                </FormField>
                <FormField label="Backup Period (minutes, 0=disabled)">
                  <input type="number" value={Number(getIni('BackupsPeriod', 0))}
                    onChange={e => updateIni('BackupsPeriod', Number(e.target.value))} className="input" min={0} max={1500} />
                </FormField>
              </Section>

              <Section title="RCON">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="RCON Port">
                    <input type="number" value={Number(getIni('RCONPort', 27015))}
                      onChange={e => updateIni('RCONPort', Number(e.target.value))} className="input" />
                  </FormField>
                  <FormField label="RCON Password">
                    <input type="password" value={String(getIni('RCONPassword', ''))}
                      onChange={e => updateIni('RCONPassword', e.target.value)} className="input" placeholder="Leave empty to disable" />
                  </FormField>
                </div>
              </Section>
            </>
          )}

          {/* ── GAMEPLAY TAB ── */}
          {!searchLower && tab === 'gameplay' && (
            <>
              <Section title="Map & World">
                <FormField label="Map">
                  <select value={String(getIni('Map', 'Muldraugh, KY'))}
                    onChange={e => updateIni('Map', e.target.value)} className="select">
                    {MAPS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </FormField>
                <FormField label="Welcome Message">
                  <textarea value={String(getIni('ServerWelcomeMessage', 'Welcome to Project Zomboid!'))}
                    onChange={e => updateIni('ServerWelcomeMessage', e.target.value)}
                    className="input resize-none" rows={3} placeholder="Message shown to players on connect. Use <LINE> for line breaks." />
                </FormField>
                <FormField label="Spawn Point (x,y,z)">
                  <input type="text" value={String(getIni('SpawnPoint', '0,0,0'))}
                    onChange={e => updateIni('SpawnPoint', e.target.value)} className="input" placeholder="0,0,0 = use game default" />
                  <p className="text-xs text-pz-muted mt-1">Find coordinates at map.projectzomboid.com. 0,0,0 = use game default spawn regions.</p>
                </FormField>
                <FormField label="Spawn Items">
                  <input type="text" value={String(getIni('SpawnItems', ''))}
                    onChange={e => updateIni('SpawnItems', e.target.value)} className="input" placeholder="Base.BaseballBat,Base.WaterBottleFull" />
                  <p className="text-xs text-pz-muted mt-1">Comma-separated item IDs that new players spawn with</p>
                </FormField>
                <ToggleField label="Pause When Empty" description="Pause the world simulation when no players are online"
                  value={!!getIni('PauseEmpty', true)} onChange={v => updateIni('PauseEmpty', v)} />
                <FormField label="Save World Every (minutes)">
                  <input type="number" value={Number(getIni('SaveWorldEveryMinutes', 0))}
                    onChange={e => updateIni('SaveWorldEveryMinutes', Number(e.target.value))} className="input" min={0} max={1440} />
                  <p className="text-xs text-pz-muted mt-1">0 = only save on server stop</p>
                </FormField>
                <ToggleField label="Verify Lua Checksum" description="Kick clients whose game files don't match the server (disable if using mods)"
                  value={!!getIni('DoLuaChecksum', true)} onChange={v => updateIni('DoLuaChecksum', v)} />
              </Section>

              <Section title="Chat">
                <ToggleField label="Global Chat" description="Enable /all global chat channel"
                  value={!!getIni('GlobalChat', true)} onChange={v => updateIni('GlobalChat', v)} />
                <FormField label="Chat Streams">
                  <input type="text" value={String(getIni('ChatStreams', 's,r,a,w,y,sh,f,all'))}
                    onChange={e => updateIni('ChatStreams', e.target.value)} className="input" />
                  <p className="text-xs text-pz-muted mt-1">Comma-separated: s=say, r=radio, a=admin, w=whisper, y=yell, sh=safehouse, f=faction, all=global</p>
                </FormField>
                <ToggleField label="Display Usernames" description="Show player usernames above their heads"
                  value={!!getIni('DisplayUserName', true)} onChange={v => updateIni('DisplayUserName', v)} />
                <ToggleField label="Show First & Last Name" description="Display character names instead of usernames"
                  value={!!getIni('ShowFirstAndLastName', false)} onChange={v => updateIni('ShowFirstAndLastName', v)} />
                <ToggleField label="Mouse Over to See Name" description="Players must mouse over someone to see their display name"
                  value={!!getIni('MouseOverToSeeDisplayName', true)} onChange={v => updateIni('MouseOverToSeeDisplayName', v)} />
                <ToggleField label="Hide Players Behind You" description="Auto-hide players you can't see (like zombies)"
                  value={!!getIni('HidePlayersBehindYou', true)} onChange={v => updateIni('HidePlayersBehindYou', v)} />
                <ToggleField label="Allow Non-ASCII Usernames" description="Allow Cyrillic and other non-ASCII characters in usernames"
                  value={!!getIni('AllowNonAsciiUsername', false)} onChange={v => updateIni('AllowNonAsciiUsername', v)} />
                <ToggleField label="Ban/Kick Global Sound" description="Play a sound when a player is banned or kicked"
                  value={!!getIni('BanKickGlobalSound', true)} onChange={v => updateIni('BanKickGlobalSound', v)} />
              </Section>

              <Section title="Sleep">
                <ToggleField label="Sleep Allowed" description="Allow players to sleep (requires all players in bed)"
                  value={!!getIni('SleepAllowed', false)} onChange={v => updateIni('SleepAllowed', v)} />
                <ToggleField label="Sleep Needed" description="Players must sleep when exhausted"
                  value={!!getIni('SleepNeeded', false)} onChange={v => updateIni('SleepNeeded', v)} />
                <FormField label="Fast Forward Multiplier">
                  <input type="number" value={Number(getIni('FastForwardMultiplier', 40))}
                    onChange={e => updateIni('FastForwardMultiplier', Number(e.target.value))} className="input" min={1} max={100} />
                  <p className="text-xs text-pz-muted mt-1">How fast time passes while players sleep</p>
                </FormField>
              </Section>

              <Section title="Voice Chat">
                <ToggleField label="Enable Voice Chat" description="Built-in proximity voice chat"
                  value={!!getIni('VoiceEnable', true)} onChange={v => updateIni('VoiceEnable', v)} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Min Distance (tiles)">
                    <input type="number" value={Number(getIni('VoiceMinDistance', 10))}
                      onChange={e => updateIni('VoiceMinDistance', Number(e.target.value))} className="input" />
                  </FormField>
                  <FormField label="Max Distance (tiles)">
                    <input type="number" value={Number(getIni('VoiceMaxDistance', 300))}
                      onChange={e => updateIni('VoiceMaxDistance', Number(e.target.value))} className="input" />
                  </FormField>
                </div>
                <ToggleField label="3D Voice" description="Directional audio for voice chat"
                  value={!!getIni('Voice3D', true)} onChange={v => updateIni('Voice3D', v)} />
                <FormField label="Voice Complexity (1-10)">
                  <input type="number" value={Number(getIni('VoiceComplexity', 5))}
                    onChange={e => updateIni('VoiceComplexity', Number(e.target.value))} className="input" min={1} max={10} />
                </FormField>
                <FormField label="Voice Period (ms)">
                  <input type="number" value={Number(getIni('VoicePeriod', 20))}
                    onChange={e => updateIni('VoicePeriod', Number(e.target.value))} className="input" />
                </FormField>
                <FormField label="Voice Sample Rate">
                  <select value={Number(getIni('VoiceSampleRate', 24000))}
                    onChange={e => updateIni('VoiceSampleRate', Number(e.target.value))} className="select">
                    <option value={8000}>8000 Hz</option>
                    <option value={12000}>12000 Hz</option>
                    <option value={16000}>16000 Hz</option>
                    <option value={24000}>24000 Hz</option>
                    <option value={48000}>48000 Hz</option>
                  </select>
                </FormField>
              </Section>

              <Section title="Factions">
                <ToggleField label="Enable Factions" description="Allow players to create and join factions"
                  value={!!getIni('Faction', true)} onChange={v => updateIni('Faction', v)} />
                <FormField label="Days Survived to Create Faction">
                  <input type="number" value={Number(getIni('FactionDaySurvivedToCreate', 0))}
                    onChange={e => updateIni('FactionDaySurvivedToCreate', Number(e.target.value))} className="input" min={0} />
                </FormField>
                <FormField label="Players Required for Faction Tag">
                  <input type="number" value={Number(getIni('FactionPlayersRequiredForTag', 1))}
                    onChange={e => updateIni('FactionPlayersRequiredForTag', Number(e.target.value))} className="input" min={1} />
                </FormField>
                <ToggleField label="Allow Trade UI" description="Allow players to directly trade with each other"
                  value={!!getIni('AllowTradeUI', true)} onChange={v => updateIni('AllowTradeUI', v)} />
              </Section>

              <Section title="Player Respawn">
                <ToggleField label="Respawn at Death Location" description="Players can respawn at their death coordinates"
                  value={!!getIni('PlayerRespawnWithSelf', false)} onChange={v => updateIni('PlayerRespawnWithSelf', v)} />
                <ToggleField label="Respawn at Co-op Partner" description="Players can respawn at a splitscreen partner's location"
                  value={!!getIni('PlayerRespawnWithOther', false)} onChange={v => updateIni('PlayerRespawnWithOther', v)} />
                <ToggleField label="Save Player on Damage" description="Save player data immediately when they take damage"
                  value={!!getIni('PlayerSaveOnDamage', true)} onChange={v => updateIni('PlayerSaveOnDamage', v)} />
              </Section>
            </>
          )}

          {/* ── PVP TAB ── */}
          {!searchLower && tab === 'pvp' && (
            <>
              <Section title="PvP Settings">
                <ToggleField label="Enable PvP" description="Allow players to damage each other"
                  value={!!getIni('PVP', true)} onChange={v => updateIni('PVP', v)} />
                <ToggleField label="Safety System" description="Players can individually toggle PvP on/off via skull icon"
                  value={!!getIni('SafetySystem', true)} onChange={v => updateIni('SafetySystem', v)} />
                <ToggleField label="Show Safety Icon" description="Display skull icon over players in PvP mode"
                  value={!!getIni('ShowSafety', true)} onChange={v => updateIni('ShowSafety', v)} />
                <FormField label="Safety Toggle Timer (seconds)">
                  <input type="number" value={Number(getIni('SafetyToggleTimer', 2))}
                    onChange={e => updateIni('SafetyToggleTimer', Number(e.target.value))} className="input" min={0} max={1000} />
                  <p className="text-xs text-pz-muted mt-1">Time it takes to enter/leave PvP mode</p>
                </FormField>
                <FormField label="Safety Cooldown Timer (seconds)">
                  <input type="number" value={Number(getIni('SafetyCooldownTimer', 3))}
                    onChange={e => updateIni('SafetyCooldownTimer', Number(e.target.value))} className="input" min={0} max={1000} />
                  <p className="text-xs text-pz-muted mt-1">Delay before toggling PvP mode again</p>
                </FormField>
              </Section>

              <Section title="PvP Damage Modifiers">
                <FormField label="PvP Melee Damage Modifier (%)">
                  <input type="number" value={Number(getIni('PVPMeleeDamageModifier', 30))}
                    onChange={e => updateIni('PVPMeleeDamageModifier', Number(e.target.value))} className="input" min={0} max={500} />
                  <p className="text-xs text-pz-muted mt-1">Multiplier for PvP melee attacks (30 = 30% of normal damage)</p>
                </FormField>
                <FormField label="PvP Firearm Damage Modifier (%)">
                  <input type="number" value={Number(getIni('PVPFirearmDamageModifier', 50))}
                    onChange={e => updateIni('PVPFirearmDamageModifier', Number(e.target.value))} className="input" min={0} max={500} />
                </FormField>
                <ToggleField label="PvP Melee While Hit Reaction" description="Allow players to hit again when struck by another player"
                  value={!!getIni('PVPMeleeWhileHitReaction', false)} onChange={v => updateIni('PVPMeleeWhileHitReaction', v)} />
                <ToggleField label="Player Bump Player" description="Players knock over other players when running through them"
                  value={!!getIni('PlayerBumpPlayer', false)} onChange={v => updateIni('PlayerBumpPlayer', v)} />
                <ToggleField label="Knocked Down Allowed" description="Players can be knocked down"
                  value={!!getIni('KnockedDownAllowed', true)} onChange={v => updateIni('KnockedDownAllowed', v)} />
                <ToggleField label="Sneak Mode Hides From Players" description="Sneaking hides players from other players"
                  value={!!getIni('SneakModeHideFromOtherPlayers', true)} onChange={v => updateIni('SneakModeHideFromOtherPlayers', v)} />
              </Section>

              <Section title="Announce & Map">
                <ToggleField label="Announce Death" description="Server-wide announcement when a player dies"
                  value={!!getIni('AnnounceDeath', true)} onChange={v => updateIni('AnnounceDeath', v)} />
                <FormField label="Remote Player Visibility on Map">
                  <select value={Number(getIni('MapRemotePlayerVisibility', 1))}
                    onChange={e => updateIni('MapRemotePlayerVisibility', Number(e.target.value))} className="select">
                    <option value={1}>Hidden</option>
                    <option value={2}>Friends Only</option>
                    <option value={3}>Everyone</option>
                  </select>
                </FormField>
              </Section>
            </>
          )}

          {/* ── SAFEHOUSES TAB ── */}
          {!searchLower && tab === 'safehouses' && (
            <>
              <Section title="Safehouse Settings">
                <ToggleField label="Player Safehouses" description="Allow players to claim safehouses"
                  value={!!getIni('PlayerSafehouse', true)} onChange={v => updateIni('PlayerSafehouse', v)} />
                <ToggleField label="Admin Safehouses Only" description="Only admins can claim safehouses"
                  value={!!getIni('AdminSafehouse', false)} onChange={v => updateIni('AdminSafehouse', v)} />
                <ToggleField label="Allow Non-Residential Safehouses" description="Players can claim non-residential buildings"
                  value={!!getIni('SafehouseAllowNonResidential', false)} onChange={v => updateIni('SafehouseAllowNonResidential', v)} />
                <FormField label="Days Survived to Claim Safehouse">
                  <input type="number" value={Number(getIni('SafehouseDaySurvivedToClaim', 0))}
                    onChange={e => updateIni('SafehouseDaySurvivedToClaim', Number(e.target.value))} className="input" min={0} />
                </FormField>
                <FormField label="Safehouse Removal Time (hours)">
                  <input type="number" value={Number(getIni('SafeHouseRemovalTime', 144))}
                    onChange={e => updateIni('SafeHouseRemovalTime', Number(e.target.value))} className="input" min={0} />
                  <p className="text-xs text-pz-muted mt-1">Hours before a player is auto-removed from a safehouse they haven't visited</p>
                </FormField>
              </Section>

              <Section title="Safehouse Permissions">
                <ToggleField label="Allow Trespass" description="Non-members can enter a safehouse without invitation"
                  value={!!getIni('SafehouseAllowTrepass', true)} onChange={v => updateIni('SafehouseAllowTrepass', v)} />
                <ToggleField label="Allow Fire Damage" description="Fire can damage safehouses"
                  value={!!getIni('SafehouseAllowFire', true)} onChange={v => updateIni('SafehouseAllowFire', v)} />
                <ToggleField label="Allow Non-Member Looting" description="Non-members can take items from safehouses"
                  value={!!getIni('SafehouseAllowLoot', true)} onChange={v => updateIni('SafehouseAllowLoot', v)} />
                <ToggleField label="Allow Safehouse Respawn" description="Players respawn in their safehouse after death"
                  value={!!getIni('SafehouseAllowRespawn', false)} onChange={v => updateIni('SafehouseAllowRespawn', v)} />
                <ToggleField label="Disable Safehouse When Player Connected" description="Safehouse acts like a normal house when a member is online"
                  value={!!getIni('DisableSafehouseWhenPlayerConnected', false)} onChange={v => updateIni('DisableSafehouseWhenPlayerConnected', v)} />
              </Section>

              <Section title="Construction">
                <ToggleField label="Allow Sledgehammer Destruction" description="Allow players to destroy world objects with sledgehammers"
                  value={!!getIni('AllowDestructionBySledgehammer', true)} onChange={v => updateIni('AllowDestructionBySledgehammer', v)} />
                <ToggleField label="Sledgehammer Only in Safehouse" description="Restrict sledgehammer destruction to player's own safehouse"
                  value={!!getIni('SledgehammerOnlyInSafehouse', false)} onChange={v => updateIni('SledgehammerOnlyInSafehouse', v)} />
                <ToggleField label="No Fire" description="Disable all fire except campfires"
                  value={!!getIni('NoFire', false)} onChange={v => updateIni('NoFire', v)} />
              </Section>
            </>
          )}

          {/* ── ADVANCED TAB ── */}
          {!searchLower && tab === 'advanced' && (
            <>
              <Section title="Loot">
                <FormField label="Loot Respawn (hours, 0=never)">
                  <input type="number" value={Number(getIni('HoursForLootRespawn', 0))}
                    onChange={e => updateIni('HoursForLootRespawn', Number(e.target.value))} className="input" min={0} />
                  <p className="text-xs text-pz-muted mt-1">Hours before looted containers respawn loot</p>
                </FormField>
                <FormField label="Max Items for Loot Respawn">
                  <input type="number" value={Number(getIni('MaxItemsForLootRespawn', 4))}
                    onChange={e => updateIni('MaxItemsForLootRespawn', Number(e.target.value))} className="input" min={0} />
                  <p className="text-xs text-pz-muted mt-1">Containers with more items than this won't respawn</p>
                </FormField>
                <ToggleField label="Construction Prevents Loot Respawn" description="Player-built structures prevent loot from respawning nearby"
                  value={!!getIni('ConstructionPreventsLootRespawn', true)} onChange={v => updateIni('ConstructionPreventsLootRespawn', v)} />
                <FormField label="Item Numbers Limit Per Container">
                  <input type="number" value={Number(getIni('ItemNumbersLimitPerContainer', 0))}
                    onChange={e => updateIni('ItemNumbersLimitPerContainer', Number(e.target.value))} className="input" min={0} max={9000} />
                  <p className="text-xs text-pz-muted mt-1">0 = no limit. Note: includes individual small items like nails.</p>
                </FormField>
              </Section>

              <Section title="World Items">
                <FormField label="Hours for World Item Removal (0=disabled)">
                  <input type="number" value={Number(getIni('HoursForWorldItemRemoval', 0))}
                    onChange={e => updateIni('HoursForWorldItemRemoval', Number(e.target.value))} className="input" min={0} />
                  <p className="text-xs text-pz-muted mt-1">Hours before dropped items are removed from the ground</p>
                </FormField>
                <FormField label="World Item Removal List">
                  <textarea value={String(getIni('WorldItemRemovalList', 'Base.Vest,Base.Shirt,Base.Blouse,Base.Skirt,Base.Shoes'))}
                    onChange={e => updateIni('WorldItemRemovalList', e.target.value)}
                    className="input resize-none" rows={3} placeholder="Comma-separated item IDs" />
                  <p className="text-xs text-pz-muted mt-1">Items to remove after HoursForWorldItemRemoval hours</p>
                </FormField>
                <ToggleField label="Item Removal Blacklist Mode" description="If true, items NOT in the list will be removed instead"
                  value={!!getIni('ItemRemovalListBlacklistToggle', false)} onChange={v => updateIni('ItemRemovalListBlacklistToggle', v)} />
                <ToggleField label="Trash Delete All" description="Allow players to use the 'delete all' button on bins"
                  value={!!getIni('TrashDeleteAll', false)} onChange={v => updateIni('TrashDeleteAll', v)} />
              </Section>

              <Section title="Corpses & Blood">
                <FormField label="Blood Splat Lifespan (days, 0=never)">
                  <input type="number" value={Number(getIni('BloodSplatLifespanDays', 0))}
                    onChange={e => updateIni('BloodSplatLifespanDays', Number(e.target.value))} className="input" min={0} max={365} />
                </FormField>
                <ToggleField label="Remove Player Corpses on Corpse Removal" description="Remove player corpses when HoursForCorpseRemoval triggers"
                  value={!!getIni('RemovePlayerCorpsesOnCorpseRemoval', false)} onChange={v => updateIni('RemovePlayerCorpsesOnCorpseRemoval', v)} />
              </Section>

              <Section title="Vehicles">
                <FormField label="Car Engine Attraction Modifier">
                  <input type="number" step={0.1} value={Number(getIni('CarEngineAttractionModifier', 0.5))}
                    onChange={e => updateIni('CarEngineAttractionModifier', Number(e.target.value))} className="input" min={0} max={10} />
                  <p className="text-xs text-pz-muted mt-1">Multiplier for zombie attraction to car engines. Lower = less lag.</p>
                </FormField>
                <FormField label="Speed Limit (km/h)">
                  <input type="number" value={Number(getIni('SpeedLimit', 70))}
                    onChange={e => updateIni('SpeedLimit', Number(e.target.value))} className="input" min={10} max={150} />
                </FormField>
              </Section>

              <Section title="Books & Misc">
                <FormField label="Minutes Per Page">
                  <input type="number" step={0.1} value={Number(getIni('MinutesPerPage', 1.0))}
                    onChange={e => updateIni('MinutesPerPage', Number(e.target.value))} className="input" min={0} max={60} />
                  <p className="text-xs text-pz-muted mt-1">In-game minutes to read one page of a book</p>
                </FormField>
                <ToggleField label="Perk Logs" description="Track changes in player perk levels in PerkLog.txt"
                  value={!!getIni('PerkLogs', true)} onChange={v => updateIni('PerkLogs', v)} />
                <FormField label="Client Command Filter">
                  <input type="text" value={String(getIni('ClientCommandFilter', '-vehicle.*;+vehicle.damageWindow;+vehicle.fixPart;+vehicle.installPart;+vehicle.uninstallPart'))}
                    onChange={e => updateIni('ClientCommandFilter', e.target.value)} className="input" />
                  <p className="text-xs text-pz-muted mt-1">Semicolon-separated commands not written to cmd.txt log</p>
                </FormField>
                <FormField label="Client Action Logs">
                  <input type="text" value={String(getIni('ClientActionLogs', ''))}
                    onChange={e => updateIni('ClientActionLogs', e.target.value)} className="input" placeholder="Semicolon-separated actions to log" />
                </FormField>
              </Section>

              <Section title="Radio">
                <ToggleField label="Disable Radio (Staff)" description="Disable radio transmissions from staff-level players"
                  value={!!getIni('DisableRadioStaff', false)} onChange={v => updateIni('DisableRadioStaff', v)} />
                <ToggleField label="Disable Radio (Admin)" description="Disable radio transmissions from admin-level players"
                  value={!!getIni('DisableRadioAdmin', true)} onChange={v => updateIni('DisableRadioAdmin', v)} />
                <ToggleField label="Disable Radio (GM)" description="Disable radio transmissions from GM-level players"
                  value={!!getIni('DisableRadioGM', true)} onChange={v => updateIni('DisableRadioGM', v)} />
                <ToggleField label="Disable Radio (Overseer)" description="Disable radio transmissions from overseer-level players"
                  value={!!getIni('DisableRadioOverseer', false)} onChange={v => updateIni('DisableRadioOverseer', v)} />
                <ToggleField label="Disable Radio (Moderator)" description="Disable radio transmissions from moderator-level players"
                  value={!!getIni('DisableRadioModerator', false)} onChange={v => updateIni('DisableRadioModerator', v)} />
                <ToggleField label="Disable Radio (Invisible)" description="Disable radio transmissions from invisible players"
                  value={!!getIni('DisableRadioInvisible', true)} onChange={v => updateIni('DisableRadioInvisible', v)} />
              </Section>
            </>
          )}

          {/* ── DISCORD TAB ── */}
          {!searchLower && tab === 'discord' && (
            <>
              <Section title="Discord Integration">
                <ToggleField label="Enable Discord Integration" description="Bridge global text chat with a Discord channel"
                  value={!!getIni('DiscordEnable', false)} onChange={v => updateIni('DiscordEnable', v)} />
                <FormField label="Discord Bot Token">
                  <input type="password" value={String(getIni('DiscordToken', ''))}
                    onChange={e => updateIni('DiscordToken', e.target.value)} className="input" placeholder="Bot token from Discord Developer Portal" />
                </FormField>
                <FormField label="Discord Channel Name">
                  <input type="text" value={String(getIni('DiscordChannel', ''))}
                    onChange={e => updateIni('DiscordChannel', e.target.value)} className="input" placeholder="channel-name" />
                </FormField>
                <FormField label="Discord Channel ID">
                  <input type="text" value={String(getIni('DiscordChannelID', ''))}
                    onChange={e => updateIni('DiscordChannelID', e.target.value)} className="input" placeholder="Use if channel name doesn't work" />
                </FormField>
                <div className="bg-pz-darker border border-pz-border rounded-md p-3 text-xs text-pz-muted">
                  <strong className="text-pz-text">Setup:</strong> Create a bot at discord.com/developers, invite it to your server with Send Messages permission, and paste the bot token above.
                </div>
              </Section>
            </>
          )}

          {/* ── DANGER ZONE TAB ── */}
          {!searchLower && tab === 'danger' && (
            <>
              {!isNew && (
                <Section title="World Wipe">
                  <div className="bg-pz-red/10 border border-pz-red/20 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="text-pz-red flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-pz-red">Wipe World Data</h4>
                        <p className="text-xs text-pz-muted mt-1">
                          Permanently deletes all world save data for this server. Player characters, base builds, and world state will be lost. Server settings and mods are preserved.
                        </p>
                        <p className="text-xs text-pz-muted mt-1">
                          World save path: <code className="text-pz-text">{(form.worldSavePath || '%USERPROFILE%\\Zomboid') + '\\Saves\\Multiplayer\\' + (form.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'serverName')}</code>
                        </p>
                        {wipeMsg && <p className="text-xs text-pz-green mt-2">{wipeMsg}</p>}
                      </div>
                      <button onClick={() => setWipeConfirm(true)} className="btn-danger flex-shrink-0">
                        <Trash2 size={14} /> Wipe World
                      </button>
                    </div>
                  </div>
                </Section>
              )}
              {isNew && (
                <div className="card p-6 text-center text-pz-muted text-sm">
                  Save this profile first before accessing the Danger Zone.
                </div>
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

function ToggleField({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <div className="text-sm text-pz-text">{label}</div>
        <div className="text-xs text-pz-muted">{description}</div>
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-pz-green' : 'bg-pz-border'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

// ── INI Search Results ────────────────────────────────────────────────────────
const INI_FIELDS: { label: string; key: string; type: 'text' | 'number' | 'toggle' | 'select'; default?: unknown; options?: string[]; description?: string }[] = [
  { label: 'Public', key: 'Public', type: 'toggle', default: false, description: 'Show server in public list' },
  { label: 'Public Name', key: 'PublicName', type: 'text', default: 'My PZ Server' },
  { label: 'Public Description', key: 'PublicDescription', type: 'text', default: '' },
  { label: 'Max Players', key: 'MaxPlayers', type: 'number', default: 32 },
  { label: 'Game Port', key: 'DefaultPort', type: 'number', default: 16261 },
  { label: 'UDP Port', key: 'UDPPort', type: 'number', default: 16262 },
  { label: 'Password', key: 'Password', type: 'text', default: '' },
  { label: 'Admin Password', key: 'AdminPassword', type: 'text', default: 'admin' },
  { label: 'PvP', key: 'PVP', type: 'toggle', default: true, description: 'Allow players to damage each other' },
  { label: 'Pause on Empty', key: 'PauseEmpty', type: 'toggle', default: true },
  { label: 'Global Chat', key: 'GlobalChat', type: 'toggle', default: true },
  { label: 'Open', key: 'Open', type: 'toggle', default: true, description: 'Allow anyone to join without invite' },
  { label: 'Server Welcome Message', key: 'ServerWelcomeMessage', type: 'text', default: '' },
  { label: 'Logging', key: 'Logging', type: 'toggle', default: true },
  { label: 'Client Command Filter', key: 'ClientCommandFilter', type: 'text', default: '' },
  { label: 'Client Action Logs', key: 'ClientActionLogs', type: 'text', default: '' },
  { label: 'Map', key: 'Map', type: 'text', default: 'Muldraugh, KY' },
  { label: 'Mods', key: 'Mods', type: 'text', default: '' },
  { label: 'Workshop Items', key: 'WorkshopItems', type: 'text', default: '' },
  { label: 'Steam VAC', key: 'SteamVAC', type: 'toggle', default: true },
  { label: 'Spawn Point', key: 'SpawnPoint', type: 'text', default: '0,0,0' },
  { label: 'Safety System', key: 'SafetySystem', type: 'toggle', default: true },
  { label: 'Show Safety', key: 'ShowSafety', type: 'toggle', default: true },
  { label: 'Safety Toggle Timer', key: 'SafetyToggleTimer', type: 'number', default: 2 },
  { label: 'Safety Cooldown Timer', key: 'SafetyCooldownTimer', type: 'number', default: 3 },
  { label: 'Spawn Items', key: 'SpawnItems', type: 'text', default: '' },
  { label: 'Default Port', key: 'DefaultPort', type: 'number', default: 16261 },
  { label: 'Ping Limit', key: 'PingLimit', type: 'number', default: 400 },
  { label: 'Hours for Loot Respawn', key: 'HoursForLootRespawn', type: 'number', default: 0 },
  { label: 'Max Items for Loot Respawn', key: 'MaxItemsForLootRespawn', type: 'number', default: 4 },
  { label: 'Construction Prevents Loot Respawn', key: 'ConstructionPreventsLootRespawn', type: 'toggle', default: true },
  { label: 'Drop Off White List After Death', key: 'DropOffWhiteListAfterDeath', type: 'toggle', default: false },
  { label: 'No Fire', key: 'NoFire', type: 'toggle', default: false },
  { label: 'Announce Death', key: 'AnnounceDeath', type: 'toggle', default: false },
  { label: 'Min Network Bandwidth', key: 'MinNetworkBandwidth', type: 'number', default: 0 },
  { label: 'Max Network Bandwidth', key: 'MaxNetworkBandwidth', type: 'number', default: 131072 },
  { label: 'Player Safehouse', key: 'PlayerSafehouse', type: 'toggle', default: true },
  { label: 'Admin Safehouse', key: 'AdminSafehouse', type: 'toggle', default: true },
  { label: 'Safehouse Allow Trepass', key: 'SafehouseAllowTrepass', type: 'toggle', default: true },
  { label: 'Safehouse Allow Fire', key: 'SafehouseAllowFire', type: 'toggle', default: true },
  { label: 'Safehouse Allow Loot', key: 'SafehouseAllowLoot', type: 'toggle', default: true },
  { label: 'Safehouse Allow Respawn', key: 'SafehouseAllowRespawn', type: 'toggle', default: false },
  { label: 'Safehouse Day Survived To Claim', key: 'SafehouseDaySurvivedToClaim', type: 'number', default: 0 },
  { label: 'Safehouse Remove On Disconnect', key: 'SafehouseRemoveOnDisconnect', type: 'number', default: 0 },
  { label: 'Allow Non Admins Debug', key: 'AllowNonAminsDEBUG', type: 'toggle', default: false },
  { label: 'Show First And Last Name', key: 'ShowFirstAndLastName', type: 'toggle', default: false },
  { label: 'Faction', key: 'Faction', type: 'toggle', default: true },
  { label: 'Faction Dayz Survived To Create', key: 'FactionDayzSurvivedToCreate', type: 'number', default: 0 },
  { label: 'Faction Players Required For Tag', key: 'FactionPlayersRequiredForTag', type: 'number', default: 1 },
  { label: 'Discord Enable', key: 'DiscordEnable', type: 'toggle', default: false },
  { label: 'Discord Token', key: 'DiscordToken', type: 'text', default: '' },
  { label: 'Discord Channel', key: 'DiscordChannel', type: 'text', default: '' },
  { label: 'Discord Channel ID', key: 'DiscordChannelID', type: 'text', default: '' },
  { label: 'Car Engine Attraction Modifier', key: 'CarEngineAttractionModifier', type: 'number', default: 0.5 },
  { label: 'Speed Limit', key: 'SpeedLimit', type: 'number', default: 70 },
  { label: 'Server Player ID', key: 'ServerPlayerID', type: 'number', default: 0 },
  { label: 'RCON Port', key: 'RCONPort', type: 'number', default: 27015 },
  { label: 'RCON Password', key: 'RCONPassword', type: 'text', default: '' },
  { label: 'Disable Item Anticheat', key: 'DisableItemAnticheat', type: 'toggle', default: false },
  { label: 'Disable Container Loot', key: 'DisableContainerLoot', type: 'toggle', default: false },
  { label: 'Blood Splat Lifespan Days', key: 'BloodSplatLifespanDays', type: 'number', default: 0 },
  { label: 'Hours For World Item Removal', key: 'HoursForWorldItemRemoval', type: 'number', default: 0 },
  { label: 'Trash Delete All', key: 'TrashDeleteAll', type: 'toggle', default: false },
  { label: 'Item Numbers Limit Per Container', key: 'ItemNumbersLimitPerContainer', type: 'number', default: 0 },
  { label: 'Minutes Per Page', key: 'MinutesPerPage', type: 'number', default: 1.0 },
  { label: 'Save World Every N Minutes', key: 'SaveWorldEveryNMinutes', type: 'number', default: 0 },
  { label: 'Kick Unfair Ping', key: 'KickFastPlayers', type: 'toggle', default: false },
  { label: 'Server Browser Announced IP', key: 'ServerBrowserAnnouncedIP', type: 'text', default: '' },
  { label: 'Player Bump Player', key: 'PlayerBumpPlayer', type: 'toggle', default: false },
  { label: 'Map Remote Player Visibility', key: 'MapRemotePlayerVisibility', type: 'number', default: 1 },
  { label: 'Voice Enable', key: 'VoiceEnable', type: 'toggle', default: true },
  { label: 'Voice Min Distance', key: 'VoiceMinDistance', type: 'number', default: 10 },
  { label: 'Voice Max Distance', key: 'VoiceMaxDistance', type: 'number', default: 100 },
  { label: 'Voice 3D', key: 'Voice3D', type: 'toggle', default: true },
]

function IniSearchResults({ query, getIni, updateIni }: {
  query: string
  getIni: (key: string, def: unknown) => unknown
  updateIni: (key: string, value: unknown) => void
}) {
  const matches = INI_FIELDS.filter(f =>
    f.label.toLowerCase().includes(query) || f.key.toLowerCase().includes(query) || (f.description || '').toLowerCase().includes(query)
  )
  if (matches.length === 0) return <p className="text-sm text-pz-muted">No settings found matching "{query}".</p>
  return (
    <div className="space-y-3">
      {matches.map(f => (
        <div key={f.key} className="py-1">
          {f.type === 'toggle' ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-pz-text">{f.label}</div>
                {f.description && <div className="text-xs text-pz-muted">{f.description}</div>}
                <div className="text-xs text-pz-muted font-mono">{f.key}</div>
              </div>
              <button onClick={() => updateIni(f.key, !getIni(f.key, f.default))}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${getIni(f.key, f.default) ? 'bg-pz-green' : 'bg-pz-border'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${getIni(f.key, f.default) ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          ) : (
            <div>
              <label className="label">{f.label} <span className="font-mono text-pz-muted text-xs ml-1">({f.key})</span></label>
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                value={String(getIni(f.key, f.default))}
                onChange={e => updateIni(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                className="input"
              />
              {f.description && <p className="text-xs text-pz-muted mt-1">{f.description}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
