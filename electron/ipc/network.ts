import { ipcMain, app } from 'electron'
import { execFile } from 'child_process'
import dgram from 'dgram'
import os from 'os'
import http from 'http'
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { listProfiles } from './profileManager'
import { loadSettings } from './appSettings'
import { firewallScript, firewallRemoveScript, firewallQueryScript, firewallState, type FirewallEntry, type FirewallRuleInfo } from './winScripts'

// ── UPnP check ──────────────────────────────────────────────────────────────
// PZ asks the router to open its ports over UPnP. This asks the router whether that
// actually happened, and spots the cases where port forwarding can never work
// (CGNAT: the "public" address the router has is itself a private one).

interface Gateway {
  controlUrl: string
  serviceType: string
}

// Ask every network adapter, PCs with WSL/Hyper-V/VPN adapters otherwise send the search out the wrong one
function ssdpDiscover(timeoutMs = 3000): Promise<string[]> {
  const lanIps = Object.values(os.networkInterfaces()).flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address)
  return new Promise((resolve) => {
    const locations = new Set<string>()
    const sockets: dgram.Socket[] = []
    const targets = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2']
    for (const ip of lanIps.length ? lanIps : ['0.0.0.0']) {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      sockets.push(sock)
      sock.on('message', (msg) => {
        const m = msg.toString().match(/^location:\s*(.+)$/im)
        if (m) locations.add(m[1].trim())
      })
      sock.on('error', () => { try { sock.close() } catch { /* already closed */ } })
      sock.bind(0, ip, () => {
        for (const st of targets) {
          const req = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`
          sock.send(req, 1900, '239.255.255.250', () => undefined)
        }
      })
    }
    setTimeout(() => {
      for (const sock of sockets) { try { sock.close() } catch { /* already closed */ } }
      resolve([...locations])
    }, timeoutMs)
  })
}

function httpRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers, timeout: 4000 }, (res) => {
      let body = ''
      res.on('data', (c: Buffer) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

async function findGateway(): Promise<Gateway | null> {
  for (const location of await ssdpDiscover()) {
    try {
      const { body } = await httpRequest(location)
      // first WAN connection service with a control URL
      const services = body.split(/<service>/i).slice(1)
      for (const s of services) {
        const type = s.match(/<serviceType>([^<]+)<\/serviceType>/i)?.[1]
        const control = s.match(/<controlURL>([^<]+)<\/controlURL>/i)?.[1]
        if (type && control && /WAN(IP|PPP)Connection/i.test(type)) {
          return { controlUrl: new URL(control, location).toString(), serviceType: type.trim() }
        }
      }
    } catch { /* try the next one */ }
  }
  return null
}

async function soap(gw: Gateway, action: string, args: Record<string, string | number> = {}): Promise<string | null> {
  const argXml = Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gw.serviceType}">${argXml}</u:${action}></s:Body></s:Envelope>`
  try {
    const res = await httpRequest(gw.controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.serviceType}#${action}"` },
      body,
    })
    return res.status === 200 ? res.body : null
  } catch {
    return null
  }
}

function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a === 127 || a === 0
}

export interface UpnpReport {
  routerFound: boolean
  routerExternalIp: string | null
  // the router itself sits behind another network (common with some ISPs and mobile internet)
  cgnat: boolean
  portOpen: boolean | null
  summary: string
}

export async function checkUpnp(port: number, publicIp: string | null): Promise<UpnpReport> {
  const gw = await findGateway()
  if (!gw) {
    return {
      routerFound: false, routerExternalIp: null, cgnat: false, portOpen: null,
      summary: "Your router didn't answer UPnP requests, so it can't open ports by itself. Use playit.gg, or forward the ports by hand.",
    }
  }
  const ipXml = await soap(gw, 'GetExternalIPAddress')
  const routerIp = ipXml?.match(/<NewExternalIPAddress>([^<]*)<\/NewExternalIPAddress>/i)?.[1] || null
  const cgnat = !!routerIp && (isPrivateIp(routerIp) || (!!publicIp && routerIp !== publicIp))

  const mapping = await soap(gw, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'UDP' })
  const portOpen = !!mapping && /<NewInternalPort>/i.test(mapping)

  let summary: string
  if (cgnat) summary = "Your internet provider shares one public address between lots of customers (CGNAT), so opening ports on your router can't work. playit.gg gets around this."
  else if (portOpen) summary = `Your router opened port ${port} for the server, friends should be able to join with your address.`
  else summary = `Your router supports UPnP, but port ${port} isn't open. Start the server and check again, or use playit.gg.`
  return { routerFound: true, routerExternalIp: routerIp, cgnat, portOpen, summary }
}

// ── Windows Firewall ─────────────────────────────────────────────────────────
export function javaPath(serverInstallPath: string): string {
  return join(serverInstallPath, 'jre64', 'bin', 'java.exe')
}

// What the rule has to open: each server install's java.exe with the DefaultPort and
// UDPPort of every server profile using it. Before any server exists (setup), the
// install that's being set up with the default ports
function neededFirewall(serverInstallPath?: string): FirewallEntry[] {
  const byProgram = new Map<string, FirewallEntry>()
  const add = (install: string | undefined, ports: number[]) => {
    if (!install) return
    const program = javaPath(install)
    if (!existsSync(program)) return
    const key = program.toLowerCase()
    if (!byProgram.has(key)) byProgram.set(key, { program, ports: [] })
    byProgram.get(key)!.ports.push(...ports)
  }
  for (const p of listProfiles()) add(p.serverInstallPath, [p.port, p.udpPort || p.port + 1])
  const fallback = serverInstallPath || loadSettings().serverInstallPath
  if (fallback && !byProgram.has(javaPath(fallback).toLowerCase())) add(fallback, [16261, 16262])
  return [...byProgram.values()]
}

function readFirewallRules(): Promise<FirewallRuleInfo[] | null> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', firewallQueryScript()], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(null)
      try { resolve(JSON.parse(stdout)) } catch { resolve(null) }
    })
  })
}

// Asking Windows starts PowerShell, which takes about a second, and the rules only change
// when the app adds or removes them. So the answer is kept for a minute (and calls that
// come in at the same time share one PowerShell). What the servers need is worked out
// fresh every time, so a changed port still shows up right away
let rulesCache: { at: number; rules: Promise<FirewallRuleInfo[] | null> } | null = null
function cachedFirewallRules(): Promise<FirewallRuleInfo[] | null> {
  if (!rulesCache || Date.now() - rulesCache.at > 60_000) rulesCache = { at: Date.now(), rules: readFirewallRules() }
  return rulesCache.rules
}

export async function firewallStatus(serverInstallPath?: string) {
  const needed = neededFirewall(serverInstallPath)
  const rules = await cachedFirewallRules()
  // couldn't ask Windows: don't nag about the firewall over that
  if (!rules) return { exists: true, upToDate: true, oldRule: false, anyRule: false, ports: [] as number[], unknown: true }
  const state = firewallState(needed, rules)
  return { exists: state.upToDate, ...state, ports: [...new Set(needed.flatMap(e => e.ports))].sort((a, b) => a - b), unknown: false }
}

// true when every server's game ports are allowed through (the pre-start check and diagnostics)
export async function firewallRuleExists(): Promise<boolean> {
  return (await firewallStatus()).exists
}

// Runs a .cmd as admin, so Windows shows one "Allow" prompt. The netsh commands go in a
// small file so there's no quoting soup between powershell and cmd.
function runElevated(script: string): Promise<Error | null> {
  const path = join(app.getPath('temp'), 'pzm-firewall.cmd')
  writeFileSync(path, script)
  const ps = `try { Start-Process -FilePath cmd.exe -ArgumentList '/c','"${path.replace(/'/g, "''")}"' -Verb RunAs -Wait -WindowStyle Hidden; exit 0 } catch { exit 5 }`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 120000 }, (err) => {
      try { unlinkSync(path) } catch { /* already gone */ }
      resolve(err)
    })
  })
}

// Allows the server's game ports (UDP only) for every server install, replacing the
// older rule that opened every port including RCON. One admin prompt.
export async function addFirewallRule(serverInstallPath: string): Promise<{ success: boolean; message?: string }> {
  if (!existsSync(javaPath(serverInstallPath))) return { success: false, message: "The server isn't installed yet." }
  const err = await runElevated(firewallScript(neededFirewall(serverInstallPath)))
  rulesCache = null
  if ((await firewallStatus(serverInstallPath)).upToDate) return { success: true }
  return { success: false, message: err ? 'You said no to the permission prompt.' : "Windows didn't add the rule." }
}

// Takes our rules back out (the old one too). One admin prompt.
export async function removeFirewallRule(): Promise<{ success: boolean; message?: string }> {
  const err = await runElevated(firewallRemoveScript())
  rulesCache = null
  if (!(await firewallStatus()).anyRule) return { success: true }
  return { success: false, message: err ? 'You said no to the permission prompt.' : "Windows didn't remove the rule." }
}

export function setupNetworkHandlers() {
  ipcMain.handle('network:checkUpnp', async (_event, port: number, publicIp: string | null) => checkUpnp(port, publicIp))
  ipcMain.handle('network:firewallStatus', async () => firewallStatus())
  ipcMain.handle('network:addFirewallRule', async (_event, serverInstallPath: string) => addFirewallRule(serverInstallPath))
  ipcMain.handle('network:removeFirewallRule', async () => removeFirewallRule())
}
