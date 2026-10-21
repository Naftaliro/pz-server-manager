import { ipcMain } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync } from 'fs'
import { spawn, execFile } from 'child_process'
import https from 'https'
import fs from 'fs'
import { loadSettings, steamcmdExe } from './appSettings'
import { PZ_APP_ID } from './modManager'

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
const PZ_SERVER_APP_ID = '380870'

// B42 is the default public branch now, B41 lives on the legacy41 beta
function branchArgs(buildVersion?: string): string {
  return buildVersion === 'b41' ? ' -beta legacy41' : ''
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
      return { success: false, message: `Failed to download SteamCMD: ${msg}` }
    }
  })

  ipcMain.handle('steamcmd:installServer', async (event, { steamcmdPath, installDir, channel, buildVersion }) => {
    return runServerInstall(event, steamcmdPath, installDir, channel, false, buildVersion)
  })

  ipcMain.handle('steamcmd:updateServer', async (event, { steamcmdPath, installDir, channel, buildVersion }) => {
    return runServerInstall(event, steamcmdPath, installDir, channel, true, buildVersion)
  })

  // Download workshop mods straight into the server's own workshop folder, so the
  // server sees them as already downloaded and we can read mod.info right away
  ipcMain.handle('steamcmd:downloadMods', async (event, { workshopIds, channel }) => {
    const sender = event.sender
    const send = (payload: ModDownloadEvent) => { if (!sender.isDestroyed()) sender.send(channel, payload) }
    return downloadMods(workshopIds, send)
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

let latestCache: { branch: string; buildId: string; at: number } | null = null

async function latestBuild(branch: string): Promise<string | null> {
  if (latestCache && latestCache.branch === branch && Date.now() - latestCache.at < 30 * 60 * 1000) return latestCache.buildId
  const settings = loadSettings()
  let exe = steamcmdExe(settings)
  if (!existsSync(exe)) {
    try { exe = await ensureSteamCmd(settings.steamcmdDir) } catch { return null }
  }
  let out = ''
  await exclusive(() => runSteamCmd(exe, ['+login anonymous', '+app_info_update 1', `+app_info_print ${PZ_SERVER_APP_ID}`, '+quit'], (l) => { out += l + '\n' }))
  // ..."branches" { "public" { "buildid" "123" ... } "legacy41" { ... } }
  const branches = out.slice(out.search(/"branches"/i))
  const block = branches.match(new RegExp(`"${branch}"\\s*\\{([^}]*)\\}`, 'i'))?.[1]
  const buildId = block?.match(/"buildid"\s+"(\d+)"/i)?.[1] || null
  if (buildId) latestCache = { branch, buildId, at: Date.now() }
  return buildId
}

export async function checkServerUpdate(installDir: string): Promise<{ checked: boolean; updateAvailable: boolean; installed: string | null; latest: string | null; steamManaged: boolean }> {
  const steamManaged = loadSettings().steamManaged
  const { buildId, branch } = installedBuild(installDir)
  if (!buildId) return { checked: false, updateAvailable: false, installed: null, latest: null, steamManaged }
  const latest = await latestBuild(branch || 'public')
  return { checked: !!latest, updateAvailable: !!latest && latest !== buildId, installed: buildId, latest, steamManaged }
}

// ── Already installed through Steam? ──────────────────────────────────────────
// Lots of people already have "Project Zomboid Dedicated Server" in their Steam library.
// No point downloading 7 GB again.

function steamPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
      resolve(m ? m[1].trim().replace(/\//g, '\\') : null)
    })
  })
}

export async function findSteamInstalledServer(): Promise<string | null> {
  const steam = await steamPath()
  if (!steam) return null
  const libs = new Set<string>([steam])
  try {
    const vdf = readFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf-8')
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) libs.add(m[1].replace(/\\\\/g, '\\'))
  } catch { /* only the main library then */ }
  for (const lib of libs) {
    const dir = join(lib, 'steamapps', 'common', 'Project Zomboid Dedicated Server')
    if (isServerInstalled(dir)) return dir
  }
  return null
}

export function isServerInstalled(installDir: string): boolean {
  return existsSync(join(installDir, 'StartServer64.bat')) || existsSync(join(installDir, 'ProjectZomboidServer.bat'))
}

async function ensureSteamCmd(targetDir: string): Promise<string> {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const exe = join(targetDir, 'steamcmd.exe')
  if (existsSync(exe)) return exe

  const zipPath = join(targetDir, 'steamcmd.zip')
  await downloadFile(STEAMCMD_URL, zipPath)
  await runCommand('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${targetDir}" -Force`])
  fs.unlinkSync(zipPath)
  return exe
}

// Run steamcmd with the given +commands, feeding each output line to onLine
function runSteamCmd(exe: string, args: string[], onLine: (line: string) => void): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { shell: true, cwd: dirname(exe), windowsHide: true })
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

function runServerInstall(
  event: Electron.IpcMainInvokeEvent,
  steamcmdPath: string,
  installDir: string,
  channel: string,
  isUpdate: boolean,
  buildVersion?: string
) {
  return exclusive(async () => {
    try {
      if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true })

      const sender = event.sender
      const sendProgress = (line: string) => { if (!sender.isDestroyed()) sender.send(channel, line) }

      sendProgress(isUpdate ? 'Starting server update...' : 'Starting server installation...')
      sendProgress(`SteamCMD path: ${steamcmdPath}`)
      sendProgress(`Install directory: ${installDir}`)
      sendProgress(`Branch: ${buildVersion === 'b41' ? 'legacy41 (Build 41)' : 'public (Build 42)'}`)

      const code = await runSteamCmd(steamcmdPath, [
        `+force_install_dir "${installDir}"`,
        '+login anonymous',
        `+app_update ${PZ_SERVER_APP_ID}${branchArgs(buildVersion)} validate`,
        '+quit',
      ], sendProgress)

      // steamcmd exits 7 after a successful self-update, so trust the files over the exit code
      if (isServerInstalled(installDir) && (code === 0 || code === 7)) {
        sendProgress('Installation complete!')
        return { success: true, message: isUpdate ? 'Server updated successfully' : 'Server installed successfully' }
      }
      throw new Error(`SteamCMD exited with code ${code}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })
}

// ── Workshop downloads ────────────────────────────────────────────────────────

export interface ModDownloadEvent {
  workshopId: string
  state: 'queued' | 'downloading' | 'done' | 'failed'
  bytes?: number
  message?: string
}

function dirSize(p: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name)
      if (entry.isDirectory()) total += dirSize(full)
      else { try { total += statSync(full).size } catch { /* skip */ } }
    }
  } catch { /* missing dir */ }
  return total
}

export function downloadMods(
  workshopIds: string[],
  send: (e: ModDownloadEvent) => void
): Promise<{ success: boolean; done: string[]; failed: string[]; message?: string }> {
  return exclusive(async () => {
    const settings = loadSettings()
    let exe = steamcmdExe(settings)
    const installDir = settings.serverInstallPath
    if (!existsSync(exe)) {
      try {
        exe = await ensureSteamCmd(settings.steamcmdDir)
      } catch (e) {
        return { success: false, done: [], failed: workshopIds, message: `Couldn't get SteamCMD: ${e instanceof Error ? e.message : String(e)}` }
      }
    }
    if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true })

    const done = new Set<string>()
    let pending = [...new Set(workshopIds)]
    pending.forEach(id => send({ workshopId: id, state: 'queued' }))

    // steamcmd prints nothing while a big item downloads, so watch the folder sizes instead
    const downloadsDir = join(installDir, 'steamapps', 'workshop', 'downloads', PZ_APP_ID)
    const poll = setInterval(() => {
      for (const id of pending) {
        if (done.has(id)) continue
        const bytes = dirSize(join(downloadsDir, id))
        if (bytes > 0) send({ workshopId: id, state: 'downloading', bytes })
      }
    }, 2000)

    // big items time out a lot, steamcmd resumes where it left off so just try again
    const errors: Record<string, string> = {}
    try {
      for (let attempt = 1; attempt <= 4 && pending.length > 0; attempt++) {
        await runSteamCmd(exe, [
          `+force_install_dir "${installDir}"`,
          '+login anonymous',
          ...pending.map(id => `+workshop_download_item ${PZ_APP_ID} ${id}`),
          '+quit',
        ], (line) => {
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
    return { success: pending.length === 0, done: [...done], failed: pending }
  })
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject)
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
    const proc = spawn(cmd, args, { shell: true, windowsHide: true })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}
