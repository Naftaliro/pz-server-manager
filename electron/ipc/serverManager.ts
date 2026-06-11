import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getProfile } from './profileManager'

interface ServerProcess {
  process: ChildProcess
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  startTime: Date
}

const runningServers = new Map<string, ServerProcess>()
let mainWindowRef: BrowserWindow | null = null

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

      // ---------------------------------------------------------------
      // Build the launch args for StartServer64.bat
      //
      // CRITICAL: Always pass -adminpassword so the server never tries to
      // prompt for it interactively via stdin. When the server runs as a
      // child process with piped stdin there is no terminal to respond,
      // which causes a java.util.NoSuchElementException crash on first run.
      // ---------------------------------------------------------------
      const serverArgs: string[] = [
        `-servername`, serverName,
        `-adminpassword`, adminPassword,
      ]

      // Optionally pass -nosteam if steam is not available (helps in some
      // headless setups, but we leave it out by default so Workshop works)

      const proc = spawn('cmd.exe', ['/c', startBat, ...serverArgs], {
        cwd: serverDir,
        shell: false,
        // Keep stdin open so we can send commands (e.g. quit), but the
        // server will never block waiting for interactive input because
        // -adminpassword bypasses the first-run password prompt.
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PZ_SERVER_NAME: serverName,
        },
      })

      const serverEntry: ServerProcess = {
        process: proc,
        status: 'starting',
        startTime: new Date(),
      }
      runningServers.set(profileId, serverEntry)

      emitStatusChange(profileId, 'starting')

      // ---------------------------------------------------------------
      // Watch stdout for key startup markers
      // ---------------------------------------------------------------
      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        const lines = text.split('\n')
        lines.forEach(line => {
          const trimmed = line.trim()
          if (!trimmed) return

          emitConsoleOutput(profileId, trimmed)

          // Detect successful startup
          if (
            trimmed.includes('SERVER STARTED') ||
            trimmed.includes('LuaManager: Loading') ||
            trimmed.includes('players connected') ||
            trimmed.includes('Waiting for connection')
          ) {
            if (serverEntry.status === 'starting') {
              serverEntry.status = 'running'
              emitStatusChange(profileId, 'running')
            }
          }

          // Detect fatal errors early
          if (
            trimmed.includes('Exception in thread "main"') ||
            trimmed.includes('NoSuchElementException') ||
            trimmed.includes('Could not find or load main class')
          ) {
            emitConsoleOutput(profileId, '[ERROR] Server encountered a fatal error and will exit.')
          }
        })
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        lines.forEach(line => {
          const trimmed = line.trim()
          // Filter out noisy but harmless Steam client library warnings
          if (!trimmed) return
          if (
            trimmed.includes('contentupdatecontext.cpp') ||
            trimmed.includes('threadtools.cpp') ||
            trimmed.includes('Assertion Failed: Illegal termination') ||
            trimmed.includes('SetMinidumpSteamID') ||
            trimmed.includes('Setting breakpad')
          ) {
            // Suppress these — they are Steam client noise, not real errors
            return
          }
          emitConsoleOutput(profileId, `[STDERR] ${trimmed}`)
        })
      })

      proc.on('close', (code) => {
        emitConsoleOutput(profileId, `Server process exited with code ${code}`)
        runningServers.delete(profileId)
        emitStatusChange(profileId, 'stopped')
      })

      proc.on('error', (err) => {
        emitConsoleOutput(profileId, `Server error: ${err.message}`)
        runningServers.delete(profileId)
        emitStatusChange(profileId, 'stopped')
      })

      // Give it a moment to detect early failures
      await new Promise(resolve => setTimeout(resolve, 800))

      if (!runningServers.has(profileId)) {
        return { success: false, message: 'Server failed to start. Check the console for details.' }
      }

      return { success: true, message: 'Server starting...' }
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

      // Send quit command via stdin — the graceful way
      if (srv.process.stdin) {
        srv.process.stdin.write('quit\n')
      }

      // Force kill after 30 seconds if it hasn't stopped
      setTimeout(() => {
        if (runningServers.has(profileId)) {
          emitConsoleOutput(profileId, 'Force-killing server after 30s timeout...')
          srv.process.kill('SIGTERM')
        }
      }, 30000)

      return { success: true, message: 'Server stopping...' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  ipcMain.handle('server:restart', async (_event, profileId: string) => {
    const srv = runningServers.get(profileId)
    if (srv) {
      srv.status = 'stopping'
      emitStatusChange(profileId, 'stopping')
      if (srv.process.stdin) srv.process.stdin.write('quit\n')
      // Wait for the process to actually exit before restarting
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          srv.process.kill('SIGTERM')
          resolve()
        }, 15000)
        srv.process.on('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }
    // Small buffer before restart
    await new Promise(resolve => setTimeout(resolve, 1000))
    // Re-invoke start
    const profile = await getProfile(profileId)
    if (!profile) return { success: false, message: 'Profile not found' }
    // Trigger start via IPC emit
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
    if (!srv || !srv.process.stdin) {
      return { success: false, message: 'Server is not running' }
    }
    srv.process.stdin.write(command + '\n')
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
