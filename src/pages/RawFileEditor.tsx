import { useState, useEffect, useRef, useMemo } from 'react'
import { ArrowLeft, Save, RefreshCw, FileText, AlertCircle, CheckCircle, FolderOpen, Info, Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { getServerName } from '../lib/profile'
import { useLeaveGuard } from '../lib/leaveGuard'
import ConfirmDialog from '../components/ConfirmDialog'

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
  // each file as it was read or last saved: anything else is an edit that isn't saved yet
  const [savedText, setSavedText] = useState<Record<FileTab, string>>({ ini: '', sandbox: '' })
  const keep = (which: FileTab, text: string) => setSavedText(prev => ({ ...prev, [which]: text }))
  const edited = (which: FileTab) => (which === 'ini' ? iniContent : sandboxContent) !== savedText[which]
  const dirty = edited('ini') || edited('sandbox')
  // mouse back/forward and the back arrow ask before throwing edits away
  const [leaveOpen, setLeaveOpen] = useState(false)
  const leaveGuard = useLeaveGuard(dirty, () => setLeaveOpen(true))

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)

  // Resolve paths from the profile
  useEffect(() => {
    if (!profile) return
    const serverName = getServerName(profile)
    const base = profile.worldSavePath
      ? profile.worldSavePath.replace(/\\$/, '')
      : '%USERPROFILE%\\Zomboid'
    setIniPath(`${base}\\Server\\${serverName}.ini`)
    setSandboxPath(`${base}\\Server\\${serverName}_SandboxVars.lua`)
  }, [profile])

  // Load file contents when tab changes or paths change
  // (not over edits that aren't saved yet: switching tabs and back keeps them)
  useEffect(() => {
    if (edited(activeTab)) return
    if (activeTab === 'ini') loadFile('ini')
    else loadFile('sandbox')
  }, [activeTab, iniPath, sandboxPath])

  // Compute matching line indices for search
  const matchingLines = useMemo(() => {
    const content = activeTab === 'ini' ? iniContent : sandboxContent
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return content.split('\n').reduce<number[]>((acc, line, i) => {
      if (line.toLowerCase().includes(q)) acc.push(i)
      return acc
    }, [])
  }, [searchQuery, iniContent, sandboxContent, activeTab])

  // Scroll to current match
  useEffect(() => {
    if (matchingLines.length === 0 || !textareaRef.current) return
    const idx = matchingLines[searchIndex % matchingLines.length]
    const lineHeight = 18 // approximate px per line in the monospace textarea
    textareaRef.current.scrollTop = Math.max(0, idx * lineHeight - 100)
  }, [searchIndex, matchingLines])

  const jumpNext = () => setSearchIndex(i => matchingLines.length ? (i + 1) % matchingLines.length : 0)
  const jumpPrev = () => setSearchIndex(i => matchingLines.length ? (i - 1 + matchingLines.length) % matchingLines.length : 0)

  const loadFile = async (which: FileTab) => {
    const filePath = which === 'ini' ? iniPath : sandboxPath
    if (!filePath) return
    setLoading(true)
    setError('')
    try {
      const result = await window.electronAPI.fs.readFile(filePath)
      if (result.success && result.content !== undefined) {
        if (which === 'ini') { setIniContent(result.content); setIniExists(true) }
        else { setSandboxContent(result.content); setSandboxExists(true) }
        keep(which, result.content)
      } else {
        if (which === 'ini') { setIniContent(''); setIniExists(false) }
        else { setSandboxContent(''); setSandboxExists(false) }
        keep(which, '')
      }
    } catch {
      setError("Couldn't read the file.")
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
        keep(activeTab, content)
        setSaved(true)
        if (activeTab === 'ini') setIniExists(true)
        else setSandboxExists(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        setError(result.message || "Couldn't save the file.")
      }
    } catch {
      setError("Couldn't save the file.")
    } finally {
      setSaving(false)
    }
  }

  const handleBrowse = async () => {
    const ext = activeTab === 'ini' ? ['ini'] : ['lua']
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [
        { name: activeTab === 'ini' ? 'Server settings' : 'Lua file', extensions: ext },
        { name: 'All files', extensions: ['*'] },
      ]
    })
    if (!filePath) return
    const result = await window.electronAPI.fs.readFile(filePath)
    if (result.success && result.content !== undefined) {
      if (activeTab === 'ini') { setIniContent(result.content); setIniPath(filePath); setIniExists(true) }
      else { setSandboxContent(result.content); setSandboxPath(filePath); setSandboxExists(true) }
      keep(activeTab, result.content)
    }
  }

  const currentContent = activeTab === 'ini' ? iniContent : sandboxContent
  const setCurrentContent = activeTab === 'ini' ? setIniContent : setSandboxContent
  const currentPath = activeTab === 'ini' ? iniPath : sandboxPath
  const currentExists = activeTab === 'ini' ? iniExists : sandboxExists

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full text-pz-muted">
        Pick a server first.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={() => (dirty ? setLeaveOpen(true) : setActiveView('server'))} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-pz-text">Raw files</h1>
          <p className="text-xs text-pz-muted">{profile.name} · the server's settings files as plain text</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleBrowse} className="btn-outline text-xs" title="Open a different file">
            <FolderOpen size={12} /> Open another file
          </button>
          <button onClick={() => loadFile(activeTab)} disabled={loading} className="btn-outline text-xs" title="Read the file again">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
          <button onClick={handleSave} disabled={saving || loading} className="btn-primary">
            <Save size={14} />
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-pz-border bg-pz-darker px-6 flex-shrink-0">
        {[
          { id: 'ini' as FileTab, label: 'Server options (.ini)' },
          { id: 'sandbox' as FileTab, label: 'World & zombies (.lua)' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === t.id ? 'tab-active' : 'tab-inactive'}`}
          >
            <span className="flex items-center gap-1.5"><FileText size={13} /> {t.label}</span>
          </button>
        ))}
      </div>

      {/* File path bar */}
      <div className="flex items-center gap-2 px-6 py-2 bg-pz-dark border-b border-pz-border flex-shrink-0">
        <span className="text-xs text-pz-muted font-mono truncate flex-1" title={currentPath}>
          {currentPath || 'No file yet, save the server first'}
        </span>
        {currentExists ? (
          <span className="flex items-center gap-1 text-xs text-pz-green flex-shrink-0">
            <CheckCircle size={11} /> On disk
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-pz-muted flex-shrink-0">
            <AlertCircle size={11} /> Not there yet, saving makes it
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 px-6 py-2 bg-pz-darker border-b border-pz-border flex-shrink-0">
        <Search size={13} className="text-pz-muted flex-shrink-0" />
        <input
          type="text"
          placeholder="Search in the file (Enter for the next match)"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.shiftKey ? jumpPrev() : jumpNext() } }}
          className="flex-1 bg-transparent text-sm text-pz-text placeholder:text-pz-muted outline-none"
        />
        {searchQuery && (
          <span className="text-xs text-pz-muted flex-shrink-0">
            {matchingLines.length > 0
              ? `${(searchIndex % matchingLines.length) + 1} / ${matchingLines.length}`
              : 'No matches'}
          </span>
        )}
        {searchQuery && matchingLines.length > 0 && (
          <>
            <button onClick={jumpPrev} className="btn-ghost p-1" title="Previous match (Shift+Enter)">
              <ChevronUp size={13} />
            </button>
            <button onClick={jumpNext} className="btn-ghost p-1" title="Next match (Enter)">
              <ChevronDown size={13} />
            </button>
          </>
        )}
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-pz-muted hover:text-pz-text">
            <X size={13} />
          </button>
        )}
      </div>

      {/* What happens to these edits, which depends on who writes the files (Server options, Basics) */}
      {profile.launchMode === 'passthrough' ? (
        <div className="flex items-start gap-2 px-6 py-2 bg-pz-blue/10 border-b border-pz-blue/30 flex-shrink-0">
          <Info size={13} className="text-pz-blue flex-shrink-0 mt-0.5" />
          <p className="text-xs text-pz-subtext leading-relaxed">
            This server is set to <b className="text-pz-text">Me, by hand</b>: the app starts it without touching these files, so what you save here is exactly what it uses.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-6 py-2 bg-pz-yellow/10 border-b border-pz-yellow/30 flex-shrink-0">
          <Info size={13} className="text-pz-yellow flex-shrink-0 mt-0.5" />
          <p className="text-xs text-pz-subtext leading-relaxed">
            The app writes its settings into these files every time the server starts. What you change here stays, except the settings the app keeps itself:
            ports, passwords, max players, the mod list and map, and anything set on the Settings tab, in Server options or in World &amp; zombies. Those go back to the app's value, so change them there.
            To have the server use these files exactly as they are, pick <b className="text-pz-text">Me, by hand</b> under "Who writes the settings files" in Server options.
          </p>
        </div>
      )}

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
                ? "# This file isn't there yet.\n# Start the server once to make it, or paste a .ini here and hit Save."
                : "-- This file isn't there yet.\n-- Start the server once to make it, or paste a SandboxVars.lua here and hit Save."
            }
            style={{ fontFamily: "'Consolas', 'Courier New', monospace" }}
          />
        )}
      </div>

      <ConfirmDialog
        isOpen={leaveOpen}
        title="Leave without saving?"
        message="Your edits to these files will be lost."
        confirmLabel="Leave"
        danger
        onConfirm={() => { setLeaveOpen(false); if (!leaveGuard.leave()) setActiveView('server') }}
        onCancel={() => { setLeaveOpen(false); leaveGuard.stay() }}
      />
    </div>
  )
}
