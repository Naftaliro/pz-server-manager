import { ipcMain, BrowserWindow } from 'electron'
import { mkdirSync } from 'fs'
import { open } from 'fs/promises'
import { getProfile, listProfiles, patchProfile, getServerName, type ServerProfile, type ModEntry } from './profileManager'
import {
  resolveDataPath, serverStatus, serverPlayers, serverLogPath, rconFor, stopServer, startServer, installedModTimes, emitConsoleOutput,
} from './serverManager'
import {
  installedBuild, steamBranches, cachedBranches, runServerInstall, onBeforeServerUpdate, sameInstall, checkServerUpdate, ensureSteamCmd, steamProgress,
} from './steamcmd'
import { loadSettings, steamcmdExe } from './appSettings'
import { learnedBuilds, learnBuild } from './gameBuilds'
import { isServerName } from './allowedPaths'
import { folderSize, forgetFolderSize } from './folderSize'
import {
  createBackup, listBackups, deleteBackup, restoreBackup, diskMap, usageOf, readWorldVersion, recoverInterrupted, worldDir, backupsDir,
  type ServerFiles, type StoredBackup, type DiskMap,
} from './backupStore'
import { planRetention, checkCompat, isBackupId, type BackupReason, type BackupGame, type BackupMod, type CompatResult, type GameCheck } from '../../shared/backups'
import { versionOf, versionFromLog, worldVersionOf, branchLabel, steamSwitchSteps, shortVersion, isBranchName } from '../../shared/gameVersion'
import { PRIVATE_INI_KEYS, SECRET_INI_KEYS } from '../../shared/serverPack'
import { oneAtATime, whileBusy, busyJobs, dismissJob, onBusyChange, startBlocker } from './busy'

// ---------------------------------------------------------------------------
// World backups for every server: before each start, every so often while it runs, by hand,
// and before anything that could hurt the world (a game update, a mod update restart, going
// back to an older backup). The files side is backupStore.ts, the rules shared/backups.ts.
// ---------------------------------------------------------------------------

let mainWindowRef: BrowserWindow | null = null

const DEFAULT_EVERY_MINUTES = 30

// the world is Saves\Multiplayer\<name>: an empty or odd name would make that the whole
// Multiplayer folder (and a restore would replace it), so it has to be a plain server name
function filesOf(profile: ServerProfile): ServerFiles {
  const serverName = getServerName(profile)
  if (!isServerName(serverName)) throw new Error(`"${profile.name}" doesn't have a server name the game can use. Give it one on its Settings tab.`)
  return { dataDir: resolveDataPath(profile.worldSavePath), serverName }
}

const say = (profileId: string, line: string) => emitConsoleOutput(profileId, `[Knox] ${line}`)

function emitChanged(profileId: string) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.webContents.send('backups:changed', profileId)
}

// when the last backup was made and the server last launched, to skip a second backup of a
// world nobody touched (a mod update restart backs up while it's down, then starts it)
const lastBackupAt = new Map<string, number>()
const lastLaunchAt = new Map<string, number>()

// ── What a backup records ─────────────────────────────────────────────────────

// the game that last ran the world. A start backup is from before the installed build runs
// it, so it's the one from last time, not necessarily the one installed now
function gameOf(profile: ServerProfile): BackupGame {
  const inst = installedBuild(profile.serverInstallPath)
  const last = profile.lastRunGame
  const buildId = last?.buildId || inst.buildId || undefined
  const branch = last?.buildId ? last.branch : inst.branch
  return { buildId, branch: isBranchName(branch) ? branch : undefined, version: versionOf(buildId, { learned: learnedBuilds(), branches: cachedBranches() }) || last?.version }
}

function modsOf(profile: ServerProfile): BackupMod[] {
  const times = installedModTimes(profile.serverInstallPath)
  return profile.mods.map(m => ({ workshopId: m.workshopId, modId: m.modId, name: m.name, timeUpdated: times.get(m.workshopId) }))
}

// the app's settings for the server, minus its secrets (the backup keeps the real .ini too)
function settingsOf(profile: ServerProfile) {
  const ini = Object.fromEntries(Object.entries(profile.iniSettings || {}).filter(([k]) => !SECRET_INI_KEYS.has(k) && k !== 'Password'))
  return { ini, sandbox: profile.sandboxSettings || {}, mapOrder: profile.mapOrder }
}

// ── Saving a running server first ─────────────────────────────────────────────

// RCON "save", then wait for the game's "Saving finish" in its log (it says how long it took
// right after). Same idea as the game's own backups taking the chunk lock: what gets copied is
// what the game itself just wrote, not something half done. false = it didn't confirm
async function saveFirst(profileId: string): Promise<boolean> {
  const log = serverLogPath(profileId)
  let from = 0
  try { if (log) from = (await open(log, 'r').then(async fh => { const s = await fh.stat(); await fh.close(); return s.size })) } catch { /* no log yet */ }
  try { await rconFor(profileId, 'save', 15000) } catch { return false }
  if (!log) return true
  // read on from where the last look stopped, a chunk at a time: a busy server can write more
  // than a chunk between two looks (mods warning about every item), and the line can be anywhere
  const CHUNK = 1024 * 1024
  const done = /Saving finish|Saving took/
  // the end of the last chunk, in case the line was cut in two
  let tail = ''
  for (let waited = 0; waited < 60000; waited += 500) {
    await new Promise(r => setTimeout(r, 500))
    try {
      const fh = await open(log, 'r')
      try {
        const { size } = await fh.stat()
        if (size < from) { from = 0; tail = '' }
        while (from < size) {
          const buf = Buffer.alloc(Math.min(size - from, CHUNK))
          const { bytesRead } = await fh.read(buf, 0, buf.length, from)
          if (!bytesRead) break
          from += bytesRead
          const text = tail + buf.subarray(0, bytesRead).toString('utf-8')
          if (done.test(text)) return true
          tail = text.slice(-200)
        }
      } finally { await fh.close() }
    } catch { /* try again */ }
  }
  return false
}

// ── Making backups ────────────────────────────────────────────────────────────

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, Math.round(bytes / 1024 / 1024 * 10) / 10)} MB`)

// the backup itself, not queued (callers are already in the queue)
async function backupNow(profileId: string, reason: BackupReason, opts: { prune?: boolean } = {}): Promise<StoredBackup | null> {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('That server is no longer in your list.')
  const files = filesOf(profile)
  const running = serverStatus(profileId) === 'running'
  let savedFirst: boolean | undefined
  if (running) {
    savedFirst = await saveFirst(profileId)
    if (!savedFirst) say(profileId, "⚠ The server didn't confirm it saved, backing up what's on disk.")
    // the build running now just wrote the world, so this is the world version it saves
    const wv = savedFirst ? await readWorldVersion(worldDir(files)) : undefined
    if (wv) learnBuild(installedBuild(profile.serverInstallPath).buildId, { worldVersion: wv })
  }
  const started = Date.now()
  const r = await createBackup(files, { reason, game: gameOf(profile), mods: modsOf(profile), settings: settingsOf(profile), savedFirst })
  if (!r) return null
  lastBackupAt.set(profileId, Date.now())
  say(profileId, `✓ Backed up the world (${mb(r.manifest.newBytes)} new, ${((Date.now() - started) / 1000).toFixed(1)} s)${r.linksUnsupported ? '. This drive can\'t share files between backups, so each one is a full copy.' : ''}`)
  if (opts.prune !== false) await prune(profileId).catch(e => say(profileId, `⚠ Couldn't tidy up old backups: ${e instanceof Error ? e.message : String(e)}`))
  usageCache.delete(profileId)
  emitChanged(profileId)
  return r.manifest
}

export function takeBackup(profileId: string, reason: BackupReason, opts: { prune?: boolean } = {}): Promise<StoredBackup | null> {
  return oneAtATime(profileId, () => backupNow(profileId, reason, opts))
}

// an old world-only backup is a full copy, measured once and remembered (it never changes)
const oldSize = (b: StoredBackup) => folderSize(b.dir, Infinity)

// thin out old backups (shared/backups planRetention), and keep under the disk limit if there is one
async function prune(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) return
  const list = await listBackups(filesOf(profile))
  const capBytes = profile.backupCapGb ? profile.backupCapGb * 1024 ** 3 : 0
  let usage: ((ids: string[]) => number) | undefined
  if (capBytes) {
    const maps = new Map<string, DiskMap | number>()
    for (const b of list) maps.set(b.id, b.legacy ? await oldSize(b) : await diskMap(b))
    const chrono = [...list].reverse()
    usage = (ids) => usageOf(chrono.filter(b => ids.includes(b.id)).map(b => maps.get(b.id)!))
  }
  const plan = planRetention(list.map(b => ({ id: b.id, createdAt: Date.parse(b.createdAt), reason: b.reason, legacy: !!b.legacy })), { now: Date.now(), capBytes, usage })
  for (const id of plan.remove) await deleteBackup(filesOf(profile), id)
}

const usageCache = new Map<string, Promise<number>>()
function backupUsage(profile: ServerProfile): Promise<number> {
  const hit = usageCache.get(profile.id)
  if (hit) return hit
  const run = listBackups(filesOf(profile)).then(list => {
    const chrono = [...list].reverse()
    return Promise.all(chrono.map(b => (b.legacy ? oldSize(b) : diskMap(b)))).then(usageOf)
  })
  usageCache.set(profile.id, run)
  run.catch(() => usageCache.delete(profile.id))
  return run
}

// ── Hooks from serverManager ──────────────────────────────────────────────────

/**
 * Right before a start: a backup of the world as the last run left it. If the game build
 * changed since then, this is the last chance to keep the world as the old version wrote it
 * (the new one converts it on load, for good), so that one is made even with backups off,
 * and when it fails the start stops there (a message to show, null = go ahead) unless
 * withoutBackup says the user wants it anyway. Any other backup failing is only a warning.
 */
export async function backupBeforeStart(profile: ServerProfile, opts: { withoutBackup?: boolean } = {}): Promise<string | null> {
  // in the queue: a rollback or restore still going finishes first (its own backup would
  // count as "fresh" below), and this never tidies up after one that's half way
  await oneAtATime(profile.id, async () => {
    try { for (const note of await recoverInterrupted(filesOf(profile))) say(profile.id, note) } catch { /* nothing to recover */ }
  })
  const inst = installedBuild(profile.serverInstallPath)
  const gameChanged = !!profile.lastRunGame?.buildId && !!inst.buildId && profile.lastRunGame.buildId !== inst.buildId
  const fresh = (lastBackupAt.get(profile.id) || 0) > (lastLaunchAt.get(profile.id) || 0) && Date.now() - (lastBackupAt.get(profile.id) || 0) < 10 * 60 * 1000
  if (!fresh && (profile.backupsEnabled !== false || gameChanged)) {
    try {
      if (gameChanged) say(profile.id, `The game server changed version since this world last ran, backing it up first.`)
      await takeBackup(profile.id, gameChanged ? 'before-game-update' : 'start')
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      say(profile.id, `⚠ Backup failed: ${why}`)
      if (gameChanged && !opts.withoutBackup) {
        const learned = learnedBuilds()
        const was = shortVersion(profile.lastRunGame?.version || versionOf(profile.lastRunGame?.buildId, { learned, branches: cachedBranches() }))
        const now = shortVersion(versionOf(inst.buildId, { learned, branches: cachedBranches() }))
        return `Couldn't back up the world before ${now ? `game ${now}` : 'the new game version'} runs it for the first time (${why.replace(/\.$/, '')}). `
          + `It converts the world${was ? ` from ${was}` : ''} for good, so without this backup it can't go back. Free up some space and start again, or start anyway without a backup.`
      }
    }
  }
  // from here on this build is the one that last touched the world
  lastLaunchAt.set(profile.id, Date.now())
  const version = versionOf(inst.buildId, { learned: learnedBuilds(), branches: cachedBranches() })
  if (inst.buildId) patchProfile(profile.id, { lastRunGame: { buildId: inst.buildId, branch: inst.branch, version } })
  return null
}

const timers = new Map<string, NodeJS.Timeout>()
const upAt = new Map<string, number>()
// someone was on since the last backup (with PauseEmpty the world doesn't change otherwise)
const played = new Map<string, boolean>()
const ticking = new Set<string>()

export function serverUp(profileId: string) {
  upAt.set(profileId, Date.now())
  played.set(profileId, false)
  void learnVersionFromLog(profileId)
  if (timers.has(profileId)) clearInterval(timers.get(profileId)!)
  timers.set(profileId, setInterval(() => { void tick(profileId) }, 60 * 1000))
}

export function serverDown(profileId: string) {
  const t = timers.get(profileId)
  if (t) clearInterval(t)
  timers.delete(profileId)
}

// "version=42.21.0 4a0e9546ec demo=false" near the top of the log
async function learnVersionFromLog(profileId: string) {
  const log = serverLogPath(profileId)
  const profile = getProfile(profileId)
  if (!log || !profile) return
  try {
    const fh = await open(log, 'r')
    const buf = Buffer.alloc(256 * 1024)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    await fh.close()
    const version = versionFromLog(buf.subarray(0, bytesRead).toString('utf-8'))
    const inst = installedBuild(profile.serverInstallPath)
    if (!version || !inst.buildId) return
    learnBuild(inst.buildId, { version })
    if (profile.lastRunGame?.buildId === inst.buildId && profile.lastRunGame.version !== version) {
      patchProfile(profileId, { lastRunGame: { ...profile.lastRunGame, version } })
    }
  } catch { /* no log */ }
}

async function tick(profileId: string) {
  if (serverStatus(profileId) !== 'running' || ticking.has(profileId)) return
  if (serverPlayers(profileId).length > 0) played.set(profileId, true)
  const profile = getProfile(profileId)
  if (!profile || profile.backupsEnabled === false) return
  const every = profile.backupEveryMinutes ?? DEFAULT_EVERY_MINUTES
  if (!every) return
  const since = Math.max(lastBackupAt.get(profileId) || 0, upAt.get(profileId) || 0)
  if (Date.now() - since < every * 60 * 1000) return
  // an empty server with PauseEmpty on (the default) is frozen, nothing to back up
  if (!played.get(profileId) && profile.iniSettings?.PauseEmpty !== false) return
  ticking.add(profileId)
  try {
    if (await takeBackup(profileId, 'scheduled')) played.set(profileId, false)
  } catch (e) {
    say(profileId, `⚠ Backup failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    ticking.delete(profileId)
  }
}

/**
 * A planned restart has the server down for a moment: a mod update gets a backup of the
 * world as the old mods left it, and with "Ask before updating the game server" off, a waiting
 * game update goes in (backed up first by the update itself). Crash restarts never update
 */
export async function whileDownForRestart(profileId: string, kind: 'mod-update' | 'daily') {
  if (kind === 'mod-update') {
    try { await takeBackup(profileId, 'before-mod-update') } catch (e) { say(profileId, `⚠ Backup failed: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const profile = getProfile(profileId)
  const settings = loadSettings()
  if (!profile || settings.askBeforeServerUpdate !== false || settings.steamManaged) return
  try {
    const upd = await checkServerUpdate(profile.serverInstallPath)
    if (!upd.updateAvailable) return
    if (serversOn(profile.serverInstallPath).some(p => p.id !== profileId && serverStatus(p.id) !== 'stopped')) return
    say(profileId, 'Updating the game server while it restarts...')
    const exe = await ensureSteamCmd(settings.steamcmdDir)
    const r = await runServerInstall(exe, profile.serverInstallPath, () => undefined, true, profile.buildVersion)
    say(profileId, r.success ? '✓ Game server updated.' : `⚠ The game server update didn't work: ${r.message}`)
  } catch (e) {
    say(profileId, `⚠ The game server update didn't work: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function serversOn(installDir: string): ServerProfile[] {
  return listProfiles().filter(p => sameInstall(p.serverInstallPath, installDir))
}

// servers whose backup the update hook leaves out (a rollback already made one)
const hookSkips = new Set<string>()

// before SteamCMD touches an install: every server on it is stopped and backed up, or it doesn't happen
function noneRunning(installDir: string) {
  const running = serversOn(installDir).filter(p => !hookSkips.has(p.id) && serverStatus(p.id) !== 'stopped')
  if (running.length) throw new Error(`Stop ${running.map(p => `"${p.name}"`).join(', ')} first, the game server can't update while ${running.length === 1 ? 'it runs' : 'they run'}.`)
}

async function backUpFor(servers: ServerProfile[]): Promise<string[]> {
  for (const p of servers) {
    try {
      await takeBackup(p.id, 'before-game-update')
    } catch (e) {
      throw new Error(`Couldn't back up "${p.name}" before the update, so nothing was updated: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return servers.map(p => p.id)
}

const updateGuard = {
  prepare: async (installDir: string) => {
    noneRunning(installDir)
    return backUpFor(serversOn(installDir).filter(p => !hookSkips.has(p.id)))
  },
  // it's SteamCMD's turn now: no server is allowed to start on it from the moment the update
  // was asked for (busy.ts), but one could have been picked back up, or a server added
  check: async (installDir: string, backedUp: string[]) => {
    noneRunning(installDir)
    await backUpFor(serversOn(installDir).filter(p => !hookSkips.has(p.id) && !backedUp.includes(p.id)))
    noneRunning(installDir)
  },
}

// Players get a warning in chat (like a planned restart) if anyone's on, then it stops
async function warnAndStop(profileId: string, minutes: number, why: string, progress: (s: string) => void) {
  if (serverStatus(profileId) === 'stopped') return
  const sayInGame = (msg: string) => rconFor(profileId, `servermsg "${msg}"`).catch(() => undefined)
  if (minutes > 0 && serverStatus(profileId) === 'running' && serverPlayers(profileId).length > 0) {
    await sayInGame(`Server going down in ${minutes} minute${minutes === 1 ? '' : 's'} ${why}`)
    say(profileId, `Stopping in ${minutes} minute${minutes === 1 ? '' : 's'} ${why} (players were told in chat).`)
    progress(`Players were told in chat. Stopping in ${minutes} minute${minutes === 1 ? '' : 's'}...`)
    await new Promise(r => setTimeout(r, minutes * 60 * 1000))
    await sayInGame('Going down now, see you in a bit!')
  }
  progress('Saving and stopping the server...')
  await stopServer(profileId)
}

// ── Going back to a backup ────────────────────────────────────────────────────

interface CheckInfo {
  compat: CompatResult
  current: { buildId: string | null; branch: string; version?: string; label: string; worldVersion?: number }
  legacy: boolean
}

async function compatFor(profile: ServerProfile, backup: StoredBackup): Promise<CheckInfo> {
  const inst = installedBuild(profile.serverInstallPath)
  const branches = await steamBranches()
  const learned = learnedBuilds()
  const liveWv = await readWorldVersion(worldDir(filesOf(profile)))
  const compat = checkCompat({
    backup,
    current: { buildId: inst.buildId, branch: inst.branch, worldVersion: liveWv },
    branches,
    worldVersionOf: id => worldVersionOf(id, learned),
    mods: modsOf(profile),
    settings: { ini: profile.iniSettings || {}, sandbox: profile.sandboxSettings || {} },
  })
  // old backups never recorded their mods or settings, so there's nothing to compare
  if (backup.legacy) compat.mods = { added: [], removed: [], updated: [] }
  return {
    compat,
    current: {
      buildId: inst.buildId, branch: inst.branch,
      version: shortVersion(versionOf(inst.buildId, { learned, branches })),
      label: branchLabel(inst.branch, branches?.find(b => b.name === inst.branch)?.description),
      worldVersion: (inst.buildId && worldVersionOf(inst.buildId, learned)) || liveWv,
    },
    legacy: !!backup.legacy,
  }
}

function blockedMessage(g: GameCheck): string {
  if (g.kind === 'unknown') return 'This backup is from a newer game version than the server has. The game can\'t load newer worlds.'
  if (g.kind !== 'blocked') return ''
  if (g.why === 'newer-world') return `This backup is from a newer game version${g.version ? ` (${g.version})` : ''} than the server has, and Steam doesn't offer that version anymore. The game can't load newer worlds.`
  if (g.why === 'no-steam') return "Couldn't ask Steam which game versions it has. Check your internet connection and try again."
  return `Steam doesn't offer the game version this backup was made with${g.version ? ` (${g.version})` : ''} anymore.`
}

export interface RollbackOptions {
  // switch the server install to this Steam branch first (from the check)
  switchBranch?: string | null
  // put the server's mod list back the way it was
  restoreMods?: boolean
  // put the server's settings back (its .ini, SandboxVars and spawn files, and the app's copy)
  restoreSettings?: boolean
  // go ahead even though the game version can't be matched (only for older worlds)
  force?: boolean
  // stop the server first if it's running, with a warning in chat this many minutes before
  stopFirst?: boolean
  warnMinutes?: number
}

export interface RollbackResult {
  success: boolean
  message: string
  beforeId?: string
  gameChanged?: { branch: string; label: string; version?: string }
  playerSteps?: string
  modsRestored?: boolean
  settingsRestored?: boolean
}

// keep what the app owns for this server now: ports, passwords, ids
function mergeIni(fromBackup: Record<string, unknown>, now: Record<string, unknown>): Record<string, unknown> {
  const keep = Object.fromEntries(Object.entries(now).filter(([k]) => PRIVATE_INI_KEYS.has(k) || SECRET_INI_KEYS.has(k)))
  return { ...fromBackup, ...keep }
}

function modsFromBackup(then: BackupMod[], now: ModEntry[]): ModEntry[] {
  return then.map(m => {
    const have = now.find(x => (m.workshopId ? x.workshopId === m.workshopId : !x.workshopId && x.modId === m.modId))
    return have ? { ...have, modId: m.modId } : { workshopId: m.workshopId, modId: m.modId, name: m.name || m.modId }
  })
}

// keepResult: the window shows what came of it, also when it was on another page meanwhile
// (busy.ts keeps it until the window says it's been seen)
export function rollback(profileId: string, id: string, opts: RollbackOptions, report: (s: string) => void = () => undefined, keepResult = false): Promise<RollbackResult> {
  // a server can't start from the moment this is asked for, also while it waits its turn
  return whileBusy({ profileId }, 'rollback', 'Getting started...', (busyProgress) => {
    const progress = (s: string) => { busyProgress(s); report(s) }
    return rollbackNow(profileId, id, opts, progress)
  }, { keepResult })
}

function rollbackNow(profileId: string, id: string, opts: RollbackOptions, progress: (s: string) => void): Promise<RollbackResult> {
  return oneAtATime(profileId, async (): Promise<RollbackResult> => {
    const fail = (message: string): RollbackResult => ({ success: false, message })
    const profile = getProfile(profileId)
    if (!profile) return fail('That server is no longer in your list.')
    if (!isBackupId(id)) return fail("That isn't a backup.")
    const files = filesOf(profile)
    const backup = (await listBackups(files)).find(b => b.id === id)
    if (!backup) return fail("That backup isn't there anymore.")

    // checked again here, whatever the window said: a newer world never goes onto an older game
    progress('Checking the game version...')
    const { compat } = await compatFor(profile, backup)
    const g = compat.game
    if (g.kind === 'blocked' && !(opts.force && g.canForce)) return fail(blockedMessage(g))
    if (g.kind === 'unknown' && g.newerWorld) return fail(blockedMessage(g))
    if (g.kind === 'switch' && g.required && opts.switchBranch !== g.branch) return fail(`This backup needs the game server on ${g.label}${g.version ? ` (${g.version})` : ''}: the game can't load newer worlds.`)
    if (opts.switchBranch && (g.kind !== 'switch' || opts.switchBranch !== g.branch)) return fail("That game version doesn't go with this backup.")

    const install = profile.serverInstallPath
    if (opts.switchBranch) {
      const others = serversOn(install).filter(p => p.id !== profileId && serverStatus(p.id) !== 'stopped')
      if (others.length) return fail(`Stop ${others.map(p => `"${p.name}"`).join(', ')} first: ${others.length === 1 ? 'it uses' : 'they use'} the same game server files, which have to switch version.`)
    }
    if (serverStatus(profileId) !== 'stopped') {
      if (!opts.stopFirst) return fail('Stop the server first.')
      await warnAndStop(profileId, Math.max(0, Math.min(10, opts.warnMinutes ?? 1)), 'to go back to a backup', progress)
    }

    progress('Backing up the world as it is now, so you can undo this...')
    let before: StoredBackup | null
    try {
      // not tidied up here, the backup being restored could be the one that would go
      before = await backupNow(profileId, 'before-rollback', { prune: false })
    } catch (e) {
      return fail(`Couldn't back up the world as it is now, so nothing was changed: ${e instanceof Error ? e.message : String(e)}`)
    }

    const branchBefore = installedBuild(install).branch
    const settings = loadSettings()
    let switched: RollbackResult['gameChanged']
    if (opts.switchBranch && g.kind === 'switch') {
      const to = g.branch === 'public' ? `the normal version${g.version ? ` (${g.version})` : ''}` : g.label
      progress(`Switching the game server to ${to}${g.downloadBytes ? ` (up to ${mb(g.downloadBytes)} to download)` : ''}. This can take a few minutes...`)
      hookSkips.add(profileId)
      try {
        const exe = await ensureSteamCmd(settings.steamcmdDir)
        const r = await runServerInstall(exe, install, (line) => progress(steamProgress(line, `Switching the game server to ${to}`)), true, profile.buildVersion, opts.switchBranch)
        if (!r.success) return fail(`Couldn't switch the game server to ${to}: ${r.message}. Nothing else was changed.`)
      } catch (e) {
        return fail(`Couldn't switch the game server to ${to}: ${e instanceof Error ? e.message : String(e)}. Nothing else was changed.`)
      } finally {
        hookSkips.delete(profileId)
      }
      switched = { branch: g.branch, label: g.label, version: g.version }
    }

    progress('Putting the world back...')
    const withSettings = !!opts.restoreSettings && !backup.legacy
    try {
      await restoreBackup(files, backup, { configs: withSettings })
    } catch (e) {
      // the world is still the one from before; the game server goes back to match it
      if (switched) {
        progress('Switching the game server back...')
        hookSkips.add(profileId)
        try { await runServerInstall(steamcmdExe(settings), install, () => undefined, true, profile.buildVersion, branchBefore) } catch { /* said below */ } finally { hookSkips.delete(profileId) }
      }
      return fail(`Couldn't put the world back (${e instanceof Error ? e.message : String(e)}). Your world is still the way it was.`)
    }
    lastBackupAt.delete(profileId)
    forgetFolderSize(worldDir(files))

    const latest = getProfile(profileId) || profile
    const restoreMods = !!opts.restoreMods && !backup.legacy && backup.mods.length > 0
    patchProfile(profileId, {
      lastRollback: { at: new Date().toISOString(), backupId: backup.id, beforeId: before?.id, branchBefore, branchAfter: switched?.branch },
      // the world is the backup's now, so is the game that last ran it
      lastRunGame: backup.game.buildId ? { buildId: backup.game.buildId, branch: backup.game.branch, version: backup.game.version } : latest.lastRunGame,
      ...(withSettings && backup.settings ? {
        iniSettings: mergeIni(backup.settings.ini, latest.iniSettings || {}),
        sandboxSettings: backup.settings.sandbox,
        mapOrder: backup.settings.mapOrder,
      } : {}),
      ...(restoreMods ? { mods: modsFromBackup(backup.mods, latest.mods) } : {}),
      updatedAt: new Date().toISOString(),
    })
    usageCache.delete(profileId)
    void prune(profileId).catch(() => undefined)
    emitChanged(profileId)
    say(profileId, `✓ Went back to the backup from ${new Date(backup.createdAt).toLocaleString()}.`)
    return {
      success: true,
      message: 'The world is back to how it was.',
      beforeId: before?.id,
      gameChanged: switched,
      playerSteps: switched ? steamSwitchSteps(switched.branch) : undefined,
      modsRestored: restoreMods,
      settingsRestored: withSettings,
    }
  })
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function summaryOf(b: StoredBackup) {
  const branches = cachedBranches()
  return {
    name: b.id,
    sizeMb: Math.round(b.sizeBytes / 1024 / 1024 * 10) / 10,
    createdAt: b.createdAt,
    reason: b.reason,
    legacy: !!b.legacy,
    game: {
      ...b.game,
      version: shortVersion(b.game.version || versionOf(b.game.buildId, { learned: learnedBuilds(), branches })),
      label: b.game.branch ? branchLabel(b.game.branch, branches?.find(x => x.name === b.game.branch)?.description) : undefined,
    },
    modCount: b.mods.length,
    configFiles: b.configFiles.length,
    savedFirst: b.savedFirst,
    unsettledFiles: b.unsettledFiles,
  }
}

export function setupBackupHandlers(mainWindow: BrowserWindow | null) {
  mainWindowRef = mainWindow
  onBeforeServerUpdate(updateGuard)

  // what's busy (busy.ts): Start buttons say why they're off, and a page that comes back to a
  // game update or rollback still going shows it instead of starting over
  const busyState = () => ({
    jobs: busyJobs(),
    blocked: Object.fromEntries(listProfiles().flatMap(p => { const why = startBlocker(p); return why ? [[p.id, why]] : [] })),
  })
  onBusyChange(() => { if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.webContents.send('busy:changed', busyState()) })
  ipcMain.handle('busy:list', async () => busyState())
  ipcMain.handle('busy:dismiss', async (_event, id: number) => { if (Number.isInteger(id)) dismissJob(id) })

  const send = (channel: string, ...args: unknown[]) => { if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.webContents.send(channel, ...args) }
  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) => async (_e: unknown, ...args: A) => {
    try { return { success: true, ...(await fn(...args)) } } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
  const profileOrThrow = (profileId: string) => {
    const p = getProfile(profileId)
    if (!p) throw new Error('That server is no longer in your list.')
    return p
  }

  ipcMain.handle('server:listBackups', async (_event, profileId: string) => {
    const profile = getProfile(profileId)
    if (!profile) return []
    const list = await listBackups(filesOf(profile))
    return Promise.all(list.map(async b => {
      const s = summaryOf(b)
      return b.legacy ? { ...s, sizeMb: Math.round((await oldSize(b)) / 1024 / 1024 * 10) / 10 } : s
    }))
  })

  ipcMain.handle('backups:summary', wrap(async (profileId: string) => {
    const profile = profileOrThrow(profileId)
    const files = filesOf(profile)
    const list = await listBackups(files)
    const inst = installedBuild(profile.serverInstallPath)
    const learned = learnedBuilds()
    const branches = cachedBranches()
    const lr = profile.lastRollback
    return {
      count: list.length,
      usageBytes: await backupUsage(profile),
      current: {
        buildId: inst.buildId, branch: inst.branch,
        version: shortVersion(versionOf(inst.buildId, { learned, branches })),
        label: branchLabel(inst.branch, branches?.find(b => b.name === inst.branch)?.description),
        worldVersion: (inst.buildId && worldVersionOf(inst.buildId, learned)) || await readWorldVersion(worldDir(files)),
      },
      // Undo is there while the backup it goes back to is
      lastRollback: lr && lr.beforeId && list.some(b => b.id === lr.beforeId) ? lr : undefined,
    }
  }))

  ipcMain.handle('server:backupNow', async (_event, profileId: string) => {
    try {
      const made = await takeBackup(profileId, 'manual')
      return made ? { success: true, message: 'Backup made.' } : { success: false, noWorld: true, message: 'No world to back up yet.' }
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('backups:check', wrap(async (profileId: string, id: string) => {
    const profile = profileOrThrow(profileId)
    const backup = (await listBackups(filesOf(profile))).find(b => b.id === id)
    if (!backup) throw new Error("That backup isn't there anymore.")
    const info = await compatFor(profile, backup)
    const others = serversOn(profile.serverInstallPath).filter(p => p.id !== profileId)
    // the world version the backup's game saves: another server's world newer than that
    // won't load on the switched game files
    const targetWv = (backup.game.buildId && worldVersionOf(backup.game.buildId, learnedBuilds())) || backup.game.worldVersion
    const tooNew = async (p: ServerProfile) => {
      try {
        const wv = await readWorldVersion(worldDir(filesOf(p)))
        return !!wv && !!targetWv && wv > targetWv
      } catch { return false }
    }
    return {
      ...info,
      backup: summaryOf(backup),
      running: serverStatus(profileId) !== 'stopped',
      players: serverPlayers(profileId).length,
      // other servers on the same install: a version switch changes them too
      sharedWith: await Promise.all(others.map(async p => ({ name: p.name, running: serverStatus(p.id) !== 'stopped', newerWorld: await tooNew(p) }))),
    }
  }))

  const progressFor = (profileId: string) => (text: string) => send('backups:progress', profileId, text)

  ipcMain.handle('backups:rollback', async (_event, profileId: string, id: string, opts: RollbackOptions) => {
    try {
      return await rollback(profileId, id, opts || {}, progressFor(profileId), true)
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  // put back the backup the last rollback made, game version included
  ipcMain.handle('backups:undoRollback', async (_event, profileId: string, opts: { stopFirst?: boolean; warnMinutes?: number } = {}) => {
    try {
      const profile = profileOrThrow(profileId)
      const lr = profile.lastRollback
      if (!lr?.beforeId) return { success: false, message: 'There\'s nothing to undo.' }
      const backup = (await listBackups(filesOf(profile))).find(b => b.id === lr.beforeId)
      if (!backup) return { success: false, message: 'The backup from before going back is gone, so this can\'t be undone.' }
      const { compat } = await compatFor(profile, backup)
      const switchBranch = compat.game.kind === 'switch' ? compat.game.branch : undefined
      const r = await rollback(profileId, lr.beforeId, {
        switchBranch, restoreMods: true, restoreSettings: true, force: compat.game.kind === 'blocked' && compat.game.canForce,
        stopFirst: opts.stopFirst, warnMinutes: opts.warnMinutes,
      }, progressFor(profileId), true)
      // undoing the undo isn't a thing people want, the next rollback starts fresh
      if (r.success) patchProfile(profileId, { lastRollback: undefined })
      return r
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  // the old name: a plain restore from the list, settings included
  ipcMain.handle('server:restoreBackup', async (_event, profileId: string, name: string) => {
    const r = await rollback(profileId, name, { restoreSettings: true }, progressFor(profileId))
    return { success: r.success, message: r.success ? 'Backup restored. Start the server to play it.' : r.message }
  })

  ipcMain.handle('backups:delete', wrap(async (profileId: string, id: string) => {
    const profile = profileOrThrow(profileId)
    await oneAtATime(profileId, () => deleteBackup(filesOf(profile), id))
    usageCache.delete(profileId)
    emitChanged(profileId)
    return {}
  }))

  ipcMain.handle('server:openBackups', async (_event, profileId: string) => {
    const profile = getProfile(profileId)
    if (!profile) return ''
    const dir = backupsDir(filesOf(profile))
    mkdirSync(dir, { recursive: true })
    return dir
  })

  // "Back up & update": stop the servers on the install (players warned), back each one up
  // (the update does that itself, see beforeServerUpdate), update, start again the ones that ran
  ipcMain.handle('backups:updateGame', async (_event, installDir: string, opts: { branch?: string; warnMinutes?: number } = {}) => {
    const servers = serversOn(installDir)
    if (!servers.length && !sameInstall(loadSettings().serverInstallPath, installDir)) return { success: false, message: "That isn't one of your server installs." }
    const progress = (text: string) => send('backups:updateProgress', installDir, text)
    const wasRunning = servers.filter(p => serverStatus(p.id) !== 'stopped')
    try {
      // no server on it starts from here (also not one that was off) until the update is done
      const r = await whileBusy({ installDir }, 'game-update', 'Getting ready...', async (busyProgress) => {
        const tell = (text: string) => { busyProgress(text); progress(text) }
        await Promise.all(wasRunning.map(p => warnAndStop(p.id, Math.max(0, Math.min(10, opts.warnMinutes ?? 1)), 'for a game update', tell)))
        tell('Backing up the worlds...')
        const exe = await ensureSteamCmd(loadSettings().steamcmdDir)
        return runServerInstall(exe, installDir, (line) => progress(steamProgress(line, 'Updating the game server')), true, servers[0]?.buildVersion || loadSettings().buildVersion, opts.branch || undefined)
      })
      if (r.success && wasRunning.length) {
        progress('Starting the servers again...')
        for (const p of wasRunning) await startServer(p.id)
      }
      return r
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
}

export { filesOf as backupFilesOf }
