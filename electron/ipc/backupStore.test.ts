import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync, readdirSync, utimesSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createBackup, listBackups, diskUsage, deleteBackup, restoreBackup, recoverInterrupted, readWorldVersion, copyBackupsFolder, backupsCopyProblem,
  worldDir, dbFile, configDir, backupsDir, type ServerFiles,
} from './backupStore'

let base: string
let f: ServerFiles

const MAP_T_249 = Buffer.from([0x47, 0x4d, 0x54, 0x4d, 0, 0, 0, 0xf9, 1, 2, 3])
const at = (min: number) => new Date(2026, 10, 10, 12, min, 0)
const opts = (min: number, extra = {}) => ({ reason: 'scheduled' as const, game: { buildId: '25485538', branch: '42.21' }, mods: [], now: at(min), ...extra })

function write(rel: string, text: string, root = worldDir(f)) {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
  return p
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'knox-backups-'))
  f = { dataDir: join(base, 'Zomboid'), serverName: 'Test' }
  write('map_t.bin', MAP_T_249.toString('latin1'))
  writeFileSync(join(worldDir(f), 'map_t.bin'), MAP_T_249)
  write('map/12/34.bin', 'chunk 12 34')
  write('map/12/35.bin', 'chunk 12 35')
  write('players.db', 'world players')
  mkdirSync(join(worldDir(f), 'radio'), { recursive: true })
  write('Test.db', 'accounts v1', join(f.dataDir, 'db'))
  write('Test.ini', 'PVP=true', configDir(f))
  write('Test_SandboxVars.lua', 'SandboxVars = { Zombies = 3 }', configDir(f))
  write('Other.ini', 'not ours', configDir(f))
})

afterEach(() => { rmSync(base, { recursive: true, force: true }) })

const ino = (p: string) => statSync(p, { bigint: true }).ino

describe('making backups', () => {
  it('copies the world, players db and config files, with a manifest', async () => {
    const r = (await createBackup(f, opts(0)))!
    const dir = r.manifest.dir
    expect(readFileSync(join(dir, 'world', 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 34')
    expect(readFileSync(join(dir, 'players.db'), 'utf-8')).toBe('accounts v1')
    expect(readdirSync(join(dir, 'config')).sort()).toEqual(['Test.ini', 'Test_SandboxVars.lua'])
    expect(existsSync(join(dir, 'world', 'radio'))).toBe(true)
    expect(r.copied).toBe(7)
    expect(r.linked).toBe(0)
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    expect(m).toMatchObject({ reason: 'scheduled', serverName: 'Test', hasPlayersDb: true, configFiles: ['Test.ini', 'Test_SandboxVars.lua'], files: 7 })
    expect(m.game).toEqual({ buildId: '25485538', branch: '42.21', worldVersion: 249 })
    expect(await readWorldVersion(worldDir(f))).toBe(249)
  })

  it('gives nothing when there is no world yet', async () => {
    rmSync(worldDir(f), { recursive: true })
    expect(await createBackup(f, opts(0))).toBeNull()
  })

  it('links unchanged files to the previous backup, copies changed ones, never links to the live world', async () => {
    const first = (await createBackup(f, opts(0)))!
    writeFileSync(join(worldDir(f), 'map', '12', '35.bin'), 'chunk 12 35 changed')
    const second = (await createBackup(f, opts(30)))!
    const a = (rel: string) => join(first.manifest.dir, 'world', ...rel.split('/'))
    const b = (rel: string) => join(second.manifest.dir, 'world', ...rel.split('/'))
    expect(ino(b('map/12/34.bin'))).toBe(ino(a('map/12/34.bin')))
    expect(statSync(b('map/12/34.bin')).nlink).toBe(2)
    expect(ino(b('map/12/35.bin'))).not.toBe(ino(a('map/12/35.bin')))
    expect(readFileSync(b('map/12/35.bin'), 'utf-8')).toBe('chunk 12 35 changed')
    // the live files stay on their own
    expect(statSync(join(worldDir(f), 'map', '12', '34.bin')).nlink).toBe(1)
    expect(ino(b('map/12/34.bin'))).not.toBe(ino(join(worldDir(f), 'map', '12', '34.bin')))
    // databases are always copied
    expect(ino(join(second.manifest.dir, 'players.db'))).not.toBe(ino(join(first.manifest.dir, 'players.db')))
    expect(second.linked).toBe(4)
    expect(second.copied).toBe(3)
    expect(second.manifest.newBytes).toBeLessThan(second.manifest.sizeBytes)
  })

  it('a changed file with the same size is still noticed (modified time)', async () => {
    await createBackup(f, opts(0))
    const p = join(worldDir(f), 'map', '12', '34.bin')
    writeFileSync(p, 'chunk 12 XX')
    utimesSync(p, new Date(), new Date(Date.now() + 5000))
    const second = (await createBackup(f, opts(30)))!
    expect(readFileSync(join(second.manifest.dir, 'world', 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 XX')
  })

  it('every backup stays whole when the one it linked to is deleted', async () => {
    const first = (await createBackup(f, opts(0)))!
    const second = (await createBackup(f, opts(30)))!
    await deleteBackup(f, first.manifest.id)
    expect(existsSync(first.manifest.dir)).toBe(false)
    expect(readFileSync(join(second.manifest.dir, 'world', 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 34')
    expect(statSync(join(second.manifest.dir, 'world', 'map', '12', '34.bin')).nlink).toBe(1)
  })

  it('copies everything when the drive does not do hard links', async () => {
    await createBackup(f, opts(0))
    let tries = 0
    const link = async () => { tries++; throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }) }
    const r = (await createBackup(f, opts(30, { ops: { link } })))!
    expect(r.linksUnsupported).toBe(true)
    expect(r.linked).toBe(0)
    expect(r.copied).toBe(7)
    // gave up after the first failure instead of trying 90,000 times
    expect(tries).toBeLessThanOrEqual(16)
    expect(readFileSync(join(r.manifest.dir, 'world', 'map', '12', '35.bin'), 'utf-8')).toBe('chunk 12 35')
  })

  it('copies a single file whose earlier copy went missing, and keeps linking the rest', async () => {
    const first = (await createBackup(f, opts(0)))!
    rmSync(join(first.manifest.dir, 'world', 'map', '12', '34.bin'))
    const r = (await createBackup(f, opts(30)))!
    expect(r.linksUnsupported).toBe(false)
    // map_t.bin, 35.bin and the two config files; 34.bin copied, databases always copied
    expect(r.linked).toBe(4)
    expect(readFileSync(join(r.manifest.dir, 'world', 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 34')
  })

  it('copies a file again when the game writes to it mid-copy', async () => {
    const chunk = join(worldDir(f), 'map', '12', '35.bin')
    let writes = 0
    const copyFile = async (src: string, dst: string) => {
      const { copyFile: real } = await import('fs/promises')
      await real(src, dst)
      // the game saves this chunk right after the first copy of it
      if (src === chunk && writes++ === 0) { appendFileSync(chunk, ' + more'); utimesSync(chunk, new Date(), new Date(Date.now() + 2000)) }
    }
    const r = (await createBackup(f, opts(0, { ops: { copyFile } })))!
    expect(readFileSync(join(r.manifest.dir, 'world', 'map', '12', '35.bin'), 'utf-8')).toBe('chunk 12 35 + more')
    expect(r.manifest.unsettledFiles).toBeUndefined()
  })

  it('says so when a file never holds still', async () => {
    const chunk = join(worldDir(f), 'map', '12', '35.bin')
    let n = 0
    const copyFile = async (src: string, dst: string) => {
      const { copyFile: real } = await import('fs/promises')
      await real(src, dst)
      if (src === chunk) { appendFileSync(chunk, String(n++)); utimesSync(chunk, new Date(), new Date(Date.now() + 1000 * n)) }
    }
    const r = (await createBackup(f, opts(0, { ops: { copyFile }, retries: 2 })))!
    expect(r.manifest.unsettledFiles).toBe(1)
  })

  it('leaves no half-made backup behind when copying fails', async () => {
    const copyFile = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }
    await expect(createBackup(f, opts(0, { ops: { copyFile } }))).rejects.toThrow('disk full')
    expect(readdirSync(backupsDir(f))).toEqual([])
    expect(await listBackups(f)).toEqual([])
  })
})

describe('listing and space used', () => {
  it('lists new and old backups newest first, skipping half-made ones', async () => {
    const old = join(backupsDir(f), '2026-10-21_19-04-33_manual')
    write('map_t.bin', '', join(old, 'world'))
    writeFileSync(join(old, 'world', 'map_t.bin'), MAP_T_249)
    writeFileSync(join(old, 'players.db'), 'x')
    mkdirSync(join(backupsDir(f), '2026-11-10_11-00-00_start.partial'), { recursive: true })
    mkdirSync(join(backupsDir(f), 'random folder'), { recursive: true })
    await createBackup(f, opts(0))
    const list = await listBackups(f)
    expect(list.map(b => b.reason)).toEqual(['scheduled', 'manual'])
    expect(list[1]).toMatchObject({ legacy: true, hasPlayersDb: true, game: { worldVersion: 249 } })
    // half-made ones are cleaned up by the next backup
    expect(existsSync(join(backupsDir(f), '2026-11-10_11-00-00_start.partial'))).toBe(false)
  })

  it('counts files shared by hard links once', async () => {
    const one = (await createBackup(f, opts(0)))!
    writeFileSync(join(worldDir(f), 'map', '12', '35.bin'), 'chunk 12 35 changed!')
    await createBackup(f, opts(30))
    const list = await listBackups(f)
    const changed = Buffer.byteLength('chunk 12 35 changed!')
    // the second one only adds the changed chunk and the always-copied databases
    const dbs = Buffer.byteLength('accounts v1') + Buffer.byteLength('world players')
    expect(await diskUsage(list)).toBe(one.manifest.sizeBytes + changed + dbs)
    expect(await diskUsage(list.slice(0, 1))).toBe(list[0].sizeBytes)
  })
})

describe('moving the backups to another folder', () => {
  it('a finished copy passes the check the move does, though every files.tsv was rewritten', async () => {
    await createBackup(f, opts(0))
    writeFileSync(join(worldDir(f), 'map', '12', '35.bin'), 'chunk 12 35 changed!')
    await createBackup(f, opts(30))
    await createBackup(f, opts(60))
    write('map/12/34.bin', 'old chunk', join(backupsDir(f), '2026-10-21_19-04-33', 'world'))
    const to = join(base, 'Own', 'pzm-backups', 'Test')
    await copyBackupsFolder(backupsDir(f), to)
    expect(await backupsCopyProblem(backupsDir(f), to)).toBeNull()
    // a real difference is still caught
    const one = (await listBackups({ dataDir: join(base, 'Own'), serverName: 'Test' })).find(b => !b.legacy)!
    writeFileSync(join(one.dir, 'world', 'map', '12', '34.bin'), 'cut')
    expect(await backupsCopyProblem(backupsDir(f), to)).toMatch(/isn't the same size/)
    rmSync(join(one.dir, 'world', 'map', '12', '34.bin'))
    expect(await backupsCopyProblem(backupsDir(f), to)).toMatch(/missing from the copy/)
  })
  it('keeps the files the backups share as one file on disk, and the space they take', async () => {
    await createBackup(f, opts(0))
    writeFileSync(join(worldDir(f), 'map', '12', '35.bin'), 'chunk 12 35 changed!')
    await createBackup(f, opts(30))
    await createBackup(f, opts(60))
    // an old full copy from 1.5.1 too
    write('map/12/34.bin', 'old chunk', join(backupsDir(f), '2026-10-21_19-04-33', 'world'))
    const to = join(base, 'Own', 'pzm-backups', 'Test')
    const r = await copyBackupsFolder(backupsDir(f), to)
    expect(r.linked).toBeGreaterThan(0)

    const g = { dataDir: join(base, 'Own'), serverName: 'Test' }
    const before = await listBackups(f)
    const after = await listBackups(g)
    expect(after.map(b => b.id)).toEqual(before.map(b => b.id))
    // an unchanged chunk is the same file in all three new copies, and not the original's
    const chunk = (dir: string) => join(dir, 'world', 'map', '12', '34.bin')
    const news = after.filter(b => !b.legacy)
    expect(new Set(news.map(b => ino(chunk(b.dir)))).size).toBe(1)
    expect(ino(chunk(news[0].dir))).not.toBe(ino(chunk(before.find(b => !b.legacy)!.dir)))
    // the changed one is shared by the last two only
    const changed = (dir: string) => join(dir, 'world', 'map', '12', '35.bin')
    expect(ino(changed(news[0].dir))).toBe(ino(changed(news[1].dir)))
    expect(ino(changed(news[1].dir))).not.toBe(ino(changed(news[2].dir)))
    // the old one is its own copy, nothing to share
    expect(readFileSync(chunk(after.find(b => b.legacy)!.dir), 'utf-8')).toBe('old chunk')
    // the file lists point at the new copies, so the space used adds up the same
    expect(await diskUsage(after)).toBe(await diskUsage(before))
    const tsv = readFileSync(join(news[0].dir, 'files.tsv'), 'utf-8')
    expect(tsv).toContain(`\t${ino(chunk(news[0].dir))}`)
    // and the next backup there links to them (the world moved along, same times)
    const { renameSync } = await import('fs')
    mkdirSync(join(g.dataDir, 'Saves'), { recursive: true })
    renameSync(join(f.dataDir, 'Saves', 'Multiplayer'), join(g.dataDir, 'Saves', 'Multiplayer'))
    const next = (await createBackup(g, opts(90)))!
    expect(next.linked).toBeGreaterThan(0)
  })

  it('copies everything when the drive has no hard links', async () => {
    await createBackup(f, opts(0))
    await createBackup(f, opts(30))
    const to = join(base, 'Fat', 'pzm-backups', 'Test')
    const link = async () => { throw Object.assign(new Error('not supported'), { code: 'EPERM' }) }
    const r = await copyBackupsFolder(backupsDir(f), to, { link })
    expect(r.linked).toBe(0)
    expect((await listBackups({ dataDir: join(base, 'Fat'), serverName: 'Test' })).length).toBe(2)
  })
})

describe('restoring', () => {
  async function changeEverything() {
    writeFileSync(join(worldDir(f), 'map', '12', '34.bin'), 'NEW chunk')
    write('map/99/99.bin', 'NEW far chunk')
    writeFileSync(dbFile(f), 'accounts v2')
    writeFileSync(join(configDir(f), 'Test.ini'), 'PVP=false')
  }

  it('puts the world, players db and settings back, and only those', async () => {
    const b = (await createBackup(f, opts(0)))!
    await changeEverything()
    const r = await restoreBackup(f, b.manifest, { configs: true })
    expect(readFileSync(join(worldDir(f), 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 34')
    expect(existsSync(join(worldDir(f), 'map', '99', '99.bin'))).toBe(false)
    expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v1')
    expect(readFileSync(join(configDir(f), 'Test.ini'), 'utf-8')).toBe('PVP=true')
    expect(readFileSync(join(configDir(f), 'Other.ini'), 'utf-8')).toBe('not ours')
    expect(r.configs.length).toBe(2)
    // real copies, not links into the backup
    expect(statSync(join(worldDir(f), 'map', '12', '34.bin')).nlink).toBe(1)
    expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
  })

  it('can leave the settings alone', async () => {
    const b = (await createBackup(f, opts(0)))!
    await changeEverything()
    await restoreBackup(f, b.manifest, { configs: false })
    expect(readFileSync(join(configDir(f), 'Test.ini'), 'utf-8')).toBe('PVP=false')
  })

  it('a copy that fails half way leaves the live world untouched', async () => {
    const b = (await createBackup(f, opts(0)))!
    await changeEverything()
    let n = 0
    const copyFile = async (src: string, dst: string) => {
      if (++n === 3) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      const { copyFile: real } = await import('fs/promises')
      await real(src, dst)
    }
    await expect(restoreBackup(f, b.manifest, { configs: true, ops: { copyFile } })).rejects.toThrow('disk full')
    expect(readFileSync(join(worldDir(f), 'map', '99', '99.bin'), 'utf-8')).toBe('NEW far chunk')
    expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v2')
    expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
  })

  // every rename of the swap failing in turn: always the old set or the new set, whole
  for (const failAt of [1, 2, 3, 4, 5, 6]) {
    it(`a swap that fails at step ${failAt} puts everything back`, async () => {
      const b = (await createBackup(f, opts(0)))!
      await changeEverything()
      let n = 0
      const rename = async (from: string, to: string) => {
        if (++n === failAt) throw Object.assign(new Error('in use'), { code: 'EBUSY' })
        const { rename: real } = await import('fs/promises')
        await real(from, to)
      }
      await expect(restoreBackup(f, b.manifest, { configs: true, ops: { rename } })).rejects.toThrow('in use')
      expect(readFileSync(join(worldDir(f), 'map', '99', '99.bin'), 'utf-8')).toBe('NEW far chunk')
      expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v2')
      expect(readFileSync(join(configDir(f), 'Test.ini'), 'utf-8')).toBe('PVP=false')
      expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
      expect(readdirSync(join(f.dataDir, 'db'))).toEqual(['Test.db'])
    })
  }

  // the app dying at each rename of the swap, just before it or just after it (before the
  // marker heard about it): the next recovery puts the old world, db, its journal and settings
  // back together, never the backup's world with the live db
  const LIVE_JOURNAL = 'live journal'
  const isOld = () => ({
    world: readFileSync(join(worldDir(f), 'map', '99', '99.bin'), 'utf-8'),
    db: readFileSync(dbFile(f), 'utf-8'),
    journal: readFileSync(dbFile(f) + '-journal', 'utf-8'),
    ini: readFileSync(join(configDir(f), 'Test.ini'), 'utf-8'),
  })
  // world, db, ini, sandbox: two renames each, then the journal goes aside
  for (const crashAt of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const when of ['before', 'after'] as const) {
      it(`a restore cut off ${when} rename ${crashAt} of the swap comes back whole`, async () => {
        const b = (await createBackup(f, opts(0)))!
        await changeEverything()
        writeFileSync(dbFile(f) + '-journal', LIVE_JOURNAL)
        const { rename: real } = await import('fs/promises')
        let n = 0
        let crashed = false
        const rename = async (from: string, to: string) => {
          if (++n === crashAt) {
            if (when === 'after') await real(from, to)
            crashed = true
            // the app is gone: nothing after this ever runs
            return new Promise<void>(() => undefined)
          }
          await real(from, to)
        }
        void restoreBackup(f, b.manifest, { configs: true, ops: { rename } })
        await vi.waitFor(() => expect(crashed).toBe(true))
        const notes = await recoverInterrupted(f)
        expect(notes.length).toBe(when === 'before' && crashAt === 1 ? 0 : 1)
        expect(isOld()).toEqual({ world: 'NEW far chunk', db: 'accounts v2', journal: LIVE_JOURNAL, ini: 'PVP=false' })
        expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
        expect(readdirSync(join(f.dataDir, 'db')).sort()).toEqual(['Test.db', 'Test.db-journal'])
        expect(readdirSync(configDir(f)).sort()).toEqual(['Other.ini', 'Test.ini', 'Test_SandboxVars.lua'])
        expect(existsSync(join(backupsDir(f), 'restore.knox-swap.json'))).toBe(false)
        // and a restore after that works
        await restoreBackup(f, b.manifest, { configs: true })
        expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v1')
      })
    }
  }

  it('cut off after the last rename, the restore is finished instead', async () => {
    const b = (await createBackup(f, opts(0)))!
    await changeEverything()
    // the swap is done and marked so, only the old copies are left (put back by hand here)
    await restoreBackup(f, b.manifest, { configs: true })
    const world = worldDir(f)
    const { cpSync } = await import('fs')
    cpSync(world, world + '.knox-old', { recursive: true })
    writeFileSync(dbFile(f) + '.knox-old', 'accounts v2')
    writeFileSync(join(backupsDir(f), 'restore.knox-swap.json'), JSON.stringify({
      items: [{ live: world, staged: world + '.knox-staging', hadLive: true }, { live: dbFile(f), staged: dbFile(f) + '.knox-staging', hadLive: true }],
      done: ['aside:0', 'in:0', 'aside:1', 'in:1'], finished: true,
    }))
    expect(await recoverInterrupted(f)).toEqual([])
    expect(readFileSync(join(world, 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 34')
    expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v1')
    expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
    expect(readdirSync(join(f.dataDir, 'db'))).toEqual(['Test.db'])
  })

  it("a marker can't point the recovery at anything but this server's files", async () => {
    const elsewhere = join(base, 'Important')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'keep.txt'), 'keep')
    writeFileSync(join(elsewhere + '.knox-old'), 'x')
    mkdirSync(backupsDir(f), { recursive: true })
    writeFileSync(join(backupsDir(f), 'restore.knox-swap.json'), JSON.stringify({ items: [{ live: elsewhere, staged: join(base, 'x'), hadLive: true }], done: ['aside:0'] }))
    await recoverInterrupted(f)
    expect(readFileSync(join(elsewhere, 'keep.txt'), 'utf-8')).toBe('keep')
  })

  it("the restored db doesn't get the live db's journal, wal or shm", async () => {
    const b = (await createBackup(f, opts(0)))!
    await changeEverything()
    for (const s of ['-journal', '-wal', '-shm']) writeFileSync(dbFile(f) + s, `live ${s}`)
    // one inside the world that the backup has too is the backup's own
    writeFileSync(join(worldDir(f), 'players.db-journal'), 'live world journal')
    await restoreBackup(f, b.manifest, { configs: true })
    expect(readdirSync(join(f.dataDir, 'db'))).toEqual(['Test.db'])
    expect(existsSync(join(worldDir(f), 'players.db-journal'))).toBe(false)
    expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v1')
  })

  it('leaves the journal alone when the backup has no players db to replace it with', async () => {
    const old = join(backupsDir(f), '2026-10-21_19-04-33')
    write('map/12/34.bin', 'old chunk', join(old, 'world'))
    writeFileSync(dbFile(f) + '-journal', LIVE_JOURNAL)
    const legacy = (await listBackups(f)).find(b => b.legacy)!
    await restoreBackup(f, legacy, { configs: true })
    expect(readFileSync(dbFile(f) + '-journal', 'utf-8')).toBe(LIVE_JOURNAL)
  })

  it('after a crash mid-swap, the old world comes back', async () => {
    // live world already moved aside, staged one not in yet
    const world = worldDir(f)
    const { renameSync, cpSync } = await import('fs')
    cpSync(world, world + '.knox-staging', { recursive: true })
    renameSync(world, world + '.knox-old')
    renameSync(dbFile(f), dbFile(f) + '.knox-old')
    const notes = await recoverInterrupted(f)
    expect(notes.length).toBe(1)
    expect(readFileSync(join(world, 'map', '12', '34.bin'), 'utf-8')).toBe('chunk 12 34')
    expect(readFileSync(dbFile(f), 'utf-8')).toBe('accounts v1')
    expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
  })

  it('after a crash right after the swap, the new world stays and the old copy goes', async () => {
    const world = worldDir(f)
    const { cpSync } = await import('fs')
    cpSync(world, world + '.knox-old', { recursive: true })
    writeFileSync(join(world, 'map', '12', '34.bin'), 'restored')
    await recoverInterrupted(f)
    expect(readFileSync(join(world, 'map', '12', '34.bin'), 'utf-8')).toBe('restored')
    expect(readdirSync(join(f.dataDir, 'Saves', 'Multiplayer'))).toEqual(['Test'])
  })

  it('restores old world-only backups too', async () => {
    const old = join(backupsDir(f), '2026-10-21_19-04-33')
    write('map/12/34.bin', 'old chunk', join(old, 'world'))
    writeFileSync(join(old, 'players.db'), 'old accounts')
    const legacy = (await listBackups(f)).find(b => b.legacy)!
    await restoreBackup(f, legacy, { configs: true })
    expect(readFileSync(join(worldDir(f), 'map', '12', '34.bin'), 'utf-8')).toBe('old chunk')
    expect(readFileSync(dbFile(f), 'utf-8')).toBe('old accounts')
    // nothing to restore the settings from, so they stay
    expect(readFileSync(join(configDir(f), 'Test.ini'), 'utf-8')).toBe('PVP=true')
  })
})
