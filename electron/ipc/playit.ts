import { ipcMain, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import net from 'net'

// "Works with playit.gg": the user's own official playit agent, on their own account.
// We never ship playit's binary or touch anyone's account. The app only:
//  - offers the official install (winget, or playit.gg/download)
//  - opens playit's own setup so the user links their account themselves
//  - asks the running agent (read-only) which tunnels it has, so we can show the address
//  - starts the agent's service if it isn't running when a server starts
// Their IPC is newline-delimited JSON over \\.\pipe\playitd-system (ipc_version 2 as of agent 1.0.x).
// If that ever changes we fall back to an address the user pastes in.

// Off until playit approves us as a third-party app (see src/lib/features.ts)
export const PLAYIT_INTEGRATION = false

const PIPE = '\\\\.\\pipe\\playitd-system'
const IPC_VERSION = 2

export interface PlayitTunnel {
  address: string
  destination: string
  disabled: boolean
  disabledReason?: string
}

export interface PlayitState {
  installed: boolean
  exePath: string | null
  running: boolean
  // waiting_for_secret = installed but no account linked yet
  phase: 'not_installed' | 'not_running' | 'needs_setup' | 'starting' | 'running' | 'error' | 'unknown'
  tunnels: PlayitTunnel[]
  notices: string[]
  error?: string
}

function candidatePaths(): string[] {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA || ''
  return [
    join(pf, 'playit_gg', 'bin', 'playit.exe'),
    join(pf86, 'playit_gg', 'bin', 'playit.exe'),
    join(local, 'Programs', 'playit_gg', 'bin', 'playit.exe'),
    join(local, 'Microsoft', 'WinGet', 'Links', 'playit.exe'),
  ]
}

function findOnPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where.exe', ['playit'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const first = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean)
      resolve(first || null)
    })
  })
}

export async function findPlayit(): Promise<string | null> {
  for (const p of candidatePaths()) if (existsSync(p)) return p
  return findOnPath()
}

// One request over the agent's pipe: read the hello, send the request, read the matching response
function ipcRequest(type: string, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PIPE)
    let buf = ''
    let gotHello = false
    const done = (err: Error | null, value?: unknown) => {
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(value)
    }
    const timer = setTimeout(() => done(new Error('playit did not answer')), timeoutMs)
    socket.on('error', (e) => done(e))
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8')
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: any
        try { msg = JSON.parse(line) } catch { return done(new Error('playit sent something unexpected')) }
        if (msg.message_kind === 'hello') {
          const version = msg.data?.protocol?.ipc_version
          if (version !== IPC_VERSION) return done(new Error(`unsupported playit version (ipc ${version})`))
          gotHello = true
          socket.write(JSON.stringify({ ipc_version: IPC_VERSION, request_id: 1, request: { type } }) + '\n')
        } else if (gotHello && msg.message_kind === 'response' && msg.data?.request_id === 1) {
          return done(null, msg.data.response)
        }
      }
    })
  })
}

export async function getPlayitState(): Promise<PlayitState> {
  const exePath = await findPlayit()
  const base: PlayitState = { installed: !!exePath, exePath, running: false, phase: exePath ? 'not_running' : 'not_installed', tunnels: [], notices: [] }

  let response: any
  try {
    response = await ipcRequest('get_state')
  } catch (e) {
    // pipe not there = service not running (or playit not installed at all)
    const msg = e instanceof Error ? e.message : String(e)
    if (/unsupported|unexpected/.test(msg)) return { ...base, installed: true, running: true, phase: 'unknown', error: msg }
    return base
  }

  // {"type":"state","data":{"state":"running","data":{...AgentState}}}
  const lifecycle = response?.data
  const state: string = lifecycle?.state || ''
  const running = { ...base, installed: true, running: true }
  if (state === 'waiting_for_secret' || state === 'has_invalid_secret') return { ...running, phase: 'needs_setup' }
  if (state === 'starting') return { ...running, phase: 'starting' }
  if (state === 'disabled_over_limit' || state === 'error') {
    return { ...running, phase: 'error', error: lifecycle?.data?.message || state.replace(/_/g, ' ') }
  }
  if (state === 'running') {
    const agent = lifecycle?.data || {}
    return {
      ...running,
      phase: 'running',
      tunnels: (agent.tunnels || []).map((t: any) => ({
        address: String(t.display_address || ''),
        destination: String(t.destination || ''),
        disabled: !!t.is_disabled,
        disabledReason: t.disabled_reason || undefined,
      })),
      notices: (agent.notices || []).map((n: any) => String(n.message || '')).filter(Boolean),
    }
  }
  return { ...running, phase: 'unknown' }
}

function run(exe: string, args: string[], timeoutMs = 20000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0, out: `${stdout}${stderr}` })
    })
  })
}

// Starts the installed playit service if it's not already up. Safe to call any time.
export async function ensurePlayitRunning(): Promise<boolean> {
  const state = await getPlayitState()
  if (!state.installed || !state.exePath) return false
  if (state.running) return true
  await run(state.exePath, ['start'])
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if ((await getPlayitState()).running) return true
  }
  return false
}

export function setupPlayitHandlers() {
  // the only thing left on while we wait for approval: opening playit's site when the user clicks
  ipcMain.handle('playit:openDashboard', async () => {
    shell.openExternal('https://playit.gg/account/tunnels')
    return { success: true }
  })
  if (!PLAYIT_INTEGRATION) return

  ipcMain.handle('playit:state', async () => getPlayitState())

  // Official install through winget (Windows' own package manager). Shows its own
  // permission prompt for the installer. If winget isn't there we open the download page.
  ipcMain.handle('playit:install', async () => {
    const hasWinget = await new Promise<boolean>((resolve) => {
      execFile('winget.exe', ['--version'], { windowsHide: true, timeout: 10000 }, (err) => resolve(!err))
    })
    if (!hasWinget) {
      shell.openExternal('https://playit.gg/download')
      return { success: false, openedDownloadPage: true, message: 'Opened the playit download page. Install it, then come back here.' }
    }
    const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const proc = spawn('winget.exe', [
        'install', '--id', 'DevelopedMethods.playit', '-e',
        '--accept-package-agreements', '--accept-source-agreements', '--silent',
      ], { windowsHide: true })
      let out = ''
      proc.stdout.on('data', (d) => { out += d.toString() })
      proc.stderr.on('data', (d) => { out += d.toString() })
      proc.on('close', (code) => resolve({ code, out }))
      proc.on('error', () => resolve({ code: 1, out }))
    })
    const installed = !!(await findPlayit())
    if (installed) return { success: true }
    return { success: false, message: /cancel/i.test(result.out) ? 'The install was cancelled.' : 'The install did not finish. You can grab it from playit.gg/download instead.' }
  })

  // Link the agent to the user's playit account using playit's own setup screen
  ipcMain.handle('playit:setup', async () => {
    const exe = await findPlayit()
    if (!exe) return { success: false, message: 'playit is not installed yet.' }
    // a normal visible console window running their interactive setup
    spawn('cmd.exe', ['/c', `start "playit.gg setup" "${exe}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
    return { success: true }
  })

  ipcMain.handle('playit:start', async () => ({ success: await ensurePlayitRunning() }))
}
