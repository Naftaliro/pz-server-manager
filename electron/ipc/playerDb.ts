import { join } from 'path'
import { existsSync, copyFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { DatabaseSync } from 'node:sqlite'
import type { ServerProfile } from './profileManager'
import { getServerName } from './profileManager'

// Everyone who has an account on a server, and who's banned. The game keeps both in
// Zomboid\db\<server>.db (SQLite). Read only: changes go through the game's own commands.

export interface KnownPlayer {
  username: string
  lastSeen?: string
  role?: string
  banned: boolean
  banReason?: string
}

function rows<T>(db: DatabaseSync, sql: string): T[] {
  try { return db.prepare(sql).all() as T[] } catch { return [] }
}

function readDb(file: string): KnownPlayer[] {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const roles = new Map(rows<{ id: number; name: string }>(db, 'select id, name from role').map(r => [r.id, r.name]))
    // B42: bans by Steam id. B41 had a banned column on the account instead
    const bannedIds = new Map(rows<{ steamid: string; reason: string }>(db, 'select steamid, reason from bannedid').map(r => [String(r.steamid), r.reason]))
    const bannedNames = new Map(rows<{ username: string; reason: string }>(db, 'select username, reason from bannedip').map(r => [r.username, r.reason]))
    const accounts = rows<{ username: string; lastConnection?: string; role?: number | string; steamid?: string; banned?: unknown; accesslevel?: string }>(db, 'select * from whitelist')
    return accounts.map(a => {
      const byId = a.steamid ? bannedIds.get(String(a.steamid)) : undefined
      const banned = byId !== undefined || bannedNames.has(a.username) || a.banned === 'true' || a.banned === 1
      const role = typeof a.role === 'number' ? roles.get(a.role) : a.accesslevel || (typeof a.role === 'string' ? a.role : undefined)
      return {
        username: a.username,
        lastSeen: a.lastConnection || undefined,
        role: role && role.toLowerCase() !== 'user' && role.toLowerCase() !== 'none' ? role : undefined,
        banned,
        banReason: byId || bannedNames.get(a.username) || undefined,
      }
    }).sort((x, y) => (y.lastSeen || '').localeCompare(x.lastSeen || ''))
  } finally {
    db.close()
  }
}

export function knownPlayers(profile: ServerProfile, dataPath: string): KnownPlayer[] {
  const file = join(dataPath, 'db', `${getServerName(profile)}.db`)
  if (!existsSync(file)) return []
  try {
    return readDb(file)
  } catch {
    // the running server can hold a lock on it, read a copy instead
    const copy = join(tmpdir(), `knox-${process.pid}-${Date.now()}.db`)
    try {
      copyFileSync(file, copy)
      return readDb(copy)
    } finally {
      rmSync(copy, { force: true })
    }
  }
}
