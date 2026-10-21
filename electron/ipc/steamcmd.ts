import { ipcMain } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { spawn } from 'child_process'
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
