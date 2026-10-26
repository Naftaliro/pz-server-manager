import { useMemo, useState } from 'react'
import { Layers, Loader, Search, Plus, CheckCircle, AlertTriangle, Trash2, ExternalLink, Info } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import { addModsToProfile } from '../lib/mods'
import { patchProfile, formatBytes } from '../lib/profile'
import { parseWorkshopIds, comparePack } from '../../shared/modCore'

interface PackResult {
  ids: string[]
  details: WorkshopModDetails[]
  addedDeps: Record<string, string[]>
  collections: string[]
  unchecked: string[]
  depsChecked: boolean
}

// Paste a Workshop collection (modpack) link: install everything in it, with the mods
// they require, or just check how your list compares
export default function ModPackPanel({ profile, onDone }: { profile: ServerProfile; onDone: () => void }) {
  const hasKey = !!useAppStore(s => s.settings?.steamApiKey)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PackResult | null>(null)
  const [removeExtra, setRemoveExtra] = useState(false)
  const [applied, setApplied] = useState('')

  const listIds = profile.mods.map(m => m.workshopId).filter(Boolean)
  const cmp = useMemo(() => (result ? comparePack(listIds, result.ids) : null), [result, listIds.join(';')])
  const byId = useMemo(() => new Map(result?.details.map(d => [d.workshopId, d]) || []), [result])
  const nameOf = (id: string) => byId.get(id)?.name || profile.mods.find(m => m.workshopId === id)?.name || `Workshop item ${id}`

  const lookUp = async () => {
    const ids = parseWorkshopIds(text)
    if (ids.length === 0) {
      setError("That doesn't look like a Workshop link. Copy the address of the collection page on Steam and paste it here.")
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    setApplied('')
    try {
      const res = await window.electronAPI.mods.resolvePack(ids, true)
      if (!res.success) { setError(res.message || "Couldn't reach Steam."); return }
      if (res.mods.length === 0) { setError('Steam says that collection is empty (or private).'); return }
      setResult({ ids: res.mods, details: res.details, addedDeps: res.addedDeps, collections: res.collections, unchecked: res.unchecked, depsChecked: res.depsChecked })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!result || !cmp) return
    setBusy(true)
    try {
      // Steam didn't know some ids (removed / private), skip those, they'd never download
      const items = cmp.missing.map(id => byId.get(id)).filter((d): d is WorkshopModDetails => !!d)
      const added = await addModsToProfile(profile.id, items)
      let removed = 0
      if (removeExtra && cmp.extra.length > 0) {
        await patchProfile(profile.id, p => {
          const keep = p.mods.filter(m => !m.workshopId || result.ids.includes(m.workshopId))
          removed = p.mods.length - keep.length
          return { mods: keep }
        })
      }
      setApplied([
        added ? `Added ${added} mod${added === 1 ? '' : 's'}, downloading now.` : '',
        removed ? `Removed ${removed}.` : '',
      ].filter(Boolean).join(' ') || 'Nothing to change.')
    } finally {
      setBusy(false)
    }
  }

  const unknown = result ? result.ids.filter(id => !byId.has(id)) : []
  const newSize = cmp ? cmp.missing.reduce((n, id) => n + (byId.get(id)?.fileSize || 0), 0) : 0
  const depCount = result ? Object.keys(result.addedDeps).length : 0

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-pz-text flex items-center gap-1.5"><Layers size={14} /> Install or check a modpack</h3>
          <p className="text-xs text-pz-subtext">
            Paste the link to a Steam Workshop collection (or a few). The app finds every mod in it, including
            collections inside it{hasKey ? ' and the mods each one needs' : ''}, then shows what's new before changing anything.
          </p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            className="input font-mono text-xs resize-none select-text"
            placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=..."
          />
          <div className="flex items-center gap-3">
            <button onClick={lookUp} disabled={busy || !text.trim()} className="btn-primary flex-shrink-0 whitespace-nowrap">
              {busy && !result ? <Loader size={14} className="animate-spin" /> : <Search size={14} />} Look up
            </button>
            {!hasKey && (
              <span className="text-xs text-pz-muted">
                Tip: add a Steam Web API key in App Settings and this also catches required mods the pack forgot.
              </span>
            )}
          </div>
          {error && <p className="text-xs text-pz-red">{error}</p>}
        </div>

        {result && cmp && (
          <div className="card p-5 space-y-4">
            <div className="text-sm text-pz-text">
              <b>{result.ids.length}</b> mods in this pack
              {result.collections.length > 1 && <> (from {result.collections.length} collections)</>}
              {depCount > 0 && <>, including <b>{depCount}</b> required mod{depCount === 1 ? '' : 's'} the pack didn't list</>}.
            </div>

            {cmp.missing.length === 0 && cmp.extra.length === 0 ? (
              <p className="text-sm text-pz-green flex items-center gap-1.5"><CheckCircle size={14} /> Your list has exactly these mods.</p>
            ) : (
              <>
                {cmp.missing.length > 0 && (
                  <Section title={`New to your list (${cmp.missing.length}${newSize ? `, ${formatBytes(newSize)}` : ''})`}>
                    {cmp.missing.map(id => (
                      <Row key={id} id={id} name={nameOf(id)} note={result.addedDeps[id] ? `needed by ${result.addedDeps[id].map(nameOf).join(', ')}` : undefined} />
                    ))}
                  </Section>
                )}
                {cmp.extra.length > 0 && (
                  <Section title={`In your list but not in the pack (${cmp.extra.length})`}>
                    {cmp.extra.map(id => <Row key={id} id={id} name={nameOf(id)} />)}
                    <label className="flex items-center gap-2 text-xs text-pz-subtext pt-1">
                      <input type="checkbox" checked={removeExtra} onChange={e => setRemoveExtra(e.target.checked)} />
                      <Trash2 size={11} /> Remove these so my list matches the pack exactly
                    </label>
                  </Section>
                )}
                <p className="text-xs text-pz-muted">{cmp.matching.length} of the pack's mods are already in your list.</p>
              </>
            )}

            {unknown.length > 0 && (
              <p className="text-xs text-pz-yellow flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                Steam couldn't find {unknown.length} item{unknown.length === 1 ? '' : 's'} in this pack (removed or made private): {unknown.join(', ')}. Those get skipped.
              </p>
            )}

            {result.unchecked.length > 0 && (
              <p className="text-xs text-pz-muted flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 flex-shrink-0" />
                Steam didn't say what {result.unchecked.length} of these mod{result.unchecked.length === 1 ? '' : 's'} need. That's fine:
                once they're downloaded, the Mods tab reads their files and points out anything still missing.
              </p>
            )}

            {(cmp.missing.length > 0 || (removeExtra && cmp.extra.length > 0)) && !applied && (
              <button onClick={apply} disabled={busy} className="btn-primary">
                {busy ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                {cmp.missing.length > 0 ? ` Add ${cmp.missing.length - unknown.filter(u => cmp.missing.includes(u)).length} mods` : ' Update my list'}
                {removeExtra && cmp.extra.length > 0 ? ` and remove ${cmp.extra.length}` : ''}
              </button>
            )}
            {applied && (
              <div className="flex items-center gap-3">
                <p className="text-xs text-pz-green flex-1">{applied} Once they're downloaded, use "Sort automatically" on your list if it asks.</p>
                <button onClick={onDone} className="btn-outline text-xs py-1 px-2">See my mods</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-pz-subtext uppercase tracking-wide">{title}</h4>
      <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">{children}</div>
    </div>
  )
}

function Row({ id, name, note }: { id: string; name: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-pz-text py-0.5">
      <span className="truncate flex-1">
        {name}
        {note && <span className="text-xs text-pz-muted ml-2">{note}</span>}
      </span>
      <button
        onClick={() => window.electronAPI.shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`)}
        className="btn-ghost p-1" title="Open on Steam"
      >
        <ExternalLink size={11} />
      </button>
    </div>
  )
}
