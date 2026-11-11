import { ipcMain } from 'electron'
import { join, dirname, win32 } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { spawn, execFile } from 'child_process'
import https from 'https'
import fs from 'fs'
import { folderSize } from './folderSize'
import { loadSettings, saveSettings, steamcmdExe } from './appSettings'
import { PZ_APP_ID } from './modManager'
import { backupAfterDownload } from './modBackups'
import { listProfiles } from './profileManager'
import { isWorkshopId } from '../../shared/modCore'
import {
  branchArgs, branchFor, parseBranches, serverVersionState, versionOf, branchLabel, isBranchName, buildOfBranch,
  type SteamBranch,
} from '../../shared/gameVersion'
import { learnedBuilds } from './gameBuilds'
import { expandArchiveScript } from './winScripts'
import { redirectTarget } from './httpsOnly'
import { followFile } from './logTail'
import { whileBusy } from './busy'

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
const PZ_SERVER_APP_ID = '380870'

// What goes on SteamCMD's command line. SteamCMD runs without a shell (so nothing in here can
// start another program), and every +command and its arguments are separate items: SteamCMD
// puts them back together itself, and a path with spaces goes in as one item.
// The branch is always there, public too (see shared/gameVersion)
export function installArgs(installDir: string, branch = 'public'): string[] {
  return [
    '+force_install_dir', checkedDir(installDir),
    '+login', 'anonymous',
    '+app_update', PZ_SERVER_APP_ID, ...branchArgs(branch), 'validate',
    '+quit',
  ]
}

// A branch the user picked for an install that the next install/update switches it to,
// kept per install folder. Once that's done it's forgotten: the install's own branch (in its
// manifest) is what updates keep, also when someone switched it outside the app
const installKey = (dir: string) => win32.resolve(dir).toLowerCase()

export function chosenBranch(installDir: string): string | undefined {
  const b = loadSettings().serverBranches?.[installKey(installDir)]
  return isBranchName(b) ? b : undefined
}

export function chooseBranch(installDir: string, branch: string) {
  if (!isBranchName(branch)) throw new Error(`"${String(branch)}" isn't a Steam branch.`)
  saveSettings({ serverBranches: { ...loadSettings().serverBranches, [installKey(installDir)]: branch } })
}

function clearBranchChoice(installDir: string) {
  const all = { ...loadSettings().serverBranches }
  if (!(installKey(installDir) in all)) return
  delete all[installKey(installDir)]
  saveSettings({ serverBranches: all })
}

// Every server install the app knows about. Things the window asks SteamCMD to do happen
// in one of these, nowhere else
export function knownInstalls(): string[] {
  const all = [loadSettings().serverInstallPath, ...listProfiles().map(p => p.serverInstallPath)].filter(Boolean)
  return [...new Map(all.map(d => [installKey(d), d])).values()]
}

export function sameInstall(a: string, b: string): boolean {
  return !!a && !!b && installKey(a) === installKey(b)
}

function knownInstall(dir: unknown): string {
  const hit = typeof dir === 'string' ? knownInstalls().find(d => sameInstall(d, dir)) : undefined
  if (!hit) throw new Error("That isn't one of your server installs.")
  return hit
}

// Before an update or branch switch touches an install (backups.ts makes a backup of every
// server on it). Throwing stops the update.
//  prepare: when it's asked for: every server on it is stopped and backed up. Says which got a backup
//  check:   once it's SteamCMD's turn (it can wait behind mod downloads): still nothing running
//           on it, and every server on it now has its backup (one added meanwhile gets it here)
export interface UpdateGuard {
  prepare: (installDir: string) => Promise<string[]>
  check: (installDir: string, backedUp: string[]) => Promise<void>
}
let updateGuard: UpdateGuard | null = null
export function onBeforeServerUpdate(guard: UpdateGuard) {
  updateGuard = guard
}

export function workshopDownloadArgs(installDir: string, workshopIds: string[]): string[] {
  const bad = workshopIds.find(id => !isWorkshopId(id))
  if (bad !== undefined) throw new Error(`"${String(bad)}" isn't a Workshop item id.`)
  return [
    '+force_install_dir', checkedDir(installDir),
    '+login', 'anonymous',
    ...workshopIds.flatMap(id => ['+workshop_download_item', PZ_APP_ID, id]),
    '+quit',
  ]
}

// A folder for +force_install_dir: a full Windows path. No quotes (Windows doesn't allow
// them in names) and nothing SteamCMD would read as the start of another +command
function checkedDir(dir: string): string {
  if (typeof dir !== 'string' || !win32.isAbsolute(dir) || /["\0\r\n]/.test(dir) || /(^|\s)\+/.test(dir)) {
    throw new Error(`"${String(dir)}" isn't a folder SteamCMD can install into.`)
  }
  return dir
}

// SteamCMD is always our own steamcmd.exe, never some other program the window names
function checkedSteamCmd(exe: string): string {
  if (typeof exe !== 'string' || !win32.isAbsolute(exe) || win32.basename(exe).toLowerCase() !== 'steamcmd.exe') {
    throw new Error(`"${String(exe)}" isn't SteamCMD.`)
  }
  return exe
}

// SteamCMD falls over if two copies run against the same folder, so everything goes through here one at a time
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

export function setupSteamCmdHandlers() {
  ipcMain.handle('steamcmd:checkInstalled', async (_event, installDir: string) => isServerInstalled(installDir))
  ipcMain.handle('steamcmd:checkUpdate', async (_event, installDir: string) => checkServerUpdate(installDir))
  ipcMain.handle('steamcmd:findSteamInstall', async () => findSteamInstalledServer())

  ipcMain.handle('steamcmd:download', async (_event, targetDir: string) => {
    try {
      const path = await ensureSteamCmd(targetDir)
      return { success: true, path, message: 'SteamCMD ready' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: `Couldn't download SteamCMD (${msg}). Check your internet connection and try again` }
    }
  })

  ipcMain.handle('steamcmd:installServer', async (event, { steamcmdPath, installDir, channel, buildVersion, branch }) => {
    const sender = event.sender
    return runServerInstall(steamcmdPath, installDir, (line) => { if (!sender.isDestroyed()) sender.send(channel, line) }, false, buildVersion, branch)
  })

  ipcMain.handle('steamcmd:updateServer', async (event, { steamcmdPath, installDir, channel, buildVersion, branch }) => {
    const sender = event.sender
    return runServerInstall(steamcmdPath, installDir, (line) => { if (!sender.isDestroyed()) sender.send(channel, line) }, true, buildVersion, branch)
  })

  // pick the branch the next update switches an install to ('' = stay where it is)
  ipcMain.handle('steamcmd:chooseBranch', async (_event, installDir: string, branch: string) => {
    try {
      const dir = knownInstall(installDir)
      if (branch) chooseBranch(dir, branch)
      else clearBranchChoice(dir)
      return { success: true }
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('steamcmd:branches', async (_event, force?: boolean) => {
    const branches = await steamBranches(!!force)
    return branches ? { success: true, branches: branches.map(b => ({ ...b, label: branchLabel(b.name, b.description), version: versionOf(b.buildId, { learned: learnedBuilds(), branches }) })) } : { success: false, message: "Couldn't ask Steam which versions it has." }
  })

  // Download workshop mods straight into the server's own workshop folder, so the
  // server sees them as already downloaded and we can read mod.info right away
  ipcMain.handle('steamcmd:downloadMods', async (event, { workshopIds, channel, installDir }) => {
    const sender = event.sender
    const send = (payload: ModDownloadEvent) => { if (!sender.isDestroyed()) sender.send(channel, payload) }
    let dir: string
    try { dir = installDir ? knownInstall(installDir) : loadSettings().serverInstallPath } catch (e) {
      return { success: false, done: [], failed: Array.isArray(workshopIds) ? workshopIds.map(String) : [], message: e instanceof Error ? e.message : String(e) }
    }
    const result = await downloadMods(workshopIds, send, dir)
    backupAfterDownload(result.done, dir)
    return result
  })
}

// ── Is the server out of date? ────────────────────────────────────────────────
// The #1 reason friends can't join: Steam updated the game, the server didn't.
// Compare the build in the server's appmanifest with what Steam says is current.

export function installedBuild(installDir: string): { buildId: string | null; branch: string } {
  // steamcmd puts the manifest inside the server folder, the Steam client keeps it in the
  // library's steamapps folder (two levels up from steamapps/common/<server>)
  const candidates = [
    join(installDir, 'steamapps', `appmanifest_${PZ_SERVER_APP_ID}.acf`),
    join(installDir, '..', '..', `appmanifest_${PZ_SERVER_APP_ID}.acf`),
  ]
  const manifest = candidates.find(p => existsSync(p))
  try {
    if (!manifest) throw new Error('no manifest')
    const acf = readFileSync(manifest, 'utf-8')
    return {
      buildId: acf.match(/"buildid"\s+"(\d+)"/i)?.[1] || null,
      branch: acf.match(/"BetaKey"\s+"([^"]*)"/i)?.[1] || 'public',
    }
  } catch {
    return { buildId: null, branch: 'public' }
  }
}

// Every branch of the server on Steam with its build id, from app_info_print. Asked at
// most every 30 minutes, null when Steam couldn't be asked
let branchCache: { branches: SteamBranch[]; at: number } | null = null
let branchAsk: Promise<SteamBranch[] | null> | null = null

// what the last ask said, without asking again (null = not asked yet)
export function cachedBranches(): SteamBranch[] | null {
  return branchCache?.branches || null
}

export function steamBranches(force = false): Promise<SteamBranch[] | null> {
  if (!force && branchCache && Date.now() - branchCache.at < 30 * 60 * 1000) return Promise.resolve(branchCache.branches)
  if (branchAsk) return branchAsk
  branchAsk = (async () => {
    const settings = loadSettings()
    let exe = steamcmdExe(settings)
    if (!existsSync(exe)) {
      try { exe = await ensureSteamCmd(settings.steamcmdDir) } catch { return null }
    }
    let out = ''
    await exclusive(() => runSteamCmd(exe, ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', PZ_SERVER_APP_ID, '+quit'], (l) => { out += l + '\n' }))
    const branches = parseBranches(out, PZ_SERVER_APP_ID)
    if (branches.length === 0) return branchCache?.branches || null
    branchCache = { branches, at: Date.now() }
    return branches
  })().catch(() => branchCache?.branches || null).finally(() => { branchAsk = null })
  return branchAsk
}

export interface ServerUpdateInfo {
  checked: boolean
  updateAvailable: boolean
  installed: string | null
  latest: string | null
  steamManaged: boolean
  // the Steam branch the install is on, and how people would say it
  branch: string
  branchLabel: string
  // a branch picked for this install that it isn't on yet (applies on the next update)
  chosenBranch?: string
  branchMissing: boolean
  behindPublic: boolean
  publicBuild: string | null
  installedVersion?: string
  latestVersion?: string
  publicVersion?: string
}

export async function checkServerUpdate(installDir: string): Promise<ServerUpdateInfo> {
  const steamManaged = loadSettings().steamManaged
  const mine = installedBuild(installDir)
  const chosen = chosenBranch(installDir)
  const base = { steamManaged, branch: mine.branch, branchLabel: branchLabel(mine.branch), chosenBranch: chosen && chosen !== mine.branch ? chosen : undefined }
  if (!mine.buildId) return { ...base, checked: false, updateAvailable: false, installed: null, latest: null, branchMissing: false, behindPublic: false, publicBuild: null }
  const branches = await steamBranches()
  const state = serverVersionState(mine, branches)
  const learned = learnedBuilds()
  const v = (id: string | null) => versionOf(id, { learned, branches })
  return {
    ...base,
    branchLabel: branchLabel(mine.branch, branches?.find(b => b.name === mine.branch)?.description),
    checked: !!state.latest || state.branchMissing,
    updateAvailable: state.updateAvailable,
    installed: mine.buildId,
    latest: state.latest,
    branchMissing: state.branchMissing,
    behindPublic: state.behindPublic,
    publicBuild: state.publicBuild,
    installedVersion: v(mine.buildId),
    latestVersion: v(state.latest),
    publicVersion: v(state.publicBuild),
  }
}

// ── Already installed through Steam? ──────────────────────────────────────────
// Lots of people already have "Project Zomboid Dedicated Server" in their Steam library.
// No point downloading 7 GB again.

export function steamPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
      resolve(m ? m[1].trim().replace(/\//g, '\\') : null)
    })
  })
}

// Every Steam library folder (they can be on any drive), from Steam's own list
export async function steamLibraries(): Promise<string[]> {
  const steam = await steamPath()
  if (!steam) return []
  const libs = new Set<string>([steam])
  try {
    const vdf = readFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf-8')
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) libs.add(m[1].replace(/\\\\/g, '\\'))
  } catch { /* only the main library then */ }
  return [...libs]
}

export async function findSteamInstalledServer(): Promise<string | null> {
  for (const lib of await steamLibraries()) {
    const dir = join(lib, 'steamapps', 'common', 'Project Zomboid Dedicated Server')
    if (isServerInstalled(dir)) return dir
  }
  return null
}

export function isServerInstalled(installDir: string): boolean {
  return existsSync(join(installDir, 'StartServer64.bat')) || existsSync(join(installDir, 'ProjectZomboidServer.bat'))
}

export async function ensureSteamCmd(targetDir: string): Promise<string> {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const exe = join(targetDir, 'steamcmd.exe')
  if (existsSync(exe)) return exe

  const zipPath = join(targetDir, 'steamcmd.zip')
  await downloadFile(STEAMCMD_URL, zipPath)
  await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', expandArchiveScript(zipPath, targetDir)])
  fs.unlinkSync(zipPath)
  await bootstrapSteamCmd(exe)
  return exe
}

// A fresh steamcmd.exe is only the updater: its first run downloads the rest of SteamCMD and
// exits (code 7) without doing anything it was asked to. Get that over with right after
// unzipping, so the first real job (the 7 GB server download) doesn't fail. A run that has
// nothing left to update exits 0. It also fetches the app info once: with an empty cache the
// first +app_update fails with "Missing configuration"
const BOOTSTRAP_ARGS = ['+login', 'anonymous', '+app_info_update', '1', '+quit']
async function bootstrapSteamCmd(exe: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await runSteamCmd(exe, BOOTSTRAP_ARGS, () => undefined).catch(() => null)
    if (code === 0) return
  }
}

// SteamCMD stopped for a reason that goes away when it runs again: it updated itself (7), or
// its app info cache was still empty ("Missing configuration")
export function worthRetrying(code: number | null, output: string[]): boolean {
  return code === 7 || output.some(l => /Failed to install app '\d+' \(Missing configuration\)/i.test(l))
}

// What went wrong when SteamCMD stopped without installing the server, in plain words.
// Code 7 is it restarting after updating itself, not a connection problem
export function installFailureMessage(code: number | null, output: string[], installDir: string): string {
  const reason = output.map(l => l.match(/ERROR! Failed to (?:install|update) app '\d+' \(([^)]+)\)/i)?.[1]).find(Boolean)
  if (reason && /disk write|write failure|access denied/i.test(reason)) {
    return `Windows wouldn't let SteamCMD write to ${installDir}. Pick a folder you can write to (not inside Program Files) and try again`
  }
  if (reason && /disk space/i.test(reason)) {
    return `There isn't enough free space for the server in ${installDir} (it needs about 8 GB)`
  }
  if ((reason && /connect|timeout|network/i.test(reason)) || output.some(l => /FAILED \(No Connection\)|Connecting anonymously to Steam Public\.\.\.\s*FAILED|Timed out waiting/i.test(l))) {
    return "SteamCMD couldn't reach Steam. Check your internet connection and try again"
  }
  if (reason) return `SteamCMD couldn't install the server: ${reason}. Try again, the details are under "Show details"`
  if (code === 7) return 'SteamCMD stopped after updating itself, twice in a row. Try again, it usually works the next time'
  return `SteamCMD stopped without installing the server (exit code ${code ?? 'unknown'}). Try again, the details are under "Show details"`
}

// SteamCMD's " Update state (0x61) downloading, progress: 42.17 (...)" as "<what>: downloading 42%".
// Its last line is "(0x0) unknown, progress: 0.00", which says nothing
export function steamProgress(line: string, what: string): string {
  const m = line.match(/Update state \(0x[0-9a-f]+\)\s*([a-z ]+?),\s*progress:\s*([\d.]+)/i)
  if (!m || /unknown/i.test(m[1])) return `${what}...`
  const stage = m[1].trim().replace(/^verifying update$/i, 'checking files').replace(/^committing$/i, 'installing files')
  return `${what}: ${stage} ${Math.round(parseFloat(m[2]))}%`
}

// Run steamcmd with the given +commands, feeding each output line to onLine. No shell: the
// arguments go to steamcmd as they are, so & | > and the like in them are just text
function runSteamCmd(exe: string, args: string[], onLine: (line: string) => void): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(checkedSteamCmd(exe), args, { cwd: dirname(exe), windowsHide: true })
    const handle = (prefix: string) => (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) onLine(prefix + trimmed)
      }
    }
    proc.stdout.on('data', handle(''))
    proc.stderr.on('data', handle('[ERR] '))
    proc.on('close', resolve)
    proc.on('error', reject)
  })
}

/**
 * Install or update the server. branch: switch the install to this branch (it's remembered for
 * the install). Without one an update keeps the branch the install is on, see branchFor.
 * An update first lets backups.ts back up every server on the install, and stops if it can't.
 */
export async function runServerInstall(
  steamcmdPath: string,
  installDir: string,
  sendProgress: (line: string) => void,
  isUpdate: boolean,
  buildVersion?: string,
  branch?: string,
): Promise<{ success: boolean; message: string; branch?: string }> {
  try {
    checkedSteamCmd(steamcmdPath)
    checkedDir(installDir)
    if (branch !== undefined && branch !== null && !isBranchName(branch)) throw new Error(`"${String(branch)}" isn't a Steam branch.`)
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
  // from here until it's done no server on this install starts (busy.ts): not while the
  // worlds are backed up, not while it waits for SteamCMD, not while SteamCMD runs
  const what = !isUpdate && !isServerInstalled(installDir) ? 'Installing the game server' : branch ? `Switching the game server to ${branchLabel(branch)}` : 'Updating the game server'
  const updating = isUpdate || isServerInstalled(installDir)
  return whileBusy({ installDir }, 'game-update', updating ? 'Backing up the worlds first...' : `${what}...`, (busyProgress) =>
    installNow(steamcmdPath, installDir, (line) => {
      if (/Update state \(0x[0-9a-f]+\)/i.test(line)) busyProgress(steamProgress(line, what))
      sendProgress(line)
    }, isUpdate, buildVersion, branch, () => busyProgress(`${what}...`)))
}

async function installNow(
  steamcmdPath: string,
  installDir: string,
  sendProgress: (line: string) => void,
  isUpdate: boolean,
  buildVersion: string | undefined,
  branch: string | undefined,
  // SteamCMD is about to start on it
  onStart: () => void,
): Promise<{ success: boolean; message: string; branch?: string }> {
  try {
    const mine = installedBuild(installDir)
    const target = branchFor({ chosen: branch || chosenBranch(installDir), installed: mine.buildId ? mine.branch : null, build: buildVersion })
    const args = installArgs(installDir, target)
    const guarded = (isUpdate || isServerInstalled(installDir)) && !!updateGuard
    const backedUp = guarded ? await updateGuard!.prepare(installDir) : []
    return await exclusive(async () => {
      // it may have waited a while for its turn: checked again right before SteamCMD starts
      if (guarded) await updateGuard!.check(installDir, backedUp)
      onStart()
      if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true })

      sendProgress(isUpdate ? 'Starting server update...' : 'Starting server installation...')
      sendProgress(`SteamCMD path: ${steamcmdPath}`)
      sendProgress(`Install directory: ${installDir}`)
      sendProgress(`Branch: ${target} (${buildOfBranch(target) === 'b41' ? 'Build 41' : 'Build 42'})`)

      const output: string[] = []
      const onLine = (line: string) => { output.push(line); if (output.length > 300) output.shift(); sendProgress(line) }
      // piped, SteamCMD holds its output back until it's done, so the "Update state ...
      // progress: 42.17 (3003 / 7124 bytes)" lines only show up in its own console log (every 2 s)
      const progress = followFile(join(dirname(steamcmdPath), 'logs', 'console_log.txt'), (line) => {
        if (/Update state \(0x[0-9a-f]+\)/i.test(line)) sendProgress(line.replace(/^\[[^\]]*\]\s*/, ''))
      })
      let code: number | null
      try {
        code = await runSteamCmd(steamcmdPath, args, onLine)
        // steamcmd exits 7 when it updated itself instead of doing the job (a SteamCMD folder from
        // before the app bootstrapped it, or an update Valve pushed since), and a fresh one can
        // trip over its empty app info cache: run it again, once
        if (worthRetrying(code, output) && !isServerInstalled(installDir)) {
          sendProgress(code === 7 ? 'SteamCMD updated itself, starting the download again...' : 'SteamCMD needed a second go, starting the download again...')
          output.length = 0
          code = await runSteamCmd(steamcmdPath, args, onLine)
        }
      } finally {
        progress.stop()
      }
      branchCache = branchCache && { ...branchCache, at: 0 }

      // steamcmd exits 7 after a successful self-update, so trust the files over the exit code
      const now = installedBuild(installDir)
      if (isServerInstalled(installDir) && (code === 0 || code === 7) && now.branch === target) {
        // the switch is done, from now on updates keep whatever branch the install is on
        clearBranchChoice(installDir)
        sendProgress('Installation complete!')
        return { success: true, branch: target, message: isUpdate ? 'Server updated successfully' : 'Server installed successfully' }
      }
      if (isServerInstalled(installDir) && (code === 0 || code === 7)) throw new Error(`Steam left the server on ${now.branch} instead of ${target}`)
      throw new Error(installFailureMessage(code, output, installDir))
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return { success: false, message: msg }
  }
}

// ── Workshop downloads ────────────────────────────────────────────────────────

export interface ModDownloadEvent {
  workshopId: string
  state: 'queued' | 'downloading' | 'done' | 'failed'
  bytes?: number
  message?: string
}

// installDir: the server install the mods are for (each server can have its own)
export function downloadMods(
  workshopIds: string[],
  send: (e: ModDownloadEvent) => void,
  installDir = loadSettings().serverInstallPath,
): Promise<{ success: boolean; done: string[]; failed: string[]; message?: string }> {
  // ids come from mod lists people paste in and packs other people made: only plain numbers
  // get anywhere near SteamCMD
  const list = Array.isArray(workshopIds) ? workshopIds : []
  const bad = list.filter(id => !isWorkshopId(id)).map(String)
  bad.forEach(id => send({ workshopId: id, state: 'failed', message: "That isn't a Workshop item id." }))
  workshopIds = list.filter(isWorkshopId)
  if (workshopIds.length === 0) {
    return Promise.resolve({ success: bad.length === 0, done: [], failed: bad, message: bad.length ? "Those aren't Workshop item ids." : undefined })
  }
  return exclusive(async () => {
    const settings = loadSettings()
    let exe = steamcmdExe(settings)
    try {
      checkedDir(installDir)
      if (!existsSync(exe)) exe = await ensureSteamCmd(settings.steamcmdDir)
    } catch (e) {
      return { success: false, done: [], failed: [...bad, ...workshopIds], message: `Couldn't get SteamCMD: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true })

    const done = new Set<string>()
    let pending = [...new Set(workshopIds)]
    pending.forEach(id => send({ workshopId: id, state: 'queued' }))

    // steamcmd prints nothing while a big item downloads, so watch the folder sizes instead
    const downloadsDir = join(installDir, 'steamapps', 'workshop', 'downloads', PZ_APP_ID)
    // measured outside the app (big mods are thousands of files), one round at a time
    let measuring = false
    const poll = setInterval(async () => {
      if (measuring) return
      measuring = true
      try {
        for (const id of pending) {
          if (done.has(id)) continue
          const dir = join(downloadsDir, id)
          if (!existsSync(dir)) continue
          const bytes = await folderSize(dir)
          if (bytes > 0) send({ workshopId: id, state: 'downloading', bytes })
        }
      } finally {
        measuring = false
      }
    }, 2000)

    // big items time out a lot, steamcmd resumes where it left off so just try again
    const errors: Record<string, string> = {}
    try {
      for (let attempt = 1; attempt <= 4 && pending.length > 0; attempt++) {
        await runSteamCmd(exe, workshopDownloadArgs(installDir, pending), (line) => {
          const ok = line.match(/Success\. Downloaded item (\d+)/i)
          if (ok) {
            done.add(ok[1])
            send({ workshopId: ok[1], state: 'done' })
            return
          }
          const bad = line.match(/ERROR!.*?item (\d+)\s*(.*)/i)
          if (bad) errors[bad[1]] = bad[2] || line
          const started = line.match(/Downloading item (\d+)/i)
          if (started) send({ workshopId: started[1], state: 'downloading' })
        })
        pending = pending.filter(id => !done.has(id))
      }
    } finally {
      clearInterval(poll)
    }

    for (const id of pending) {
      send({ workshopId: id, state: 'failed', message: errors[id] || 'Download failed' })
    }
    return { success: pending.length === 0 && bad.length === 0, done: [...done], failed: [...bad, ...pending] }
  })
}

function downloadFile(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
        response.resume()
        // SteamCMD is a program the app runs, so https all the way
        const next = redirectTarget(url, response.headers.location)
        if (!next || redirects >= 10) { reject(new Error("Steam's download link went somewhere unexpected")); return }
        downloadFile(next, dest, redirects + 1).then(resolve).catch(reject)
        return
      }
      const file = fs.createWriteStream(dest)
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    }).on('error', (err) => {
      try { fs.unlinkSync(dest) } catch { /* nothing to clean */ }
      reject(err)
    })
  })
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}
