import { ipcMain, app, dialog, shell, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { createHash, randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { steamLibraries } from './steamcmd'
import { scanModFolders, PZ_APP_ID } from './modManager'
import { getProfile } from './profileManager'
import { resolveDataPath } from './serverManager'
import { loadSettings, saveSettings } from './appSettings'
import { enabledIds, orderModIds, orderedModMaps } from '../../shared/modCore'
import {
  PACK_FORMAT, PACK_VERSION, PACK_MAX_BYTES, validatePack, checkPack, modFingerprint, launchUrl, isSafeRelPath, accountProblem, parseJoinAddress,
  type ServerPack, type PackLocalMod, type ClientState,
} from '../../shared/serverPack'

// ---------------------------------------------------------------------------
// Play mode: the player's side. Find the game, compare the player's mods with a
// host's server pack, copy the host's fix mods in, and launch the game.
// ---------------------------------------------------------------------------

const GAME_EXE = 'ProjectZomboid64.exe'

// Where Project Zomboid (the game, not the server) is installed. The user's pick
// wins, then Steam's own library list, which covers every drive Steam uses
export async function findGame(): Promise<{ gameDir: string; library: string } | null> {
  const picked = loadSettings().gameDir
  if (picked && existsSync(join(picked, GAME_EXE))) return { gameDir: picked, library: libraryOf(picked) }
  for (const lib of await steamLibraries()) {
    const dir = join(lib, 'steamapps', 'common', 'ProjectZomboid')
    if (existsSync(join(dir, GAME_EXE))) return { gameDir: dir, library: lib }
  }
  return null
}

// <library>\steamapps\common\ProjectZomboid -> <library>
function libraryOf(gameDir: string): string {
  return dirname(dirname(dirname(gameDir)))
}

// "Find it" button: Steam's list missed it (moved library, Steam not set up yet), so look
// in the usual Steam folders on each drive. Only these folders, not a whole-disk search
export function searchDrives(): string[] {
  const spots = ['SteamLibrary', 'Steam', 'Program Files (x86)\\Steam', 'Program Files\\Steam', 'Games\\Steam', 'Games\\SteamLibrary', 'Games']
  const found: string[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    if (!existsSync(root)) continue
    for (const spot of spots) {
      const dir = join(root, spot, 'steamapps', 'common', 'ProjectZomboid')
      if (existsSync(join(dir, GAME_EXE)) && !found.includes(dir)) found.push(dir)
    }
  }
  return found
}

// The player's Zomboid folder (saves, settings, local mods)
function clientDataDir(): string {
  return resolveDataPath(loadSettings().clientDataDir)
}

function workshopDir(library: string): string {
  return join(library, 'steamapps', 'workshop', 'content', PZ_APP_ID)
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// All files under a folder, paths relative to it with forward slashes
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base))
    else if (name !== '.gitkeep') out.push(p.slice(base.length + 1).replace(/\\/g, '/'))
  }
  return out
}

function folderFingerprint(dir: string): string {
  return modFingerprint(listFiles(dir).map(path => ({ path, sha256: sha256(readFileSync(join(dir, path))) })))
}

export async function clientState(): Promise<ClientState & { gameDir?: string; dataDir: string }> {
  const game = await findGame()
  const dataDir = clientDataDir()
  const modsDir = join(dataDir, 'mods')
  const localMods: Record<string, string> = {}
  if (existsSync(modsDir)) {
    for (const name of readdirSync(modsDir)) {
      const p = join(modsDir, name)
      try { if (statSync(p).isDirectory()) localMods[name.toLowerCase()] = folderFingerprint(p) } catch { /* unreadable, skip */ }
    }
  }
  let workshopDownloaded: string[] = []
  if (game) {
    try { workshopDownloaded = readdirSync(workshopDir(game.library)).filter(n => /^\d+$/.test(n)) } catch { /* nothing downloaded */ }
  }
  return { gameFound: !!game, gameDir: game?.gameDir, dataDir, workshopDownloaded, localMods }
}

// ── Host side: build a pack from a server profile ─────────────────────────────

export async function buildPack(profileId: string, opts: { address?: string; includePassword?: boolean }): Promise<ServerPack> {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('That server profile no longer exists.')
  // a playit address comes with its own port, which isn't the server's port
  const joinAt = parseJoinAddress(opts.address, profile.port)
  if (joinAt.error) throw new Error(joinAt.error)
  const dataMods = join(resolveDataPath(profile.worldSavePath), 'mods')
  const folders = await scanModFolders(dataMods)

  const localMods: PackLocalMod[] = []
  for (const m of profile.mods.filter(m => !m.workshopId)) {
    for (const id of enabledIds(m)) {
      const hit = folders.find(f => f.info.id === id)
      if (!hit) throw new Error(`The fix mod "${m.name}" isn't in ${dataMods}, so it can't go in the pack.`)
      if (localMods.some(l => l.folder === hit.folder)) continue
      const dir = join(dataMods, hit.folder)
      const files = listFiles(dir).map(path => {
        const buf = readFileSync(join(dir, path))
        return { path, sha256: sha256(buf), data: buf.toString('base64') }
      })
      localMods.push({ id, name: m.name, folder: hit.folder, files })
    }
  }

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    createdAt: new Date().toISOString(),
    server: {
      name: profile.name,
      address: joinAt.address,
      port: joinAt.port,
      password: opts.includePassword && profile.serverPassword ? profile.serverPassword : undefined,
      build: profile.buildVersion === 'b41' ? 'b41' : 'b42',
    },
    workshopItems: profile.mods.filter(m => m.workshopId).map(m => ({ workshopId: m.workshopId, name: m.name })),
    mods: orderModIds(profile.mods).order,
    maps: orderedModMaps(profile.mods, profile.mapOrder),
    localMods,
  }
}

// ── Player side: saved servers ────────────────────────────────────────────────

// account = the name the player picked for this server. PZ makes the account the first
// time someone logs in with a new name, but its login box never says so
interface SavedServer { id: string; addedAt: string; pack: ServerPack; account?: { username: string; password: string } }

function savedPath(): string {
  return join(app.getPath('userData'), 'play-servers.json')
}

function loadSaved(): SavedServer[] {
  try { return JSON.parse(readFileSync(savedPath(), 'utf-8')) } catch { return [] }
}

function storeSaved(list: SavedServer[]) {
  mkdirSync(dirname(savedPath()), { recursive: true })
  writeFileSync(savedPath(), JSON.stringify(list, null, 2), 'utf-8')
}

export function readPackFile(path: string): ServerPack {
  if (statSync(path).size > PACK_MAX_BYTES) throw new Error("That file is too big to be a server pack.")
  let raw: unknown
  try { raw = JSON.parse(readFileSync(path, 'utf-8')) } catch { throw new Error("That file isn't a server pack.") }
  const errors = validatePack(raw)
  if (errors.length) throw new Error(errors.join(' '))
  return raw as ServerPack
}

// Same server again (same name + address + port) replaces the old copy, so a newer
// pack from the host just updates it
function addSaved(pack: ServerPack): SavedServer {
  const list = loadSaved()
  const same = (s: SavedServer) => s.pack.server.name === pack.server.name && s.pack.server.address === pack.server.address && s.pack.server.port === pack.server.port
  const existing = list.find(same)
  const entry: SavedServer = { id: existing?.id || randomUUID(), addedAt: new Date().toISOString(), pack, account: existing?.account }
  storeSaved([entry, ...list.filter(s => !same(s))])
  return entry
}

// Copy the host's fix mods into <Zomboid>\mods. Anything already there under the same
// folder name gets moved aside (not deleted) first, in case it was the player's own
export async function installFixes(id: string): Promise<{ installed: string[]; backedUp: string[] }> {
  const saved = loadSaved().find(s => s.id === id)
  if (!saved) throw new Error('That server is no longer in your list.')
  const errors = validatePack(saved.pack)
  if (errors.length) throw new Error(errors.join(' '))

  const state = await clientState()
  const check = checkPack(saved.pack, state)
  const modsDir = join(state.dataDir, 'mods')
  const backupRoot = join(state.dataDir, 'pzm-mod-backups')
  mkdirSync(modsDir, { recursive: true })
  const installed: string[] = []
  const backedUp: string[] = []

  for (const mod of saved.pack.localMods) {
    if (check.localMods.find(m => m.folder === mod.folder)?.status === 'ok') continue
    // decode and check every file before touching anything on disk
    const files = mod.files.map(f => {
      if (!isSafeRelPath(f.path)) throw new Error(`"${mod.name}" has a file that isn't allowed.`)
      const buf = Buffer.from(f.data, 'base64')
      if (sha256(buf) !== f.sha256) throw new Error(`"${mod.name}" is damaged in this pack (a file doesn't match). Ask the host for a new pack.`)
      return { path: f.path, buf }
    })
    const target = join(modsDir, mod.folder)
    if (existsSync(target)) {
      mkdirSync(backupRoot, { recursive: true })
      const aside = join(backupRoot, `${mod.folder}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      renameSync(target, aside)
      backedUp.push(aside)
    }
    for (const f of files) {
      const dest = join(target, ...f.path.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, f.buf)
    }
    // B42 wants a common folder even when it's empty
    mkdirSync(join(target, 'common'), { recursive: true })
    installed.push(mod.name)
  }
  return { installed, backedUp }
}

export function setupClientHandlers(mainWindow: BrowserWindow | null) {
  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) => async (_e: unknown, ...args: A) => {
    try { return { success: true, ...(await fn(...args)) } } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  ipcMain.handle('client:state', wrap(async () => clientState()))
  ipcMain.handle('client:searchDrives', wrap(() => ({ found: searchDrives() })))

  // the player picked the game folder themselves (or a "Find it" result)
  ipcMain.handle('client:useGameDir', wrap((dir: string) => {
    const gameDir = existsSync(join(dir, GAME_EXE)) ? dir : join(dir, 'steamapps', 'common', 'ProjectZomboid')
    if (!existsSync(join(gameDir, GAME_EXE))) throw new Error(`Project Zomboid isn't in that folder (looked for ${GAME_EXE}).`)
    saveSettings({ gameDir })
    return { gameDir }
  }))

  ipcMain.handle('client:listServers', wrap(async () => {
    const state = await clientState()
    return { servers: loadSaved().map(s => ({ ...s, check: checkPack(s.pack, state) })), gameDir: state.gameDir }
  }))

  ipcMain.handle('client:openPack', wrap(async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open a server pack',
      filters: [{ name: 'Server pack', extensions: ['pzpack'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths[0]) return { cancelled: true }
    return { saved: addSaved(readPackFile(res.filePaths[0])) }
  }))

  ipcMain.handle('client:setAccount', wrap((id: string, account: { username: string; password: string }) => {
    const problem = accountProblem(account)
    if (problem) throw new Error(problem)
    const list = loadSaved()
    const s = list.find(x => x.id === id)
    if (!s) throw new Error('That server is no longer in your list.')
    s.account = { username: account.username.trim(), password: account.password }
    storeSaved(list)
    return {}
  }))

  ipcMain.handle('client:removeServer', wrap((id: string) => {
    storeSaved(loadSaved().filter(s => s.id !== id))
    return {}
  }))

  ipcMain.handle('client:installFixes', wrap((id: string) => installFixes(id)))

  ipcMain.handle('client:launch', wrap(async (id?: string, join?: boolean) => {
    const pack = id ? loadSaved().find(s => s.id === id)?.pack : undefined
    await shell.openExternal(launchUrl(join && pack ? pack.server : undefined))
    return {}
  }))

  // host side
  ipcMain.handle('client:exportPack', wrap(async (profileId: string, opts: { address?: string; includePassword?: boolean }) => {
    const pack = await buildPack(profileId, opts)
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save server pack',
      defaultPath: `${pack.server.name.replace(/[^\w-]+/g, '_')}.pzpack`,
      filters: [{ name: 'Server pack', extensions: ['pzpack'] }],
    })
    if (res.canceled || !res.filePath) return { cancelled: true }
    writeFileSync(res.filePath, JSON.stringify(pack), 'utf-8')
    return { path: res.filePath, fixMods: pack.localMods.length, workshopItems: pack.workshopItems.length }
  }))
}
