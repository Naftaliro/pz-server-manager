import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Save, RefreshCw, FileText, AlertCircle, CheckCircle, FolderOpen, Info } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

type FileTab = 'ini' | 'sandbox'

export default function RawFileEditor() {
  const { activeProfileId, setActiveView, profiles } = useAppStore()
  const profile = profiles.find(p => p.id === activeProfileId)

  const [activeTab, setActiveTab] = useState<FileTab>('ini')
  const [iniContent, setIniContent] = useState('')
  const [sandboxContent, setSandboxContent] = useState('')
  const [iniPath, setIniPath] = useState('')
  const [sandboxPath, setSandboxPath] = useState('')
  const [iniExists, setIniExists] = useState(false)
  const [sandboxExists, setSandboxExists] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Resolve paths from the profile
  useEffect(() => {
    if (!profile) return
    const serverName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    const dataPath = (profile.worldSavePath || '%USERPROFILE%\\Zomboid')
      .replace(/%USERPROFILE%/gi, '')
      .trim()

    // We'll resolve these paths in the main process via the readFile IPC
    // For display, show the expected paths
    const base = profile.worldSavePath
      ? profile.worldSavePath.replace(/\\$/, '')
      : '%USERPROFILE%\\Zomboid'

    setIniPath(`${base}\\Server\\${serverName}.ini`)
    setSandboxPath(`${base}\\Server\\${serverName}_SandboxVars.lua`)
    void serverName
    void dataPath
  }, [profile])

  // Load file contents when tab changes or on mount
  useEffect(() => {
    if (activeTab === 'ini') loadFile('ini')
    else loadFile('sandbox')
  }, [activeTab, iniPath, sandboxPath])

  const loadFile = async (which: FileTab) => {
    const filePath = which === 'ini' ? iniPath : sandboxPath
    if (!filePath) return
    setLoading(true)
    setError('')
    try {
      const result = await window.electronAPI.fs.readFile(filePath)
      if (result.success && result.content !== undefined) {
        if (which === 'ini') {
          setIniContent(result.content)
          setIniExists(true)
        } else {
          setSandboxContent(result.content)
          setSandboxExists(true)
        }
      } else {
        // File doesn't exist yet — show empty editor with a note
        if (which === 'ini') {
          setIniContent('')
          setIniExists(false)
        } else {
          setSandboxContent('')
          setSandboxExists(false)
        }
      }
    } catch {
      setError('Failed to read file.')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    const filePath = activeTab === 'ini' ? iniPath : sandboxPath
    const content = activeTab === 'ini' ? iniContent : sandboxContent
    if (!filePath) return
    setSaving(true)
    setError('')
    try {
      const result = await window.electronAPI.fs.writeFile(filePath, content)
      if (result.success) {
        setSaved(true)
        if (activeTab === 'ini') setIniExists(true)
        else setSandboxExists(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        setError(result.message || 'Failed to save file.')
      }
    } catch {
      setError('Failed to save file.')
    } finally {
      setSaving(false)
    }
  }

  const handleReload = () => {
    loadFile(activeTab)
  }

  const handleBrowse = async () => {
    const ext = activeTab === 'ini' ? ['ini'] : ['lua']
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [
        { name: activeTab === 'ini' ? 'Server Config' : 'Lua Script', extensions: ext },
        { name: 'All Files', extensions: ['*'] },
      ]
    })
    if (!filePath) return
    const result = await window.electronAPI.fs.readFile(filePath)
    if (result.success && result.content !== undefined) {
      if (activeTab === 'ini') {
        setIniContent(result.content)
        setIniPath(filePath)
        setIniExists(true)
      } else {
        setSandboxContent(result.content)
        setSandboxPath(filePath)
        setSandboxExists(true)
      }
    }
  }

  const currentContent = activeTab === 'ini' ? iniContent : sandboxContent
  const setCurrentContent = activeTab === 'ini' ? setIniContent : setSandboxContent
  const currentPath = activeTab === 'ini' ? iniPath : sandboxPath
  const currentExists = activeTab === 'ini' ? iniExists : sandboxExists

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full text-pz-muted">
        No profile selected.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={() => setActiveView('editor')} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-pz-text">Raw File Editor</h1>
          <p className="text-xs text-pz-muted">{profile.name} — edit config files directly on disk</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleBrowse} className="btn-ghost text-xs py-1.5 px-3" title="Browse for a different file">
            <FolderOpen size={13} /> Browse
          </button>
          <button onClick={handleReload} disabled={loading} className="btn-ghost text-xs py-1.5 px-3" title="Reload from disk">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
          <button onClick={handleSave} disabled={saving || loading} className="btn-primary text-xs py-1.5 px-3">
            <Save size={13} />
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save to Disk'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-pz-border bg-pz-darker px-6 flex-shrink-0">
        {[
          { id: 'ini' as FileTab, label: 'Server Config (.ini)' },
          { id: 'sandbox' as FileTab, label: 'Sandbox Settings (.lua)' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === t.id ? 'tab-active' : 'tab-inactive'}`}
          >
            {t.id === 'ini'
              ? <span className="flex items-center gap-1.5"><FileText size={13} /> {t.label}</span>
              : <span className="flex items-center gap-1.5"><FileText size={13} /> {t.label}</span>
            }
          </button>
        ))}
      </div>

      {/* File path bar */}
      <div className="flex items-center gap-2 px-6 py-2 bg-pz-dark border-b border-pz-border flex-shrink-0">
        <span className="text-xs text-pz-muted font-mono truncate flex-1" title={currentPath}>
          {currentPath || 'Path not set — save a profile first'}
        </span>
        {currentExists ? (
          <span className="flex items-center gap-1 text-xs text-pz-green flex-shrink-0">
            <CheckCircle size={11} /> File exists
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-pz-muted flex-shrink-0">
            <AlertCircle size={11} /> File not found (will be created on save)
          </span>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 px-6 py-2 bg-amber-900/20 border-b border-amber-700/30 flex-shrink-0">
        <Info size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300 leading-relaxed">
          <strong>Direct file editing mode.</strong> Changes saved here are written directly to disk and will be used as-is when the server starts — <em>as long as the server profile is set to "Use files as-is" launch mode</em>. Switch the launch mode in Server Config → Basic tab to prevent the app from overwriting your edits on next launch.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-6 py-2 bg-pz-red/10 border-b border-pz-red/30 flex-shrink-0">
          <AlertCircle size={13} className="text-pz-red flex-shrink-0" />
          <span className="text-xs text-pz-red">{error}</span>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-pz-muted">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Loading file...</span>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={currentContent}
            onChange={e => setCurrentContent(e.target.value)}
            spellCheck={false}
            className="w-full h-full bg-pz-darker text-pz-text font-mono text-xs leading-relaxed p-4 rounded border border-pz-border resize-none focus:outline-none focus:border-pz-green/50 placeholder-pz-muted"
            placeholder={
              activeTab === 'ini'
                ? '# Server config file not found yet.\n# Start the server once to generate it, or paste your existing .ini content here and click Save to Disk.'
                : '-- SandboxVars.lua not found yet.\n-- Start the server once to generate it, or paste your existing SandboxVars content here and click Save to Disk.'
            }
            style={{ fontFamily: "'Consolas', 'Courier New', monospace" }}
          />
        )}
      </div>
    </div>
  )
}
