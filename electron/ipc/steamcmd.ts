import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import https from 'https'
import fs from 'fs'

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
const PZ_SERVER_APP_ID = '380870'

export function setupSteamCmdHandlers() {
  // Check if server is installed
  ipcMain.handle('steamcmd:checkInstalled', async (_event, installDir: string) => {
    const serverExe = join(installDir, 'StartServer64.bat')
    const serverExeAlt = join(installDir, 'ProjectZomboidServer.bat')
    return existsSync(serverExe) || existsSync(serverExeAlt)
  })

  // Download SteamCMD
  ipcMain.handle('steamcmd:download', async (_event, targetDir: string) => {
    try {
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true })
      }

      const steamcmdExe = join(targetDir, 'steamcmd.exe')
      if (existsSync(steamcmdExe)) {
        return { success: true, path: steamcmdExe, message: 'SteamCMD already downloaded' }
      }

      const zipPath = join(targetDir, 'steamcmd.zip')

      await downloadFile(STEAMCMD_URL, zipPath)

      // Extract using PowerShell (available on Windows)
      await runCommand('powershell', [
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${targetDir}" -Force`
      ])

      fs.unlinkSync(zipPath)

      return { success: true, path: steamcmdExe, message: 'SteamCMD downloaded successfully' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: `Failed to download SteamCMD: ${msg}` }
    }
  })

  // Install server
  ipcMain.handle('steamcmd:installServer', async (event, { steamcmdPath, installDir, channel }) => {
    return runSteamCmdInstall(event, steamcmdPath, installDir, channel, false)
  })

  // Update server
  ipcMain.handle('steamcmd:updateServer', async (event, { steamcmdPath, installDir, channel }) => {
    return runSteamCmdInstall(event, steamcmdPath, installDir, channel, true)
  })
}

async function runSteamCmdInstall(
  event: Electron.IpcMainInvokeEvent,
  steamcmdPath: string,
  installDir: string,
  channel: string,
  isUpdate: boolean
) {
  try {
    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true })
    }

    const sender = event.sender
    const sendProgress = (line: string) => {
      if (!sender.isDestroyed()) {
        sender.send(channel, line)
      }
    }

    sendProgress(isUpdate ? 'Starting server update...' : 'Starting server installation...')
    sendProgress(`SteamCMD path: ${steamcmdPath}`)
    sendProgress(`Install directory: ${installDir}`)

    const args = [
      `+force_install_dir "${installDir}"`,
      '+login anonymous',
      `+app_update ${PZ_SERVER_APP_ID} -beta unstable validate`,
      '+quit'
    ]

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(steamcmdPath, args, {
        shell: true,
        cwd: require('path').dirname(steamcmdPath),
      })

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        lines.forEach(line => {
          const trimmed = line.trim()
          if (trimmed) sendProgress(trimmed)
        })
      })

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        lines.forEach(line => {
          const trimmed = line.trim()
          if (trimmed) sendProgress(`[ERR] ${trimmed}`)
        })
      })

      proc.on('close', (code) => {
        if (code === 0 || code === 7) {
          sendProgress('Installation complete!')
          resolve()
        } else {
          reject(new Error(`SteamCMD exited with code ${code}`))
        }
      })

      proc.on('error', reject)
    })

    return { success: true, message: isUpdate ? 'Server updated successfully' : 'Server installed successfully' }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return { success: false, message: msg }
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close()
        fs.unlinkSync(dest)
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject)
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', (err) => {
      fs.unlinkSync(dest)
      reject(err)
    })
  })
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: true })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}
