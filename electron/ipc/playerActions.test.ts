import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { playerCommand, actionResult, knownName } from './playerActions'
import { toKnownPlayer, knownPlayers } from './playerDb'

describe('playerCommand', () => {
  it('takes admin away with the level each build knows', () => {
    expect(playerCommand('unadmin', 'bob', 'b42')).toBe('setaccesslevel "bob" user')
    expect(playerCommand('unadmin', 'bob', 'b41')).toBe('setaccesslevel "bob" none')
  })
  it('keeps quotes out of the name', () => {
    expect(playerCommand('kick', 'a"b', 'b42')).toBe('kickuser "ab"')
  })
})

describe('actionResult', () => {
  it('reports the game saying no as a failure, in its own words', () => {
    expect(actionResult('kick', 'ghostplayer', "User ghostplayer doesn't exist.")).toEqual({ success: false, message: "User ghostplayer doesn't exist." })
    expect(actionResult('unadmin', 'x', "Access Level '' unknown, list of access level: banned, user, priority, observer, gm, moderator, admin").success).toBe(false)
  })
  it('says what happened when it worked', () => {
    expect(actionResult('kick', 'bob', 'User bob kicked.')).toEqual({ success: true, message: 'Kicked bob.' })
    expect(actionResult('ban', 'bob', 'User bob is now banned')).toEqual({ success: true, message: 'Banned bob.' })
    expect(actionResult('unban', 'bob', 'User bob is now un-banned')).toEqual({ success: true, message: 'bob can join again.' })
  })
})

describe('knownName', () => {
  it('only lets names the server knows through', () => {
    expect(knownName('Bob', ['bob'], [])).toBe(true)
    expect(knownName('alice', [], ['alice'])).toBe(true)
    expect(knownName('typo', ['bob'], ['alice'])).toBe(false)
  })
})

describe('toKnownPlayer', () => {
  const roles = new Map([[1, 'banned'], [2, 'user'], [3, 'admin']])
  it('counts the B42 "banned" access level as banned, not as a role', () => {
    expect(toKnownPlayer({ username: 'qaplayer', role: 1 }, roles, new Map(), new Map())).toEqual({ username: 'qaplayer', lastSeen: undefined, role: undefined, banned: true, banReason: undefined })
  })
  it('keeps real roles and leaves normal players alone', () => {
    expect(toKnownPlayer({ username: 'a', role: 3 }, roles, new Map(), new Map())).toMatchObject({ role: 'admin', banned: false })
    expect(toKnownPlayer({ username: 'b', role: 2 }, roles, new Map(), new Map())).toMatchObject({ role: undefined, banned: false })
  })
  it('still reads B41 accounts and Steam id bans', () => {
    expect(toKnownPlayer({ username: 'c', accesslevel: 'admin', banned: 'true' }, roles, new Map(), new Map())).toMatchObject({ role: 'admin', banned: true })
    expect(toKnownPlayer({ username: 'd', steamid: '76561190000000001' }, roles, new Map([['76561190000000001', 'griefing']]), new Map())).toMatchObject({ banned: true, banReason: 'griefing' })
  })
})

describe('knownPlayers on a B42 style database', () => {
  it('shows someone banned with banuser as banned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knox-db-'))
    try {
      mkdirSync(join(dir, 'db'))
      const db = new DatabaseSync(join(dir, 'db', 'Test.db'))
      db.exec(`create table role (id integer primary key, name text);
        insert into role values (1, 'banned'), (2, 'user'), (7, 'admin');
        create table whitelist (id integer primary key, username text, role integer, lastConnection text, steamid text);
        insert into whitelist (username, role, lastConnection) values ('qaplayer', 1, '2026-11-10 18:00:00'), ('friend', 2, '2026-11-09 18:00:00');
        create table bannedid (steamid text, reason text);`)
      db.close()
      const players = knownPlayers({ name: 'Test', serverName: 'Test' }, dir)
      expect(players.map(p => [p.username, p.banned])).toEqual([['qaplayer', true], ['friend', false]])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
