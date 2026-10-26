// Server packs: everything a player needs to join a host's server with the same mods,
// in one file the host can send (later: fetched by a short code). Pure logic only,
// the Electron side does the file reading / hashing / writing.

import type { Build } from './modCore'

export const PACK_FORMAT = 'pzm-server-pack'
export const PACK_VERSION = 1
// fix mods are small; anything near this is not what a pack is for
export const PACK_MAX_BYTES = 50 * 1024 * 1024

export interface PackFile {
  // relative to the mod folder, forward slashes
  path: string
  sha256: string
  // base64
  data: string
}

export interface PackLocalMod {
  id: string
  name: string
  // folder name inside <Zomboid>\mods
  folder: string
  files: PackFile[]
}

export interface ServerPack {
  format: typeof PACK_FORMAT
  version: number
  createdAt: string
  server: {
    name: string
    address?: string
    port: number
    password?: string
    build: Build
  }
  workshopItems: Array<{ workshopId: string; name: string }>
  // Mods= order the server uses
  mods: string[]
  maps: string[]
  localMods: PackLocalMod[]
}

// Windows-safe relative path with no way out of the mod folder
export function isSafeRelPath(p: string): boolean {
  if (!p || p.length > 260) return false
  if (/^[\\/]/.test(p) || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return false
  const parts = p.split(/[\\/]/)
  return parts.every(part => part !== '' && part !== '.' && part !== '..' && !/[<>:"|?*]/.test(part) && !/[. ]$/.test(part)
    // device names Windows won't treat as normal files, with or without an extension
    && !/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(part))
}

export function isSafeFolderName(name: string): boolean {
  return isSafeRelPath(name) && !/[\\/]/.test(name)
}

// What's wrong with a parsed pack file, empty when it's fine
export function validatePack(raw: unknown): string[] {
  const errors: string[] = []
  const p = raw as Partial<ServerPack>
  if (!p || typeof p !== 'object') return ["This isn't a server pack file."]
  if (p.format !== PACK_FORMAT) return ["This isn't a server pack file."]
  if (typeof p.version !== 'number' || p.version > PACK_VERSION) errors.push('This pack was made by a newer version of the app. Update the app and try again.')
  if (!p.server || typeof p.server.name !== 'string' || typeof p.server.port !== 'number') {
    errors.push("The pack doesn't say which server it's for.")
  } else {
    // these end up in the game's launch options, so nothing that could sneak in extra ones
    const { address, port, password } = p.server
    if (address !== undefined && (typeof address !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(address))) errors.push("The server address in this pack isn't valid.")
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("The server port in this pack isn't valid.")
    if (password !== undefined && (typeof password !== 'string' || /[\s+]/.test(password) || password.startsWith('-'))) errors.push("The server password in this pack can't be used (no spaces or + allowed).")
  }
  if (!Array.isArray(p.workshopItems) || !Array.isArray(p.mods) || !Array.isArray(p.localMods) || !Array.isArray(p.maps)) {
    errors.push('The pack is missing its mod list.')
    return errors
  }
  for (const w of p.workshopItems) {
    if (!w || !/^\d+$/.test(String(w.workshopId))) { errors.push('The pack has a bad Workshop item in it.'); break }
  }
  const folders = new Set<string>()
  for (const m of p.localMods) {
    if (!m || typeof m.id !== 'string' || !isSafeFolderName(m.folder) || !Array.isArray(m.files)) {
      errors.push(`The fix mod "${m?.name || m?.folder || '?'}" in this pack isn't valid.`)
      continue
    }
    if (folders.has(m.folder.toLowerCase())) errors.push(`The pack has the fix mod folder "${m.folder}" twice.`)
    folders.add(m.folder.toLowerCase())
    for (const f of m.files) {
      if (!f || !isSafeRelPath(f.path) || typeof f.data !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) {
        errors.push(`The fix mod "${m.name}" has a file that isn't allowed (${f?.path || '?'}).`)
        break
      }
    }
  }
  return errors
}

// Same files with the same contents = same fingerprint, regardless of order
export function modFingerprint(files: Array<{ path: string; sha256: string }>): string {
  return files
    .map(f => `${f.path.replace(/\\/g, '/').toLowerCase()}:${f.sha256}`)
    .sort()
    .join('|')
}

// What the player's PC looks like, as far as the pack cares
export interface ClientState {
  gameFound: boolean
  // workshop items the game already has downloaded
  workshopDownloaded: string[]
  // fingerprint of each folder in <Zomboid>\mods, keyed by lowercased folder name
  localMods: Record<string, string>
}

export type LocalModStatus = 'ok' | 'missing' | 'different'

export interface PackCheck {
  ready: boolean
  localMods: Array<{ id: string; name: string; folder: string; status: LocalModStatus }>
  // not a problem: the game downloads these itself when you join
  toDownload: Array<{ workshopId: string; name: string }>
}

export function checkPack(pack: ServerPack, client: ClientState): PackCheck {
  const localMods = pack.localMods.map(m => {
    const have = client.localMods[m.folder.toLowerCase()]
    const status: LocalModStatus = have === undefined ? 'missing' : have === modFingerprint(m.files) ? 'ok' : 'different'
    return { id: m.id, name: m.name, folder: m.folder, status }
  })
  const downloaded = new Set(client.workshopDownloaded)
  return {
    ready: client.gameFound && localMods.every(m => m.status === 'ok'),
    localMods,
    toDownload: pack.workshopItems.filter(w => !downloaded.has(w.workshopId)),
  }
}

// steam://run/108600//<args>/ starts PZ through Steam; +connect / +password are the
// launch options Steam's own server browser uses to join a server
export function launchUrl(server?: { address?: string; port: number; password?: string }): string {
  if (!server?.address) return 'steam://run/108600'
  const args = [`+connect ${server.address}:${server.port}`]
  if (server.password) args.push(`+password ${server.password}`)
  return `steam://run/108600//${encodeURIComponent(args.join(' '))}/`
}

// The game puts the username in the save file name, so keep it to safe characters
export function accountProblem(a: { username?: string; password?: string }): string | null {
  const u = (a.username || '').trim()
  if (u.length < 2 || u.length > 20) return 'Pick a username between 2 and 20 characters.'
  if (!/^[A-Za-z0-9_.-]+$/.test(u)) return 'Usernames can only have letters, numbers, dots, dashes and underscores.'
  if (!a.password || a.password.length < 4) return 'Pick a password with at least 4 characters.'
  return null
}

// Easy to read and type into the game's login box: no 0/O or 1/l/I mix-ups
export function suggestPassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKMNPQRTUVWXY23456789'
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(b => chars[b % chars.length]).join('')
}

// What the host typed into "Address friends join with": a host, or host:port (playit
// gives you both). No port = the server's own port
export function parseJoinAddress(input: string | undefined, serverPort: number): { address?: string; port: number; error?: string } {
  const text = (input || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  if (!text) return { port: serverPort }
  const m = text.match(/^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/)
  if (!m) return { port: serverPort, error: `"${input}" doesn't look like an address. Use something like 73.9.243.225 or hoc-gz.tun.ply.gg:41371.` }
  const port = m[2] ? Number(m[2]) : serverPort
  if (port < 1 || port > 65535) return { port: serverPort, error: `${m[2]} isn't a valid port.` }
  return { address: m[1], port }
}
