import { useEffect, useMemo, useState } from 'react'
import {
  Package, Trash2, ChevronUp, ChevronDown, ExternalLink, Download, RefreshCw, AlertTriangle,
  CheckCircle, Loader, Search, Pencil, Upload, Copy, FileText, Map as MapIcon, Info, GripVertical, ArrowDownUp, Users,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ModEntry, ServerProfile } from '../store/useAppStore'
import WorkshopBrowser from './WorkshopBrowser'
import ModPackPanel from './ModPackPanel'
import WorkshopPublish from './WorkshopPublish'
import {
  addModsToProfile, downloadAndScan, scanMods, enabledIds, withEnabled, needsChoice, hasRealModId,
  missingRequirements, disabledRequirements, isLocalMod, modKey, listProblems,
} from '../lib/mods'
import { patchProfile, formatBytes, formatModIds } from '../lib/profile'
import { sortModList, orderModIds, orderedModMaps, diffSnapshot } from '../../shared/modCore'

type SubTab = 'list' | 'browse' | 'pack' | 'import'

export default function ModsPanel({ profile }: { profile: ServerProfile }) {
  const { modDownloads, serverStatuses, settings } = useAppStore()
  const [sub, setSub] = useState<SubTab>(profile.mods.length === 0 ? 'browse' : 'list')
  const [searchRequest, setSearchRequest] = useState<{ query: string; nonce: number }>()
  const status = serverStatuses[profile.id] || 'stopped'
  const advanced = !!settings?.advancedMode

  // pick up anything downloaded by the server itself since last time
  useEffect(() => { void scanMods(profile.id) }, [profile.id])

  const missing = useMemo(() => missingRequirements(profile), [profile])
  const switchedOff = useMemo(() => disabledRequirements(profile), [profile])
  const problems = useMemo(() => listProblems(profile), [profile])
  const sortPlan = useMemo(() => sortModList(profile.mods), [profile.mods])
  const changes = useMemo(() => diffSnapshot(profile.lastStartedMods, {
    workshopItems: profile.mods.map(m => m.workshopId).filter(Boolean),
    mods: orderModIds(profile.mods).order,
  }), [profile.mods, profile.lastStartedMods])
  const modMaps = useMemo(() => orderedModMaps(profile.mods, profile.mapOrder), [profile.mods, profile.mapOrder])
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const nameOf = (id: string) => profile.mods.find(m => enabledIds(m).includes(id))?.name || id
  const notDownloaded = profile.mods.filter(m => !isLocalMod(m) && !m.infos && modDownloads[m.workshopId]?.state !== 'done')
  const busy = profile.mods.some(m => ['queued', 'downloading'].includes(modDownloads[m.workshopId]?.state || ''))

  const setMods = (fn: (mods: ModEntry[]) => ModEntry[]) => patchProfile(profile.id, p => ({ mods: fn(p.mods) }))

  const move = (idx: number, dir: -1 | 1) => setMods(mods => {
    const next = [...mods]
    const target = idx + dir
    if (target < 0 || target >= next.length) return mods
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return next
  })

  // drag and drop goes by key, the list on disk could have shifted since the drag started
  const moveTo = (fromKey: string, toIdx: number) => setMods(mods => {
    const from = mods.findIndex(m => modKey(m) === fromKey)
    if (from < 0 || from === toIdx) return mods
    const next = [...mods]
    const [item] = next.splice(from, 1)
    next.splice(toIdx > from ? toIdx - 1 : toIdx, 0, item)
    return next
  })

  const autoSort = () => setMods(mods => sortModList(mods).sorted)

  const moveMap = (idx: number, dir: -1 | 1) => patchProfile(profile.id, p => {
    const order = orderedModMaps(p.mods, p.mapOrder)
    const target = idx + dir
    if (target < 0 || target >= order.length) return {}
    ;[order[idx], order[target]] = [order[target], order[idx]]
    return { mapOrder: order }
  })

  const remove = (key: string) => setMods(mods => mods.filter(m => modKey(m) !== key))

  const toggleId = (key: string, id: string) => setMods(mods => mods.map(m => {
    if (modKey(m) !== key) return m
    const on = enabledIds(m).filter(x => m.infos?.some(i => i.id === x))
    return withEnabled(m, on.includes(id) ? on.filter(x => x !== id) : [...on, id])
  }))

  // a local mod with its id cleared would have nothing left to go by, so keep the old one
  const setManualId = (key: string, value: string) => setMods(mods => mods.map(m =>
    modKey(m) === key ? { ...m, modId: value.trim() || (isLocalMod(m) ? m.modId : m.workshopId) } : m
  ))

  const findOnWorkshop = (query: string) => {
    setSearchRequest({ query, nonce: Date.now() })
    setSub('browse')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sub tabs */}
      <div className="flex items-center border-b border-pz-border bg-pz-darker px-4 flex-shrink-0">
        {([
          ['list', `Your mods (${profile.mods.length})`],
          ['browse', 'Browse Workshop'],
          ['pack', 'Modpacks'],
          ['import', 'Import / Export'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${sub === id ? 'tab-active' : 'tab-inactive'}`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        {status !== 'stopped' && (
          <span className="text-xs text-pz-yellow flex items-center gap-1.5">
            <Info size={12} /> Mod changes apply next time the server starts
          </span>
        )}
      </div>

      {/* Browser stays mounted so it keeps its page when you flip tabs */}
      <div className={sub === 'browse' ? 'flex-1 min-h-0' : 'hidden'}>
        <WorkshopBrowser
          addedIds={profile.mods.map(m => m.workshopId).filter(Boolean)}
          buildVersion={profile.buildVersion}
          onAdd={async (items) => { await addModsToProfile(profile.id, items) }}
          searchRequest={searchRequest}
        />
      </div>

      {sub === 'list' && (
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {profile.mods.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Package size={36} className="text-pz-muted" />
              <p className="text-pz-subtext">No mods yet. Your server runs fine without any!</p>
              <button onClick={() => setSub('browse')} className="btn-primary"><Search size={14} /> Browse the Workshop</button>
            </div>
          ) : (
            <>
              {/* Problems first, with a button that fixes each one */}
              {missing.map(m => (
                <Banner key={m.id} tone="error">
                  <span className="flex-1"><b>{m.neededBy}</b> needs the mod <b>{m.id}</b>, which isn't in your list.</span>
                  <button onClick={() => findOnWorkshop(m.id)} className="btn-outline text-xs py-1 px-2"><Search size={12} /> Find it</button>
                </Banner>
              ))}
              {switchedOff.map(m => (
                <Banner key={m.id} tone="error">
                  <span className="flex-1">The mod <b>{m.id}</b> is needed but switched off.</span>
                  <button onClick={() => toggleId(m.workshopId, m.id)} className="btn-outline text-xs py-1 px-2">Turn it on</button>
                </Banner>
              ))}
              {problems.order.map(p => (
                <Banner key={p.kind === 'cycle' ? p.ids.join('>') : `${p.a}|${p.b}`} tone="warning">
                  {p.kind === 'cycle' ? (
                    <span className="flex-1">These mods each want to load after the other: <b>{p.ids.map(nameOf).join(' → ')}</b>. Check their Steam pages for the right order.</span>
                  ) : (
                    <span className="flex-1"><b>{nameOf(p.a)}</b> says it doesn't work together with <b>{nameOf(p.b)}</b>. Turn one of them off.</span>
                  )}
                </Banner>
              ))}
              {problems.wrongBuild.map(w => (
                <Banner key={w.id} tone="warning">
                  <span className="flex-1">
                    <b>{w.name}</b> only has files for {w.builds.map(b => b.toUpperCase()).join('/')}, so this {profile.buildVersion === 'b41' ? 'B41' : 'B42'} server
                    {' '}won't load it. Look for a {profile.buildVersion === 'b41' ? 'B41' : 'B42'} version on the Workshop.
                  </span>
                  <button onClick={() => findOnWorkshop(w.name)} className="btn-outline text-xs py-1 px-2"><Search size={12} /> Find one</button>
                </Banner>
              ))}
              {problems.unsorted && (
                <Banner tone="warning">
                  <span className="flex-1">
                    {sortPlan.moves.length === 1 ? 'A mod is above something it has' : `${sortPlan.moves.length || 'Some'} mods are above something they have`} to load after
                    {sortPlan.moves[0] && <> (<b>{sortPlan.moves[0].name}</b>: {sortPlan.moves[0].because})</>}.
                    {' '}The server fixes this when it starts, but sorting now makes the list match what actually loads.
                  </span>
                  <button onClick={autoSort} className="btn-outline text-xs py-1 px-2"><ArrowDownUp size={12} /> Sort automatically</button>
                </Banner>
              )}
              {changes && (
                <Banner tone={status === 'stopped' ? 'info' : 'warning'}>
                  <span className="flex-1">
                    Changed since the server last started:{' '}
                    {[
                      changes.added.length ? `${changes.added.length} added` : '',
                      changes.removed.length ? `${changes.removed.length} removed` : '',
                      changes.reordered ? 'load order changed' : '',
                    ].filter(Boolean).join(', ') || 'workshop items changed'}.
                    {status === 'stopped' ? ' Friends will need the same mods next time they join.' : ' Restart the server to apply it.'}
                  </span>
                </Banner>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-pz-muted flex-1">
                  Mods load top to bottom, drag them to reorder. Mods that others depend on are moved up automatically when the server starts.
                </p>
                <button onClick={() => scanMods(profile.id)} className="btn-ghost text-xs py-1 px-2" title="Re-read mod files from disk">
                  <RefreshCw size={12} /> Re-check files
                </button>
                <button
                  onClick={() => downloadAndScan(profile.id, notDownloaded.map(m => m.workshopId))}
                  disabled={busy || notDownloaded.length === 0}
                  className="btn-outline text-xs py-1 px-2"
                >
                  <Download size={12} /> {notDownloaded.length ? `Download ${notDownloaded.length} missing` : 'All downloaded'}
                </button>
              </div>

              {profile.mods.map((mod, idx) => (
                <div
                  key={modKey(mod)}
                  draggable
                  onDragStart={e => { setDragFrom(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', modKey(mod)) }}
                  onDragOver={e => {
                    if (dragFrom === null) return
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setDragOver(e.clientY < r.top + r.height / 2 ? idx : idx + 1)
                  }}
                  onDrop={e => {
                    e.preventDefault()
                    const key = e.dataTransfer.getData('text/plain')
                    if (key && dragOver !== null) void moveTo(key, dragOver)
                    setDragFrom(null); setDragOver(null)
                  }}
                  onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                  className={`relative ${dragFrom === idx ? 'opacity-40' : ''}`}
                >
                  {dragOver === idx && dragFrom !== null && <div className="absolute -top-1.5 left-0 right-0 h-0.5 bg-pz-green rounded" />}
                  {dragOver === idx + 1 && idx === profile.mods.length - 1 && dragFrom !== null && <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 bg-pz-green rounded" />}
                  <ModRow
                    profileId={profile.id}
                    mod={mod}
                    index={idx}
                    total={profile.mods.length}
                    advanced={advanced}
                    wrongBuild={problems.wrongBuild.some(w => enabledIds(mod).includes(w.id))}
                    download={isLocalMod(mod) ? undefined : modDownloads[mod.workshopId]}
                    onMove={dir => move(idx, dir)}
                    onRemove={() => remove(modKey(mod))}
                    onToggleId={id => toggleId(modKey(mod), id)}
                    onRetry={() => downloadAndScan(profile.id, [mod.workshopId])}
                    onSetId={v => setManualId(modKey(mod), v)}
                  />
                </div>
              ))}

              {modMaps.length > 1 && (
                <div className="card p-4 space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-pz-text flex items-center gap-1.5"><MapIcon size={14} /> Map order</h3>
                    <p className="text-xs text-pz-muted mt-0.5">
                      Where two maps change the same area, the one higher up wins. The base game map always goes last.
                    </p>
                  </div>
                  {modMaps.map((m, i) => (
                    <div key={m} className="flex items-center gap-2 text-sm">
                      <div className="flex flex-col">
                        <button onClick={() => moveMap(i, -1)} disabled={i === 0} className="text-pz-muted hover:text-pz-text disabled:opacity-20" title="Move up"><ChevronUp size={12} /></button>
                        <button onClick={() => moveMap(i, 1)} disabled={i === modMaps.length - 1} className="text-pz-muted hover:text-pz-text disabled:opacity-20" title="Move down"><ChevronDown size={12} /></button>
                      </div>
                      <span className="text-xs text-pz-muted w-5">{i + 1}.</span>
                      <span className="text-pz-text">{m}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-sm text-pz-muted">
                    <span className="w-3" /><span className="text-xs w-5">{modMaps.length + 1}.</span>
                    <span>{String(profile.iniSettings?.Map || 'Muldraugh, KY')} (base game)</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {sub === 'pack' && <ModPackPanel profile={profile} onDone={() => setSub('list')} />}
      {sub === 'import' && <ImportExport profile={profile} />}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'error' | 'warning' | 'info'; children: React.ReactNode }) {
  const styles = {
    error: ['bg-pz-red/10 border-pz-red/30', 'text-pz-red'],
    warning: ['bg-pz-yellow/10 border-pz-yellow/30', 'text-pz-yellow'],
    info: ['bg-pz-blue/10 border-pz-blue/30', 'text-pz-blue'],
  }[tone]
  return (
    <div className={`flex items-center gap-3 text-sm rounded-lg px-3 py-2 border text-pz-text ${styles[0]}`}>
      {tone === 'info'
        ? <Info size={14} className={`${styles[1]} flex-shrink-0`} />
        : <AlertTriangle size={14} className={`${styles[1]} flex-shrink-0`} />}
      {children}
    </div>
  )
}

interface RowProps {
  profileId: string
  mod: ModEntry
  index: number
  total: number
  advanced: boolean
  wrongBuild: boolean
  download?: { state: string; bytes?: number; message?: string }
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onToggleId: (id: string) => void
  onRetry: () => void
  onSetId: (value: string) => void
}

function ModRow({ profileId, mod, index, total, advanced, wrongBuild, download, onMove, onRemove, onToggleId, onRetry, onSetId }: RowProps) {
  const [editing, setEditing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [idDraft, setIdDraft] = useState(mod.modId)
  const enabled = enabledIds(mod)
  const state = download?.state

  const statusChip = (() => {
    if (state === 'queued') return <Chip tone="muted"><Loader size={11} className="animate-spin" /> Waiting to download</Chip>
    if (state === 'downloading') {
      const pct = mod.fileSize && download?.bytes ? Math.min(99, Math.round(download.bytes / mod.fileSize * 100)) : null
      return <Chip tone="blue"><Loader size={11} className="animate-spin" /> Downloading{pct !== null ? ` ${pct}%` : '...'}</Chip>
    }
    if (state === 'failed') return (
      <Chip tone="red">
        <AlertTriangle size={11} /> Download failed
        <button onClick={onRetry} className="underline ml-1">retry</button>
      </Chip>
    )
    if (isLocalMod(mod)) return <Chip tone="blue">Local mod (Zomboid\mods)</Chip>
    if (needsChoice(mod)) return <Chip tone="yellow"><AlertTriangle size={11} /> Pick which mods to turn on</Chip>
    if (wrongBuild) return <Chip tone="yellow"><AlertTriangle size={11} /> Wrong game version</Chip>
    if (!mod.infos) {
      return hasRealModId(mod)
        ? <Chip tone="muted">Not downloaded <button onClick={onRetry} className="underline ml-1">download</button></Chip>
        : <Chip tone="yellow">Not downloaded yet <button onClick={onRetry} className="underline ml-1">download</button></Chip>
    }
    return <Chip tone="green"><CheckCircle size={11} /> Ready</Chip>
  })()

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-3">
        <GripVertical size={14} className="text-pz-muted flex-shrink-0 cursor-grab" />
        <span className="text-xs text-pz-muted w-5 text-right flex-shrink-0" title="Load position">{index + 1}</span>
        <div className="flex flex-col flex-shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="text-pz-muted hover:text-pz-text disabled:opacity-20" title="Move up"><ChevronUp size={14} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="text-pz-muted hover:text-pz-text disabled:opacity-20" title="Move down"><ChevronDown size={14} /></button>
        </div>
        {mod.thumbnailUrl ? (
          <img src={mod.thumbnailUrl} alt="" className="w-11 h-11 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded bg-pz-border flex items-center justify-center flex-shrink-0"><Package size={16} className="text-pz-muted" /></div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-pz-text truncate">{mod.name}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {statusChip}
            {mod.fileSize ? <span className="text-xs text-pz-muted">{formatBytes(mod.fileSize)}</span> : null}
            {(mod.maps?.length || 0) > 0 && <span className="text-xs text-pz-teal flex items-center gap-1"><MapIcon size={11} /> adds a map</span>}
            {advanced && hasRealModId(mod) && <span className="text-xs text-pz-muted">ID: <span className="text-pz-subtext">{mod.modId}</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {advanced && (
            <button onClick={() => { setIdDraft(mod.modId === mod.workshopId ? '' : mod.modId); setEditing(e => !e) }} className="btn-ghost p-1.5" title="Edit mod ID">
              <Pencil size={12} />
            </button>
          )}
          {!isLocalMod(mod) && (
            <button
              onClick={() => window.electronAPI.shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`)}
              className="btn-ghost p-1.5" title="Open on Steam"
            >
              <ExternalLink size={12} />
            </button>
          )}
          {isLocalMod(mod) && (
            <button onClick={() => setPublishing(p => !p)} className="btn-ghost text-xs py-1 px-2" title="Players get it by themselves once it's on the Workshop">
              <Upload size={12} /> Put on Workshop
            </button>
          )}
          <button onClick={onRemove} className="btn-ghost p-1.5 text-pz-red hover:text-pz-red" title="Remove"><Trash2 size={12} /></button>
        </div>
      </div>

      {(mod.infos?.length || 0) > 1 && (
        <div className="ml-7 pl-3 border-l-2 border-pz-border">
          <p className="text-xs text-pz-subtext mb-1.5">
            This download has {mod.infos!.length} mods inside. Turn on the ones you want (the mod page on Steam usually says which):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {mod.infos!.map(info => {
              const on = enabled.includes(info.id)
              return (
                <button
                  key={info.id}
                  onClick={() => onToggleId(info.id)}
                  title={info.id}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    on ? 'bg-pz-green/20 border-pz-green text-pz-green' : 'border-pz-border text-pz-muted hover:border-pz-text'
                  }`}
                >
                  {on ? '✓ ' : ''}{info.name}{info.name !== info.id && advanced ? ` (${info.id})` : ''}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {publishing && isLocalMod(mod) && enabled[0] && (
        <WorkshopPublish profileId={profileId} modId={enabled[0]} onDone={() => setPublishing(false)} />
      )}

      {editing && (
        <div className="ml-7 pl-3 border-l-2 border-pz-green/40 flex items-center gap-2">
          <input
            value={idDraft}
            onChange={e => setIdDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onSetId(idDraft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
            className="input text-sm py-1"
            placeholder="Mod ID, several separated by ;"
            autoFocus
          />
          <button onClick={() => { onSetId(idDraft); setEditing(false) }} className="btn-primary text-xs py-1 px-3">Save</button>
        </div>
      )}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'green' | 'yellow' | 'red' | 'blue' | 'muted'; children: React.ReactNode }) {
  const colors = {
    green: 'text-pz-green bg-pz-green/10',
    yellow: 'text-pz-yellow bg-pz-yellow/10',
    red: 'text-pz-red bg-pz-red/10',
    blue: 'text-pz-blue bg-pz-blue/10',
    muted: 'text-pz-subtext bg-pz-border/60',
  }
  return <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${colors[tone]}`}>{children}</span>
}

// ── Import / export ───────────────────────────────────────────────────────────

function parseModLines(text: string): { workshopIds: string[]; modIds: string[] } {
  const workshopIds: string[] = []
  const modIds: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    const val = t.split('=').slice(1).join('=').trim()
    if (/^WorkshopItems\s*=/i.test(t) && val) workshopIds.push(...val.split(';').map(s => s.trim()).filter(Boolean))
    // B42 ini files put a \ in front of each id, we store them without it
    if (/^Mods\s*=/i.test(t) && val) modIds.push(...val.split(';').map(s => s.trim().replace(/^\\+/, '')).filter(Boolean))
  }
  // a bare list of ids or workshop links works too
  if (workshopIds.length === 0) {
    for (const m of text.matchAll(/(?:id=)?(\d{8,12})/g)) if (!workshopIds.includes(m[1])) workshopIds.push(m[1])
  }
  return { workshopIds, modIds }
}

function ImportExport({ profile }: { profile: ServerProfile }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)

  const exportText = `WorkshopItems=${profile.mods.map(m => m.workshopId).filter(Boolean).join(';')}\nMods=${formatModIds(orderModIds(profile.mods).order, profile.buildVersion)}`

  const runImport = async (input: string) => {
    const { workshopIds, modIds } = parseModLines(input)
    if (workshopIds.length === 0) {
      setMsg({ tone: 'error', text: 'No workshop IDs found. Paste the WorkshopItems= line from a server .ini, or a list of workshop links.' })
      return
    }
    setWorking(true)
    setMsg(null)
    try {
      const res = await window.electronAPI.mods.getDetails(workshopIds)
      const byId = new Map(res.mods.map(m => [m.workshopId, m]))
      // anything Steam didn't know about still gets added so nothing is lost
      const items = workshopIds.map(id => byId.get(id) || {
        workshopId: id, name: `Workshop item ${id}`, description: '', thumbnailUrl: '',
        subscriptions: 0, tags: [], timeUpdated: 0, fileSize: 0,
      })
      const before = new Set(profile.mods.map(m => m.workshopId))
      const added = await addModsToProfile(profile.id, items)

      // old B41-style lists line up one-to-one, use those ids until the files say otherwise
      if (modIds.length === workshopIds.length) {
        await patchProfile(profile.id, p => ({
          mods: p.mods.map(m => {
            const i = workshopIds.indexOf(m.workshopId)
            return i >= 0 && !before.has(m.workshopId) && !m.infos ? { ...m, modId: modIds[i] } : m
          }),
        }))
      }
      setMsg({ tone: 'ok', text: `Added ${added} mod${added === 1 ? '' : 's'} (${workshopIds.length - added} were already in your list). They're downloading now.` })
      setText('')
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setWorking(false)
    }
  }

  const importFile = async () => {
    const path = await window.electronAPI.dialog.openFile({ filters: [{ name: 'Server config', extensions: ['ini', 'txt'] }, { name: 'All Files', extensions: ['*'] }] })
    if (!path) return
    const res = await window.electronAPI.fs.readFile(path)
    if (res.success && res.content) runImport(res.content)
    else setMsg({ tone: 'error', text: res.message || "Couldn't read that file" })
  }

  const saveExport = async () => {
    const path = await window.electronAPI.dialog.saveFile({ defaultPath: `${profile.name}_mods.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (path) await window.electronAPI.fs.writeFile(path, exportText)
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-5">
        <SharePack profile={profile} />

        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-pz-text">Import mods</h3>
          <p className="text-xs text-pz-subtext">
            Got a mod list from a friend or another server? Open their <code>.ini</code> file, or paste the
            {' '}<code>WorkshopItems=</code> line (or just a bunch of workshop links) below.
          </p>
          <button onClick={importFile} disabled={working} className="btn-outline"><Upload size={14} /> Open .ini file</button>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={5}
            className="input font-mono text-xs resize-none select-text"
            placeholder={'WorkshopItems=2392709985;2200148440\nMods=\\ModA;\\ModB'}
          />
          <button onClick={() => runImport(text)} disabled={working || !text.trim()} className="btn-primary">
            {working ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />} Import
          </button>
          {msg && <p className={`text-xs ${msg.tone === 'ok' ? 'text-pz-green' : 'text-pz-red'}`}>{msg.text}</p>}
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-pz-text">Share your mod list</h3>
          <p className="text-xs text-pz-subtext">Send this to a friend, they can paste it into their own app.</p>
          <pre className="bg-pz-darker border border-pz-border rounded-md p-3 text-xs font-mono text-pz-subtext whitespace-pre-wrap break-all select-text">{exportText}</pre>
          <div className="flex gap-2">
            <button
              onClick={async () => { await navigator.clipboard.writeText(exportText); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="btn-outline"
            >
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={saveExport} className="btn-outline"><Download size={14} /> Save as file</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Server pack for players: mod list, load order and the fix mods themselves in one
// file. Friends open it in Play and get exactly this server's setup
function SharePack({ profile }: { profile: ServerProfile }) {
  const [address, setAddress] = useState(profile.playitAddress || '')
  const [withPassword, setWithPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fixCount = profile.mods.filter(isLocalMod).length

  useEffect(() => {
    if (address) return
    window.electronAPI.server.networkInfo().then(n => { if (n.publicIp) setAddress(a => a || n.publicIp!) }).catch(() => undefined)
  }, [])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    const r = await window.electronAPI.client.exportPack(profile.id, { address, includePassword: withPassword })
    setBusy(false)
    if (!r.success) setMsg({ tone: 'error', text: r.message || "Couldn't make the pack." })
    else if (!r.cancelled) setMsg({ tone: 'ok', text: `Saved. Send that file to your friends (Discord works). It has ${r.workshopItems} Workshop mods and ${r.fixMods} fix${r.fixMods === 1 ? '' : 'es'}.` })
  }

  return (
    <div className="card p-5 space-y-3 border-pz-green/40">
      <h3 className="text-sm font-semibold text-pz-text flex items-center gap-1.5"><Users size={14} /> Share with players</h3>
      <p className="text-xs text-pz-subtext">
        Makes a <b>server pack</b> file for your friends. They open it in this app under <b>Play</b> and get the same
        mods{fixCount > 0 ? `, your ${fixCount} fix mod${fixCount === 1 ? '' : 's'}` : ''} and load order, then join with one click.
        Make a new one whenever you change mods.
      </p>
      <div>
        <label className="label">Address friends join with</label>
        <input value={address} onChange={e => setAddress(e.target.value)} className="input text-sm" placeholder="Your public IP or playit address" />
      </div>
      {profile.serverPassword && (
        <label className="flex items-center gap-2 text-xs text-pz-subtext">
          <input type="checkbox" checked={withPassword} onChange={e => setWithPassword(e.target.checked)} />
          Put the server password in the pack (anyone with the file can join)
        </label>
      )}
      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? <Loader size={14} className="animate-spin" /> : <Download size={14} />} Save server pack
      </button>
      {msg && <p className={`text-xs ${msg.tone === 'ok' ? 'text-pz-green' : 'text-pz-red'}`}>{msg.text}</p>}
    </div>
  )
}

