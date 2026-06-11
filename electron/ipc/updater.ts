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
    if (redirectCount > 5) { reject(new Error('Too many redirects')); return }

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
        // Drain the body so the socket can be reused, then reject
        res.resume()
        reject(new Error(`GitHub API returned HTTP ${res.statusCode} for ${url}`))
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}: ${(e as Error).message}`)) }
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

      const file = fs.createWriteStream(destPath)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (!file.write(chunk)) {
          res.pause()
          file.once('drain', () => res.resume())
        }
        if (total > 0) onProgress(Math.round((received / total) * 100))
      })
      res.on('end', () => {
        file.end()
        file.on('finish', resolve)
        file.on('error', reject)
      })
      res.on('error', (err) => { file.destroy(); reject(err) })
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Download timed out')) })
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

// ── IPC handlers ──────────────────────────────────────────────────────────────

export function setupUpdaterHandlers(mainWindow: BrowserWindow | null) {

  // Check for updates
  ipcMain.handle('updater:check', async () => {
    const currentVersion = getCurrentVersion()
    try {
      const release = await httpsGetJson(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
      ) as GithubRelease

      const latestVersion = release.tag_name.replace(/^v/, '')
      const isNewer = compareVersions(latestVersion, currentVersion) > 0

      // Pick the best Windows zip asset — prefer exact name match, then any win zip
      const asset =
        release.assets.find(a => a.name.match(/win.*\.zip$/i)) ||
        release.assets.find(a => a.name.endsWith('.zip')) ||
        null

      if (!asset) {
        // No downloadable asset found — still report if newer, just no auto-install
        return {
          success: true,
          available: isNewer,
          currentVersion,
          latestVersion,
          releaseNotes: release.body || '',
          releaseUrl: release.html_url,
          downloadUrl: '',
          assetName: '',
          assetSize: 0,
          publishedAt: release.published_at,
        } as UpdateInfo & { success: boolean }
      }

      const info: UpdateInfo = {
        available: isNewer,
        currentVersion,
        latestVersion,
        releaseNotes: release.body || '',
        releaseUrl: release.html_url,
        downloadUrl: asset.browser_download_url,
        assetName: asset.name,
        assetSize: asset.size,
        publishedAt: release.published_at,
      }

      return { success: true, ...info }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, available: false, currentVersion }
    }
  })

  // Download and install update
  // Strategy:
  //   1. Download the zip to %TEMP%\pz-manager-update\
  //   2. Write a .bat that: waits 4s, extracts via PowerShell, robocopy/xcopy new files
  //      over the install dir (skipping userData), then relaunches the exe
  //   3. Launch the bat detached, then quit the app
  //
  // User data lives in app.getPath('userData') and is NEVER touched.
  ipcMain.handle('updater:install', async (_event, downloadUrl: string, assetName: string) => {
    const sendProgress = (stage: string, pct: number) => {
      mainWindow?.webContents.send('updater:progress', { stage, pct })
    }

    try {
      if (!downloadUrl || !assetName) {
        return { success: false, message: 'No download URL available. Please update manually from the GitHub releases page.' }
      }

      const tempDir = path.join(app.getPath('temp'), 'pz-manager-update')
      const zipPath = path.join(tempDir, assetName)
      const extractDir = path.join(tempDir, 'extracted')

      // Clean up any previous attempt
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
      fs.mkdirSync(tempDir, { recursive: true })
      fs.mkdirSync(extractDir, { recursive: true })

      sendProgress('Downloading update...', 0)

      await downloadFile(downloadUrl, zipPath, (pct) => {
        sendProgress('Downloading update...', pct)
      })

      sendProgress('Preparing installer...', 100)

      // Verify the downloaded file looks like a zip (PK magic bytes)
      const header = Buffer.alloc(4)
      const fd = fs.openSync(zipPath, 'r')
      fs.readSync(fd, header, 0, 4, 0)
      fs.closeSync(fd)
      if (header[0] !== 0x50 || header[1] !== 0x4B) {
        return { success: false, message: 'Downloaded file is not a valid zip archive. The release asset may be missing or corrupt.' }
      }

      const appExe = app.getPath('exe')
      const appDir = path.dirname(appExe)

      // Escape paths for batch — wrap in quotes, no backslash doubling needed inside quotes
      const batchScript = `@echo off
setlocal enabledelayedexpansion
title PZ Server Manager - Updating...
echo ================================================
echo  PZ Server Manager Auto-Updater
echo ================================================
echo.
echo Waiting for the app to close...
timeout /t 4 /nobreak > nul

echo Extracting update package...
powershell -NoProfile -NonInteractive -Command ^
  "try { Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if %errorlevel% neq 0 (
  echo.
  echo ERROR: Extraction failed. Please update manually.
  pause
  exit /b 1
)

echo Finding extracted folder...
set "EXTRACTED="
for /d %%i in ("${extractDir}\\*") do (
  if not defined EXTRACTED set "EXTRACTED=%%i"
)

if not defined EXTRACTED (
  echo ERROR: Could not find extracted folder.
  pause
  exit /b 1
)

echo Copying new files to: ${appDir}
robocopy "!EXTRACTED!" "${appDir}" /E /IS /IT /IM /NP /NJH /NJS 2>nul
if %errorlevel% geq 8 (
  echo Robocopy failed, trying xcopy...
  xcopy /E /Y /I "!EXTRACTED!\\*" "${appDir}\\" > nul
)

echo.
echo Update complete! Relaunching...
timeout /t 1 /nobreak > nul
start "" "${appExe}"
del "%~f0"
exit /b 0
`

      const batchPath = path.join(tempDir, 'pz-update.bat')
      fs.writeFileSync(batchPath, batchScript, 'utf-8')

      // Launch the batch script in a visible window so the user can see progress
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', batchPath], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      }).unref()

      // Give the batch a moment to start, then quit
      setTimeout(() => app.quit(), 1000)

      return { success: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Open release page in browser (manual fallback)
  ipcMain.handle('updater:openReleasePage', async (_event, url: string) => {
    shell.openExternal(url)
    return { success: true }
  })

  // Get current version (always live from app)
  ipcMain.handle('updater:getVersion', () => {
    return { version: getCurrentVersion() }
  })
}
