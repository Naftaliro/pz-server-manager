import { ipcMain, app, BrowserWindow, shell } from 'electron'
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const GITHUB_OWNER = 'Naftaliro'
const GITHUB_REPO = 'pz-server-manager'

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
        file.on('finish', resolve)
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
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } catch {
    // Best-effort cleanup — ignore errors
  }
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

      // Prefer a win zip asset; fall back to any zip
      const asset =
        release.assets.find(a => /win.*\.zip$/i.test(a.name)) ||
        release.assets.find(a => a.name.endsWith('.zip')) ||
        null

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
  // Strategy:
  //   1. Clean any leftover temp dir from a previous attempt
  //   2. Download the zip to %LOCALAPPDATA%\pz-manager-update\
  //   3. Verify the zip magic bytes
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
    const appExe = app.getPath('exe')
    const appDir = path.dirname(appExe)

    // Use short 8.3-safe variable names inside the batch to avoid quoting issues
    const batchScript = [
      '@echo off',
      'setlocal enabledelayedexpansion',
      'title PZ Server Manager - Updating...',
      'echo ================================================',
      'echo  PZ Server Manager Auto-Updater',
      'echo ================================================',
      'echo.',
      'echo Waiting for the app to fully close...',
      'timeout /t 5 /nobreak > nul',
      '',
      'echo Extracting update package...',
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force"`,
      'if %errorlevel% neq 0 (',
      '  echo.',
      '  echo ERROR: Extraction failed. Please update manually.',
      '  pause',
      '  exit /b 1',
      ')',
      '',
      'echo Finding extracted app folder...',
      'set "SRC="',
      `for /d %%i in ("${extractDir}\\*") do (`,
      '  if not defined SRC set "SRC=%%i"',
      ')',
      '',
      ':: If no subfolder, the zip extracted flat — use extractDir directly',
      'if not defined SRC (',
      `  set "SRC=${extractDir}"`,
      ')',
      '',
      `echo Copying new files to: ${appDir}`,
      `robocopy "!SRC!" "${appDir}" /E /IS /IT /IM /NP /NJH /NJS 2>nul`,
      ':: robocopy exit codes 0-7 are success (8+ are errors)',
      'if %errorlevel% geq 8 (',
      '  echo Robocopy reported errors, trying xcopy fallback...',
      `  xcopy /E /Y /I "!SRC!\\*" "${appDir}\\" > nul`,
      ')',
      '',
      'echo.',
      'echo Update complete! Relaunching PZ Server Manager...',
      'timeout /t 2 /nobreak > nul',
      `start "" "${appExe}"`,
      '',
      ':: Clean up this batch file',
      'del "%~f0"',
      'exit /b 0',
    ].join('\r\n')

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
      spawn('cmd.exe', ['/c', 'start', 'PZ Updater', '/wait', 'cmd.exe', '/c', batchPath], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
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
