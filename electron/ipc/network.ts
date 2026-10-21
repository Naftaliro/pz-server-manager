import { ipcMain, app } from 'electron'
import { execFile } from 'child_process'
import dgram from 'dgram'
import os from 'os'
import http from 'http'
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync } from 'fs'

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
const RULE_NAME = 'PZ Server Manager - Project Zomboid server'

export function javaPath(serverInstallPath: string): string {
  return join(serverInstallPath, 'jre64', 'bin', 'java.exe')
}

export function firewallRuleExists(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE_NAME}`], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      resolve(!err && /Rule Name/i.test(stdout))
    })
  })
}

// Adds inbound allow rules for the server's java.exe. Needs admin, so Windows shows one "Allow" prompt.
// The netsh commands go in a small .cmd file so there's no quoting soup between powershell and cmd.
export function addFirewallRule(serverInstallPath: string): Promise<{ success: boolean; message?: string }> {
  const java = javaPath(serverInstallPath)
  if (!existsSync(java)) return Promise.resolve({ success: false, message: "The server isn't installed yet." })
  const script = join(app.getPath('temp'), 'pzm-firewall.cmd')
  writeFileSync(script, ['@echo off', ...['UDP', 'TCP'].map(proto =>
    `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow program="${java}" protocol=${proto} enable=yes profile=any`
  )].join('\r\n'))
  const ps = `try { Start-Process -FilePath cmd.exe -ArgumentList '/c','"${script.replace(/'/g, "''")}"' -Verb RunAs -Wait -WindowStyle Hidden; exit 0 } catch { exit 5 }`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 120000 }, async (err) => {
      try { unlinkSync(script) } catch { /* already gone */ }
      if (await firewallRuleExists()) resolve({ success: true })
      else resolve({ success: false, message: err ? 'You said no to the permission prompt.' : "Windows didn't add the rule." })
    })
  })
}

export function setupNetworkHandlers() {
  ipcMain.handle('network:checkUpnp', async (_event, port: number, publicIp: string | null) => checkUpnp(port, publicIp))
  ipcMain.handle('network:firewallStatus', async () => ({ exists: await firewallRuleExists() }))
  ipcMain.handle('network:addFirewallRule', async (_event, serverInstallPath: string) => addFirewallRule(serverInstallPath))
}
