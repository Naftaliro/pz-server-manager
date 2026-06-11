import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
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

      const memoryMb = profile.memory || 4096
      const serverName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')

      // Build the Java command from the batch file logic
      const javaArgs = [
        `-Djava.awt.headless=true`,
        `-Dzomboid.steam=1`,
        `-Dzomboid.znetlog=1`,
        `-XX:+UseZGC`,
        `-XX:-CreateCoredumpOnCrash`,
        `-XX:-OmitStackTraceInFastThrow`,
        `-Xms${memoryMb}m`,
        `-Xmx${memoryMb}m`,
        `-Djava.library.path=natives/;natives/win64/;.`,
        `-cp`, `%PZ_CLASSPATH%`,
        `zombie.network.GameServer`,
        `-statistic`, `0`,
        `-servername`, serverName,
      ]

      if (profile.adminPassword) {
        javaArgs.push(`-adminpassword`, profile.adminPassword)
      }

      // Use the batch file with servername parameter
      const proc = spawn('cmd.exe', ['/c', startBat, `-servername`, serverName], {
        cwd: serverDir,
        shell: false,
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

      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        lines.forEach(line => {
          const trimmed = line.trim()
          if (trimmed) {
            emitConsoleOutput(profileId, trimmed)
            // Detect when server is fully started
            if (trimmed.includes('SERVER STARTED') || trimmed.includes('LuaManager') || trimmed.includes('players connected')) {
              if (serverEntry.status === 'starting') {
                serverEntry.status = 'running'
                emitStatusChange(profileId, 'running')
              }
            }
          }
        })
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        lines.forEach(line => {
          const trimmed = line.trim()
          if (trimmed) emitConsoleOutput(profileId, `[STDERR] ${trimmed}`)
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
      await new Promise(resolve => setTimeout(resolve, 500))

      if (!runningServers.has(profileId)) {
        return { success: false, message: 'Server failed to start' }
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

      // Send quit command via stdin
      if (srv.process.stdin) {
        srv.process.stdin.write('quit\n')
      }

      // Force kill after 30 seconds
      setTimeout(() => {
        if (runningServers.has(profileId)) {
          srv.process.kill('SIGTERM')
        }
      }, 30000)

      return { success: true, message: 'Server stopping...' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  ipcMain.handle('server:restart', async (event, profileId: string) => {
    const stopResult = await ipcMain.emit('server:stop', event, profileId)
    await new Promise(resolve => setTimeout(resolve, 3000))
    return ipcMain.emit('server:start', event, profileId)
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
