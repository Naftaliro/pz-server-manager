import { useAppStore } from '../store/useAppStore'
import type { ModEntry, ModFileEntry, ServerProfile } from '../store/useAppStore'
import { patchProfile } from './profile'

export function enabledIds(mod: ModEntry): string[] {
  return (mod.modId || '').split(';').map(s => s.trim().replace(/^\\+/, '')).filter(Boolean)
}

// Placeholder = we haven't read the real id from the files yet
export function hasRealModId(mod: ModEntry): boolean {
  return !!mod.modId && mod.modId !== mod.workshopId
}

// Local mods live in <Zomboid>\mods instead of the workshop, so they have no workshop id
export function isLocalMod(mod: ModEntry): boolean {
  return !mod.workshopId
}

// Stable key for a list entry. Workshop id for workshop mods; local mods all share
// workshopId '', so they go by their mod id instead
export function modKey(mod: ModEntry): string {
  return mod.workshopId || `local:${mod.modId}`
}

// Set which of the item's mods are on, and keep requires/maps in sync with that
export function withEnabled(mod: ModEntry, ids: string[]): ModEntry {
  const on = mod.infos?.filter(i => ids.includes(i.id)) || []
  return {
    ...mod,
    modId: ids.join(';') || mod.workshopId,
    requires: [...new Set(on.flatMap(i => i.requires))],
    maps: [...new Set(on.flatMap(i => i.maps))],
  }
}

// Apply what we found in the downloaded files to a mod entry
export function applyInfos(mod: ModEntry, infos: ModFileEntry[]): ModEntry {
  const next: ModEntry = { ...mod, infos }
  const known = new Set(infos.map(i => i.id))
  const current = enabledIds(mod).filter(id => known.has(id))
  if (current.length > 0) return withEnabled(next, current)
  // only one mod inside? just turn it on. several? leave it for the user to pick
  if (infos.length === 1) return withEnabled(next, [infos[0].id])
  return { ...next, modId: mod.workshopId, requires: [], maps: [] }
}

export function needsChoice(mod: ModEntry): boolean {
  return (mod.infos?.length || 0) > 1 && !hasRealModId(mod)
}

// Mod ids that something in the list requires but nothing in the list provides
export function missingRequirements(profile: ServerProfile): Array<{ id: string; neededBy: string }> {
  const provided = new Set(profile.mods.flatMap(m => (m.infos?.map(i => i.id) || []).concat(enabledIds(m))))
  const missing: Array<{ id: string; neededBy: string }> = []
  for (const m of profile.mods) {
    for (const dep of m.requires || []) {
      if (!provided.has(dep) && !missing.some(x => x.id === dep)) missing.push({ id: dep, neededBy: m.name })
    }
  }
  return missing
}

// Required ids that are in the list but switched off inside a multi-mod item
export function disabledRequirements(profile: ServerProfile): Array<{ id: string; workshopId: string }> {
  const enabled = new Set(profile.mods.flatMap(enabledIds))
  const out: Array<{ id: string; workshopId: string }> = []
  for (const m of profile.mods) {
    for (const dep of m.requires || []) {
      if (enabled.has(dep)) continue
      const owner = profile.mods.find(o => o.infos?.some(i => i.id === dep))
      if (owner && !out.some(x => x.id === dep)) out.push({ id: dep, workshopId: owner.workshopId })
    }
  }
  return out
}

export function toModEntry(d: WorkshopModDetails): ModEntry {
  return {
    workshopId: d.workshopId,
    modId: d.workshopId,
    name: d.name,
    description: d.description,
    thumbnailUrl: d.thumbnailUrl,
    fileSize: d.fileSize,
  }
}

// Add workshop items to a profile (skipping ones already there), then download + scan them
export async function addModsToProfile(profileId: string, items: WorkshopModDetails[]): Promise<number> {
  const profile = useAppStore.getState().profiles.find(p => p.id === profileId)
  if (!profile) return 0
  const existing = new Set(profile.mods.map(m => m.workshopId))
  const fresh = items.filter(d => !existing.has(d.workshopId))
  if (fresh.length === 0) return 0
  // check again inside the patch, a quick double click could have added it already
  await patchProfile(profileId, p => ({
    mods: [...p.mods, ...fresh.filter(d => !p.mods.some(m => m.workshopId === d.workshopId)).map(toModEntry)],
  }))
  void downloadAndScan(profileId, fresh.map(d => d.workshopId))
  return fresh.length
}

// Read mod.info for whatever is already on disk and update the profile
export async function scanMods(profileId: string, workshopIds?: string[]): Promise<void> {
  const profile = useAppStore.getState().profiles.find(p => p.id === profileId)
  if (!profile) return
  const ids = workshopIds || profile.mods.map(m => m.workshopId).filter(Boolean)
  const result = await window.electronAPI.mods.scanInstalled(profile.serverInstallPath, ids)
  if (!result.success) return
  const found = result.found
  if (Object.keys(found).length === 0) return
  await patchProfile(profileId, p => ({
    mods: p.mods.map(m => (found[m.workshopId]?.length ? applyInfos(m, found[m.workshopId]) : m)),
  }))
}

let downloading: Promise<unknown> = Promise.resolve()

// Download through SteamCMD into the server folder, then read the real ids out of the files.
// Calls are chained so two quick adds don't fight over steamcmd.
export function downloadAndScan(profileId: string, workshopIds: string[]): Promise<void> {
  const { setModDownload } = useAppStore.getState()
  workshopIds.forEach(id => setModDownload(id, { state: 'queued' }))

  const job = downloading.then(async () => {
    const result = await window.electronAPI.steamcmd.downloadMods(workshopIds, (e) => {
      setModDownload(e.workshopId, { state: e.state, bytes: e.bytes, message: e.message })
    })
    if (!result.success && result.message) {
      workshopIds.forEach(id => setModDownload(id, { state: 'failed', message: result.message }))
    }
    await scanMods(profileId, workshopIds)
  })
  downloading = job.catch(() => undefined)
  return job
}
