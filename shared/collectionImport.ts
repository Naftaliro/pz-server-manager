// Importing a Workshop collection (a modpack link): what to add, what to leave out, and the
// one-line summary afterwards. Pure logic, the panel (ModPackPanel.tsx) and tests use it.

import { isWorkshopId, type Build } from './modCore'

export interface ImportItem {
  workshopId: string
  name: string
  tags?: string[]
  fileSize?: number
}

// The Workshop's own build tags. Only "Build 41 (or older) and not Build 42" counts as made for
// B41: lots of mods that work on B42 carry no build tag at all, so no tag says nothing
export function madeForOlderBuild(tags: string[] | undefined, build: Build): boolean {
  if (build !== 'b42' || !tags?.length) return false
  const t = tags.map(x => x.toLowerCase())
  return !t.includes('build 42') && t.some(x => /^build 4[01]$/.test(x))
}

export interface ImportPlan<T extends ImportItem = ImportItem> {
  // in collection order, dependencies the collection forgot after the mod that needs them
  add: T[]
  // left out because they're made for an older build (the user can still take them)
  olderBuild: T[]
  // the ones in add that the collection didn't list (another mod requires them)
  requiredAdded: string[]
  // already in the list
  already: string[]
  // Steam doesn't know them (removed or private), they'd never download
  unknown: string[]
}

export function planImport<T extends ImportItem>(opts: {
  // everything the pack resolved to, collection order first, then added requirements
  packIds: string[]
  details: T[]
  // workshop ids already in the server's list
  listIds: string[]
  // requirement id -> the mods that need it (only the ones the collection didn't have)
  addedDeps: Record<string, string[]>
  build: Build
  // take the older-build ones too
  includeOlder?: boolean
}): ImportPlan<T> {
  const byId = new Map(opts.details.filter(d => isWorkshopId(d.workshopId)).map(d => [d.workshopId, d]))
  const have = new Set(opts.listIds)
  const plan: ImportPlan<T> = { add: [], olderBuild: [], requiredAdded: [], already: [], unknown: [] }
  const seen = new Set<string>()
  // a requirement of something left out isn't needed either, unless something else kept needs it
  const skipped = new Set<string>()
  for (const id of opts.packIds) {
    if (!isWorkshopId(id) || seen.has(id)) continue
    seen.add(id)
    if (have.has(id)) { plan.already.push(id); continue }
    const d = byId.get(id)
    if (!d) { plan.unknown.push(id); continue }
    const neededBy = opts.addedDeps[id]
    if (neededBy && neededBy.every(n => skipped.has(n))) { skipped.add(id); continue }
    if (!opts.includeOlder && madeForOlderBuild(d.tags, opts.build) && !neededBy) {
      plan.olderBuild.push(d)
      skipped.add(id)
      continue
    }
    plan.add.push(d)
    if (neededBy) plan.requiredAdded.push(id)
  }
  return plan
}

// Required items from a Workshop item's page (the "Required items" box). Steam only hands these
// out through the keyed Web API otherwise. null = not a page we can read (error page, removed)
export function parseRequiredItems(html: string): string[] | null {
  // every item page has its title in this box, Steam's error page doesn't
  if (typeof html !== 'string' || !/class="workshopItemTitle"/.test(html)) return null
  const at = html.indexOf('id="RequiredItems"')
  if (at < 0) return []
  // the box ends where the next panel starts
  const rest = html.slice(at)
  const end = rest.search(/<!--|class="panel"|rightSectionTopTitle/)
  const box = end > 0 ? rest.slice(0, end) : rest.slice(0, 20000)
  const ids: string[] = []
  for (const m of box.matchAll(/filedetails\/\?id=(\d{1,20})/g)) if (isWorkshopId(m[1]) && !ids.includes(m[1])) ids.push(m[1])
  return ids
}

export interface ImportOutcome {
  added: number
  // the list got re-sorted after the downloads (moved = how many had to move)
  sorted: boolean
  moved: number
  olderSkipped: number
  requiredAdded: number
  // turned out to have no files for this build once downloaded
  wrongBuild: number
  // downloads with several mods inside and none picked yet
  needChoice: number
  failed: number
}

export function importSummary(o: ImportOutcome): string {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
  const parts = [o.added ? `added ${n(o.added, 'mod')}` : 'added no new mods']
  if (o.sorted) parts.push(o.moved ? 'sorted the load order' : 'checked the load order')
  if (o.olderSkipped) parts.push(`skipped ${o.olderSkipped} made for Build 41`)
  if (o.requiredAdded) parts.push(`added ${n(o.requiredAdded, 'required mod')}`)
  let s = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  s = s.charAt(0).toUpperCase() + s.slice(1) + '.'
  const after: string[] = []
  if (o.failed) after.push(`${n(o.failed, 'mod')} didn't download, retry ${o.failed === 1 ? 'it' : 'them'} on the Mods tab`)
  if (o.wrongBuild) after.push(`${n(o.wrongBuild, 'mod')} only ${o.wrongBuild === 1 ? 'has' : 'have'} files for another game version`)
  if (o.needChoice) after.push(`${n(o.needChoice, 'download')} ${o.needChoice === 1 ? 'has' : 'have'} several mods inside, pick which to turn on`)
  return after.length ? `${s} ${after.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join('. ')}.` : s
}
