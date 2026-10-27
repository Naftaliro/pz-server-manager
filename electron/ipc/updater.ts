import { ipcMain, app, BrowserWindow, shell } from 'electron'
import https from 'https'
import http from 'http'
import fs from 'fs'
// plain fs, without Electron's asar patching: the extracted update contains
// resources/app.asar, which the patched fs treats as a folder and fails to delete
import originalFs from 'original-fs'
import path from 'path'
import { spawn, execFile } from 'child_process'
import {
  updateScript, updaterWindowCommand, uninstallerFor, INSTALLER_UPDATE_ARGS, isNsisInstaller,
  RELEASE_SIGNER, signatureQueryScript, signedByUs, type SignatureInfo,
} from './winScripts'

const GITHUB_OWNER = 'Naftaliro'
const GITHUB_REPO = 'pz-server-manager'
const RELEASE_ZIP_URL = new RegExp(`^https://github\\.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/[^/]+/[^/\\\\]+\\.zip$`, 'i')
const RELEASE_EXE_URL = new RegExp(`^https://github\\.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/[^/]+/[^/\\\\]+\\.exe$`, 'i')

// Installed with the setup exe (so Windows "Apps & features" knows the version) or the
// portable zip. Updates go the same way they came in
function isInstalledCopy(): boolean {
  return app.isPackaged && fs.existsSync(uninstallerFor(app.getPath('exe')))
}

// Read the version fresh each time from the app — never cache at module load
function getCurrentVersion(): string {
  try { return app.getVersion() } catch { return '0.0.0' }
}

// Always get the LIVE main window — never hold a stale reference
function getLiveWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.find(w => !w.isDestroyed()) ?? null
}

// Safe send — only sends if the window and its webContents are still alive
function safeSend(channel: string, payload: unknown): void {
  try {
    const win = getLiveWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  } catch {
    // Swallow — window may have been destroyed between the check and the send
  }
}

interface GithubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
  assets: Array<{
    name: string
    browser_download_url: string
    size: number
  }>
}

interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseUrl: string
  downloadUrl: string
  assetName: string
  assetSize: number
  publishedAt: string
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsGetJson(url: string, redirectCount = 0): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) { reject(new Error('Too many redirects')); return }

    const options = {
      headers: {
        'User-Agent': `PZServerManager/${getCurrentVersion()}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }

    const lib = url.startsWith('https') ? https : http
    const req = (lib as typeof https).get(url, options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        httpsGetJson(res.headers.location, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`GitHub API returned HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`Failed to parse JSON: ${(e as Error).message}`)) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.end()
  })
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (pct: number) => void,
  redirectCount = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) { reject(new Error('Too many redirects during download')); return }

    const lib = url.startsWith('https') ? https : http
    const req = (lib as typeof https).get(url, {
      headers: { 'User-Agent': `PZServerManager/${getCurrentVersion()}` }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        res.resume()
        downloadFile(res.headers.location, destPath, onProgress, redirectCount + 1)
          .then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        return
      }

      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0
      let lastReportedPct = -1

      const file = fs.createWriteStream(destPath)

      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (!file.write(chunk)) {
          res.pause()
          file.once('drain', () => res.resume())
        }
        if (total > 0) {
          const pct = Math.round((received / total) * 100)
          // Only fire callback when percentage actually changes to reduce IPC traffic
          if (pct !== lastReportedPct) {
            lastReportedPct = pct
            onProgress(pct)
          }
        }
      })

      res.on('end', () => {
        file.end()
        // a dropped connection can still end "normally" with only part of the file
        file.on('finish', () => (total > 0 && received !== total
          ? reject(new Error(`the download stopped early (${received} of ${total} bytes)`))
          : resolve()))
        file.on('error', reject)
      })

      res.on('error', (err) => {
        file.destroy()
        reject(err)
      })
    })

    req.on('error', reject)
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Download timed out after 3 minutes')) })
    req.end()
  })
}

function compareVersions(a: string, b: string): number {
  const clean = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const pa = clean(a)
  const pb = clean(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function cleanTempDir(tempDir: string): void {
  try {
    if (originalFs.existsSync(tempDir)) {
      originalFs.rmSync(tempDir, { recursive: true, force: true })
    }
  } catch {
    // Best-effort cleanup — ignore errors
  }
}

// What Windows says about a file's signature, null if PowerShell couldn't tell
function readSignature(file: string): Promise<SignatureInfo | null> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', signatureQueryScript(file)], { windowsHide: true, timeout: 60000 }, (err, stdout) => {
      if (err) return resolve(null)
      try { resolve(JSON.parse(stdout)) } catch { resolve(null) }
    })
  })
}

// ── Installed copy: run the new setup exe ─────────────────────────────────────
//
// Copying the zip over an installed copy worked, but Windows "Apps & features" kept
// showing the old version. The setup exe updates it properly:
//   1. Same checks as the zip: only this repo's release downloads, a plain file name
//   2. Download to %LOCALAPPDATA%\pz-manager-update\ (all of it, see downloadFile)
//   3. Check it's a Windows program and an NSIS installer before running anything
//   4. Check Windows says it's validly signed by RELEASE_SIGNER. The signature covers the
//      whole installer, app files included, and only the release build can make one
//   5. Run it silently as an update (it waits for the app to close, installs over the
//      same folder and starts the app again), then quit
async function installWithSetup(downloadUrl: string, assetName: string): Promise<{ success: boolean; message?: string }> {
  if (!RELEASE_EXE_URL.test(downloadUrl) || !/^[\w. -]+\.exe$/i.test(assetName)) {
    return { success: false, message: "That download isn't one of this app's releases. Please update manually from the GitHub releases page." }
  }
  // the portable copy has no installer, it updates with the zip
  if (!isInstalledCopy()) {
    return { success: false, message: "This copy wasn't installed with the setup, so it can't update with it. Please update manually from the GitHub releases page." }
  }

  const localAppData = process.env.LOCALAPPDATA || app.getPath('temp')
  const tempDir = path.join(localAppData, 'pz-manager-update')
  const setupPath = path.join(tempDir, assetName)
  cleanTempDir(tempDir)
  try {
    fs.mkdirSync(tempDir, { recursive: true })
  } catch (err) {
    return { success: false, message: `Failed to create temp directory: ${(err as Error).message}` }
  }

  safeSend('updater:progress', { stage: 'Downloading update...', pct: 0 })
  try {
    await downloadFile(downloadUrl, setupPath, (pct) => safeSend('updater:progress', { stage: 'Downloading update...', pct }))
  } catch (err) {
    cleanTempDir(tempDir)
    return { success: false, message: `Download failed: ${(err as Error).message}` }
  }

  safeSend('updater:progress', { stage: 'Verifying download...', pct: 100 })
  try {
    const head = Buffer.alloc(1024 * 1024)
    const fd = fs.openSync(setupPath, 'r')
    const n = fs.readSync(fd, head, 0, head.length, 0)
    fs.closeSync(fd)
    if (!isNsisInstaller(head.subarray(0, n))) {
      cleanTempDir(tempDir)
      return { success: false, message: "The downloaded installer isn't valid. The release file may be missing or broken." }
    }
  } catch (err) {
    cleanTempDir(tempDir)
    return { success: false, message: `Failed to verify download: ${(err as Error).message}` }
  }

  safeSend('updater:progress', { stage: 'Checking the signature...', pct: 100 })
  const sig = await readSignature(setupPath)
  if (!sig || !signedByUs(sig)) {
    cleanTempDir(tempDir)
    return {
      success: false,
      message: sig
        ? `The downloaded installer isn't signed by ${RELEASE_SIGNER}, so it wasn't run. Please update manually from the GitHub releases page.`
        : "Couldn't check the downloaded installer's signature. Please update manually from the GitHub releases page.",
    }
  }

  try {
    // straight to the exe, no cmd in between, so nothing in the path gets parsed
    spawn(setupPath, INSTALLER_UPDATE_ARGS, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  } catch (err) {
    cleanTempDir(tempDir)
    return { success: false, message: `Failed to start the installer: ${(err as Error).message}` }
  }

  // the installer waits for the app to close (and closes it if it doesn't)
  setTimeout(() => {
    try { app.quit() } catch { /* ignore */ }
  }, 1500)
  return { success: true }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

export function setupUpdaterHandlers() {
  // NOTE: We no longer accept mainWindow as a parameter.
  // All window access goes through getLiveWindow() / safeSend() to avoid
  // "Object has been destroyed" crashes when the window is replaced during update.

  // ── Check for updates ────────────────────────────────────────────────────────
  ipcMain.handle('updater:check', async () => {
    const currentVersion = getCurrentVersion()
    try {
      const release = await httpsGetJson(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
      ) as GithubRelease

      const latestVersion = release.tag_name.replace(/^v/, '')
      const isNewer = compareVersions(latestVersion, currentVersion) > 0

      // the installed copy updates with the new setup exe, the portable one with the zip
      // (prefer a win zip; any zip if a release only has that)
      const zip =
        release.assets.find(a => /win.*\.zip$/i.test(a.name)) ||
        release.assets.find(a => a.name.endsWith('.zip')) ||
        null
      const setup = release.assets.find(a => /-Setup-[\d.]+\.exe$/i.test(a.name)) || null
      const asset = (isInstalledCopy() && setup) || zip

      const info: UpdateInfo = {
        available: isNewer,
        currentVersion,
        latestVersion,
        releaseNotes: release.body || '',
        releaseUrl: release.html_url,
        downloadUrl: asset?.browser_download_url || '',
        assetName: asset?.name || '',
        assetSize: asset?.size || 0,
        publishedAt: release.published_at,
      }

      return { success: true, ...info }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, available: false, currentVersion }
    }
  })

  // ── Download and install update ──────────────────────────────────────────────
  //
  // Strategy (the portable copy; an installed copy gets the setup exe, see installWithSetup):
  //   1. Clean any leftover temp dir from a previous attempt
  //   2. Download the zip to %LOCALAPPDATA%\pz-manager-update\
  //   3. Verify the zip magic bytes. No signature check: only the exe in the zip is
  //      signed, the app's own files (resources\app.asar) can't be
  //   4. Write a .bat that: waits for the app to exit, extracts via PowerShell,
  //      robocopy new files over the install dir (userData is never touched),
  //      then relaunches the exe
  //   5. Launch the bat detached, then quit the app
  //
  // Progress is sent via safeSend() which guards against destroyed webContents.
  //
  ipcMain.handle('updater:install', async (_event, downloadUrl: string, assetName: string) => {
    if (!downloadUrl || !assetName) {
      return { success: false, message: 'No download URL provided. Please update manually from the GitHub releases page.' }
    }
    if (/\.exe$/i.test(assetName)) return installWithSetup(downloadUrl, assetName)
    // only ever install a zip from this repo's own releases (what updater:check hands out)
    if (!RELEASE_ZIP_URL.test(downloadUrl) || !/^[\w. -]+\.zip$/i.test(assetName)) {
      return { success: false, message: "That download isn't one of this app's releases. Please update manually from the GitHub releases page." }
    }

    // Use %LOCALAPPDATA% — more reliable than %TEMP% on Windows for persisting across sessions
    const localAppData = process.env.LOCALAPPDATA || app.getPath('temp')
    const tempDir = path.join(localAppData, 'pz-manager-update')
    const zipPath = path.join(tempDir, assetName)
    const extractDir = path.join(tempDir, 'extracted')

    // ── Step 1: Clean up any leftover temp files from a previous attempt ────────
    cleanTempDir(tempDir)

    try {
      fs.mkdirSync(tempDir, { recursive: true })
      fs.mkdirSync(extractDir, { recursive: true })
    } catch (err) {
      return { success: false, message: `Failed to create temp directory: ${(err as Error).message}` }
    }

    // ── Step 2: Download ─────────────────────────────────────────────────────────
    safeSend('updater:progress', { stage: 'Downloading update...', pct: 0 })

    try {
      await downloadFile(downloadUrl, zipPath, (pct) => {
        safeSend('updater:progress', { stage: 'Downloading update...', pct })
      })
    } catch (err) {
      cleanTempDir(tempDir)
      return { success: false, message: `Download failed: ${(err as Error).message}` }
    }

    safeSend('updater:progress', { stage: 'Verifying download...', pct: 100 })

    // ── Step 3: Verify zip magic bytes ───────────────────────────────────────────
    try {
      const header = Buffer.alloc(4)
      const fd = fs.openSync(zipPath, 'r')
      fs.readSync(fd, header, 0, 4, 0)
      fs.closeSync(fd)
      if (header[0] !== 0x50 || header[1] !== 0x4B) {
        cleanTempDir(tempDir)
        return { success: false, message: 'Downloaded file is not a valid zip archive. The release asset may be missing or corrupt.' }
      }
    } catch (err) {
      cleanTempDir(tempDir)
      return { success: false, message: `Failed to verify download: ${(err as Error).message}` }
    }

    // ── Step 4: Write the updater batch script ───────────────────────────────────
    const batchScript = updateScript({ zipPath, extractDir, appExe: app.getPath('exe') })

    const batchPath = path.join(tempDir, 'pz-update.bat')

    try {
      fs.writeFileSync(batchPath, batchScript, 'utf-8')
    } catch (err) {
      cleanTempDir(tempDir)
      return { success: false, message: `Failed to write updater script: ${(err as Error).message}` }
    }

    // ── Step 5: Launch the batch detached and quit ───────────────────────────────
    // Use /c (not /k) so the terminal closes automatically after the update completes.
    // The batch itself pauses on error so the user can read it, but exits cleanly on success.
    try {
      const launch = updaterWindowCommand(batchPath)
      spawn('cmd.exe', [launch.args], {
        env: { ...process.env, ...launch.env },
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        windowsVerbatimArguments: true,
      }).unref()
    } catch (err) {
      cleanTempDir(tempDir)
      return { success: false, message: `Failed to launch updater: ${(err as Error).message}` }
    }

    // Give the batch a moment to start before we quit
    setTimeout(() => {
      try { app.quit() } catch { /* ignore */ }
    }, 1500)

    return { success: true }
  })

  // ── Open release page in browser (manual fallback) ───────────────────────────
  ipcMain.handle('updater:openReleasePage', async (_event, url: string) => {
    shell.openExternal(url)
    return { success: true }
  })

  // ── Get current version (always live from Electron) ──────────────────────────
  ipcMain.handle('updater:getVersion', () => {
    return { version: getCurrentVersion() }
  })
}
