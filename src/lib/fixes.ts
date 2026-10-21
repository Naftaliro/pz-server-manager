import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'
import { downloadAndScan } from './mods'

// What the "Fix" button next to a pre-start problem does. Returns a message to show, if any.
export async function applyFix(issue: ServerPreflightIssue, profile: ServerProfile): Promise<string | undefined> {
  const { openServer, setActiveView } = useAppStore.getState()
  switch (issue.fix) {
    case 'install-server':
    case 'update-server':
      setActiveView('appsettings')
      return
    case 'open-mods':
      openServer(profile.id, 'mods')
      return
    case 'open-settings':
      openServer(profile.id, 'settings')
      return
    case 'download-mods':
      openServer(profile.id, 'mods')
      void downloadAndScan(profile.id, profile.mods.map(m => m.workshopId))
      return
    case 'firewall': {
      const r = await window.electronAPI.network.addFirewallRule(profile.serverInstallPath)
      return r.success ? 'Windows Firewall will let the server through now.' : r.message
    }
  }
}

// Ready-to-paste text for the group chat
export function inviteMessage(profile: ServerProfile, address: string, port?: string): string {
  const lines = [
    `Join my Project Zomboid server "${profile.name}"!`,
    '',
    `In Zomboid: Join > Add server (bottom left), then type:`,
    `  IP: ${address}`,
    `  Port: ${port || profile.port}`,
  ]
  if (profile.serverPassword) lines.push(`  Server password: ${profile.serverPassword}`)
  lines.push('', 'Make up any username and password for yourself the first time you join.')
  if (profile.mods.length > 0) lines.push(`It has ${profile.mods.length} mod${profile.mods.length === 1 ? '' : 's'}, they download automatically when you join.`)
  return lines.join('\n')
}

// "host.example.com:12345" -> ["host.example.com", "12345"]
export function splitAddress(address: string): [string, string | undefined] {
  const m = address.trim().match(/^(.*?)(?::(\d+))?$/)
  return [m?.[1] || address, m?.[2]]
}
