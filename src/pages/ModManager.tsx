import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Trash2, ArrowLeft, Save, ExternalLink, Package, AlertCircle, GripVertical, Hash } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ModEntry } from '../store/useAppStore'

interface WorkshopMod {
  workshopId: string
  modId: string
  name: string
  description: string
  thumbnailUrl: string
  subscriptions: number
  tags: string[]
  timeUpdated: number
  fileSize: number
}

export default function ModManager() {
  const { activeProfileId, setActiveView, profiles, setProfiles } = useAppStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WorkshopMod[]>([])
  const [searchPage, setSearchPage] = useState(1)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [manualWorkshopId, setManualWorkshopId] = useState('')
  const [manualModId, setManualModId] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'installed' | 'search' | 'manual'>('installed')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const profile = profiles.find(p => p.id === activeProfileId)
  const [mods, setMods] = useState<ModEntry[]>(profile?.mods || [])

  useEffect(() => {
    if (profile) {
      setMods(profile.mods || [])
    }
  }, [activeProfileId])

  const handleSearch = async (page = 1) => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchError('')
    setSearchPage(page)

    try {
      const result = await window.electronAPI.mods.search(searchQuery, page)
      if (result.success) {
        setSearchResults(result.mods)
        setSearchTotal(result.total)
      } else {
        setSearchError(result.message || 'Search failed')
      }
    } catch (err) {
      setSearchError('Failed to search Steam Workshop. Check your internet connection.')
    } finally {
      setSearching(false)
    }
  }

  const handleManualLookup = async () => {
    if (!manualWorkshopId.trim()) return
    setManualLoading(true)
    try {
      const result = await window.electronAPI.mods.getDetails([manualWorkshopId.trim()])
      if (result.success && result.mods.length > 0) {
        const mod = result.mods[0]
        setManualModId(mod.modId || '')
        setManualName(mod.name || '')
      }
    } catch {
      // ignore, user can still fill manually
    } finally {
      setManualLoading(false)
    }
  }

  const addMod = (workshopId: string, modId: string, name: string, description?: string, thumbnailUrl?: string) => {
    if (mods.some(m => m.workshopId === workshopId)) return // already added

    const newMod: ModEntry = {
      workshopId,
      modId: modId || workshopId,
      name: name || `Mod ${workshopId}`,
      description,
      thumbnailUrl,
    }
    setMods(prev => [...prev, newMod])
  }

  const removeMod = (workshopId: string) => {
    setMods(prev => prev.filter(m => m.workshopId !== workshopId))
  }

  const handleManualAdd = () => {
    if (!manualWorkshopId.trim()) return
    addMod(
      manualWorkshopId.trim(),
      manualModId.trim() || manualWorkshopId.trim(),
      manualName.trim() || `Mod ${manualWorkshopId.trim()}`
    )
    setManualWorkshopId('')
    setManualModId('')
    setManualName('')
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const updatedProfile = {
        ...profile,
        mods,
        iniSettings: {
          ...profile.iniSettings,
          Mods: mods.map(m => m.modId).join(';'),
          WorkshopItems: mods.map(m => m.workshopId).join(';'),
        },
        updatedAt: new Date().toISOString(),
      }

      await window.electronAPI.profiles.save(updatedProfile)

      // Write updated INI
      const serverName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      await window.electronAPI.config.writeIni(serverName, `%USERPROFILE%\\Zomboid`, updatedProfile.iniSettings)

      const updated = await window.electronAPI.profiles.list()
      setProfiles(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert('Failed to save mods.')
    } finally {
      setSaving(false)
    }
  }

  const isAdded = (workshopId: string) => mods.some(m => m.workshopId === workshopId)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={() => setActiveView('editor')} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-pz-text">Mod Manager</h1>
          <p className="text-xs text-pz-muted">{profile?.name} — {mods.length} mod{mods.length !== 1 ? 's' : ''} installed</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <Save size={14} />
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-pz-border bg-pz-darker px-6 flex-shrink-0">
        {[
          { id: 'installed', label: `Installed (${mods.length})` },
          { id: 'search', label: 'Workshop Search' },
          { id: 'manual', label: 'Manual Entry' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as typeof activeTab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === t.id ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Installed Mods Tab */}
        {activeTab === 'installed' && (
          <div className="flex-1 overflow-y-auto p-6">
            {mods.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <Package size={36} className="text-pz-muted" />
                <p className="text-pz-muted text-sm">No mods installed yet.</p>
                <button onClick={() => setActiveTab('search')} className="btn-primary">
                  <Search size={14} />
                  Browse Workshop
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs text-pz-muted">
                    Mod load order matters in Project Zomboid. Drag to reorder (top = loaded first).
                  </p>
                </div>
                {mods.map((mod, idx) => (
                  <div key={mod.workshopId} className="card p-3 flex items-center gap-3">
                    <div className="text-pz-muted cursor-grab flex-shrink-0">
                      <GripVertical size={14} />
                    </div>
                    <div className="w-6 h-6 flex items-center justify-center text-xs text-pz-muted flex-shrink-0">
                      {idx + 1}
                    </div>
                    {mod.thumbnailUrl ? (
                      <img src={mod.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-pz-border flex items-center justify-center flex-shrink-0">
                        <Package size={16} className="text-pz-muted" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-pz-text truncate">{mod.name}</div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-pz-muted">Workshop: {mod.workshopId}</span>
                        <span className="text-xs text-pz-muted">Mod ID: {mod.modId}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => window.electronAPI.shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`)}
                        className="btn-ghost p-1.5"
                        title="View on Steam Workshop"
                      >
                        <ExternalLink size={12} />
                      </button>
                      <button
                        onClick={() => removeMod(mod.workshopId)}
                        className="btn-ghost p-1.5 text-pz-red hover:text-pz-red"
                        title="Remove mod"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Workshop Search Tab */}
        {activeTab === 'search' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Search bar */}
            <div className="p-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-pz-muted" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch(1)}
                    className="input pl-9"
                    placeholder="Search Steam Workshop for Project Zomboid mods..."
                  />
                </div>
                <button
                  onClick={() => handleSearch(1)}
                  disabled={searching || !searchQuery.trim()}
                  className="btn-primary"
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </div>
              {searchTotal > 0 && (
                <p className="text-xs text-pz-muted mt-2">{searchTotal} results found</p>
              )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto p-4">
              {searchError && (
                <div className="flex items-center gap-2 text-pz-red bg-pz-red/10 border border-pz-red/20 rounded-lg p-3 mb-4">
                  <AlertCircle size={14} />
                  <span className="text-sm">{searchError}</span>
                </div>
              )}

              {searching && (
                <div className="flex items-center justify-center h-32">
                  <div className="text-pz-muted text-sm">Searching Steam Workshop...</div>
                </div>
              )}

              {!searching && searchResults.length === 0 && searchQuery && !searchError && (
                <div className="flex items-center justify-center h-32">
                  <div className="text-pz-muted text-sm">No results found. Try different keywords.</div>
                </div>
              )}

              {!searching && searchResults.length === 0 && !searchQuery && (
                <div className="flex flex-col items-center justify-center h-32 gap-2">
                  <Search size={28} className="text-pz-muted" />
                  <p className="text-pz-muted text-sm">Search for mods above</p>
                </div>
              )}

              <div className="space-y-2">
                {searchResults.map(mod => {
                  const added = isAdded(mod.workshopId)
                  return (
                    <div key={mod.workshopId} className="card p-3 flex items-start gap-3">
                      {mod.thumbnailUrl ? (
                        <img src={mod.thumbnailUrl} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-pz-border flex items-center justify-center flex-shrink-0">
                          <Package size={20} className="text-pz-muted" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium text-pz-text">{mod.name}</div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => window.electronAPI.shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`)}
                              className="btn-ghost p-1"
                              title="View on Steam"
                            >
                              <ExternalLink size={12} />
                            </button>
                            <button
                              onClick={() => addMod(mod.workshopId, mod.modId, mod.name, mod.description, mod.thumbnailUrl)}
                              disabled={added}
                              className={added ? 'btn-ghost text-pz-green p-1.5' : 'btn-primary p-1.5'}
                              title={added ? 'Already added' : 'Add mod'}
                            >
                              {added ? '✓' : <Plus size={12} />}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-pz-muted mt-1 line-clamp-2">{mod.description}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-pz-muted">ID: {mod.workshopId}</span>
                          {mod.subscriptions > 0 && (
                            <span className="text-xs text-pz-muted">
                              {mod.subscriptions.toLocaleString()} subscribers
                            </span>
                          )}
                          {mod.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-xs bg-pz-border text-pz-muted px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {searchTotal > 20 && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  <button
                    onClick={() => handleSearch(searchPage - 1)}
                    disabled={searchPage <= 1 || searching}
                    className="btn-outline"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-pz-muted">
                    Page {searchPage} of {Math.ceil(searchTotal / 20)}
                  </span>
                  <button
                    onClick={() => handleSearch(searchPage + 1)}
                    disabled={searchPage >= Math.ceil(searchTotal / 20) || searching}
                    className="btn-outline"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-lg mx-auto">
              <div className="card p-5 space-y-4">
                <h2 className="section-title">Add Mod Manually</h2>
                <p className="text-xs text-pz-muted">
                  Enter the Steam Workshop ID to auto-fetch mod details, or fill in all fields manually.
                  Workshop IDs can be found in the mod's Steam Workshop URL:
                  <code className="text-pz-green ml-1">...filedetails/?id=XXXXXXXXX</code>
                </p>

                <div>
                  <label className="label">Workshop ID *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualWorkshopId}
                      onChange={e => setManualWorkshopId(e.target.value)}
                      className="input"
                      placeholder="e.g. 2392709985"
                    />
                    <button
                      onClick={handleManualLookup}
                      disabled={manualLoading || !manualWorkshopId.trim()}
                      className="btn-outline flex-shrink-0"
                    >
                      {manualLoading ? '...' : 'Lookup'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">Mod ID</label>
                  <div className="relative">
                    <Hash size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-pz-muted" />
                    <input
                      type="text"
                      value={manualModId}
                      onChange={e => setManualModId(e.target.value)}
                      className="input pl-8"
                      placeholder="e.g. Brita_Weapon_Pack"
                    />
                  </div>
                  <p className="text-xs text-pz-muted mt-1">
                    The Mod ID from the mod's workshop page (used in server config). Usually found in the mod description.
                  </p>
                </div>

                <div>
                  <label className="label">Mod Name</label>
                  <input
                    type="text"
                    value={manualName}
                    onChange={e => setManualName(e.target.value)}
                    className="input"
                    placeholder="e.g. Brita's Weapon Pack"
                  />
                </div>

                <button
                  onClick={handleManualAdd}
                  disabled={!manualWorkshopId.trim()}
                  className="btn-primary w-full justify-center"
                >
                  <Plus size={14} />
                  Add Mod
                </button>
              </div>

              {/* Common popular mods quick-add */}
              <div className="card p-5 mt-4">
                <h3 className="section-title mb-3">Popular Mods (Quick Add)</h3>
                <div className="space-y-2">
                  {POPULAR_MODS.map(mod => (
                    <div key={mod.workshopId} className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-pz-text">{mod.name}</div>
                        <div className="text-xs text-pz-muted">ID: {mod.workshopId}</div>
                      </div>
                      <button
                        onClick={() => addMod(mod.workshopId, mod.modId, mod.name)}
                        disabled={isAdded(mod.workshopId)}
                        className={isAdded(mod.workshopId) ? 'btn-ghost text-pz-green' : 'btn-outline'}
                      >
                        {isAdded(mod.workshopId) ? '✓ Added' : <><Plus size={12} /> Add</>}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const POPULAR_MODS = [
  { workshopId: '2392709985', modId: 'Brita', name: "Brita's Weapon Pack" },
  { workshopId: '2200148440', modId: 'BritaArmor', name: "Brita's Armor Pack" },
  { workshopId: '2313387159', modId: 'Arsenal(26)GunFighter', name: 'Arsenal(26) GunFighter' },
  { workshopId: '2458631365', modId: 'MoreDescriptionForTraits', name: 'More Description for Traits' },
  { workshopId: '2694448564', modId: 'TrueActions.Act3', name: 'True Actions. Act 3' },
  { workshopId: '2778561730', modId: 'RealHandgunsSounds', name: 'Real Handguns Sounds' },
  { workshopId: '2699036039', modId: 'MoreTraits', name: 'More Traits' },
  { workshopId: '2503622437', modId: 'ExtraMap', name: 'Extra Map Symbols' },
]
