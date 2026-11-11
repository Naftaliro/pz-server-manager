// What's being changed right now that a server start would get in the way of: a game server
// install being updated or switched to another version, and a server's own world being
// rolled back, wiped or moved to its own folder. startServer asks here first, and the window
// gets the list (busy:list, busy:changed) to grey out Start and to show a job that's still
// going after it was away from the page. No Electron in here, for the tests.

import { win32 } from 'path'

export type BusyKind = 'game-update' | 'rollback' | 'wipe' | 'data-folder'

export interface BusyJob {
  id: number
  kind: BusyKind
  // what it changes: one server's world, or a game server install (all servers on it)
  profileId?: string
  installDir?: string
  // what it's doing, in plain words, for the window
  progress: string
  startedAt: number
  // finished, kept until the window has shown what came of it (a rollback's result screen
  // with the players' Steam steps shouldn't be lost because the user looked at another page)
  done?: boolean
  result?: unknown
}

// One thing at a time on a server's own files (its world, db, settings, backups): backups,
// restores, a wipe and a move to its own folder wait for each other
const queues = new Map<string, Promise<unknown>>()
export function oneAtATime<T>(profileId: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(profileId) || Promise.resolve()).then(job, job)
  queues.set(profileId, run.catch(() => undefined))
  return run
}

const jobs = new Map<number, BusyJob>()
let nextId = 1
let listener: ((jobs: BusyJob[]) => void) | null = null

const installKey = (dir: string) => win32.resolve(dir).toLowerCase()

export function onBusyChange(fn: ((jobs: BusyJob[]) => void) | null) {
  listener = fn
}

export function busyJobs(): BusyJob[] {
  return [...jobs.values()].map(j => ({ ...j }))
}

function changed() {
  listener?.(busyJobs())
}

export interface BusyOptions {
  // keep the job (as done, with its result) until dismissJob, see BusyJob.done
  keepResult?: boolean
}

/**
 * Run job with its target marked busy. progress() updates what the window shows. The mark
 * goes when the job ends, however it ends
 */
export async function whileBusy<T>(
  target: { profileId?: string; installDir?: string },
  kind: BusyKind,
  progress: string,
  job: (progress: (text: string) => void) => Promise<T>,
  opts: BusyOptions = {},
): Promise<T> {
  const j: BusyJob = { id: nextId++, kind, profileId: target.profileId, installDir: target.installDir, progress, startedAt: Date.now() }
  jobs.set(j.id, j)
  changed()
  let result: T | undefined
  try {
    result = await job((text) => { if (text && text !== j.progress) { j.progress = text; changed() } })
    return result
  } finally {
    // a result to show stays for the window, anything else goes
    const r = result as { success?: unknown } | undefined
    if (opts.keepResult && r !== undefined) {
      j.done = true
      j.result = r
    } else {
      jobs.delete(j.id)
    }
    changed()
  }
}

// the window has shown a finished job's result
export function dismissJob(id: number) {
  const j = jobs.get(id)
  if (j?.done && jobs.delete(id)) changed()
}

/** The job still running on this install, newest first */
export function installJob(installDir: string): BusyJob | undefined {
  if (!installDir) return undefined
  const key = installKey(installDir)
  return [...jobs.values()].filter(j => !j.done && j.installDir && installKey(j.installDir) === key).pop()
}

/** The job still running on this server's own files, newest first */
export function profileJob(profileId: string): BusyJob | undefined {
  return [...jobs.values()].filter(j => !j.done && j.profileId === profileId).pop()
}

/**
 * Why this server can't start right now, in plain words, or null. A job that changes its
 * world comes first (that's the one the user started on this server)
 */
export function startBlocker(profile: { id: string; serverInstallPath: string }): string | null {
  const own = profileJob(profile.id)
  if (own) {
    if (own.kind === 'rollback') return "This server's world is being rolled back. Start it again when that's done."
    if (own.kind === 'wipe') return "This server's world is being wiped. Start it again when that's done."
    if (own.kind === 'data-folder') return "This server's files are being moved to its own folder. Start it again when that's done."
  }
  if (installJob(profile.serverInstallPath)) return "The game server is updating. Start it again when that's done."
  return null
}
