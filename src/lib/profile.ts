import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'

export function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// The name PZ uses for the .ini / world folder. Locked at creation so renames are safe.
export function getServerName(profile: Pick<ServerProfile, 'name' | 'serverName'>): string {
  return profile.serverName || sanitizeServerName(profile.name)
}

export function dataPath(profile: Pick<ServerProfile, 'worldSavePath'>): string {
  return profile.worldSavePath?.replace(/\\$/, '') || '%USERPROFILE%\\Zomboid'
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// B42 wants Mods=\ModA;\ModB, B41 wants Mods=ModA;ModB (shared with the backend)
export { formatModIds } from '../../shared/modCore'

// Save a profile and refresh the store, returns the saved copy
export async function saveProfile(profile: Partial<ServerProfile> & { id?: string }): Promise<ServerProfile> {
  const saved = await window.electronAPI.profiles.save(profile)
  const profiles = await window.electronAPI.profiles.list()
  useAppStore.getState().setProfiles(profiles)
  return saved
}

// Patch the latest stored copy of a profile. Patches run one at a time so two quick
// changes (say, adding two mods back to back) can't both start from the same stale copy.
let patchQueue: Promise<unknown> = Promise.resolve()
export function patchProfile(id: string, patch: (p: ServerProfile) => Partial<ServerProfile>): Promise<ServerProfile | undefined> {
  const job = patchQueue.then(async () => {
    // start from what's on disk, not the copy in memory: the server side (mod scans,
    // RCON password, lastStarted) and hand edits to profiles.json write there too,
    // and saving the in-memory copy would quietly undo those
    const current = (await window.electronAPI.profiles.get(id)) || useAppStore.getState().profiles.find(p => p.id === id)
    if (!current) return undefined
    return saveProfile({ ...current, ...patch(current), updatedAt: new Date().toISOString() })
  })
  patchQueue = job.catch(() => undefined)
  return job
}

export const RECOMMENDED_MEMORY_MB = 8192
