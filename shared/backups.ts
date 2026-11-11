// World backups: what's in one (manifest.json), which ones to keep, and what going back to
// one would change. Pure logic, shared by the Electron side and the UI (and the tests).
// The files themselves are handled in electron/ipc/backupStore.ts.

import { isWorkshopId } from './modCore'
import { isBranchName, isBuildId, branchLabel, shortVersion, type SteamBranch } from './gameVersion'
import { PRIVATE_INI_KEYS } from './serverPack'

export const MANIFEST_FORMAT = 'knox-backup'
export const MANIFEST_VERSION = 1

export const BACKUP_REASONS = [
  'start', 'scheduled', 'manual', 'before-game-update', 'before-mod-update', 'before-rollback', 'before-restore', 'imported-legacy',
] as const
export type BackupReason = typeof BACKUP_REASONS[number]

export const isBackupReason = (r: unknown): r is BackupReason => BACKUP_REASONS.includes(r as BackupReason)

// The game that last ran the world in this backup. worldVersion comes from map_t.bin and is
// what really decides where a world can go: the game converts older worlds when it loads
// them (42.22 turns a 249 world into 251) and can't load newer ones
export interface BackupGame {
  buildId?: string
  branch?: string
  version?: string
  worldVersion?: number
}

export interface BackupMod {
  workshopId: string
  modId: string
  name?: string
  // the Workshop's time_updated of the copy the server had, when known
  timeUpdated?: number
}

export interface BackupManifest {
  format: typeof MANIFEST_FORMAT
  version: number
  // the backup's folder name
  id: string
  createdAt: string
  reason: BackupReason
  serverName: string
  game: BackupGame
  mods: BackupMod[]
  // <name>.ini, <name>_SandboxVars.lua... as they are in config/
  configFiles: string[]
  hasPlayersDb: boolean
  // every file in it added up, and how much of that this backup put on the disk itself
  // (the rest is shared with the backup before it)
  sizeBytes: number
  newBytes: number
  files: number
  // a running server: did it confirm saving before the copy
  savedFirst?: boolean
  // files the game kept writing to while they were copied (copied again, still moving)
  unsettledFiles?: number
  // the app's settings for the server at the time, to restore and to say what changed
  settings?: { ini: Record<string, unknown>; sandbox: Record<string, unknown>; mapOrder?: string[] }
  // older world-only backups from before manifests
  legacy?: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// A safe file or folder name for a backup id (it's a folder name inside the backups folder)
export function isBackupId(id: unknown): id is string {
  return typeof id === 'string' && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_[a-z0-9-]{1,40})?$/.test(id)
}

/** A manifest.json read from disk, checked, or null if it isn't one */
export function parseManifest(raw: unknown): BackupManifest | null {
  if (!isObj(raw) || raw.format !== MANIFEST_FORMAT || typeof raw.version !== 'number' || raw.version > MANIFEST_VERSION) return null
  if (!isBackupId(raw.id) || typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt)) || !isBackupReason(raw.reason)) return null
  const g = isObj(raw.game) ? raw.game : {}
  const game: BackupGame = {
    buildId: isBuildId(g.buildId) ? g.buildId : undefined,
    branch: isBranchName(g.branch) ? g.branch : undefined,
    version: typeof g.version === 'string' && /^[\w. -]{1,32}$/.test(g.version) ? g.version : undefined,
    worldVersion: Number.isInteger(g.worldVersion) && (g.worldVersion as number) > 0 ? g.worldVersion as number : undefined,
  }
  const mods: BackupMod[] = Array.isArray(raw.mods) ? raw.mods.filter(isObj).flatMap(m => {
    if (typeof m.modId !== 'string' || (m.workshopId !== '' && !isWorkshopId(m.workshopId))) return []
    return [{
      workshopId: m.workshopId as string, modId: m.modId,
      name: typeof m.name === 'string' ? m.name : undefined,
      timeUpdated: Number.isFinite(m.timeUpdated) ? m.timeUpdated as number : undefined,
    }]
  }) : []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const settings = isObj(raw.settings) && isObj(raw.settings.ini) && isObj(raw.settings.sandbox)
    ? { ini: raw.settings.ini, sandbox: raw.settings.sandbox, mapOrder: Array.isArray(raw.settings.mapOrder) ? raw.settings.mapOrder.filter((x): x is string => typeof x === 'string') : undefined }
    : undefined
  return {
    format: MANIFEST_FORMAT,
    version: raw.version,
    id: raw.id,
    createdAt: raw.createdAt,
    reason: raw.reason,
    serverName: typeof raw.serverName === 'string' ? raw.serverName : '',
    game,
    mods,
    // only plain file names, they get joined onto the Server folder on restore
    configFiles: Array.isArray(raw.configFiles) ? raw.configFiles.filter((f): f is string => typeof f === 'string' && /^[\w-]+(\.ini|_SandboxVars\.lua|_spawnregions\.lua|_spawnpoints\.lua)$/.test(f)) : [],
    hasPlayersDb: raw.hasPlayersDb === true,
    sizeBytes: num(raw.sizeBytes),
    newBytes: num(raw.newBytes),
    files: num(raw.files),
    savedFirst: typeof raw.savedFirst === 'boolean' ? raw.savedFirst : undefined,
    unsettledFiles: num(raw.unsettledFiles) || undefined,
    settings,
  }
}

// "2026-10-21_19-04-33" in local time, as the folder names have always been
export function backupStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export function stampDate(id: string): Date | null {
  const m = id.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

// what 1.5.1 and older put after the time in a backup's folder name ("" for a start backup)
const LEGACY_REASONS: Record<string, BackupReason> = { manual: 'manual', 'before-restore': 'before-restore' }

/** A backup from before manifests (world/ + players.db), described from its folder name */
export function legacyManifest(id: string, serverName: string, extra: Partial<Pick<BackupManifest, 'sizeBytes' | 'hasPlayersDb'>> & { worldVersion?: number } = {}): BackupManifest | null {
  const at = isBackupId(id) ? stampDate(id) : null
  if (!at) return null
  const label = id.match(/^[\d-]+_[\d-]+_(.+)$/)?.[1] || ''
  return {
    format: MANIFEST_FORMAT, version: MANIFEST_VERSION, id, createdAt: at.toISOString(),
    reason: LEGACY_REASONS[label] || 'imported-legacy', serverName, game: { worldVersion: extra.worldVersion }, mods: [], configFiles: [],
    hasPlayersDb: !!extra.hasPlayersDb, sizeBytes: extra.sizeBytes || 0, newBytes: extra.sizeBytes || 0, files: 0, legacy: true,
  }
}

// ── Which backups to keep ─────────────────────────────────────────────────────

export interface RetentionItem {
  id: string
  // ms
  createdAt: number
  reason: BackupReason
  // a world-only backup from 1.5.1 or older
  legacy?: boolean
}

export interface RetentionOptions {
  now: number
  // keep the backups under this many bytes on disk (0/undefined = no limit)
  capBytes?: number
  // bytes on disk the given backups take together (hard links are shared, so not a plain sum)
  usage?: (ids: string[]) => number
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// local hour / day / week (Monday) a time falls in. Hours sit inside days and days inside
// weeks, so the newest of a day is also the newest of its hour, and keeping "the newest in
// each" never throws away something a coarser tier wants later
function bucket(ms: number, size: 'hour' | 'day' | 'week'): string {
  const d = new Date(ms)
  if (size === 'hour') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
  if (size === 'day') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
  return `w${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`
}

/**
 * Tiered thinning: everything from the last 6 hours, then the newest per hour up to a day,
 * per day up to a week, per week up to 5 weeks, nothing older. Always kept: backups the user
 * made, the newest 3 from before a game update, the newest one from before a rollback (what
 * "Undo" goes back to) and the newest backup of all. Then, with a disk limit, the oldest of
 * the rest go until it fits.
 *
 * Backups from 1.5.1 and older are kept until the user deletes them: that version already
 * kept only the last few (5 by default, 20 at most), so they're a handful the user counted on
 * that were on the disk before. They don't count towards the disk limit either, or a big
 * old world would squeeze out every new backup
 */
export function planRetention(items: RetentionItem[], opts: RetentionOptions): { keep: string[]; remove: string[] } {
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt)
  const kept = new Set<string>()
  const protectedIds = new Set<string>()
  if (sorted[0]) protectedIds.add(sorted[0].id)
  for (const it of sorted) if (it.reason === 'manual' || it.legacy) protectedIds.add(it.id)
  sorted.filter(it => it.reason === 'before-game-update').slice(0, 3).forEach(it => protectedIds.add(it.id))
  const undo = sorted.find(it => it.reason === 'before-rollback' || it.reason === 'before-restore')
  if (undo) protectedIds.add(undo.id)

  const seen = { hour: new Set<string>(), day: new Set<string>(), week: new Set<string>() }
  for (const it of sorted) {
    const age = opts.now - it.createdAt
    if (age < 6 * HOUR) { kept.add(it.id); continue }
    const size = age < DAY ? 'hour' : age < 7 * DAY ? 'day' : age < 35 * DAY ? 'week' : null
    const key = size && bucket(it.createdAt, size)
    // a backup that's kept anyway counts as its hour/day/week's one
    if (protectedIds.has(it.id)) { kept.add(it.id); if (size && key) seen[size].add(key); continue }
    if (!size || !key) continue
    if (seen[size].has(key)) continue
    seen[size].add(key)
    kept.add(it.id)
  }

  if (opts.capBytes && opts.capBytes > 0 && opts.usage) {
    // oldest first, never the protected ones
    const removable = sorted.filter(it => kept.has(it.id) && !protectedIds.has(it.id)).reverse()
    const legacy = new Set(sorted.filter(it => it.legacy).map(it => it.id))
    for (const it of removable) {
      if (opts.usage([...kept].filter(id => !legacy.has(id))) <= opts.capBytes) break
      kept.delete(it.id)
    }
  }
  return { keep: sorted.filter(it => kept.has(it.id)).map(it => it.id), remove: sorted.filter(it => !kept.has(it.id)).map(it => it.id) }
}

// ── Quick picks in the rollback window ────────────────────────────────────────

export type QuickPickKey = 'before-update' | 'hour' | 'yesterday' | 'week'

export interface QuickPick {
  key: QuickPickKey
  label: string
  // the backup it lands on, if there is one
  id?: string
}

export interface PickableBackup {
  id: string
  createdAt: number
  reason: BackupReason
  game: BackupGame
}

/**
 * "About 1 hour ago" and friends: the newest backup at or before that time. "Before the last
 * game update" is the newest backup the game version before this one wrote: a different build
 * than the one installed now, and with a world version that build can still load
 */
export function quickPicks(backups: PickableBackup[], now: number, current: { buildId?: string | null; worldVersion?: number | null }): QuickPick[] {
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt)
  const atOrBefore = (t: number) => sorted.find(b => b.createdAt <= t)?.id
  const olderGame = (b: PickableBackup) => {
    if (current.worldVersion && b.game.worldVersion && b.game.worldVersion < current.worldVersion) return true
    return !!current.buildId && !!b.game.buildId && b.game.buildId !== current.buildId
      && !(current.worldVersion && b.game.worldVersion && b.game.worldVersion > current.worldVersion)
  }
  return [
    { key: 'before-update', label: 'Before the last game update', id: sorted.find(olderGame)?.id },
    { key: 'hour', label: 'About 1 hour ago', id: atOrBefore(now - HOUR) },
    { key: 'yesterday', label: 'Yesterday', id: atOrBefore(now - DAY) },
    { key: 'week', label: 'Last week', id: atOrBefore(now - 7 * DAY) },
  ]
}

// ── What going back would change ──────────────────────────────────────────────

export type GameCheck =
  // same game build, nothing to do
  | { kind: 'same' }
  // the backup's build is still on Steam: switch the server to it (or not, if the world still loads)
  | { kind: 'switch'; branch: string; label: string; version?: string; downloadBytes?: number; required: boolean }
  // can't be matched. canForce: the world can still go back with the current game (it gets converted)
  | { kind: 'blocked'; why: 'newer-world' | 'not-offered' | 'no-steam'; canForce: boolean; version?: string }
  // an old world-only backup: nothing recorded about the game
  | { kind: 'unknown'; newerWorld: boolean }

export interface CompatInput {
  backup: Pick<BackupManifest, 'game' | 'mods' | 'settings'>
  current: { buildId?: string | null; branch?: string; version?: string; worldVersion?: number | null }
  // the branches Steam offers now, null = couldn't ask
  branches: SteamBranch[] | null
  worldVersionOf?: (buildId: string) => number | undefined
  mods: BackupMod[]
  settings: { ini: Record<string, unknown>; sandbox: Record<string, unknown> }
}

export interface CompatResult {
  game: GameCheck
  mods: { added: string[]; removed: string[]; updated: string[] }
  settings: string[]
}

export function checkGame(input: Pick<CompatInput, 'backup' | 'current' | 'branches' | 'worldVersionOf'>): GameCheck {
  const { backup, current } = input
  const b = backup.game
  // the world version the game installed now saves, or failing that the live world's
  const nowWv = (current.buildId && input.worldVersionOf?.(current.buildId)) || current.worldVersion || undefined
  const newerWorld = !!b.worldVersion && !!nowWv && b.worldVersion > nowWv
  if (!b.buildId) return { kind: 'unknown', newerWorld }
  if (current.buildId && b.buildId === current.buildId) return { kind: 'same' }
  const version = shortVersion(b.version)
  if (!input.branches) return { kind: 'blocked', why: 'no-steam', canForce: !newerWorld, version }
  const offered = input.branches.filter(x => !x.pwdRequired && x.buildId === b.buildId)
  const pick = offered.find(x => x.name === b.branch) || offered.find(x => x.name === 'public') || offered.find(x => x.name !== 'pre-release') || offered[0]
  if (pick) {
    return { kind: 'switch', branch: pick.name, label: branchLabel(pick.name, pick.description), version, downloadBytes: pick.downloadBytes, required: newerWorld }
  }
  return newerWorld ? { kind: 'blocked', why: 'newer-world', canForce: false, version } : { kind: 'blocked', why: 'not-offered', canForce: true, version }
}

const modKey = (m: BackupMod) => m.workshopId || `local:${m.modId}`
const modName = (m: BackupMod) => m.name || m.modId || m.workshopId

export function modChanges(then: BackupMod[], now: BackupMod[]): CompatResult['mods'] {
  const before = new Map(then.map(m => [modKey(m), m]))
  const after = new Map(now.map(m => [modKey(m), m]))
  return {
    added: now.filter(m => !before.has(modKey(m))).map(modName),
    removed: then.filter(m => !after.has(modKey(m))).map(modName),
    updated: now.filter(m => {
      const was = before.get(modKey(m))
      return !!was && !!was.timeUpdated && !!m.timeUpdated && m.timeUpdated > was.timeUpdated
    }).map(modName),
  }
}

// settings the app sets from the server's own fields (ports, password) or that are secrets
const SKIP_INI = new Set([...PRIVATE_INI_KEYS, 'MaxPlayers', 'BackupsOnStart'])

function flatten(tree: Record<string, unknown>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree || {})) {
    if (isObj(v)) flatten(v, `${prefix}${k}.`, out)
    else out[`${prefix}${k}`] = String(v)
  }
  return out
}

/** Setting names that differ between the backup and now (server options first, then world settings) */
export function settingChanges(then: CompatInput['settings'] | undefined, now: CompatInput['settings']): string[] {
  if (!then) return []
  const diff = (a: Record<string, string>, b: Record<string, string>, skip?: Set<string>) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !skip?.has(k) && a[k] !== b[k]).sort()
  return [...diff(flatten(then.ini), flatten(now.ini), SKIP_INI), ...diff(flatten(then.sandbox), flatten(now.sandbox))]
}

export function checkCompat(input: CompatInput): CompatResult {
  return {
    game: checkGame(input),
    mods: modChanges(input.backup.mods, input.mods),
    settings: settingChanges(input.backup.settings, input.settings),
  }
}

// ── A world the installed game can't load ─────────────────────────────────────

/**
 * Before a start: a world saved by a newer game than the one installed now. That happens to
 * the other servers on one set of game files when one of them is rolled back to an older
 * version. The game can't load newer worlds, so this says what to do instead (null = fine)
 */
export function newerWorldProblem(o: {
  // map_t.bin of the live world, and the world version the installed build saves
  worldVersion?: number
  gameWorldVersion?: number
  // the game that last ran this world, and the one installed now ("42.22", "42.21")
  savedBy?: string
  installed?: string
  // the other server whose rollback switched these game files, if that's what happened
  rolledBackBy?: string
}): string | null {
  if (!o.worldVersion || !o.gameWorldVersion || o.worldVersion <= o.gameWorldVersion) return null
  const saved = o.savedBy ? `game ${o.savedBy}` : 'a newer game version'
  const now = o.installed ? ` ${o.installed}` : ' an older version'
  return `This world was saved by ${saved}, the server files are now on${now}${o.rolledBackBy ? ` (switched when you rolled back "${o.rolledBackBy}")` : ''}. `
    + 'The game can\'t load newer worlds. Switch the game version back in App settings, or roll this server back too.'
}

// ── Saying when ───────────────────────────────────────────────────────────────

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function ago(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} days ago`
  return `${Math.round(d / 7)} weeks ago`
}

// "today 3:12 PM · 52 min ago", "yesterday 9:03 PM · 22 hours ago", "Mon, Nov 2 9:03 PM · 8 days ago"
export function whenLabel(ms: number, now: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(now - DAY)
  const day = sameDay(d, new Date(now)) ? 'today' : sameDay(d, yesterday) ? 'yesterday'
    : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} ${time} · ${ago(ms, now)}`
}

// heading for one day in the full list
export function dayLabel(ms: number, now: number): string {
  const d = new Date(ms)
  if (sameDay(d, new Date(now))) return 'Today'
  if (sameDay(d, new Date(now - DAY))) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

export const REASON_LABELS: Record<BackupReason, string> = {
  'start': 'Server start',
  'scheduled': 'Automatic',
  'manual': 'Made by you',
  'before-game-update': 'Before a game update',
  'before-mod-update': 'Before a mod update',
  'before-rollback': 'Before going back',
  'before-restore': 'Before a restore',
  'imported-legacy': 'Older, world only',
}
