import { execFile } from 'child_process'
import { opendir, stat } from 'fs/promises'
import { join } from 'path'
import { folderSizeArgs, parseFolderSize } from './winScripts'

// Folder sizes without freezing the app. A world save is ~90,000 small files and each backup
// is another copy; adding them up one stat at a time on the main process took 40 s for VAN.
// robocopy reads the sizes out of the folder listing in its own process (1.6 s for VAN).

function robocopySize(dir: string): Promise<number | null> {
  return new Promise((resolve) => {
    // robocopy's exit code is a bit mask (1 = "would copy files"), only 8+ is a failure,
    // so read the totals whatever the code
    execFile('robocopy', folderSizeArgs(dir), { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
      resolve(parseFolderSize(String(stdout || '')))
    })
  })
}

// if robocopy isn't usable: walk the folder, but without blocking (one directory at a time)
async function walkSize(dir: string): Promise<number> {
  let total = 0
  const pending = [dir]
  while (pending.length) {
    const d = pending.pop()!
    try {
      for await (const e of await opendir(d)) {
        const p = join(d, e.name)
        if (e.isDirectory()) pending.push(p)
        else { try { total += (await stat(p)).size } catch { /* gone */ } }
      }
    } catch { /* missing or no access */ }
  }
  return total
}

const cache = new Map<string, { at: number; bytes: Promise<number> }>()

// keepMs: how long an answer stays good. A backup never changes (Infinity), a live world
// does (a few minutes is plenty for a size shown on screen). Asking again while it's being
// measured shares that run
export function folderSize(dir: string, keepMs = 0): Promise<number> {
  const key = dir.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < keepMs) return hit.bytes
  const bytes = robocopySize(dir).then(n => n ?? walkSize(dir))
  cache.set(key, { at: Date.now(), bytes })
  // a failed or empty answer shouldn't stick around
  bytes.then(n => { if (n === 0) cache.delete(key) }, () => cache.delete(key))
  return bytes
}

// a backup or world got deleted or replaced
export function forgetFolderSize(dir: string) {
  cache.delete(dir.toLowerCase())
}
