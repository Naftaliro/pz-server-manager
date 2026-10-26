import { ipcMain, app, clipboard } from 'electron'
import { existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import os from 'os'
import { loadSettings } from './appSettings'
import { listProfiles } from './profileManager'
import { serverDiagnostics } from './serverManager'
import { getPlayitState } from './playit'
import { firewallRuleExists } from './network'
import { lastDiscordError } from './discord'

// "Copy diagnostics": one paste-able report so a friend saying "it doesn't work"
// turns into something fixable. Gets pasted into public GitHub issues, so
// passwords, public IPs, Steam IDs and the Windows username are scrubbed.

const appErrors: Array<{ at: number; where: string; message: string }> = []

export function recordAppError(where: string, err: unknown) {
  const message = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err)
  appErrors.push({ at: Date.now(), where, message: message.slice(0, 2000) })
  if (appErrors.length > 10) appErrors.shift()
}

const SECRET_KEY = /password|token|secret/i

function secrets(): string[] {
  const found = new Set<string>()
  for (const p of listProfiles()) {
    found.add(p.adminPassword)
    found.add(p.serverPassword)
    if (p.discordWebhook) found.add(p.discordWebhook)
    for (const [key, value] of Object.entries(p.iniSettings || {})) {
      if (SECRET_KEY.test(key) && typeof value === 'string') found.add(value)
    }
  }
  // short values like "1" would scrub half the report
  return [...found].filter(s => s && s.length >= 4).sort((a, b) => b.length - a.length)
}

const isPrivateIp = (ip: string) =>
  /^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)

function scrub(text: string, hidden: string[]): string {
  let out = text
  for (const s of hidden) out = out.split(s).join('<password>')
  const user = os.userInfo().username
  if (user) out = out.replace(new RegExp(`(\\\\Users\\\\|/Users/|/home/)${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), '$1<user>')
  out = out.replace(/\b7656119\d{10}\b/g, '<steamid>')
  // game versions look like IPs too (42.12.3.1), keep anything labelled as a version
  out = out.replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, (ip, _octet, offset: number, all: string) =>
    isPrivateIp(ip) || /(version|build|v)[\s:=]*$/i.test(all.slice(Math.max(0, offset - 12), offset)) ? ip : '<public ip>')
  return out
}

function tailFile(path: string, maxLines: number): string {
  if (!existsSync(path)) return '(no log file yet)'
  const size = statSync(path).size
  const length = Math.min(size, 64 * 1024)
  const buf = Buffer.alloc(length)
  const fd = openSync(path, 'r')
  try { readSync(fd, buf, 0, length, size - length) } finally { closeSync(fd) }
  return buf.toString('utf-8').split(/\r?\n/).filter(l => l.trim()).slice(-maxLines).join('\n')
}

const time = (at: number) => new Date(at).toISOString().replace('T', ' ').slice(0, 19)

export async function buildDiagnostics(): Promise<string> {
  const settings = loadSettings()
  const lines: string[] = []
  const section = (title: string) => lines.push('', `## ${title}`)

  lines.push('# Knox Launcher diagnostics', `generated ${time(Date.now())} UTC`)

  section('App')
  lines.push(
    `version: ${app.getVersion()} (electron ${process.versions.electron})`,
    `windows: ${os.release()} ${os.arch()}`,
    `memory: ${Math.round(os.totalmem() / 1024 ** 3)} GB total, ${Math.round(os.freemem() / 1024 ** 3)} GB free`,
    `cpu: ${os.cpus()[0]?.model || 'unknown'} x${os.cpus().length}`,
    `server install: ${settings.serverInstallPath} (${settings.steamManaged ? 'steam library' : 'steamcmd'}, ${settings.buildVersion})`,
    `steamcmd: ${settings.steamcmdDir}`,
    `setup done: ${settings.setupComplete}, advanced mode: ${settings.advancedMode}`,
  )

  section('Network')
  const firewall = await firewallRuleExists().catch(() => null)
  lines.push(`firewall rule: ${firewall === null ? 'could not check' : firewall ? 'yes' : 'no'}`)
  try {
    const playit = await getPlayitState()
    lines.push(`playit: ${playit.phase}, ${playit.tunnels.length} tunnel(s)${playit.error ? `, error: ${playit.error}` : ''}`)
    for (const t of playit.tunnels) {
      lines.push(`  tunnel -> ${t.destination}${t.disabled ? ` (disabled: ${t.disabledReason || 'unknown'})` : ''}`)
    }
  } catch (e) {
    lines.push(`playit: could not check (${e instanceof Error ? e.message : e})`)
  }

  for (const p of listProfiles()) {
    const d = serverDiagnostics(p.id)
    section(`Server "${p.name}"`)
    lines.push(
      `status: ${d.status}${d.pid ? ` (pid ${d.pid})` : ''}, ${d.players} player(s) online`,
      `build: ${p.buildVersion}, ports: ${p.port}/${p.udpPort}, memory: ${p.memory} MB, launch: ${p.launchMode || 'managed'}`,
      `auto restart: ${p.autoRestart !== false}, restart on mod update: ${p.restartOnModUpdate !== false}, backups: ${p.backupsEnabled !== false} (keep ${p.backupsToKeep || 5})`,
      `daily restart: ${p.dailyRestartHour == null ? 'off' : `${p.dailyRestartHour}:00`}`,
      `discord: ${p.discordWebhook ? `on${p.discordPlayerEvents ? ' (with joins)' : ''}${lastDiscordError.has(p.discordWebhook) ? `, last error: ${lastDiscordError.get(p.discordWebhook)}` : ''}` : 'off'}`,
      `last started: ${p.lastStarted || 'never'}`,
      `mods (${p.mods.length}): ${p.mods.map(m => `${m.workshopId} [${m.modId || '?'}]`).join(', ') || 'none'}`,
    )
    if (d.problems.length) {
      lines.push('recent problems:')
      for (const pr of d.problems) lines.push(`  [${time(pr.at)}] ${pr.hint} -> ${pr.line}`)
    }
    if (d.logPath) {
      let log: string
      try { log = tailFile(d.logPath, 150) } catch (e) { log = `(could not read log: ${e instanceof Error ? e.message : e})` }
      lines.push('', 'last log lines:', '```', log, '```')
    }
  }

  section('App errors')
  if (appErrors.length === 0) lines.push('none')
  for (const e of appErrors) lines.push(`[${time(e.at)}] ${e.where}: ${e.message}`)

  return scrub(lines.join('\n'), secrets())
}

export function setupDiagnosticsHandlers() {
  process.on('uncaughtExceptionMonitor', err => recordAppError('main', err))
  process.on('unhandledRejection', err => recordAppError('main (promise)', err))

  ipcMain.on('diagnostics:reportError', (_event, where: string, message: string) => recordAppError(where, message))
  ipcMain.handle('diagnostics:copy', async () => {
    const text = await buildDiagnostics()
    // returns a promise since Electron 44, a failed copy would otherwise go unnoticed
    await clipboard.writeText(text)
    return text
  })
}
