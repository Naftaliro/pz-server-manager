import { useMemo, useState } from 'react'
import { Layers, Loader, Search, Plus, CheckCircle, AlertTriangle, Trash2, ExternalLink, Info } from 'lucide-react'
import type { ServerProfile } from '../store/useAppStore'
import { addModsToProfile, finishImport } from '../lib/mods'
import { patchProfile, formatBytes } from '../lib/profile'
import { parseWorkshopIds, comparePack } from '../../shared/modCore'
import { planImport, importSummary } from '../../shared/collectionImport'

interface PackResult {
  ids: string[]
  details: WorkshopModDetails[]
  addedDeps: Record<string, string[]>
  collections: string[]
  unchecked: string[]
  depsChecked: boolean
}

// Paste a Workshop collection (modpack) link: install everything in it, with the mods
// they require, in load order, leaving out what's made for an older build. Or just check
// how your list compares
export default function ModPackPanel({ profile, onDone }: { profile: ServerProfile; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<PackResult | null>(null)
  const [removeExtra, setRemoveExtra] = useState(false)
  const [includeOlder, setIncludeOlder] = useState(false)
  const [applied, setApplied] = useState<{ summary: string; wrongBuild: string[] } | null>(null)
  const build = profile.buildVersion === 'b41' ? 'b41' : 'b42'

  const listIds = profile.mods.map(m => m.workshopId).filter(Boolean)
  const cmp = useMemo(() => (result ? comparePack(listIds, result.ids) : null), [result, listIds.join(';')])
  const byId = useMemo(() => new Map(result?.details.map(d => [d.workshopId, d]) || []), [result])
  const plan = useMemo(() => (result ? planImport({
    packIds: result.ids, details: result.details, listIds, addedDeps: result.addedDeps, build, includeOlder,
  }) : null), [result, listIds.join(';'), build, includeOlder])
  // what the Build 41 check leaves out, shown even while they're being added anyway
  const older = useMemo(() => (result ? planImport({ packIds: result.ids, details: result.details, listIds, addedDeps: result.addedDeps, build }).olderBuild : []), [result, listIds.join(';'), build])
  const nameOf = (id: string) => byId.get(id)?.name || profile.mods.find(m => m.workshopId === id)?.name || `Workshop item ${id}`

  const lookUp = async () => {
    // numbers only, whatever was pasted (links, ids, a WorkshopItems= line)
    const ids = parseWorkshopIds(text)
    if (ids.length === 0) {
      setError("That doesn't look like a Workshop link. Copy the address of the collection page on Steam and paste it here.")
      return
    }
    setBusy(true)
    setPhase('Asking Steam what\'s in it and what each mod needs...')
    setError('')
    setResult(null)
    setApplied(null)
    try {
      const res = await window.electronAPI.mods.resolvePack(ids, true)
      if (!res.success) { setError(res.message || "Couldn't reach Steam."); return }
      if (res.mods.length === 0) { setError('Steam says that collection is empty (or private).'); return }
      setResult({ ids: res.mods, details: res.details, addedDeps: res.addedDeps, collections: res.collections, unchecked: res.unchecked, depsChecked: res.depsChecked })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  const apply = async () => {
    if (!result || !plan) return
    setBusy(true)
    try {
      let removed = 0
      if (removeExtra && cmp && cmp.extra.length > 0) {
        await patchProfile(profile.id, p => {
          const keep = p.mods.filter(m => !m.workshopId || result.ids.includes(m.workshopId))
          removed = p.mods.length - keep.length
          return { mods: keep }
        })
      }
      setPhase(plan.add.length ? `Downloading ${plan.add.length} mod${plan.add.length === 1 ? '' : 's'}... The Mods tab shows how far along each one is.` : '')
      const added = await addModsToProfile(profile.id, plan.add, { wait: true })
      setPhase('Sorting the load order...')
      const done = await finishImport(profile.id, plan.add.map(d => d.workshopId))
      const summary = importSummary({
        added,
        sorted: true,
        moved: done.moved,
        olderSkipped: plan.olderBuild.length,
        requiredAdded: plan.requiredAdded.length,
        wrongBuild: done.wrongBuild.length,
        needChoice: done.needChoice,
        failed: done.failed,
      })
      setApplied({ summary: removed ? `${summary} Removed ${removed} that weren't in the pack.` : summary, wrongBuild: done.wrongBuild })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  const removeWrongBuild = async () => {
    if (!applied) return
    const ids = applied.wrongBuild
    await patchProfile(profile.id, p => ({ mods: p.mods.filter(m => !ids.includes(m.workshopId)) }))
    setApplied({ summary: `${applied.summary} Removed ${ids.length} that only work on another game version.`, wrongBuild: [] })
  }

  const newSize = plan ? plan.add.reduce((n, d) => n + (d.fileSize || 0), 0) : 0
  const depCount = result ? Object.keys(result.addedDeps).length : 0

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-pz-text flex items-center gap-1.5"><Layers size={14} /> Install or check a modpack</h3>
          <p className="text-xs text-pz-subtext">
            Paste the link to a Steam Workshop collection (or a few). The app finds every mod in it, including collections inside it
            and the mods each one needs, leaves out mods made for an older game version, and puts everything in load order once it's downloaded.
            It shows what's new before changing anything.
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
            {phase && !result && <span className="text-xs text-pz-muted">{phase}</span>}
          </div>
          {error && <p className="text-xs text-pz-red">{error}</p>}
        </div>

        {result && cmp && plan && (
          <div className="card p-5 space-y-4">
            <div className="text-sm text-pz-text">
              <b>{result.ids.length}</b> mods in this pack
              {result.collections.length > 1 && <> (from {result.collections.length} collections)</>}
              {depCount > 0 && <>, including <b>{depCount}</b> required mod{depCount === 1 ? '' : 's'} the pack didn't list</>}.
            </div>

            {plan.add.length === 0 && cmp.extra.length === 0 && older.length === 0 ? (
              <p className="text-sm text-pz-green flex items-center gap-1.5"><CheckCircle size={14} /> Your list already has these mods.</p>
            ) : (
              <>
                {plan.add.length > 0 && (
                  <Section title={`New to your list (${plan.add.length}${newSize ? `, ${formatBytes(newSize)}` : ''})`}>
                    {plan.add.map(d => (
                      <Row key={d.workshopId} id={d.workshopId} name={d.name} note={result.addedDeps[d.workshopId] ? `needed by ${result.addedDeps[d.workshopId].map(nameOf).join(', ')}` : undefined} />
                    ))}
                  </Section>
                )}
                {older.length > 0 && (
                  <Section title={`Made for Build 41 (${older.length}${includeOlder ? ', adding them anyway' : ', left out'})`}>
                    {older.map(d => <Row key={d.workshopId} id={d.workshopId} name={d.name} />)}
                    <p className="text-xs text-pz-muted pt-1">Their Workshop page only lists Build 41, so a Build 42 server most likely won't load them.</p>
                    <label className="flex items-center gap-2 text-xs text-pz-subtext pt-1">
                      <input type="checkbox" checked={includeOlder} onChange={e => setIncludeOlder(e.target.checked)} />
                      Add them anyway (the Mods tab says once they're downloaded if they really don't fit)
                    </label>
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

            {plan.unknown.length > 0 && (
              <p className="text-xs text-pz-yellow flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                Steam couldn't find {plan.unknown.length} item{plan.unknown.length === 1 ? '' : 's'} in this pack (removed or made private): {plan.unknown.join(', ')}. Those get skipped.
              </p>
            )}

            {result.unchecked.length > 0 && (
              <p className="text-xs text-pz-muted flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 flex-shrink-0" />
                Steam didn't say what {result.unchecked.length} of these mod{result.unchecked.length === 1 ? '' : 's'} need. That's fine:
                once they're downloaded, the Mods tab reads their files and points out anything still missing.
              </p>
            )}

            {(plan.add.length > 0 || (removeExtra && cmp.extra.length > 0)) && !applied && (
              <div className="space-y-2">
                <button onClick={apply} disabled={busy} className="btn-primary">
                  {busy ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                  {plan.add.length > 0 ? ` Add ${plan.add.length} mod${plan.add.length === 1 ? '' : 's'}` : ' Update my list'}
                  {removeExtra && cmp.extra.length > 0 ? ` and remove ${cmp.extra.length}` : ''}
                </button>
                {phase && <p className="text-xs text-pz-muted flex items-center gap-1.5"><Loader size={11} className="animate-spin" /> {phase}</p>}
              </div>
            )}
            {applied && (
              <div className="space-y-2">
                <p className="text-sm text-pz-green flex items-start gap-1.5"><CheckCircle size={14} className="mt-0.5 flex-shrink-0" /> {applied.summary}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {applied.wrongBuild.length > 0 && (
                    <button onClick={removeWrongBuild} className="btn-outline text-xs py-1 px-2">
                      <Trash2 size={12} /> Remove the {applied.wrongBuild.length} for another version
                    </button>
                  )}
                  <button onClick={onDone} className="btn-outline text-xs py-1 px-2">See my mods</button>
                </div>
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
