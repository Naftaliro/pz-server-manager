import { ipcMain, app, BrowserWindow, shell } from 'electron'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const GITHUB_OWNER = 'Naftaliro'
const GITHUB_REPO = 'pz-server-manager'
const CURRENT_VERSION = app.getVersion()

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

function httpsGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': `PZServerManager/${CURRENT_VERSION}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }

    const req = https.get(url, options, (res) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        httpsGetJson(res.headers.location).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(e) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

function compareVersions(a: string, b: string): number {
  // Strip leading 'v'
  const clean = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const pa = clean(a)
  const pb = clean(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function downloadFile(url: string, destPath: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doDownload = (downloadUrl: string) => {
      https.get(downloadUrl, { headers: { 'User-Agent': `PZServerManager/${CURRENT_VERSION}` } }, (res) => {
        // Follow redirects (GitHub assets redirect to S3)
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          doDownload(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`))
          return
        }

        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0

        const file = fs.createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          file.write(chunk)
          if (total > 0) onProgress(Math.round((received / total) * 100))
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
      }).on('error', reject)
    }
    doDownload(url)
  })
}

export function setupUpdaterHandlers(mainWindow: BrowserWindow | null) {
  // Check for updates — returns UpdateInfo
  ipcMain.handle('updater:check', async () => {
    try {
      const release = await httpsGetJson(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
      ) as GithubRelease

      const latestVersion = release.tag_name.replace(/^v/, '')
      const isNewer = compareVersions(latestVersion, CURRENT_VERSION) > 0

      // Find the Windows zip asset
      const asset = release.assets.find(a => a.name.endsWith('-win.zip') || a.name.toLowerCase().includes('win'))

      const info: UpdateInfo = {
        available: isNewer,
        currentVersion: CURRENT_VERSION,
        latestVersion,
        releaseNotes: release.body || '',
        releaseUrl: release.html_url,
        downloadUrl: asset?.browser_download_url || release.html_url,
        assetName: asset?.name || '',
        assetSize: asset?.size || 0,
        publishedAt: release.published_at,
      }

      return { success: true, ...info }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg, available: false, currentVersion: CURRENT_VERSION }
    }
  })

  // Download and install update
  // Strategy: download zip → extract to a temp folder → run a helper batch script
  // that waits for the app to close, copies new files over (skipping userData), then relaunches.
  // User data (profiles, settings) lives in app.getPath('userData') which is NEVER touched.
  ipcMain.handle('updater:install', async (_event, downloadUrl: string, assetName: string) => {
    try {
      const tempDir = path.join(app.getPath('temp'), 'pz-manager-update')
      const zipPath = path.join(tempDir, assetName)
      const extractDir = path.join(tempDir, 'extracted')

      // Clean up any previous update attempt
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
      fs.mkdirSync(tempDir, { recursive: true })
      fs.mkdirSync(extractDir, { recursive: true })

      // Report progress to renderer
      const sendProgress = (stage: string, pct: number) => {
        mainWindow?.webContents.send('updater:progress', { stage, pct })
      }

      sendProgress('Downloading update...', 0)

      // Download the zip
      await downloadFile(downloadUrl, zipPath, (pct) => {
        sendProgress('Downloading update...', pct)
      })

      sendProgress('Preparing update...', 100)

      // Get current app install path
      const appPath = path.dirname(app.getPath('exe'))
      const userDataPath = app.getPath('userData')

      // Write a Windows batch script that:
      // 1. Waits for the app to exit
      // 2. Extracts the zip (using PowerShell's Expand-Archive)
      // 3. Copies new files over the install dir (excluding userData)
      // 4. Relaunches the app
      const batchScript = `@echo off
echo PZ Server Manager Updater
echo Waiting for app to close...
timeout /t 3 /nobreak > nul

echo Extracting update...
powershell -Command "Expand-Archive -Path '${zipPath.replace(/\\/g, '\\\\')}' -DestinationPath '${extractDir.replace(/\\/g, '\\\\')}' -Force"
if errorlevel 1 (
  echo Extraction failed!
  pause
  exit /b 1
)

echo Finding extracted app folder...
for /d %%i in ("${extractDir.replace(/\\/g, '\\\\')}\\*") do set EXTRACTED=%%i

echo Copying new files to ${appPath.replace(/\\/g, '\\\\')}...
xcopy /E /Y /I "%EXTRACTED%\\*" "${appPath.replace(/\\/g, '\\\\')}\\"

echo Update complete! Relaunching...
start "" "${app.getPath('exe').replace(/\\/g, '\\\\')}"
del "%~f0"
`

      const batchPath = path.join(tempDir, 'update.bat')
      fs.writeFileSync(batchPath, batchScript)

      // Launch the batch script detached (it will wait for us to close)
      const { spawn } = require('child_process')
      spawn('cmd.exe', ['/c', batchPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }).unref()

      // Quit the app so the batch script can proceed
      setTimeout(() => {
        app.quit()
      }, 500)

      return { success: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Open release page in browser (fallback / manual update)
  ipcMain.handle('updater:openReleasePage', async (_event, url: string) => {
    shell.openExternal(url)
    return { success: true }
  })

  // Get current version
  ipcMain.handle('updater:getVersion', () => {
    return { version: CURRENT_VERSION }
  })
}
