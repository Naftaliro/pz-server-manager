import { ipcMain, BrowserWindow } from 'electron'
import { spawn, exec, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { getProfile } from './profileManager'

interface ServerProcess {
  // The watcher is a lightweight polling process, not the server itself.
  // The actual server runs in its own visible cmd.exe window.
  watcher: NodeJS.Timeout | null
  pid: number | null          // PID of the server's java.exe process
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  startTime: Date
  serverName: string
  serverDir: string
}

const runningServers = new Map<string, ServerProcess>()
let mainWindowRef: BrowserWindow | null = null

// ---------------------------------------------------------------------------
// Find the PID of the java.exe process that owns our server by matching the
// -servername argument in the command line.
// ---------------------------------------------------------------------------
function findServerPid(serverName: string): Promise<number | null> {
  return new Promise((resolve) => {
    // WMIC gives us the full command line of every java.exe process
    exec(
      `wmic process where "name='java.exe'" get ProcessId,CommandLine /format:csv`,
      { timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const lines = stdout.split('\n')
        for (const line of lines) {
          if (line.includes(`-servername`) && line.includes(serverName)) {
            const parts = line.trim().split(',')
            // CSV columns: Node, CommandLine, ProcessId
            const pid = parseInt(parts[parts.length - 1], 10)
            if (!isNaN(pid)) return resolve(pid)
          }
        }
        resolve(null)
      }
    )
  })
}

// ---------------------------------------------------------------------------
// Check whether a PID is still alive.
// ---------------------------------------------------------------------------
function isPidAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${pid}" /NH`, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false)
      resolve(stdout.includes(String(pid)))
    })
  })
}

// ---------------------------------------------------------------------------
// Kill a process tree by PID (kills java.exe + any child processes).
// ---------------------------------------------------------------------------
function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`taskkill /PID ${pid} /T /F`, { timeout: 10000 }, () => resolve())
  })
}

export function setupServerHandlers(mainWindow: BrowserWindow | null) {
  mainWindowRef = mainWindow

  ipcMain.handle('server:start', async (_event, profileId: string) => {
    try {
      if (runningServers.has(profileId)) {
        const srv = runningServers.get(profileId)!
        if (srv.status === 'running' || srv.status === 'starting') {
          return { success: false, message: 'Server is already running' }
        }
      }

      const profile = await getProfile(profileId)
      if (!profile) return { success: false, message: 'Profile not found' }

      const serverDir = profile.serverInstallPath
      const startBat = join(serverDir, 'StartServer64.bat')

      if (!existsSync(startBat)) {
        return { success: false, message: 'Server files not found. Please install the server first.' }
      }

      const serverName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const adminPassword = profile.adminPassword || 'admin'

      // -----------------------------------------------------------------------
      // Write a tiny launcher batch file that:
      //   1. Opens a NEW visible cmd.exe window (just like double-clicking the bat)
      //   2. Passes -servername and -adminpassword so the server never blocks
      //      waiting for interactive input
      //   3. Keeps the window open after the server exits (pause) so you can
      //      read any error messages
      // -----------------------------------------------------------------------
      const launcherPath = join(serverDir, `_pzm_launch_${serverName}.bat`)
      const launcherContent = [
        `@echo off`,
        `title PZ Server - ${serverName}`,
        `cd /d "${serverDir}"`,
        `echo Starting Project Zomboid Server: ${serverName}`,
        `echo.`,
        `call StartServer64.bat -servername "${serverName}" -adminpassword "${adminPassword}"`,
        `echo.`,
        `echo ============================================`,
        `echo  Server stopped. You may close this window.`,
        `echo ============================================`,
        `pause`,
      ].join('\r\n')

      writeFileSync(launcherPath, launcherContent)

      // Launch in a NEW visible console window using `start` (same as double-click)
      // /WAIT is NOT used so we return immediately; we poll for the PID separately.
      const proc: ChildProcess = spawn(
        'cmd.exe',
        ['/c', 'start', `"PZ Server - ${serverName}"`, '/D', serverDir, launcherPath],
        {
          cwd: serverDir,
          detached: true,
          stdio: 'ignore',
          shell: false,
        }
      )
      proc.unref()

      const serverEntry: ServerProcess = {
        watcher: null,
        pid: null,
        status: 'starting',
        startTime: new Date(),
        serverName,
        serverDir,
      }
      runningServers.set(profileId, serverEntry)
      emitStatusChange(profileId, 'starting')
      emitConsoleOutput(profileId, `[PZ Manager] Launching server "${serverName}" in external console window...`)
      emitConsoleOutput(profileId, `[PZ Manager] Admin password: ${adminPassword}`)
      emitConsoleOutput(profileId, `[PZ Manager] Server dir: ${serverDir}`)
      emitConsoleOutput(profileId, `[PZ Manager] Watch the console window that just opened for live server output.`)

      // -----------------------------------------------------------------------
      // Poll for the java.exe PID — it takes a few seconds to appear after
      // the cmd window opens.
      // -----------------------------------------------------------------------
      let attempts = 0
      const maxAttempts = 30  // 30 × 2s = 60s max wait

      const pollForPid = async () => {
        attempts++
        const pid = await findServerPid(serverName)
        if (pid) {
          serverEntry.pid = pid
          serverEntry.status = 'running'
          emitStatusChange(profileId, 'running')
          emitConsoleOutput(profileId, `[PZ Manager] Server process detected (PID ${pid}). Server is running.`)

          // Now watch for the process to exit
          serverEntry.watcher = setInterval(async () => {
            if (!serverEntry.pid) return
            const alive = await isPidAlive(serverEntry.pid)
            if (!alive) {
              emitConsoleOutput(profileId, `[PZ Manager] Server process (PID ${serverEntry.pid}) has stopped.`)
              if (serverEntry.watcher) clearInterval(serverEntry.watcher)
              runningServers.delete(profileId)
              emitStatusChange(profileId, 'stopped')
            }
          }, 5000)

        } else if (attempts < maxAttempts) {
          // Keep polling
          setTimeout(pollForPid, 2000)
        } else {
          // Timed out — server may have crashed immediately
          emitConsoleOutput(profileId, `[PZ Manager] Could not detect server process after 60s. It may have crashed — check the console window.`)
          runningServers.delete(profileId)
          emitStatusChange(profileId, 'stopped')
        }
      }

      // Start polling after 3 seconds (give the window time to open)
      setTimeout(pollForPid, 3000)

      return { success: true, message: 'Server launching in external console window...' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  ipcMain.handle('server:stop', async (_event, profileId: string) => {
    const srv = runningServers.get(profileId)
    if (!srv) return { success: false, message: 'Server is not running' }

    try {
      srv.status = 'stopping'
      emitStatusChange(profileId, 'stopping')
      emitConsoleOutput(profileId, `[PZ Manager] Stopping server "${srv.serverName}"...`)

      if (srv.pid) {
        // Graceful: send the PZ quit command via rcon-style stdin injection
        // Since we can't pipe to the detached window, we use taskkill gracefully
        // first, then force-kill after a timeout.
        emitConsoleOutput(profileId, `[PZ Manager] Sending stop signal to PID ${srv.pid}...`)

        // Try graceful stop first via a helper cmd that sends input to the window
        // PZ listens on its console for "quit" — we use a PowerShell approach
        await new Promise<void>((resolve) => {
          exec(
            `powershell -Command "& {$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('PZ Server - ${srv.serverName}'); Start-Sleep -Milliseconds 200; $wshell.SendKeys('quit{ENTER}')}"`,
            { timeout: 5000 },
            () => resolve()
          )
        })

        // Wait up to 30 seconds for graceful exit
        let waited = 0
        while (waited < 30000) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          waited += 2000
          const alive = await isPidAlive(srv.pid)
          if (!alive) {
            emitConsoleOutput(profileId, `[PZ Manager] Server stopped gracefully.`)
            break
          }
        }

        // Force kill if still running
        const stillAlive = await isPidAlive(srv.pid)
        if (stillAlive) {
          emitConsoleOutput(profileId, `[PZ Manager] Force-stopping server...`)
          await killProcessTree(srv.pid)
        }
      }

      if (srv.watcher) clearInterval(srv.watcher)
      runningServers.delete(profileId)
      emitStatusChange(profileId, 'stopped')

      return { success: true, message: 'Server stopped.' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  ipcMain.handle('server:restart', async (_event, profileId: string) => {
    const srv = runningServers.get(profileId)
    if (srv && srv.pid) {
      // Stop first
      if (srv.watcher) clearInterval(srv.watcher)
      emitConsoleOutput(profileId, `[PZ Manager] Restarting server...`)
      await killProcessTree(srv.pid)
      runningServers.delete(profileId)
      emitStatusChange(profileId, 'stopped')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    // Re-trigger start
    return ipcMain.emit('server:start', { sender: mainWindowRef?.webContents }, profileId)
  })

  ipcMain.handle('server:getStatus', async (_event, profileId: string) => {
    const srv = runningServers.get(profileId)
    return srv ? srv.status : 'stopped'
  })

  ipcMain.handle('server:getAllStatuses', async () => {
    const statuses: Record<string, string> = {}
    runningServers.forEach((srv, id) => {
      statuses[id] = srv.status
    })
    return statuses
  })

  ipcMain.handle('server:sendCommand', async (_event, profileId: string, command: string) => {
    const srv = runningServers.get(profileId)
    if (!srv || !srv.pid) {
      return { success: false, message: 'Server is not running' }
    }
    // Send command to the visible console window via PowerShell SendKeys
    emitConsoleOutput(profileId, `[PZ Manager] Sending command: ${command}`)
    await new Promise<void>((resolve) => {
      exec(
        `powershell -Command "& {$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('PZ Server - ${srv.serverName}'); Start-Sleep -Milliseconds 100; $wshell.SendKeys('${command.replace(/'/g, "''")}'); $wshell.SendKeys('{ENTER}')}"`,
        { timeout: 5000 },
        () => resolve()
      )
    })
    return { success: true }
  })
}

function emitConsoleOutput(profileId: string, line: string) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(`server:console:${profileId}`, line)
  }
}

function emitStatusChange(profileId: string, status: string) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('server:statusChange', profileId, status)
  }
}
