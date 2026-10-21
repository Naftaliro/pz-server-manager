import { ipcMain } from 'electron'
import https from 'https'
import type { ServerProfile } from './profileManager'

// Discord notifications: the user pastes a channel webhook link and we post
// "server is online", crashes, restarts and (optionally) player joins there.

export const DISCORD_COLORS = { green: 0xa6e3a1, red: 0xf38ba8, yellow: 0xf9e2af, blue: 0x89b4fa, gray: 0x6c7086 }

// last failure per webhook, for the diagnostics report
export const lastDiscordError = new Map<string, string>()

export function isWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:'
      && ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'].includes(u.hostname)
      && /^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname)
  } catch {
    return false
  }
}

export function postToWebhook(url: string, text: string, color: number): Promise<{ success: boolean; message?: string }> {
  if (!isWebhookUrl(url)) return Promise.resolve({ success: false, message: "That doesn't look like a Discord webhook link." })
  const body = JSON.stringify({
    username: 'PZ Server Manager',
    embeds: [{ description: text.slice(0, 4000), color }],
    // never ping @everyone or anyone else from a player name
    allowed_mentions: { parse: [] },
  })
  return new Promise(resolve => {
    const req = https.request(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = ''
      res.on('data', (c: Buffer) => { data += c })
      res.on('end', () => {
        const ok = !!res.statusCode && res.statusCode < 300
        const message = ok ? undefined
          : res.statusCode === 404 || res.statusCode === 401 ? 'Discord says this webhook no longer exists. Make a new one and paste it again.'
          : `Discord answered ${res.statusCode}: ${data.slice(0, 200)}`
        if (message) lastDiscordError.set(url, message)
        else lastDiscordError.delete(url)
        resolve({ success: ok, message })
      })
    })
    req.on('error', e => {
      lastDiscordError.set(url, e.message)
      resolve({ success: false, message: `Could not reach Discord: ${e.message}` })
    })
    req.setTimeout(8000, () => req.destroy(new Error('timed out')))
    req.end(body)
  })
}

// Fire and forget, a Discord hiccup must never get in the way of the server
export function notify(profile: ServerProfile | undefined, text: string, color: number, kind: 'status' | 'players' = 'status') {
  if (!profile?.discordWebhook) return
  if (kind === 'players' && !profile.discordPlayerEvents) return
  void postToWebhook(profile.discordWebhook, text, color)
}

// Discord's markdown would turn names like _bob_ into italics
export const escapeDiscord = (s: string) => s.replace(/([\\*_~`|>])/g, '\\$1')

export function setupDiscordHandlers() {
  ipcMain.handle('discord:test', async (_event, url: string, serverName: string) =>
    postToWebhook(url, `👋 **${escapeDiscord(serverName)}** is connected. Server updates will show up in this channel.`, DISCORD_COLORS.blue))
}
