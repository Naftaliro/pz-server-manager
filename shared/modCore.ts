// Mod logic shared by the Electron side and the UI. No Node or browser APIs in here,
// so it runs the same in both (and in tests).

export type Build = 'b41' | 'b42'

// One mod.info inside a workshop item (or a local mods folder)
export interface ModInfo {
  id: string
  name: string
  requires: string[]
  maps: string[]
  loadAfter?: string[]
  loadBefore?: string[]
  incompatible?: string[]
  // which game builds this mod has files for. missing = scanned by an older version
  builds?: Build[]
}

export interface ModLike {
  workshopId: string
  // enabled mod ids, ;-separated
  modId: string
  name: string
  infos?: ModInfo[]
  requires?: string[]
  maps?: string[]
}

export function stripId(id: string): string {
  return id.trim().replace(/^\\+/, '')
}

export function splitIds(value: string | undefined): string[] {
  return (value || '').split(/[;,]/).map(stripId).filter(Boolean)
}

export function enabledIds(mod: Pick<ModLike, 'modId'>): string[] {
  return (mod.modId || '').split(';').map(stripId).filter(Boolean)
}

// B42 wants Mods=\ModA;\ModB, B41 wants Mods=ModA;ModB
export function formatModIds(modIds: string[], buildVersion?: string): string {
  return modIds
    .flatMap(id => (id || '').split(';'))
    .map(stripId)
    .filter(Boolean)
    .map(id => (buildVersion === 'b41' ? id : `\\${id}`))
    .join(';')
}

export function parseModInfo(text: string): {
  id?: string; name?: string; requires: string[]; loadAfter: string[]; loadBefore: string[]; incompatible: string[]
} {
  const get = (key: string) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'im'))?.[1]
  return {
    id: get('id') ? stripId(get('id')!) : undefined,
    name: get('name'),
    requires: splitIds(get('require')),
    loadAfter: splitIds(get('loadModAfter')),
    loadBefore: splitIds(get('loadModBefore')),
    incompatible: splitIds(get('incompatible')),
  }
}

// ── Load order ────────────────────────────────────────────────────────────────

export type OrderProblem =
  | { kind: 'cycle'; ids: string[] }
  | { kind: 'incompatible'; a: string; b: string }

interface Rules {
  // id -> ids that have to load before it
  before: Map<string, Set<string>>
  // why each edge exists, for "X moved because Y requires it" messages
  reason: Map<string, string>
}

function infoFor(mod: ModLike, id: string): ModInfo | undefined {
  return mod.infos?.find(i => i.id === id)
}

function collectRules(mods: ModLike[], present: Set<string>): Rules {
  const before = new Map<string, Set<string>>()
  const reason = new Map<string, string>()
  const edge = (first: string, then: string, why: string) => {
    if (first === then || !present.has(first) || !present.has(then)) return
    if (!before.has(then)) before.set(then, new Set())
    before.get(then)!.add(first)
    if (!reason.has(`${first}>${then}`)) reason.set(`${first}>${then}`, why)
  }
  for (const m of mods) {
    for (const id of enabledIds(m)) {
      const info = infoFor(m, id)
      // older profiles only have the item-level requires list
      const requires = info ? info.requires : m.requires || []
      for (const dep of requires) edge(dep, id, `${id} requires ${dep}`)
      for (const dep of info?.loadAfter || []) edge(dep, id, `${id} loads after ${dep}`)
      for (const next of info?.loadBefore || []) edge(id, next, `${id} loads before ${next}`)
    }
  }
  return { before, reason }
}

// Keeps the given order, but pulls whatever something needs up to just before it
// (the same thing a person would do by hand). Loops get reported instead of hanging.
function stableSort<T>(items: T[], deps: (item: T) => T[]): { order: T[]; cycles: T[][] } {
  const index = new Map(items.map((it, i) => [it, i]))
  const order: T[] = []
  const done = new Set<T>()
  const path: T[] = []
  const cycles: T[][] = []
  const visit = (it: T) => {
    if (done.has(it)) return
    const at = path.indexOf(it)
    if (at >= 0) { cycles.push(path.slice(at)); return }
    path.push(it)
    const ds = deps(it).filter(d => index.has(d)).sort((x, y) => index.get(x)! - index.get(y)!)
    for (const d of ds) visit(d)
    path.pop()
    done.add(it)
    order.push(it)
  }
  items.forEach(visit)
  return { order, cycles }
}

function incompatibilities(mods: ModLike[], present: Set<string>): OrderProblem[] {
  const out: OrderProblem[] = []
  const seen = new Set<string>()
  for (const m of mods) {
    for (const id of enabledIds(m)) {
      for (const other of infoFor(m, id)?.incompatible || []) {
        const key = [id, other].sort().join('|')
        if (present.has(other) && other !== id && !seen.has(key)) {
          seen.add(key)
          out.push({ kind: 'incompatible', a: id, b: other })
        }
      }
    }
  }
  return out
}

// The Mods= order the server gets: the user's order, with required / loadModAfter /
// loadModBefore rules applied on top
export function orderModIds(mods: ModLike[]): { order: string[]; problems: OrderProblem[] } {
  const ids = [...new Set(mods.flatMap(enabledIds))]
  const present = new Set(ids)
  const { before } = collectRules(mods, present)
  const { order, cycles } = stableSort(ids, id => [...(before.get(id) || [])])
  const problems: OrderProblem[] = [
    ...cycles.map(ids => ({ kind: 'cycle' as const, ids })),
    ...incompatibilities(mods, present),
  ]
  return { order, problems }
}

export interface ItemMove { name: string; because: string }

// Same rules, but for the list the user sees (whole workshop items). Returns the sorted
// list plus a short note for each item that has to move
export function sortModList<T extends ModLike>(mods: T[]): { sorted: T[]; moves: ItemMove[] } {
  const present = new Set(mods.flatMap(enabledIds))
  const { before, reason } = collectRules(mods, present)
  const owner = new Map<string, T>()
  for (const m of mods) for (const id of enabledIds(m)) if (!owner.has(id)) owner.set(id, m)

  const why = new Map<T, string>()
  const { order } = stableSort(mods, m => {
    const out: T[] = []
    for (const id of enabledIds(m)) {
      for (const dep of before.get(id) || []) {
        const o = owner.get(dep)
        if (o && o !== m) {
          out.push(o)
          if (!why.has(m)) why.set(m, reason.get(`${dep}>${id}`) || '')
        }
      }
    }
    return out
  })

  // report the items whose position changed relative to the ones they depend on
  const moves: ItemMove[] = []
  const pos = new Map(mods.map((m, i) => [m, i]))
  order.forEach((m, i) => {
    if (i !== pos.get(m) && why.has(m) && !moves.some(x => x.name === m.name)) {
      // only items that actually broke a rule in the old order
      const broke = enabledIds(m).some(id => [...(before.get(id) || [])].some(dep => {
        const o = owner.get(dep)
        return o && o !== m && pos.get(o)! > pos.get(m)!
      }))
      if (broke) moves.push({ name: m.name, because: why.get(m)! })
    }
  })
  return { sorted: order, moves }
}

// True when the list as shown already follows every rule (so what you see is what loads)
export function isListSorted(mods: ModLike[]): boolean {
  const { sorted } = sortModList(mods)
  return sorted.every((m, i) => m === mods[i])
}

// ── Maps ──────────────────────────────────────────────────────────────────────

// Mod map folders in the order they'll be written: the saved order first, anything new
// after that in mod list order
export function orderedModMaps(mods: ModLike[], mapOrder?: string[]): string[] {
  const all = [...new Set(mods.flatMap(m => m.maps || []))]
  const saved = (mapOrder || []).filter(m => all.includes(m))
  return [...saved, ...all.filter(m => !saved.includes(m))]
}

// Map= wants the mod maps first (the first one wins where they overlap) and vanilla last
export function buildMapLine(mods: ModLike[], baseMap: string | undefined, mapOrder?: string[]): string {
  const base = (baseMap || 'Muldraugh, KY').split(';').map(s => s.trim())
  return [...new Set([...orderedModMaps(mods, mapOrder), ...base].filter(Boolean))].join(';')
}

// ── Build compatibility ───────────────────────────────────────────────────────

// Enabled mods that have no files for this build, so the game won't load them
export function wrongBuildMods(mods: ModLike[], build: Build): Array<{ name: string; id: string; builds: Build[] }> {
  const out: Array<{ name: string; id: string; builds: Build[] }> = []
  for (const m of mods) {
    for (const id of enabledIds(m)) {
      const builds = infoFor(m, id)?.builds
      if (builds && builds.length > 0 && !builds.includes(build)) out.push({ name: m.name, id, builds })
    }
  }
  return out
}

// ── Changes since the last start ──────────────────────────────────────────────

export interface ModSnapshot { workshopItems: string[]; mods: string[] }

export function diffSnapshot(prev: ModSnapshot | undefined, next: ModSnapshot) {
  if (!prev) return null
  const added = next.mods.filter(id => !prev.mods.includes(id))
  const removed = prev.mods.filter(id => !next.mods.includes(id))
  const common = next.mods.filter(id => prev.mods.includes(id))
  const prevCommon = prev.mods.filter(id => next.mods.includes(id))
  const reordered = common.some((id, i) => prevCommon[i] !== id)
  const itemsChanged = next.workshopItems.join(';') !== prev.workshopItems.join(';')
  if (!added.length && !removed.length && !reordered && !itemsChanged) return null
  return { added, removed, reordered }
}

// ── Workshop pages ────────────────────────────────────────────────────────────

// Workshop ids out of whatever the user pasted: links, bare ids, WorkshopItems= lines
export function parseWorkshopIds(text: string): string[] {
  const ids: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (/^WorkshopItems\s*=/i.test(t)) {
      for (const id of t.split('=').slice(1).join('=').split(';').map(s => s.trim())) if (/^\d+$/.test(id) && !ids.includes(id)) ids.push(id)
    }
  }
  if (ids.length > 0) return ids
  for (const m of text.matchAll(/(?:id=)?(\d{8,12})/g)) if (!ids.includes(m[1])) ids.push(m[1])
  return ids
}

// Walk collections (and collections inside collections), then required items of every mod,
// so one link turns into the full list of things to download. The fetchers are passed in
// so this works from any side and can be tested without Steam.
export interface PackFetchers {
  // child ids if the id is a collection, null if it's a normal item
  collectionChildren: (id: string) => Promise<string[] | null>
  // required item ids for a batch of mods, null for any it couldn't check
  requiredItems: (ids: string[]) => Promise<Record<string, string[] | null>>
}

export interface ResolvedPack {
  // mods in collection order, then dependencies that weren't in the pack
  mods: string[]
  // dependency id -> the mod(s) that needed it, for the ones the pack didn't include
  addedDeps: Record<string, string[]>
  collections: string[]
  // mods whose requirements couldn't be checked
  unchecked: string[]
}

export async function resolvePack(ids: string[], f: PackFetchers, opts: { deps?: boolean } = {}): Promise<ResolvedPack> {
  const mods: string[] = []
  const collections: string[] = []
  const seen = new Set<string>()
  const expand = async (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const children = await f.collectionChildren(id)
    if (children) {
      collections.push(id)
      for (const c of children) await expand(c)
    } else {
      mods.push(id)
    }
  }
  for (const id of ids) await expand(id)

  const addedDeps: Record<string, string[]> = {}
  const unchecked: string[] = []
  if (opts.deps !== false) {
    const inPack = new Set(mods)
    const checked = new Set<string>()
    let queue = [...mods]
    while (queue.length > 0) {
      const batch = queue.filter(id => !checked.has(id))
      batch.forEach(id => checked.add(id))
      const results = batch.length ? await f.requiredItems(batch) : {}
      const next: string[] = []
      batch.forEach(id => {
        const deps = results[id]
        if (!deps) unchecked.push(id)
        for (const dep of deps || []) {
          if (dep === id || inPack.has(dep)) continue
          ;(addedDeps[dep] ||= []).includes(id) || addedDeps[dep].push(id)
          if (!mods.includes(dep)) { mods.push(dep); next.push(dep) }
        }
      })
      queue = next
    }
  }
  return { mods, addedDeps, collections, unchecked }
}

// What a pack has that the list doesn't, and the other way round
export function comparePack(listIds: string[], packIds: string[]) {
  return {
    missing: packIds.filter(id => !listIds.includes(id)),
    extra: listIds.filter(id => !packIds.includes(id)),
    matching: listIds.filter(id => packIds.includes(id)),
  }
}
