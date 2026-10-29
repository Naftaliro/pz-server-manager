import { useMemo, useState } from 'react'
import { Search, X, RotateCcw, Info } from 'lucide-react'
import { getPath, pathKey, humanize, VANILLA_BLOCKS } from '../../shared/gameConfig'
import type { SettingDef, SettingValue, SettingsTree } from '../../shared/gameConfig'
import type { GuideEntry, SettingsTab } from '../../shared/settingsGuide'

// A tab the page brings itself (the server editor's Basics and Danger zone)
export interface ExtraTab {
  id: string
  label: string
  render: () => React.ReactNode
}

interface Props {
  defs: SettingDef[]
  // what each setting is right now, edits included
  values: SettingsTree
  // keys (pathKey) changed since the last save
  changed: Set<string>
  onChange: (path: string[], value: SettingValue) => void
  guide: Record<string, GuideEntry>
  popular: string[]
  tabs: SettingsTab[]
  // sections that aren't the game's own become one tab per mod
  modBlocks?: boolean
  hidden?: (key: string) => boolean
  leadingTabs?: ExtraTab[]
  trailingTabs?: ExtraTab[]
  notice?: React.ReactNode
  // shown above the "Most changed" list only
  intro?: React.ReactNode
}

// Every setting from the game's own file, grouped into tabs, with plain-English names for
// the common ones and the game's description for the rest
export default function GameSettingsEditor({ defs, values, changed, onChange, guide, popular, tabs, modBlocks, hidden, leadingTabs = [], trailingTabs = [], notice, intro }: Props) {
  const [tab, setTab] = useState(leadingTabs[0]?.id || 'popular')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const visible = useMemo(() => defs.filter(d => !hidden?.(pathKey(d.path))), [defs, hidden])

  // tab id -> settings, in the game's own order
  const grouped = useMemo(() => {
    const out = new Map<string, SettingDef[]>()
    const push = (id: string, d: SettingDef) => { if (!out.has(id)) out.set(id, []); out.get(id)!.push(d) }
    const byKey = new Map(visible.map(d => [pathKey(d.path), d]))
    out.set('popular', popular.map(k => byKey.get(k)).filter((d): d is SettingDef => !!d))
    for (const d of visible) {
      const key = pathKey(d.path)
      if (modBlocks && d.path.length > 1 && !VANILLA_BLOCKS.includes(d.path[0])) { push('mods', d); continue }
      push(tabs.find(t => t.match(key))?.id || 'other', d)
    }
    return out
  }, [visible, popular, tabs, modBlocks])

  const allTabs = [
    ...leadingTabs.map(t => ({ id: t.id, label: t.label })),
    { id: 'popular', label: 'Most changed' },
    ...tabs.filter(t => grouped.get(t.id)?.length).map(t => ({ id: t.id, label: t.label })),
    ...(grouped.get('mods')?.length ? [{ id: 'mods', label: 'Mod settings' }] : []),
    ...(grouped.get('other')?.length ? [{ id: 'other', label: 'Other' }] : []),
    ...trailingTabs.map(t => ({ id: t.id, label: t.label })),
  ]
  const extra = [...leadingTabs, ...trailingTabs].find(t => t.id === tab)

  const matches = q ? visible.filter(d => {
    const key = pathKey(d.path)
    const g = guide[key]
    return [key, humanize(d.path[d.path.length - 1]), g?.label, g?.help, d.description].some(s => s?.toLowerCase().includes(q))
  }) : []

  const shown = q ? matches : grouped.get(tab) || []
  // mod settings are listed under the mod's own section name
  const sections = useMemo(() => {
    const out: Array<{ title?: string; defs: SettingDef[] }> = []
    for (const d of shown) {
      const title = tab === 'mods' && !q ? d.path.slice(0, -1).join(' › ') : undefined
      const last = out[out.length - 1]
      if (last && last.title === title) last.defs.push(d)
      else out.push({ title, defs: [d] })
    }
    return out
  }, [shown, tab, q])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 py-2 border-b border-pz-border bg-pz-darker flex items-center gap-2 flex-shrink-0">
        <Search size={14} className="text-pz-muted flex-shrink-0" />
        <input
          type="text"
          placeholder="Search every setting..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-pz-text placeholder:text-pz-muted outline-none"
        />
        {query && <button onClick={() => setQuery('')} className="text-pz-muted hover:text-pz-text"><X size={14} /></button>}
      </div>

      {!q && (
        <div className="flex border-b border-pz-border bg-pz-darker px-6 flex-shrink-0 overflow-x-auto">
          {allTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.id ? 'tab-active' : 'tab-inactive'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 pb-24">
        <div className="max-w-2xl mx-auto space-y-4">
          {notice}
          {!q && extra ? extra.render() : (
            <>
              {q && <p className="text-xs text-pz-muted">{matches.length} setting{matches.length === 1 ? '' : 's'} match "{query}"</p>}
              {!q && tab === 'popular' && intro}
              {!q && tab === 'popular' && (
                <p className="text-xs text-pz-subtext flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0" />
                  The settings people change most. Every other one is in the tabs above, or use search.
                </p>
              )}
              {!q && tab === 'mods' && (
                <p className="text-xs text-pz-subtext">Settings your mods added. The names and descriptions come from each mod, so they can be terse.</p>
              )}
              {sections.map((s, i) => (
                <div key={s.title || i} className="card p-5 space-y-1">
                  {s.title && <h3 className="text-sm font-semibold text-pz-text pb-2">{s.title}</h3>}
                  {s.defs.map(d => (
                    <SettingRow
                      key={pathKey(d.path)}
                      def={d}
                      value={getPath(values, d.path) ?? d.default}
                      changed={changed.has(pathKey(d.path))}
                      guide={guide[pathKey(d.path)]}
                      showPath={!!q}
                      onChange={v => onChange(d.path, v)}
                    />
                  ))}
                </div>
              ))}
              {shown.length === 0 && <p className="text-sm text-pz-muted">Nothing here.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function formatValue(def: SettingDef, v: SettingValue | undefined): string {
  if (v === undefined) return ''
  if (def.options) return def.options.find(o => o.value === v)?.label || String(v)
  if (typeof v === 'boolean') return v ? 'On' : 'Off'
  return String(v)
}

function SettingRow({ def, value, changed, guide, showPath, onChange }: {
  def: SettingDef
  value: SettingValue | undefined
  changed: boolean
  guide?: GuideEntry
  showPath: boolean
  onChange: (v: SettingValue) => void
}) {
  const key = def.path[def.path.length - 1]
  const label = guide?.label || humanize(key)
  const isDefault = def.default === undefined || value === undefined || value === def.default
  // our explanation is based on the game's, so only show the game's when there's no ours
  const gameText = guide?.help ? undefined : def.description

  let control: React.ReactNode
  if (def.type === 'bool') {
    const on = value === true
    control = (
      <button onClick={() => onChange(!on)} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-pz-green' : 'bg-pz-border'}`} title={on ? 'On' : 'Off'}>
        <span className={`absolute top-0.5 left-0 w-4 h-4 rounded-full bg-pz-text transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    )
  } else if (def.options) {
    control = (
      <select value={String(value ?? '')} onChange={e => onChange(Number(e.target.value))} className="input w-52 py-1.5 text-sm">
        {!def.options.some(o => o.value === value) && value !== undefined && <option value={String(value)}>{String(value)}</option>}
        {def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  } else if (def.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value ?? 0)
    const slider = def.min !== undefined && def.max !== undefined && def.max - def.min <= 1000 && def.max > def.min
    const step = def.decimal ? (def.max !== undefined && def.max <= 10 ? 0.05 : 0.1) : 1
    control = (
      <div className="flex items-center gap-2">
        {slider && (
          <input type="range" min={def.min} max={def.max} step={step} value={n}
            onChange={e => onChange(Number(e.target.value))} className="w-32" />
        )}
        <input
          type="number"
          value={Number.isFinite(n) ? n : 0}
          min={def.min} max={def.max} step={step}
          onChange={e => { if (e.target.value !== '') onChange(Number(e.target.value)) }}
          className="input w-24 py-1.5 text-sm text-right"
        />
      </div>
    )
  } else {
    control = <input value={String(value ?? '')} onChange={e => onChange(e.target.value)} className="input w-64 py-1.5 text-sm" />
  }

  return (
    <div className={`flex items-start gap-4 py-2.5 border-b border-pz-border/50 last:border-0 ${changed ? 'bg-pz-green/5 -mx-2 px-2 rounded' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-pz-text flex items-center gap-2 flex-wrap">
          {label}
          {changed && <span className="text-[10px] font-semibold text-pz-green uppercase tracking-wide">changed</span>}
        </div>
        {guide?.help && <p className="text-xs text-pz-subtext mt-0.5">{guide.help}</p>}
        {gameText && <p className="text-xs text-pz-muted mt-0.5">{gameText}</p>}
        <div className="text-[11px] text-pz-muted mt-0.5 flex items-center gap-2 flex-wrap">
          {showPath && <span className="font-mono">{pathKey(def.path)}</span>}
          {def.default !== undefined && !isDefault && (
            <button onClick={() => onChange(def.default!)} className="flex items-center gap-1 hover:text-pz-text" title="Back to the game's default">
              <RotateCcw size={10} /> Default: {formatValue(def, def.default)}
            </button>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 pt-0.5">{control}</div>
    </div>
  )
}
