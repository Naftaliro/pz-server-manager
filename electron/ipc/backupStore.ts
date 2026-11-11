// The files behind world backups. No Electron in here, so the tests run it on real folders.
//
// <data>\pzm-backups\<server>\<stamp>_<reason>\
//   world\...        the world folder (Saves\Multiplayer\<server>)
//   players.db       the server's db\<server>.db (accounts, whitelist, bans)
//   config\...       <server>.ini, _SandboxVars.lua, _spawnregions.lua, _spawnpoints.lua
//   files.tsv        every file above: path, size, modified time, which file on disk it is
//   manifest.json    written last: a backup without one never shows up (or is an old one)
//
// A file that hasn't changed since the backup before is a hard link to that backup's copy,
// so a backup of a 90,000 file world where a few hundred chunks changed only takes those few
// hundred files of space. Links only ever go from one backup to another, never to the live
// world (the game writes into its files, which would change the backup too). Each backup is
// still complete on its own: restoring or deleting one doesn't need any other. Where links
// don't work (FAT/exFAT drives, some network drives) files are copied.

import { join, dirname } from 'path'
import { existsSync, createReadStream, type BigIntStats } from 'fs'
import { promises as fsp } from 'fs'
import { createHash } from 'crypto'
import {
  backupStamp, isBackupId, parseManifest, legacyManifest, MANIFEST_FORMAT, MANIFEST_VERSION,
  type BackupManifest, type BackupReason, type BackupGame, type BackupMod,
} from '../../shared/backups'
import { worldVersionFromMapT } from '../../shared/gameVersion'

export interface ServerFiles {
  // the server's data folder (Zomboid, or its -cachedir)
  dataDir: string
  // getServerName: letters, digits, _ and -
  serverName: string
}

export const worldDir = (f: ServerFiles) => join(f.dataDir, 'Saves', 'Multiplayer', f.serverName)
export const dbFile = (f: ServerFiles) => join(f.dataDir, 'db', `${f.serverName}.db`)
export const configDir = (f: ServerFiles) => join(f.dataDir, 'Server')
export const backupsDir = (f: ServerFiles) => join(f.dataDir, 'pzm-backups', f.serverName)
export const configNames = (f: ServerFiles) => ['.ini', '_SandboxVars.lua', '_spawnregions.lua', '_spawnpoints.lua'].map(s => `${f.serverName}${s}`)

// next to the world, so swapping them is a rename on the same drive
const STAGING = '.knox-staging'
const OLD = '.knox-old'

// what the store does to files, swappable so the tests can make any step fail
export interface FsOps {
  link: (existing: string, path: string) => Promise<void>
  copyFile: (src: string, dst: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
}
const realOps: FsOps = { link: fsp.link, copyFile: (s, d) => fsp.copyFile(s, d), rename: fsp.rename }

// ── Small helpers ─────────────────────────────────────────────────────────────

async function statOrNull(p: string): Promise<BigIntStats | null> {
  try { return await fsp.stat(p, { bigint: true }) } catch { return null }
}

// every file and folder under dir, relative with forward slashes
async function walk(dir: string): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = []
  const dirs: string[] = []
  const pending = ['']
  while (pending.length) {
    const rel = pending.pop()!
    let entries
    try { entries = await fsp.readdir(rel ? join(dir, rel) : dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { dirs.push(r); pending.push(r) } else if (e.isFile()) files.push(r)
    }
  }
  return { files, dirs }
}

// a few files at a time: tens of thousands one after another is slow, all at once runs out of handles.
// On the first error nothing new starts, and it only gives up once the ones under way are done
// (so cleaning up after it can't race a copy that's still writing)
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failed: { error: unknown } | null = null
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (!failed && next < items.length) {
      try { await fn(items[next++]) } catch (error) { failed ||= { error } }
    }
  }))
  if (failed) throw (failed as { error: unknown }).error
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

const toPath = (root: string, rel: string) => join(root, ...rel.split('/'))
// SQLite files get written in place any time, so they're always copied and checked by content
const isDb = (rel: string) => /\.db$/i.test(rel)

/** The world version in a world folder's map_t.bin, if it has one */
export async function readWorldVersion(world: string): Promise<number | undefined> {
  let fh
  try {
    fh = await fsp.open(join(world, 'map_t.bin'), 'r')
    const buf = Buffer.alloc(8)
    const { bytesRead } = await fh.read(buf, 0, 8, 0)
    return worldVersionFromMapT(buf.subarray(0, bytesRead))
  } catch {
    return undefined
  } finally {
    await fh?.close()
  }
}

// ── files.tsv ─────────────────────────────────────────────────────────────────

interface IndexEntry { size: bigint; mtimeNs: bigint; dev: bigint; ino: bigint }

async function readIndex(backup: string): Promise<Map<string, IndexEntry>> {
  const out = new Map<string, IndexEntry>()
  let text: string
  try { text = await fsp.readFile(join(backup, 'files.tsv'), 'utf-8') } catch { return out }
  for (const line of text.split('\n')) {
    const [rel, size, mtime, dev, ino] = line.split('\t')
    if (!rel || !/^\d+$/.test(size || '') || !/^\d+$/.test(mtime || '') || !/^\d+$/.test(dev || '') || !/^\d+$/.test(ino || '')) continue
    out.set(rel, { size: BigInt(size), mtimeNs: BigInt(mtime), dev: BigInt(dev), ino: BigInt(ino) })
  }
  return out
}

// which file on disk (hard links share one) -> its size
async function diskFiles(backup: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const e of (await readIndex(backup)).values()) out.set(`${e.dev}:${e.ino}`, Number(e.size))
  return out
}

// ── Listing ───────────────────────────────────────────────────────────────────

export interface StoredBackup extends BackupManifest {
  dir: string
}

/** Every backup of a server, newest first: ones with a manifest, and old world-only ones */
export async function listBackups(f: ServerFiles): Promise<StoredBackup[]> {
  const root = backupsDir(f)
  let names: string[]
  try { names = (await fsp.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && isBackupId(e.name)).map(e => e.name) } catch { return [] }
  const out: StoredBackup[] = []
  await Promise.all(names.map(async id => {
    const dir = join(root, id)
    try {
      const m = parseManifest(JSON.parse(await fsp.readFile(join(dir, 'manifest.json'), 'utf-8')))
      if (m) { out.push({ ...m, id, dir }); return }
    } catch { /* no manifest: maybe an old one */ }
    if (!existsSync(join(dir, 'world'))) return
    const legacy = legacyManifest(id, f.serverName, { hasPlayersDb: existsSync(join(dir, 'players.db')), worldVersion: await readWorldVersion(join(dir, 'world')) })
    if (legacy) out.push({ ...legacy, dir })
  }))
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/**
 * Space on disk the given backups take together. Hard links count once: a backup only links
 * to the one right before it, so a file shared by two backups is in every backup between them
 * too, and comparing each backup with the previous one in the list is enough. Old world-only
 * backups are full copies, oldSize says how big.
 */
export async function diskUsage(backups: StoredBackup[], oldSize: (b: StoredBackup) => Promise<number> = async b => b.sizeBytes): Promise<number> {
  const chrono = [...backups].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  let total = 0
  let prev = new Map<string, number>()
  for (const b of chrono) {
    if (b.legacy) { total += await oldSize(b); continue }
    const files = await diskFiles(b.dir)
    for (const [key, size] of files) if (!prev.has(key)) total += size
    prev = files
  }
  return total
}

export async function deleteBackup(f: ServerFiles, id: string): Promise<void> {
  if (!isBackupId(id)) throw new Error("That isn't a backup.")
  // removes this backup's links only, the other backups keep their copy of a shared file
  await fsp.rm(join(backupsDir(f), id), { recursive: true, force: true })
}

// ── Making a backup ───────────────────────────────────────────────────────────

export interface CreateOptions {
  reason: BackupReason
  game: BackupGame
  mods: BackupMod[]
  settings?: BackupManifest['settings']
  savedFirst?: boolean
  now?: Date
  // rounds of copying again files the game wrote to while they were being copied
  retries?: number
  ops?: Partial<FsOps>
  onProgress?: (done: number, total: number) => void
}

export interface CreateResult {
  manifest: StoredBackup
  linked: number
  copied: number
  // linking stopped working on this drive, everything after was copied
  linksUnsupported: boolean
}

// errors that mean "this drive doesn't do hard links at all", not just "not this one file"
const NO_LINKS = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EINVAL', 'ENOSYS', 'EACCES'])

/** Back up the world, players db and config files. null when there's no world yet */
export async function createBackup(f: ServerFiles, opts: CreateOptions): Promise<CreateResult | null> {
  const ops = { ...realOps, ...opts.ops }
  const world = worldDir(f)
  if (!existsSync(world)) return null
  const root = backupsDir(f)
  await fsp.mkdir(root, { recursive: true })

  // a backup cut off half way (the app closed) is just a folder that's in the way
  for (const e of await fsp.readdir(root)) {
    if (e.endsWith('.partial')) await fsp.rm(join(root, e), { recursive: true, force: true }).catch(() => undefined)
  }

  const now = opts.now || new Date()
  let id = `${backupStamp(now)}_${opts.reason}`
  for (let n = 2; existsSync(join(root, id)); n++) id = `${backupStamp(now)}_${opts.reason}-${n}`
  const tmp = join(root, `${id}.partial`)

  // the newest backup that has a file list is what unchanged files get linked to
  const prevBackup = (await listBackups(f)).find(b => !b.legacy && existsSync(join(b.dir, 'files.tsv')))
  const prev = prevBackup ? await readIndex(prevBackup.dir) : new Map<string, IndexEntry>()

  // what goes in, as backup path -> live path
  const { files: worldFiles, dirs } = await walk(world)
  const sources = new Map<string, string>(worldFiles.map(rel => [`world/${rel}`, toPath(world, rel)]))
  if (existsSync(dbFile(f))) sources.set('players.db', dbFile(f))
  const configs = configNames(f).filter(n => existsSync(join(configDir(f), n)))
  for (const n of configs) sources.set(`config/${n}`, join(configDir(f), n))

  await fsp.mkdir(join(tmp, 'world'), { recursive: true })
  for (const d of dirs) await fsp.mkdir(toPath(join(tmp, 'world'), d), { recursive: true })
  if (configs.length) await fsp.mkdir(join(tmp, 'config'), { recursive: true })

  const index = new Map<string, IndexEntry>()
  const dirty = new Set<string>()
  let linked = 0, copied = 0, newBytes = 0n, done = 0
  let linksWork = true

  const copyOne = async (rel: string, src: string, before: BigIntStats) => {
    const dst = toPath(tmp, rel)
    await fsp.rm(dst, { force: true })
    await ops.copyFile(src, dst)
    const after = await statOrNull(src)
    let moved = !after || after.size !== before.size || after.mtimeNs !== before.mtimeNs
    if (!moved && isDb(rel)) moved = (await sha256(src)) !== (await sha256(dst))
    if (moved) dirty.add(rel)
    else dirty.delete(rel)
    const d = await fsp.stat(dst, { bigint: true })
    const was = index.get(rel)
    if (was) newBytes -= was.size
    index.set(rel, { size: d.size, mtimeNs: before.mtimeNs, dev: d.dev, ino: d.ino })
    newBytes += d.size
  }

  await pool([...sources], 16, async ([rel, src]) => {
    const s = await statOrNull(src)
    if (!s || !s.isFile()) return
    const p = prev.get(rel)
    if (linksWork && p && !isDb(rel) && p.size === s.size && p.mtimeNs === s.mtimeNs) {
      try {
        // from the previous backup's copy, never from the live file
        await ops.link(toPath(prevBackup!.dir, rel), toPath(tmp, rel))
        index.set(rel, { size: s.size, mtimeNs: s.mtimeNs, dev: p.dev, ino: p.ino })
        linked++
        opts.onProgress?.(++done, sources.size)
        return
      } catch (e) {
        if (NO_LINKS.has((e as NodeJS.ErrnoException).code || '')) linksWork = false
      }
    }
    try {
      await copyOne(rel, src, s)
      copied++
    } catch (e) {
      // gone since the listing (the game deletes files too), anything else is a real failure
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    opts.onProgress?.(++done, sources.size)
  }).catch(async (e) => {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    throw e
  })

  // files the game wrote to mid-copy: copy them again until they hold still
  for (let round = 0; round < (opts.retries ?? 3) && dirty.size > 0; round++) {
    for (const rel of [...dirty]) {
      const s = await statOrNull(sources.get(rel)!)
      if (!s) { dirty.delete(rel); continue }
      await copyOne(rel, sources.get(rel)!, s)
    }
  }

  const sizeBytes = [...index.values()].reduce((n, e) => n + e.size, 0n)
  await fsp.writeFile(join(tmp, 'files.tsv'), [...index].map(([rel, e]) => `${rel}\t${e.size}\t${e.mtimeNs}\t${e.dev}\t${e.ino}`).join('\n'), 'utf-8')
  const manifest: BackupManifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    id,
    createdAt: now.toISOString(),
    reason: opts.reason,
    serverName: f.serverName,
    game: { ...opts.game, worldVersion: (await readWorldVersion(world)) ?? opts.game.worldVersion },
    mods: opts.mods,
    configFiles: configs,
    hasPlayersDb: index.has('players.db'),
    sizeBytes: Number(sizeBytes),
    newBytes: Number(newBytes),
    files: index.size,
    savedFirst: opts.savedFirst,
    unsettledFiles: dirty.size || undefined,
    settings: opts.settings,
  }
  await fsp.writeFile(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await ops.rename(tmp, join(root, id))
  return { manifest: { ...manifest, dir: join(root, id) }, linked, copied, linksUnsupported: !linksWork }
}

// ── Restoring ─────────────────────────────────────────────────────────────────

async function copyTree(src: string, dst: string, ops: FsOps) {
  const { files, dirs } = await walk(src)
  await fsp.mkdir(dst, { recursive: true })
  for (const d of dirs) await fsp.mkdir(toPath(dst, d), { recursive: true })
  // real copies: the live world must never share a file with a backup
  await pool(files, 16, rel => ops.copyFile(toPath(src, rel), toPath(dst, rel)))
}

/**
 * A restore that was cut off (power cut, the app killed) left the old world in its .knox-old
 * folder or a half-copied .knox-staging one. Put things back the way they were before it:
 * the old world wins unless the swap had already finished.
 */
export async function recoverInterrupted(f: ServerFiles): Promise<string[]> {
  const notes: string[] = []
  const world = worldDir(f)
  const rmrf = (p: string) => fsp.rm(p, { recursive: true, force: true })
  if (existsSync(world + OLD)) {
    if (!existsSync(world)) { await fsp.rename(world + OLD, world); notes.push('Put the world back the way it was before a restore that didn\'t finish.') }
    else await rmrf(world + OLD)
  }
  if (existsSync(world + STAGING)) await rmrf(world + STAGING)
  for (const file of [dbFile(f), ...configNames(f).map(n => join(configDir(f), n))]) {
    if (existsSync(file + OLD)) {
      if (!existsSync(file)) await fsp.rename(file + OLD, file)
      else await rmrf(file + OLD)
    }
    if (existsSync(file + STAGING)) await rmrf(file + STAGING)
  }
  return notes
}

export interface RestoreOptions {
  // also put the server's .ini / SandboxVars / spawn files back
  configs: boolean
  ops?: Partial<FsOps>
}

/**
 * Put a backup back. Everything is copied next to the live files first (.knox-staging), and
 * only then swapped in with renames: the live world goes to .knox-old, the staged one takes
 * its place, then the old one is deleted. If any step fails, the steps already done are undone,
 * so there's always either the old world or the new one, never half of each.
 */
export async function restoreBackup(f: ServerFiles, backup: StoredBackup, opts: RestoreOptions): Promise<{ configs: string[] }> {
  const ops = { ...realOps, ...opts.ops }
  await recoverInterrupted(f)
  const world = worldDir(f)
  const src = join(backup.dir, 'world')
  if (!existsSync(src)) throw new Error("That backup doesn't have a world in it anymore.")

  // 1. stage everything
  const singles: Array<{ live: string; staged: string }> = []
  try {
    await copyTree(src, world + STAGING, ops)
    if (existsSync(join(backup.dir, 'players.db'))) {
      await fsp.mkdir(dirname(dbFile(f)), { recursive: true })
      await ops.copyFile(join(backup.dir, 'players.db'), dbFile(f) + STAGING)
      singles.push({ live: dbFile(f), staged: dbFile(f) + STAGING })
    }
    if (opts.configs) {
      for (const name of configNames(f)) {
        const from = join(backup.dir, 'config', name)
        if (!existsSync(from)) continue
        await fsp.mkdir(configDir(f), { recursive: true })
        await ops.copyFile(from, join(configDir(f), name) + STAGING)
        singles.push({ live: join(configDir(f), name), staged: join(configDir(f), name) + STAGING })
      }
    }
  } catch (e) {
    // nothing live was touched yet
    await recoverInterrupted(f).catch(() => undefined)
    throw e
  }

  // 2. swap, remembering how to undo each step
  const undo: Array<() => Promise<void>> = []
  try {
    if (existsSync(world)) {
      await ops.rename(world, world + OLD)
      undo.push(() => fsp.rename(world + OLD, world))
    }
    await ops.rename(world + STAGING, world)
    undo.push(() => fsp.rename(world, world + STAGING))
    for (const s of singles) {
      if (existsSync(s.live)) {
        await ops.rename(s.live, s.live + OLD)
        undo.push(() => fsp.rename(s.live + OLD, s.live))
      }
      await ops.rename(s.staged, s.live)
      undo.push(() => fsp.rename(s.live, s.staged))
    }
  } catch (e) {
    for (const step of undo.reverse()) await step().catch(() => undefined)
    await recoverInterrupted(f).catch(() => undefined)
    throw e
  }

  // 3. the old copies can go
  await fsp.rm(world + OLD, { recursive: true, force: true }).catch(() => undefined)
  for (const s of singles) await fsp.rm(s.live + OLD, { force: true }).catch(() => undefined)
  return { configs: singles.filter(s => !s.live.endsWith('.db')).map(s => s.live) }
}
