import { ipcMain, BrowserWindow } from 'electron'
import { spawn, exec, execFile, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, writeFileSync, mkdirSync, readFileSync, statSync, openSync, readSync, closeSync, unlinkSync, readdirSync } from 'fs'
import { cp, rm } from 'fs/promises'
import { randomBytes } from 'crypto'
import dgram from 'dgram'
import os from 'os'
import https from 'https'
import { getProfile, listProfiles, patchProfile, getServerName } from './profileManager'
import type { ServerProfile } from './profileManager'
import { rconCommand } from './rcon'
import { isServerInstalled, checkServerUpdate } from './steamcmd'
import { workshopContentDir, scanWorkshopItem, fetchModDetails, PZ_APP_ID } from './modManager'
import { loadSettings } from './appSettings'
import { ensurePlayitRunning, PLAYIT_INTEGRATION } from './playit'
import { firewallRuleExists } from './network'
import { notify, escapeDiscord, DISCORD_COLORS } from './discord'

// 'starting' = java is up but still loading the world/mods, 'running' = friends can join
type Status = 'starting' | 'running' | 'stopping' | 'stopped'

interface ServerProcess {
  pid: number | null
  status: Status
  serverName: string
  serverDir: string
  logPath: string
  logOffset: number
  watcher: NodeJS.Timeout | null
  logTimer: NodeJS.Timeout | null
  playersTimer: NodeJS.Timeout | null
  modTimer: NodeJS.Timeout | null
  players: string[]
  // set while a planned restart (mod update) is counting down
  pendingRestart: NodeJS.Timeout | null
  // picked back up after the app was reopened, so Discord already knows it's online
  reattached?: boolean
}

const runningServers = new Map<string, ServerProcess>()
// servers going down on purpose to come right back (restart button, daily, mod update)
const restarting = new Set<string>()
// last few problems per server, kept for the diagnostics report
const recentProblems = new Map<string, Array<{ hint: string; line: string; at: number }>>()
let mainWindowRef: BrowserWindow | null = null

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
function resolveDataPath(worldSavePath?: string): string {
  const raw = worldSavePath || '%USERPROFILE%\\Zomboid'
  return raw.replace(/%USERPROFILE%/gi, process.env.USERPROFILE || process.env.HOME || '')
}

// ---------------------------------------------------------------------------
// Mods: B42 wants Mods=\ModA;\ModB, B41 wants Mods=ModA;ModB
// ---------------------------------------------------------------------------
export function formatModIds(modIds: string[], buildVersion?: string): string {
  return modIds
    .flatMap(id => (id || '').split(';'))
    .map(id => id.trim().replace(/^\\+/, ''))
    .filter(Boolean)
    .map(id => (buildVersion === 'b41' ? id : `\\${id}`))
    .join(';')
}

function enabledIds(mod: ServerProfile['mods'][number]): string[] {
  return (mod.modId || '').split(';').map(s => s.trim().replace(/^\\+/, '')).filter(Boolean)
}

// Keep the user's order, but make sure anything a mod requires loads before it
export function orderModIds(profile: ServerProfile): string[] {
  const ids = profile.mods.flatMap(enabledIds)
  const requires = new Map<string, string[]>()
  for (const m of profile.mods) for (const id of enabledIds(m)) requires.set(id, m.requires || [])

  const present = new Set(ids)
  const out: string[] = []
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (out.includes(id) || visiting.has(id)) return
    visiting.add(id)
    for (const dep of requires.get(id) || []) if (present.has(dep)) visit(dep)
    visiting.delete(id)
    out.push(id)
  }
  ids.forEach(visit)
  return out
}

// Map= needs the mod map folders first and the vanilla map last
function buildMapLine(profile: ServerProfile): string {
  const base = String(profile.iniSettings?.Map || 'Muldraugh, KY')
  const modMaps = profile.mods.flatMap(m => m.maps || [])
  const parts = [...modMaps, ...base.split(';').map(s => s.trim())].filter(Boolean)
  return [...new Set(parts)].join(';')
}

// ---------------------------------------------------------------------------
// Config writers
// ---------------------------------------------------------------------------
function writeProfileIni(serverName: string, dataPath: string, profile: ServerProfile): void {
  const serverDir = join(dataPath, 'Server')
  if (!existsSync(serverDir)) mkdirSync(serverDir, { recursive: true })

  const settings: Record<string, unknown> = {
    ...(profile.iniSettings || {}),
    // Always override these from the profile so they stay in sync
    DefaultPort: profile.port,
    UDPPort: profile.udpPort,
    MaxPlayers: profile.maxPlayers,
    Password: profile.serverPassword || '',
    WorkshopItems: profile.mods.map(m => m.workshopId).filter(Boolean).join(';'),
    Mods: formatModIds(orderModIds(profile), profile.buildVersion),
    Map: buildMapLine(profile),
  }

  const lines: string[] = [
    '# Project Zomboid Server Configuration',
    `# Profile: ${profile.name}`,
    '# Generated by PZ Server Manager — do not edit manually while server is running',
    '',
  ]
  for (const [key, value] of Object.entries(settings)) {
    if (value === null || value === undefined) continue
    lines.push(`${key}=${value}`)
  }
  writeFileSync(join(serverDir, `${serverName}.ini`), lines.join('\n') + '\n', 'utf-8')
}

function luaValue(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  // some defaults were stored with their quotes already on, don't double them up
  const str = String(value).replace(/^"(.*)"$/, '$1').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${str}"`
}

function writeProfileSandbox(serverName: string, dataPath: string, profile: ServerProfile): void {
  const serverDir = join(dataPath, 'Server')
  if (!existsSync(serverDir)) mkdirSync(serverDir, { recursive: true })

  const settings = profile.sandboxSettings || {}
  const zombieConfig = (settings.ZombieConfig as Record<string, unknown>) || {}
  const lines: string[] = [
    '-- Project Zomboid Sandbox Configuration',
    `-- Profile: ${profile.name}`,
    '-- Generated by PZ Server Manager',
    '',
    'SandboxVars = {',
  ]
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'ZombieConfig' || value === null || value === undefined) continue
    lines.push(`    ${key} = ${luaValue(value)},`)
  }
  lines.push('    ZombieConfig = {')
  for (const [key, value] of Object.entries(zombieConfig)) {
    if (value === null || value === undefined) continue
    lines.push(`        ${key} = ${luaValue(value)},`)
  }
  lines.push('    },')
  lines.push('}')
  writeFileSync(join(serverDir, `${serverName}_SandboxVars.lua`), lines.join('\n') + '\n', 'utf-8')
}

// ---------------------------------------------------------------------------
// Make a copy of StartServer64.bat we can tweak every launch:
//  - the stock bat only forwards %1 %2, so -adminpassword / -cachedir got dropped
//  - swap in the profile's memory for -Xms / -Xmx (stock B42 bat hardcodes 16g, which fails on smaller PCs)
// Regenerated on every start so Steam updates to the real bat still apply.
// ---------------------------------------------------------------------------
function writePatchedStartBat(serverDir: string, serverName: string, memoryMb?: number): string {
  const original = readFileSync(join(serverDir, 'StartServer64.bat'), 'utf-8')
  let patched = original
    .replace(/%1 %2(?: %3)?(?: %4)?(?: %5)?(?: %6)?/g, '%*')
    // the stock bat ends in PAUSE, which leaves a "press any key" window behind after every stop
    .replace(/^\s*PAUSE\s*$/gim, '')
  if (memoryMb && memoryMb >= 1024) {
    patched = patched
      .replace(/-Xms\d+[mMgG]?/g, `-Xms${memoryMb}m`)
      .replace(/-Xmx\d+[mMgG]?/g, `-Xmx${memoryMb}m`)
  }
  const name = `_pzm_StartServer64_${serverName}.bat`
  writeFileSync(join(serverDir, name), patched)
  return name
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

// wmic got removed in newer Windows 11 builds, so ask CIM through powershell.
// Returns every java process that has a -servername, keyed by that name.
function findServerPids(): Promise<Map<string, number>> {
  return new Promise((resolve) => {
    const script = `Get-CimInstance Win32_Process -Filter "Name LIKE 'java%.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        const result = new Map<string, number>()
        if (err || !stdout || !stdout.trim()) return resolve(result)
        try {
          const parsed = JSON.parse(stdout)
          const procs: Array<{ ProcessId: number; CommandLine: string | null }> = Array.isArray(parsed) ? parsed : [parsed]
          for (const p of procs) {
            const match = (p.CommandLine || '').match(/-servername\s+"?([^"\s]+)"?/i)
            if (match) result.set(match[1], p.ProcessId)
          }
        } catch { /* bad json, treat as none */ }
        resolve(result)
      }
    )
  })
}

async function findServerPid(serverName: string): Promise<number | null> {
  // exact match so "Server1" doesn't grab "Server10"
  return (await findServerPids()).get(serverName) ?? null
}

function isPidAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${pid}" /NH`, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false)
      resolve(stdout.includes(String(pid)))
    })
  })
}

function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`taskkill /PID ${pid} /T /F`, { timeout: 10000, windowsHide: true }, () => resolve())
  })
}

// Last resort when RCON isn't answering: type into the console window
function sendKeysToWindow(serverName: string, text: string): Promise<void> {
  const escaped = text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}')
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -Command "& {$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('PZ Server - ${serverName}'); Start-Sleep -Milliseconds 200; $wshell.SendKeys('${escaped}{ENTER}')}"`,
      { timeout: 5000, windowsHide: true },
      () => resolve()
    )
  })
}

function rconFor(profileId: string, command: string, timeoutMs?: number): Promise<string> {
  const profile = getProfile(profileId)
  if (!profile) return Promise.reject(new Error('Profile not found'))
  const port = Number(profile.iniSettings?.RCONPort || 27015)
  const password = String(profile.iniSettings?.RCONPassword || '')
  if (!password) return Promise.reject(new Error('No RCON password set'))
  return rconCommand(port, password, command, timeoutMs)
}

// ---------------------------------------------------------------------------
// Server log tailing. PZ writes everything to <data>\server-console.txt,
// which is how we know when it's actually ready and what went wrong.
// ---------------------------------------------------------------------------
const READY_PATTERN = /SERVER STARTED/i
const PROBLEM_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /required mod .* not found|mod .* is missing|missing.*required/i, hint: 'A mod needs another mod that is not in your list.' },
  { pattern: /workshop.*(fail|error)|failed to download|ItemNotFound|item state.*not installed/i, hint: 'A workshop mod failed to download. Try "Download mods" on the Mods tab.' },
  { pattern: /Address already in use|BindException/i, hint: 'The port is already in use. Another server might still be running.' },
  { pattern: /OutOfMemoryError|Could not reserve enough space/i, hint: 'The server ran out of memory. Lower or raise the memory setting depending on your PC.' },
  { pattern: /map.*not found|cannot find map/i, hint: 'A map mod is missing or its map name is wrong.' },
]

function tailLog(profileId: string, srv: ServerProcess) {
  if (!existsSync(srv.logPath)) return
  let size: number
  try { size = statSync(srv.logPath).size } catch { return }
  if (size < srv.logOffset) srv.logOffset = 0 // file got recreated on launch
  if (size === srv.logOffset) return

  const fd = openSync(srv.logPath, 'r')
  try {
    const length = Math.min(size - srv.logOffset, 512 * 1024)
    const buf = Buffer.alloc(length)
    readSync(fd, buf, 0, length, srv.logOffset)
    srv.logOffset += length
    for (const line of buf.toString('utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue
      emitConsoleOutput(profileId, line)
      if (srv.status === 'starting' && READY_PATTERN.test(line)) markRunning(profileId, srv)
      for (const p of PROBLEM_PATTERNS) {
        if (p.pattern.test(line)) {
          emitProblem(profileId, p.hint, line)
          break
        }
      }
    }
  } finally {
    closeSync(fd)
  }
}

function markRunning(profileId: string, srv: ServerProcess) {
  if (srv.status !== 'starting') return
  srv.status = 'running'
  emitStatusChange(profileId, 'running')
  emitConsoleOutput(profileId, `[PZ Manager] Server is up, players can join now.`)
  const profile = patchProfile(profileId, { lastStarted: new Date().toISOString() })
  if (!srv.reattached) {
    const name = `**${escapeDiscord(profile?.name || srv.serverName)}**`
    const back = restarting.delete(profileId)
    const addressFor = async () => profile?.playitAddress || (await getPublicIp().then(ip => ip && `${ip}:${profile?.port || 16261}`))
    void addressFor().then(address => notify(profile, `🟢 ${name} is ${back ? 'back ' : ''}online${address ? `\nJoin at \`${address}\`` : ''}`, DISCORD_COLORS.green))
  }

  // keep the player list fresh while it's running
  let polledOnce = false
  const pollPlayers = async () => {
    try {
      const out = await rconFor(profileId, 'players', 4000)
      // "Players connected (2):\n-alice\n-bob"
      const names = out.split(/\r?\n/).filter(l => l.trim().startsWith('-')).map(l => l.trim().slice(1))
      // the first poll is everyone already on, not people joining
      if (polledOnce) {
        const profile = getProfile(profileId)
        for (const n of names.filter(n => !srv.players.includes(n))) notify(profile, `➡️ ${escapeDiscord(n)} joined (${names.length} online)`, DISCORD_COLORS.blue, 'players')
        for (const n of srv.players.filter(n => !names.includes(n))) notify(profile, `⬅️ ${escapeDiscord(n)} left (${names.length} online)`, DISCORD_COLORS.gray, 'players')
      }
      polledOnce = true
      srv.players = names
      emitPlayers(profileId, names)
    } catch { /* rcon not up yet or busy, try again next time */ }
  }
  pollPlayers()
  srv.playersTimer = setInterval(pollPlayers, 20000)
  srv.modTimer = setInterval(() => { void checkModUpdates(profileId, srv) }, 15 * 60 * 1000)

  // "Works with playit.gg": make sure the user's tunnel agent is up while the server is
  if (PLAYIT_INTEGRATION && loadSettings().playitEnabled) {
    ensurePlayitRunning().then(ok => {
      if (!ok) emitProblem(profileId, "playit.gg isn't running, so friends can't use the playit address. Open App settings to fix it.", 'playit service not running')
    }).catch(() => undefined)
  }
}

function cleanup(profileId: string) {
  const srv = runningServers.get(profileId)
  if (!srv) return
  if (srv.watcher) clearInterval(srv.watcher)
  if (srv.logTimer) clearInterval(srv.logTimer)
  if (srv.playersTimer) clearInterval(srv.playersTimer)
  if (srv.modTimer) clearInterval(srv.modTimer)
  if (srv.pendingRestart) clearTimeout(srv.pendingRestart)
  runningServers.delete(profileId)
  if (srv.status === 'stopping' && !restarting.has(profileId)) {
    const profile = getProfile(profileId)
    notify(profile, `🔴 **${escapeDiscord(profile?.name || srv.serverName)}** was stopped`, DISCORD_COLORS.gray)
  }
  emitPlayers(profileId, [])
  emitStatusChange(profileId, 'stopped')
}

// Start watching a server process we know the PID of
function attach(profileId: string, srv: ServerProcess, pid: number) {
  srv.pid = pid
  srv.logTimer = setInterval(() => tailLog(profileId, srv), 1000)

  // if the log never shows up (custom setups), RCON answering means it's ready too
  let rconChecks = 0
  srv.watcher = setInterval(async () => {
    if (!srv.pid) return
    if (!(await isPidAlive(srv.pid))) {
      const crashed = srv.status === 'running' || srv.status === 'starting'
      emitConsoleOutput(profileId, `[PZ Manager] Server process (PID ${srv.pid}) has stopped.`)
      cleanup(profileId)
      if (crashed) handleCrash(profileId)
      return
    }
    if (srv.status === 'starting' && ++rconChecks % 3 === 0) {
      try {
        await rconFor(profileId, 'players', 3000)
        markRunning(profileId, srv)
      } catch { /* still loading */ }
    }
  }, 5000)
}

// ---------------------------------------------------------------------------
// Crash recovery: the server died without anyone pressing Stop. Bring it back,
// but give up if it keeps dying (something's actually broken then).
// ---------------------------------------------------------------------------
const crashTimes = new Map<string, number[]>()

function handleCrash(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) return
  const recent = (crashTimes.get(profileId) || []).filter(t => Date.now() - t < 30 * 60 * 1000)
  recent.push(Date.now())
  crashTimes.set(profileId, recent)

  const name = `**${escapeDiscord(profile.name)}**`
  if (profile.autoRestart === false) {
    emitProblem(profileId, 'The server stopped unexpectedly. Check the console log to see why.', 'Server process exited')
    notify(profile, `💥 ${name} crashed`, DISCORD_COLORS.red)
    return
  }
  if (recent.length > 3) {
    emitProblem(profileId, 'The server keeps crashing, so it was not restarted again. The console log should say why (often a broken mod).', 'Crashed 3 times in 30 minutes')
    notify(profile, `💥 ${name} keeps crashing, so it was left off. The host needs to take a look.`, DISCORD_COLORS.red)
    return
  }
  restarting.add(profileId)
  notify(profile, `💥 ${name} crashed, restarting it...`, DISCORD_COLORS.red)
  emitProblem(profileId, 'The server crashed, restarting it automatically...', 'Server process exited unexpectedly')
  emitConsoleOutput(profileId, `[PZ Manager] Server crashed, restarting in 10 seconds (${recent.length}/3)...`)
  setTimeout(() => { if (!runningServers.has(profileId)) void startAfterRestart(profileId) }, 10000)
}

// ---------------------------------------------------------------------------
// Mod updates: when a mod updates on the Workshop, players with the new version
// can't join until the server restarts. Check every 15 minutes while running.
// ---------------------------------------------------------------------------
function installedModTimes(serverInstallPath: string): Map<string, number> {
  const times = new Map<string, number>()
  try {
    const acf = readFileSync(join(serverInstallPath, 'steamapps', 'workshop', `appworkshop_${PZ_APP_ID}.acf`), 'utf-8')
    const installed = acf.slice(acf.search(/"WorkshopItemsInstalled"/i))
    // first match per id wins, the WorkshopItemDetails section further down repeats ids with other times
    for (const m of installed.matchAll(/"(\d+)"\s*\{[^}]*?"timeupdated"\s+"(\d+)"/g)) {
      if (!times.has(m[1])) times.set(m[1], Number(m[2]))
    }
  } catch { /* nothing downloaded yet */ }
  return times
}

async function checkModUpdates(profileId: string, srv: ServerProcess) {
  const profile = getProfile(profileId)
  if (!profile || profile.mods.length === 0 || srv.status !== 'running' || srv.pendingRestart) return
  const local = installedModTimes(profile.serverInstallPath)
  let remote
  try { remote = await fetchModDetails(profile.mods.map(m => m.workshopId)) } catch { return }
  const updated = remote.filter(r => (local.get(r.workshopId) || Infinity) < r.timeUpdated)
  if (updated.length === 0) return

  const names = updated.map(u => u.name)
  emitModUpdates(profileId, names)
  emitConsoleOutput(profileId, `[PZ Manager] Mods updated on the Workshop: ${names.join(', ')}`)
  if (profile.restartOnModUpdate !== false) scheduleRestart(profileId, srv, 5, 'to update mods')
}

// a failed start shouldn't leave the next manual start saying "back online"
async function startAfterRestart(profileId: string) {
  const result = await startServer(profileId)
  if (!result.success) restarting.delete(profileId)
  return result
}

// Warn players in chat, then restart
function scheduleRestart(profileId: string, srv: ServerProcess, minutes: number, reason: string) {
  if (srv.pendingRestart) return
  const say = (msg: string) => rconFor(profileId, `servermsg "${msg}"`).catch(() => undefined)
  say(`Server restarting in ${minutes} minutes ${reason}`)
  emitConsoleOutput(profileId, `[PZ Manager] Restarting in ${minutes} minutes ${reason}.`)
  const profile = getProfile(profileId)
  notify(profile, `🔄 **${escapeDiscord(profile?.name || srv.serverName)}** restarts in ${minutes} minutes ${reason}`, DISCORD_COLORS.yellow)
  const oneMinuteLeft = setTimeout(() => say(`Server restarting in 1 minute ${reason}`), (minutes - 1) * 60 * 1000)
  srv.pendingRestart = setTimeout(async () => {
    clearTimeout(oneMinuteLeft)
    await say('Restarting now, see you in a minute!')
    restarting.add(profileId)
    await stopServer(profileId)
    await new Promise(r => setTimeout(r, 3000))
    await startAfterRestart(profileId)
  }, minutes * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Daily restart: long-running PZ servers slowly eat memory and lag, so restart
// at a quiet hour. The 5 minute warning starts early so it's back up on the hour.
// ---------------------------------------------------------------------------
const DAILY_WARNING_MINUTES = 5
const lastDailyRestart = new Map<string, string>()

// Returns a key for today's restart when it's time to start warning, null otherwise
export function dailyRestartDue(hour: number, now: Date, lastKey?: string): string | null {
  const target = new Date(now)
  target.setHours(hour, 0, 0, 0)
  // 23:55 warning for a midnight restart belongs to tomorrow's slot
  if (target.getTime() - now.getTime() > 12 * 60 * 60 * 1000) target.setDate(target.getDate() - 1)
  if (target.getTime() - now.getTime() < -12 * 60 * 60 * 1000) target.setDate(target.getDate() + 1)
  const warnAt = target.getTime() - DAILY_WARNING_MINUTES * 60 * 1000
  const key = target.toDateString()
  // a few minutes of slack in case the PC was asleep or busy when the tick landed
  if (now.getTime() < warnAt || now.getTime() > warnAt + 3 * 60 * 1000 || key === lastKey) return null
  return key
}

function checkDailyRestarts() {
  for (const [profileId, srv] of runningServers) {
    const hour = getProfile(profileId)?.dailyRestartHour
    if (hour == null || srv.status !== 'running' || srv.pendingRestart) continue
    const key = dailyRestartDue(hour, new Date(), lastDailyRestart.get(profileId))
    if (!key) continue
    lastDailyRestart.set(profileId, key)
    scheduleRestart(profileId, srv, DAILY_WARNING_MINUTES, '(daily restart)')
  }
}

// ---------------------------------------------------------------------------
// Backups: copy the world before every start, keep the last few
// ---------------------------------------------------------------------------
function backupRoot(profile: ServerProfile): string {
  return join(resolveDataPath(profile.worldSavePath), 'pzm-backups', getServerName(profile))
}

function worldDir(profile: ServerProfile): string {
  return join(resolveDataPath(profile.worldSavePath), 'Saves', 'Multiplayer', getServerName(profile))
}

function dbFile(profile: ServerProfile): string {
  return join(resolveDataPath(profile.worldSavePath), 'db', `${getServerName(profile)}.db`)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

async function backupWorld(profile: ServerProfile, label = '', prune = true): Promise<string | null> {
  const world = worldDir(profile)
  if (!existsSync(world)) return null
  const dest = join(backupRoot(profile), stamp() + (label ? `_${label}` : ''))
  await cp(world, join(dest, 'world'), { recursive: true })
  if (existsSync(dbFile(profile))) await cp(dbFile(profile), join(dest, 'players.db'))
  // keep the newest N
  if (prune) {
    const keep = Math.max(1, profile.backupsToKeep || 5)
    for (const old of listBackupNames(profile).slice(keep)) await rm(join(backupRoot(profile), old), { recursive: true, force: true })
  }
  return dest
}

function listBackupNames(profile: ServerProfile): string[] {
  try {
    return readdirSync(backupRoot(profile)).filter(n => /^\d{4}-\d{2}-\d{2}_/.test(n)).sort().reverse()
  } catch {
    return []
  }
}

function dirSizeMb(p: string): number {
  let total = 0
  const walk = (d: string) => {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name)
        if (e.isDirectory()) walk(f)
        else { try { total += statSync(f).size } catch { /* skip */ } }
      }
    } catch { /* skip */ }
  }
  walk(p)
  return Math.round(total / 1024 / 1024 * 10) / 10
}

async function restoreBackup(profileId: string, name: string): Promise<{ success: boolean; message: string }> {
  const profile = getProfile(profileId)
  if (!profile) return { success: false, message: 'Profile not found' }
  if (runningServers.has(profileId)) return { success: false, message: 'Stop the server first.' }
  const src = join(backupRoot(profile), name)
  if (!existsSync(join(src, 'world'))) return { success: false, message: "That backup doesn't exist anymore." }
  // keep what's there now, in case they change their mind. No pruning here, or the
  // backup we're about to restore could be the one that gets deleted to make room
  await backupWorld(profile, 'before-restore', false)
  await rm(worldDir(profile), { recursive: true, force: true })
  await cp(join(src, 'world'), worldDir(profile), { recursive: true })
  if (existsSync(join(src, 'players.db'))) await cp(join(src, 'players.db'), dbFile(profile))
  return { success: true, message: 'Backup restored. Start the server to play it.' }
}

// What the diagnostics report needs to know about one server
export function serverDiagnostics(profileId: string) {
  const srv = runningServers.get(profileId)
  const profile = getProfile(profileId)
  return {
    status: srv?.status || 'stopped',
    pid: srv?.pid ?? null,
    players: srv?.players.length ?? 0,
    logPath: profile ? join(resolveDataPath(profile.worldSavePath), 'server-console.txt') : null,
    problems: recentProblems.get(profileId) || [],
  }
}

// On app launch, pick back up any servers that were left running
async function reattachRunning() {
  const pids = await findServerPids()
  if (pids.size === 0) return
  for (const profile of listProfiles()) {
    const serverName = getServerName(profile)
    const pid = pids.get(serverName)
    if (!pid || runningServers.has(profile.id)) continue
    const dataPath = resolveDataPath(profile.worldSavePath)
    const logPath = join(dataPath, 'server-console.txt')
    const srv: ServerProcess = {
      pid, status: 'starting', serverName, serverDir: profile.serverInstallPath,
      logPath, logOffset: 0, watcher: null, logTimer: null, playersTimer: null, modTimer: null, players: [], pendingRestart: null,
      reattached: true,
    }
    runningServers.set(profile.id, srv)
    emitStatusChange(profile.id, 'starting')
    emitConsoleOutput(profile.id, `[PZ Manager] Found this server already running (PID ${pid}), reconnected.`)
    attach(profile.id, srv, pid)
    // replays the existing log, which flips it to running if it already finished loading
    tailLog(profile.id, srv)
  }
}

// ---------------------------------------------------------------------------
// Pre-start checks. Each issue says what's wrong in plain words.
// ---------------------------------------------------------------------------
interface PreflightIssue {
  level: 'error' | 'warning'
  message: string
  fix?: 'install-server' | 'download-mods' | 'open-mods' | 'open-settings' | 'update-server' | 'firewall'
}

function udpPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    sock.once('error', () => { sock.close(); resolve(false) })
    sock.bind(port, () => { sock.close(); resolve(true) })
  })
}

async function preflight(profileId: string): Promise<PreflightIssue[]> {
  const profile = getProfile(profileId)
  if (!profile) return [{ level: 'error', message: 'This server profile no longer exists.' }]
  const issues: PreflightIssue[] = []

  if (!isServerInstalled(profile.serverInstallPath)) {
    issues.push({ level: 'error', message: `The game server isn't installed at ${profile.serverInstallPath}.`, fix: 'install-server' })
  }

  // out of date = nobody on the current game version can join
  try {
    const upd = await checkServerUpdate(profile.serverInstallPath)
    if (upd.updateAvailable) {
      issues.push({
        level: 'warning',
        message: upd.steamManaged
          ? 'The game got an update and this server is older. Open Steam and let it update "Project Zomboid Dedicated Server", or friends on the new version can\'t join.'
          : 'The game got an update and this server is older, so friends on the new version can\'t join. Update it first (takes a couple of minutes).',
        fix: upd.steamManaged ? undefined : 'update-server',
      })
    }
  } catch { /* offline or steamcmd busy, don't block starting */ }

  if (!(await firewallRuleExists())) {
    issues.push({ level: 'warning', message: "Windows Firewall hasn't been told to allow the server yet, so it may block friends.", fix: 'firewall' })
  }

  // ports clash with another server in the app?
  for (const other of listProfiles()) {
    if (other.id === profile.id) continue
    const otherRunning = runningServers.has(other.id)
    if (otherRunning && other.port === profile.port) {
      issues.push({ level: 'error', message: `"${other.name}" is already running on port ${other.port}. Stop it first or change this server's port.`, fix: 'open-settings' })
    }
  }
  if (!runningServers.has(profile.id) && !(await udpPortFree(profile.port))) {
    issues.push({ level: 'error', message: `Port ${profile.port} is being used by something else (maybe a server that's still shutting down).` })
  }

  // memory
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
  if (profile.memory > totalMb - 2048) {
    issues.push({ level: 'error', message: `Memory is set to ${profile.memory} MB but this PC only has ${totalMb} MB. Lower it in Settings.`, fix: 'open-settings' })
  } else if (profile.buildVersion !== 'b41' && profile.memory < 4096) {
    issues.push({ level: 'warning', message: `Only ${profile.memory} MB of memory. B42 servers really want 8192 MB or more.`, fix: 'open-settings' })
  }

  // mods
  const contentDir = workshopContentDir(profile.serverInstallPath)
  const notDownloaded = profile.mods.filter(m => !existsSync(join(contentDir, m.workshopId)))
  if (notDownloaded.length > 0) {
    issues.push({
      level: 'warning',
      message: `${notDownloaded.length} mod${notDownloaded.length > 1 ? 's are' : ' is'} not downloaded yet. The server will try on start, but downloading here first is more reliable.`,
      fix: 'download-mods',
    })
  }

  const enabled = new Set(profile.mods.flatMap(enabledIds))
  for (const m of profile.mods) {
    if (!m.modId || m.modId === m.workshopId) {
      issues.push({
        level: 'error',
        message: (m.infos?.length || 0) > 1
          ? `"${m.name}" has several mods inside. Pick which ones to turn on in the Mods tab.`
          : `"${m.name}" doesn't have a mod ID yet. Download it so the app can read it, or type it in.`,
        fix: 'open-mods',
      })
    }
  }

  // requirements from the downloaded mod.info files (fresh scan, in case files changed)
  for (const m of profile.mods) {
    const itemDir = join(contentDir, m.workshopId)
    if (!existsSync(itemDir)) continue
    const infos = scanWorkshopItem(itemDir).filter(i => enabledIds(m).includes(i.id))
    for (const info of infos) {
      for (const dep of info.requires) {
        if (!enabled.has(dep)) {
          issues.push({ level: 'error', message: `"${m.name}" needs the mod "${dep}", which isn't in your list.`, fix: 'open-mods' })
        }
      }
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------
async function startServer(profileId: string): Promise<{ success: boolean; message: string }> {
  try {
    const existing = runningServers.get(profileId)
    if (existing && existing.status !== 'stopped') {
      return { success: false, message: 'Server is already running' }
    }

    let profile = getProfile(profileId)
    if (!profile) return { success: false, message: 'Profile not found' }

    const serverDir = profile.serverInstallPath
    if (!existsSync(join(serverDir, 'StartServer64.bat'))) {
      return { success: false, message: 'Server files not found. Install the server first.' }
    }

    // older profiles had no RCON password, the app needs one to talk to the server
    if (!profile.iniSettings?.RCONPassword) {
      profile = patchProfile(profileId, {
        iniSettings: { ...profile.iniSettings, RCONPassword: randomBytes(12).toString('hex') },
      }) || profile
    }

    const serverName = getServerName(profile)
    const adminPassword = profile.adminPassword || 'admin'
    const dataPath = resolveDataPath(profile.worldSavePath)
    const launchMode = profile.launchMode || 'managed'
    emitConsoleOutput(profileId, `[PZ Manager] Launch mode: ${launchMode}`)
    emitConsoleOutput(profileId, `[PZ Manager] Data path: ${dataPath}`)

    // In 'passthrough' mode the user edits files directly and the app must NOT overwrite them
    if (launchMode === 'managed') {
      emitConsoleOutput(profileId, `[PZ Manager] Writing config files for "${serverName}"...`)
      try {
        writeProfileIni(serverName, dataPath, profile)
        emitConsoleOutput(profileId, `[PZ Manager] ✓ Wrote ${serverName}.ini`)
      } catch (e) {
        emitConsoleOutput(profileId, `[PZ Manager] ⚠ Failed to write INI: ${e instanceof Error ? e.message : String(e)}`)
      }
      try {
        writeProfileSandbox(serverName, dataPath, profile)
        emitConsoleOutput(profileId, `[PZ Manager] ✓ Wrote ${serverName}_SandboxVars.lua`)
      } catch (e) {
        emitConsoleOutput(profileId, `[PZ Manager] ⚠ Failed to write SandboxVars: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      emitConsoleOutput(profileId, `[PZ Manager] Passthrough mode — using existing config files as-is`)
    }

    let startBatName = 'StartServer64.bat'
    try {
      startBatName = writePatchedStartBat(serverDir, serverName, launchMode === 'managed' ? profile.memory : undefined)
      if (launchMode === 'managed' && profile.memory) emitConsoleOutput(profileId, `[PZ Manager] Memory: ${profile.memory} MB`)
    } catch (e) {
      emitConsoleOutput(profileId, `[PZ Manager] ⚠ Couldn't patch StartServer64.bat, using stock one: ${e instanceof Error ? e.message : String(e)}`)
    }

    // -cachedir points PZ at a custom data folder so it reads OUR named config files
    const cacheArg = dataPath !== resolveDataPath() ? ` -cachedir="${dataPath}"` : ''
    const launcherPath = join(serverDir, `_pzm_launch_${serverName}.bat`)
    writeFileSync(launcherPath, [
      `@echo off`,
      `title PZ Server - ${serverName}`,
      `cd /d "${serverDir}"`,
      `echo ================================================`,
      `echo  Project Zomboid Server: ${serverName}`,
      `echo  Managed by PZ Server Manager - use the app to stop it`,
      `echo ================================================`,
      `call ${startBatName} -servername "${serverName}" -adminpassword "${adminPassword}"${cacheArg}`,
    ].join('\r\n'))

    if (profile.backupsEnabled !== false) {
      try {
        const made = await backupWorld(profile)
        if (made) emitConsoleOutput(profileId, `[PZ Manager] ✓ Backed up the world`)
      } catch (e) {
        emitConsoleOutput(profileId, `[PZ Manager] ⚠ Backup failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // last session's log is still sitting there and has its own "SERVER STARTED" in it,
    // so clear it (PZ makes a fresh one) or skip past it if something has it locked
    const logPath = join(dataPath, 'server-console.txt')
    let logOffset = 0
    try {
      if (existsSync(logPath)) unlinkSync(logPath)
    } catch {
      try { logOffset = statSync(logPath).size } catch { /* gone already */ }
    }

    // minimized so it stays out of the way but still shows up in the taskbar
    // built as one verbatim string: node escapes quotes inside args as \" and `start`
    // chokes on that, so the server silently never launched
    const proc: ChildProcess = spawn(
      'cmd.exe',
      ['/c', `start "PZ Server - ${serverName}" /min /D "${serverDir}" "${launcherPath}"`],
      { cwd: serverDir, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }
    )
    proc.unref()

    const srv: ServerProcess = {
      pid: null, status: 'starting', serverName, serverDir,
      logPath, logOffset, watcher: null, logTimer: null, playersTimer: null, modTimer: null, players: [], pendingRestart: null,
    }
    runningServers.set(profileId, srv)
    emitStatusChange(profileId, 'starting')
    emitConsoleOutput(profileId, `[PZ Manager] Starting up. First start with mods can take a few minutes...`)

    let attempts = 0
    const pollForPid = async () => {
      if (!runningServers.has(profileId)) return
      attempts++
      const pid = await findServerPid(serverName)
      if (pid) {
        emitConsoleOutput(profileId, `[PZ Manager] Server process found (PID ${pid}), loading world...`)
        attach(profileId, srv, pid)
      } else if (attempts < 45) {
        setTimeout(pollForPid, 2000)
      } else {
        emitConsoleOutput(profileId, `[PZ Manager] The server never started. Open its window in the taskbar to see why.`)
        emitProblem(profileId, 'The server process never started.', 'Java process not found after 90 seconds')
        cleanup(profileId)
      }
    }
    setTimeout(pollForPid, 3000)

    return { success: true, message: `Server "${serverName}" launching...` }
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function stopServer(profileId: string): Promise<{ success: boolean; message: string }> {
  const srv = runningServers.get(profileId)
  if (!srv) return { success: false, message: 'Server is not running' }

  srv.status = 'stopping'
  emitStatusChange(profileId, 'stopping')
  emitConsoleOutput(profileId, `[PZ Manager] Saving and stopping "${srv.serverName}"...`)

  // stopped right after Start, before java showed up? find it so it doesn't get left running
  if (!srv.pid) {
    for (let i = 0; i < 10 && !srv.pid; i++) {
      srv.pid = await findServerPid(srv.serverName)
      if (!srv.pid) await new Promise(resolve => setTimeout(resolve, 2000))
    }
    if (srv.pid) {
      // nothing is loaded yet, so there's no world to save
      await killProcessTree(srv.pid)
      cleanup(profileId)
      return { success: true, message: 'Server stopped.' }
    }
  }

  if (srv.pid) {
    try {
      await rconFor(profileId, 'quit', 4000)
    } catch {
      emitConsoleOutput(profileId, `[PZ Manager] RCON didn't answer, sending quit to the console window instead`)
      await sendKeysToWindow(srv.serverName, 'quit')
    }

    // give it time to save the world
    for (let waited = 0; waited < 60000; waited += 2000) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      if (!(await isPidAlive(srv.pid))) {
        emitConsoleOutput(profileId, `[PZ Manager] Server stopped.`)
        break
      }
    }
    if (await isPidAlive(srv.pid)) {
      emitConsoleOutput(profileId, `[PZ Manager] Server didn't stop on its own, force-stopping...`)
      await killProcessTree(srv.pid)
    }
  }
  cleanup(profileId)
  return { success: true, message: 'Server stopped.' }
}

// ---------------------------------------------------------------------------
// Network info for the "invite friends" box
// ---------------------------------------------------------------------------
let cachedPublicIp: { ip: string; at: number } | null = null

function getPublicIp(): Promise<string | null> {
  if (cachedPublicIp && Date.now() - cachedPublicIp.at < 10 * 60 * 1000) return Promise.resolve(cachedPublicIp.ip)
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org', (res) => {
      let data = ''
      res.on('data', (c: Buffer) => { data += c })
      res.on('end', () => {
        const ip = data.trim()
        if (/^[\d.]+$/.test(ip)) {
          cachedPublicIp = { ip, at: Date.now() }
          resolve(ip)
        } else resolve(null)
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(5000, () => { req.destroy(); resolve(null) })
  })
}

function getLanIps(): string[] {
  const out: string[] = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
export function setupServerHandlers(mainWindow: BrowserWindow | null) {
  mainWindowRef = mainWindow

  ipcMain.handle('server:start', async (_event, profileId: string) => startServer(profileId))
  ipcMain.handle('server:stop', async (_event, profileId: string) => stopServer(profileId))

  ipcMain.handle('server:restart', async (_event, profileId: string) => {
    if (runningServers.has(profileId)) {
      emitConsoleOutput(profileId, `[PZ Manager] Restarting server...`)
      restarting.add(profileId)
      await stopServer(profileId)
      await new Promise(resolve => setTimeout(resolve, 2000))
      return startAfterRestart(profileId)
    }
    return startServer(profileId)
  })

  ipcMain.handle('server:getStatus', async (_event, profileId: string) => runningServers.get(profileId)?.status || 'stopped')

  ipcMain.handle('server:getAllStatuses', async () => {
    const statuses: Record<string, string> = {}
    runningServers.forEach((srv, id) => { statuses[id] = srv.status })
    return statuses
  })

  ipcMain.handle('server:getPlayers', async (_event, profileId: string) => runningServers.get(profileId)?.players || [])

  ipcMain.handle('server:sendCommand', async (_event, profileId: string, command: string) => {
    const srv = runningServers.get(profileId)
    if (!srv || !srv.pid) return { success: false, message: 'Server is not running' }
    if (/^\/?quit\s*$/i.test(command.trim())) {
      void stopServer(profileId)
      return { success: true, output: '' }
    }
    emitConsoleOutput(profileId, `> ${command}`)
    try {
      const out = await rconFor(profileId, command)
      if (out) out.split(/\r?\n/).forEach(line => emitConsoleOutput(profileId, line))
      return { success: true, output: out }
    } catch {
      await sendKeysToWindow(srv.serverName, command)
      return { success: true, output: '' }
    }
  })

  ipcMain.handle('server:preflight', async (_event, profileId: string) => preflight(profileId))

  // kick / ban / admin from the players list
  ipcMain.handle('server:playerAction', async (_event, profileId: string, action: 'kick' | 'ban' | 'admin' | 'unadmin', name: string) => {
    const safe = name.replace(/"/g, '')
    const command = {
      kick: `kickuser "${safe}"`,
      ban: `banuser "${safe}"`,
      admin: `setaccesslevel "${safe}" admin`,
      unadmin: `setaccesslevel "${safe}" none`,
    }[action]
    if (!command) return { success: false, message: 'Unknown action' }
    try {
      const out = await rconFor(profileId, command)
      emitConsoleOutput(profileId, `> ${command}`)
      if (out) emitConsoleOutput(profileId, out)
      return { success: true, message: out }
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('server:restartWithWarning', async (_event, profileId: string, minutes: number) => {
    const srv = runningServers.get(profileId)
    if (!srv || srv.status !== 'running') return { success: false, message: 'Server is not running' }
    scheduleRestart(profileId, srv, Math.max(1, minutes), 'for an update')
    return { success: true }
  })

  ipcMain.handle('server:listBackups', async (_event, profileId: string) => {
    const profile = getProfile(profileId)
    if (!profile) return []
    return listBackupNames(profile).map(name => ({ name, sizeMb: dirSizeMb(join(backupRoot(profile), name)) }))
  })

  ipcMain.handle('server:backupNow', async (_event, profileId: string) => {
    const profile = getProfile(profileId)
    if (!profile) return { success: false, message: 'Profile not found' }
    try {
      const made = await backupWorld(profile, 'manual')
      return made ? { success: true, message: 'Backup made.' } : { success: false, message: 'No world to back up yet.' }
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('server:restoreBackup', async (_event, profileId: string, name: string) => restoreBackup(profileId, name))

  ipcMain.handle('server:openBackups', async (_event, profileId: string) => {
    const profile = getProfile(profileId)
    if (!profile) return ''
    mkdirSync(backupRoot(profile), { recursive: true })
    return backupRoot(profile)
  })

  ipcMain.handle('server:networkInfo', async () => ({
    publicIp: await getPublicIp(),
    lanIps: getLanIps(),
  }))

  setInterval(checkDailyRestarts, 30 * 1000)

  // pick up servers that were left running when the app was closed
  setTimeout(() => { reattachRunning().catch(() => undefined) }, 3000)
  // look up the latest server build in the background so the first Start doesn't wait on it
  setTimeout(() => {
    const dir = loadSettings().serverInstallPath
    if (isServerInstalled(dir)) checkServerUpdate(dir).catch(() => undefined)
  }, 8000)
}

function emitConsoleOutput(profileId: string, line: string) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(`server:console:${profileId}`, line)
  }
}

function emitStatusChange(profileId: string, status: Status) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('server:statusChange', profileId, status)
  }
}

function emitPlayers(profileId: string, players: string[]) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('server:players', profileId, players)
  }
}

function emitModUpdates(profileId: string, names: string[]) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('server:modUpdates', profileId, names)
  }
}

function emitProblem(profileId: string, hint: string, line: string) {
  const list = recentProblems.get(profileId) || []
  list.push({ hint, line, at: Date.now() })
  recentProblems.set(profileId, list.slice(-10))
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('server:problem', profileId, { hint, line, at: Date.now() })
  }
}
