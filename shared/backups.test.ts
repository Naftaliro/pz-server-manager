import { describe, it, expect } from 'vitest'
import {
  planRetention, quickPicks, parseManifest, legacyManifest, checkGame, checkCompat, modChanges, settingChanges,
  whenLabel, ago, dayLabel, backupStamp, isBackupId, MANIFEST_FORMAT, type RetentionItem, type BackupReason, type BackupManifest,
} from './backups'
import type { SteamBranch } from './gameVersion'

const HOUR = 3600_000
const DAY = 24 * HOUR
// a Tuesday afternoon, local time
const NOW = new Date(2026, 10, 10, 15, 0, 0).getTime()

function item(hoursAgo: number, reason: BackupReason = 'scheduled'): RetentionItem {
  const createdAt = NOW - hoursAgo * HOUR
  return { id: `${hoursAgo}h-${reason}`, createdAt, reason }
}

describe('retention', () => {
  it('keeps everything from the last 6 hours', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(i * 0.5))
    expect(planRetention(items, { now: NOW }).remove).toEqual([])
  })

  it('keeps one per hour between 6 and 24 hours, the newest of each hour', () => {
    // every 30 min from 6.5h to 23.5h ago
    const items = Array.from({ length: 35 }, (_, i) => item(6.5 + i * 0.5))
    const { keep } = planRetention(items, { now: NOW })
    const hours = keep.map(id => new Date(items.find(x => x.id === id)!.createdAt).getHours())
    expect(new Set(hours).size).toBe(hours.length)
    expect(keep.length).toBeGreaterThanOrEqual(17)
    expect(keep.length).toBeLessThanOrEqual(19)
    // within one hour bucket the newer one wins
    const at = (h: number, m: number) => ({ id: `${h}:${m}`, createdAt: new Date(2026, 10, 10, h, m).getTime(), reason: 'scheduled' as const })
    const r = planRetention([at(3, 10), at(3, 40), at(15, 0)], { now: NOW })
    expect(r.keep).toEqual(['15:0', '3:40'])
  })

  it('keeps one per day up to a week and one per week up to 5 weeks, nothing older', () => {
    const items = Array.from({ length: 60 }, (_, i) => item(24 + i * 12)) // every 12h from 1 to ~31 days
    const { keep, remove } = planRetention([...items, item(40 * 24), item(1)], { now: NOW })
    const kept = keep.map(id => [...items, item(40 * 24), item(1)].find(x => x.id === id)!)
    const days = kept.filter(k => NOW - k.createdAt >= DAY && NOW - k.createdAt < 7 * DAY)
    expect(new Set(days.map(k => new Date(k.createdAt).toDateString())).size).toBe(days.length)
    expect(days.length).toBeGreaterThanOrEqual(6)
    const weeks = kept.filter(k => NOW - k.createdAt >= 7 * DAY)
    expect(weeks.length).toBeGreaterThanOrEqual(3)
    expect(weeks.length).toBeLessThanOrEqual(5)
    expect(remove).toContain(`${40 * 24}h-scheduled`)
  })

  it('is stable: running it again later never wants back what it threw away', () => {
    let items = Array.from({ length: 200 }, (_, i) => item(i * 0.5))
    for (let step = 0; step < 48; step++) {
      const now = NOW + step * HOUR
      const plan = planRetention(items, { now })
      items = items.filter(x => plan.keep.includes(x.id))
      // nothing that survived gets removed just because time moved on by less than a tier
      const again = planRetention(items, { now })
      expect(again.remove).toEqual([])
    }
  })

  it('always keeps manual backups, the newest 3 before a game update and the undo point', () => {
    const items = [
      item(1000, 'manual'), item(900, 'before-game-update'), item(800, 'before-game-update'),
      item(700, 'before-game-update'), item(600, 'before-game-update'), item(500, 'before-rollback'),
      item(400, 'before-rollback'), item(2),
    ]
    const { keep, remove } = planRetention(items, { now: NOW })
    expect(keep).toEqual(expect.arrayContaining(['1000h-manual', '800h-before-game-update', '700h-before-game-update', '600h-before-game-update', '400h-before-rollback', '2h-scheduled']))
    expect(remove).toEqual(['500h-before-rollback', '900h-before-game-update'].sort((a, b) => parseInt(a) - parseInt(b)))
  })

  it('never removes the newest backup, however old', () => {
    expect(planRetention([item(2000)], { now: NOW }).keep).toEqual(['2000h-scheduled'])
  })

  it('with a disk limit drops the oldest unprotected ones until it fits', () => {
    const items = [item(1), item(2), item(3), item(4), item(5, 'manual')]
    // 10 bytes each, nothing shared
    const usage = (ids: string[]) => ids.length * 10
    const r = planRetention(items, { now: NOW, capBytes: 30, usage })
    expect(r.keep).toEqual(['1h-scheduled', '2h-scheduled', '5h-manual'])
    // a limit it can't reach still keeps the protected ones
    expect(planRetention(items, { now: NOW, capBytes: 1, usage }).keep).toEqual(['1h-scheduled', '5h-manual'])
  })
})

describe('quick picks', () => {
  const b = (hoursAgo: number, reason: BackupReason, buildId: string, worldVersion?: number) =>
    ({ id: `${hoursAgo}`, createdAt: NOW - hoursAgo * HOUR, reason, game: { buildId, worldVersion } })
  const list = [
    b(0.2, 'scheduled', '26486687', 251),
    b(0.9, 'scheduled', '26486687', 251),
    b(3, 'start', '25485538', 249),
    b(3.1, 'before-game-update', '25485538', 249),
    b(30, 'scheduled', '25485538', 249),
    b(200, 'start', '25485538', 249),
  ]
  const current = { buildId: '26486687', worldVersion: 251 }

  it('maps each pick to the newest backup at or before that time', () => {
    const picks = quickPicks(list, NOW, current)
    expect(picks.find(p => p.key === 'hour')?.id).toBe('3')
    expect(picks.find(p => p.key === 'yesterday')?.id).toBe('30')
    expect(picks.find(p => p.key === 'week')?.id).toBe('200')
  })

  it('"before the last game update" is the newest backup from the older game', () => {
    expect(quickPicks(list, NOW, current).find(p => p.key === 'before-update')?.id).toBe('3')
  })

  it('leaves out picks with nothing to land on', () => {
    const picks = quickPicks([b(0.2, 'scheduled', '26486687', 251)], NOW, current)
    expect(picks.filter(p => p.id).map(p => p.key)).toEqual([])
  })

  it('never counts a newer world as "before the update"', () => {
    // a 42.22 backup while the server is back on 42.21
    const picks = quickPicks([b(5, 'scheduled', '26486687', 251)], NOW, { buildId: '25485538', worldVersion: 249 })
    expect(picks.find(p => p.key === 'before-update')?.id).toBeUndefined()
  })
})

const MANIFEST: BackupManifest = {
  format: MANIFEST_FORMAT, version: 1, id: '2026-11-10_14-30-00_scheduled', createdAt: new Date(NOW - 30 * 60000).toISOString(),
  reason: 'scheduled', serverName: 'Test', game: { buildId: '25485538', branch: '42.21', version: '42.21.0', worldVersion: 249 },
  mods: [{ workshopId: '111', modId: 'Guns', name: 'Guns', timeUpdated: 100 }, { workshopId: '', modId: 'LocalFix', name: 'Fix' }],
  configFiles: ['Test.ini', 'Test_SandboxVars.lua'], hasPlayersDb: true, sizeBytes: 1000, newBytes: 10, files: 12, savedFirst: true,
  settings: { ini: { PVP: true }, sandbox: { Zombies: 3 } },
}

describe('manifest', () => {
  it('round-trips through JSON', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(MANIFEST)))).toEqual({ ...MANIFEST, unsettledFiles: undefined })
  })

  it('turns down anything that is not a manifest or comes from a newer app', () => {
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest({ ...MANIFEST, format: 'x' })).toBeNull()
    expect(parseManifest({ ...MANIFEST, version: 2 })).toBeNull()
    expect(parseManifest({ ...MANIFEST, reason: 'whatever' })).toBeNull()
    expect(parseManifest({ ...MANIFEST, id: '..\\..\\Windows' })).toBeNull()
  })

  it('drops bad parts instead of trusting them', () => {
    const m = parseManifest({
      ...MANIFEST,
      game: { buildId: '1 & calc', branch: 'x +quit', worldVersion: -1 },
      mods: [{ workshopId: 'abc', modId: 'X' }, { workshopId: '222', modId: 'Ok' }, 'junk'],
      configFiles: ['Test.ini', '..\\..\\evil.ini', 'C:\\Windows\\win.ini', 'Test_spawnpoints.lua'],
      sizeBytes: -5,
    })!
    expect(m.game).toEqual({ buildId: undefined, branch: undefined, version: undefined, worldVersion: undefined })
    expect(m.mods.map(x => x.modId)).toEqual(['Ok'])
    expect(m.configFiles).toEqual(['Test.ini', 'Test_spawnpoints.lua'])
    expect(m.sizeBytes).toBe(0)
  })

  it('describes old world-only backups from their folder name', () => {
    const m = legacyManifest('2026-10-21_19-04-33_manual', 'Test', { sizeBytes: 5, worldVersion: 249 })!
    expect(m.legacy).toBe(true)
    expect(m.reason).toBe('imported-legacy')
    expect(new Date(m.createdAt).getHours()).toBe(19)
    expect(m.game.worldVersion).toBe(249)
    expect(legacyManifest('not-a-backup', 'Test')).toBeNull()
  })

  it('names folders the way they always were', () => {
    expect(backupStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02_03-04-05')
    expect(isBackupId('2026-01-02_03-04-05_before-game-update')).toBe(true)
    expect(isBackupId('2026-01-02_03-04-05_x\\..')).toBe(false)
  })
})

const BRANCHES: SteamBranch[] = [
  { name: 'public', buildId: '26486687', downloadBytes: 1_944_000_000 },
  { name: 'pre-release', buildId: '26486687', description: 'Pre-release testing' },
  { name: '42.21', buildId: '25485538', description: 'temporary fall-back', downloadBytes: 1_945_000_000 },
  { name: 'legacy41', buildId: '24928750', description: 'Build 41.78.21' },
]
const WV: Record<string, number> = { 26486687: 251, 25485538: 249 }
const worldVersionOf = (id: string) => WV[id]

describe('game check', () => {
  const on4222 = { buildId: '26486687', branch: 'public', worldVersion: 251 }
  const on4221 = { buildId: '25485538', branch: '42.21', worldVersion: 249 }

  it('same build: nothing to do', () => {
    expect(checkGame({ backup: MANIFEST, current: on4221, branches: BRANCHES, worldVersionOf })).toEqual({ kind: 'same' })
  })

  it('42.22 server, 42.21 backup: offers the 42.21 fall-back (optional, the world still loads)', () => {
    expect(checkGame({ backup: MANIFEST, current: on4222, branches: BRANCHES, worldVersionOf })).toEqual({
      kind: 'switch', branch: '42.21', label: '42.21 fall-back', version: '42.21', downloadBytes: 1_945_000_000, required: false,
    })
  })

  it('42.21 server, 42.22 backup: switching back is required', () => {
    const backup = { ...MANIFEST, game: { buildId: '26486687', branch: 'public', version: '42.22.2', worldVersion: 251 } }
    expect(checkGame({ backup, current: on4221, branches: BRANCHES, worldVersionOf })).toMatchObject({ kind: 'switch', branch: 'public', label: 'Latest', required: true })
  })

  it('finds the build on another branch when its own moved on', () => {
    // made on public back when public was 42.21
    const backup = { ...MANIFEST, game: { ...MANIFEST.game, branch: 'public' } }
    expect(checkGame({ backup, current: on4222, branches: BRANCHES, worldVersionOf })).toMatchObject({ kind: 'switch', branch: '42.21' })
  })

  it('build gone from Steam: blocked, but an older world can still go back by force', () => {
    const backup = { ...MANIFEST, game: { buildId: '20000000', branch: '42.13', version: '42.13.1', worldVersion: 240 } }
    expect(checkGame({ backup, current: on4222, branches: BRANCHES, worldVersionOf })).toEqual({ kind: 'blocked', why: 'not-offered', canForce: true, version: '42.13.1' })
  })

  it('never lets a newer world onto an older game', () => {
    const backup = { ...MANIFEST, game: { buildId: '30000000', branch: 'public', worldVersion: 260 } }
    expect(checkGame({ backup, current: on4222, branches: BRANCHES, worldVersionOf })).toMatchObject({ kind: 'blocked', why: 'newer-world', canForce: false })
  })

  it('offline: says so, and only allows forcing an older world', () => {
    expect(checkGame({ backup: MANIFEST, current: on4222, branches: null, worldVersionOf })).toMatchObject({ kind: 'blocked', why: 'no-steam', canForce: true })
    const newer = { ...MANIFEST, game: { buildId: '26486687', worldVersion: 251 } }
    expect(checkGame({ backup: newer, current: on4221, branches: null, worldVersionOf })).toMatchObject({ kind: 'blocked', canForce: false })
  })

  it('old backups without game info are unknown, but a newer world is still caught', () => {
    const legacy = legacyManifest('2026-10-21_19-04-33', 'Test', { worldVersion: 251 })!
    expect(checkGame({ backup: legacy, current: on4221, branches: BRANCHES, worldVersionOf })).toEqual({ kind: 'unknown', newerWorld: true })
    expect(checkGame({ backup: legacyManifest('2026-10-21_19-04-33', 'Test')!, current: on4222, branches: BRANCHES, worldVersionOf })).toEqual({ kind: 'unknown', newerWorld: false })
  })

  it('uses the live world version when the game build is new to it', () => {
    const backup = { ...MANIFEST, game: { buildId: '1', worldVersion: 252 } }
    expect(checkGame({ backup, current: { buildId: '2', worldVersion: 251 }, branches: [], worldVersionOf })).toMatchObject({ kind: 'blocked', why: 'newer-world' })
  })
})

describe('mods and settings since the backup', () => {
  it('lists added, removed and updated mods', () => {
    const now = [
      { workshopId: '111', modId: 'Guns', name: 'Guns', timeUpdated: 200 },
      { workshopId: '333', modId: 'Cars', name: 'Cars' },
    ]
    expect(modChanges(MANIFEST.mods, now)).toEqual({ added: ['Cars'], removed: ['Fix'], updated: ['Guns'] })
    expect(modChanges(MANIFEST.mods, MANIFEST.mods)).toEqual({ added: [], removed: [], updated: [] })
  })

  it('lists changed settings, not ports and passwords', () => {
    const then = { ini: { PVP: true, RCONPassword: 'a', DefaultPort: 1, Open: true }, sandbox: { Zombies: 3, ZombieLore: { Speed: 2 } } }
    const now = { ini: { PVP: false, RCONPassword: 'b', DefaultPort: 2, Open: true }, sandbox: { Zombies: 3, ZombieLore: { Speed: 1 }, Loot: 2 } }
    expect(settingChanges(then, now)).toEqual(['PVP', 'Loot', 'ZombieLore.Speed'])
    expect(settingChanges(undefined, now)).toEqual([])
  })

  it('puts it all together', () => {
    const r = checkCompat({
      backup: MANIFEST, current: { buildId: '26486687', branch: 'public' }, branches: BRANCHES, worldVersionOf,
      mods: MANIFEST.mods, settings: { ini: { PVP: false }, sandbox: { Zombies: 3 } },
    })
    expect(r.game.kind).toBe('switch')
    expect(r.settings).toEqual(['PVP'])
  })
})

describe('saying when', () => {
  it('says how long ago', () => {
    expect(ago(NOW - 20_000, NOW)).toBe('just now')
    expect(ago(NOW - 52 * 60000, NOW)).toBe('52 min ago')
    expect(ago(NOW - HOUR, NOW)).toBe('1 hour ago')
    expect(ago(NOW - 22 * HOUR, NOW)).toBe('22 hours ago')
    expect(ago(NOW - 3 * DAY, NOW)).toBe('3 days ago')
    expect(ago(NOW - 21 * DAY, NOW)).toBe('3 weeks ago')
  })

  it('gives the real time with it', () => {
    expect(whenLabel(NOW - 52 * 60000, NOW)).toMatch(/^today 2:08\s?PM · 52 min ago$/)
    expect(whenLabel(new Date(2026, 10, 9, 21, 3).getTime(), NOW)).toMatch(/^yesterday 9:03\s?PM · 18 hours ago$/)
    expect(whenLabel(NOW - 8 * DAY, NOW)).toMatch(/Nov 2 .* · 8 days ago$/)
    expect(dayLabel(NOW, NOW)).toBe('Today')
    expect(dayLabel(NOW - DAY, NOW)).toBe('Yesterday')
  })
})
