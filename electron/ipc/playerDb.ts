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

export interface AccountRow { username: string; lastConnection?: string; role?: number | string; steamid?: string; banned?: unknown; accesslevel?: string }

// One whitelist row. B42 bans a name by setting its access level (role) to "banned", and
// bans Steam ids in bannedid. B41 had a banned column on the account instead
export function toKnownPlayer(a: AccountRow, roles: Map<number, string>, bannedIds: Map<string, string>, bannedNames: Map<string, string>): KnownPlayer {
  const byId = a.steamid ? bannedIds.get(String(a.steamid)) : undefined
  const role = typeof a.role === 'number' ? roles.get(a.role) : a.accesslevel || (typeof a.role === 'string' ? a.role : undefined)
  const bannedRole = role?.toLowerCase() === 'banned'
  const banned = bannedRole || byId !== undefined || bannedNames.has(a.username) || a.banned === 'true' || a.banned === 1
  return {
    username: a.username,
    lastSeen: a.lastConnection || undefined,
    // "banned" shows as banned, not as a role
    role: role && !['user', 'none', 'banned'].includes(role.toLowerCase()) ? role : undefined,
    banned,
    banReason: byId || bannedNames.get(a.username) || undefined,
  }
}

function readDb(file: string): KnownPlayer[] {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const roles = new Map(rows<{ id: number; name: string }>(db, 'select id, name from role').map(r => [r.id, r.name]))
    const bannedIds = new Map(rows<{ steamid: string; reason: string }>(db, 'select steamid, reason from bannedid').map(r => [String(r.steamid), r.reason]))
    const bannedNames = new Map(rows<{ username: string; reason: string }>(db, 'select username, reason from bannedip').map(r => [r.username, r.reason]))
    const accounts = rows<AccountRow>(db, 'select * from whitelist')
    return accounts.map(a => toKnownPlayer(a, roles, bannedIds, bannedNames))
      .sort((x, y) => (y.lastSeen || '').localeCompare(x.lastSeen || ''))
  } finally {
    db.close()
  }
}

export function knownPlayers(profile: Pick<ServerProfile, 'name' | 'serverName'>, dataPath: string): KnownPlayer[] {
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
