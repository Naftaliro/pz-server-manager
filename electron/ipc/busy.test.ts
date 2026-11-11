import { describe, it, expect } from 'vitest'
import { whileBusy, startBlocker, busyJobs, dismissJob, onBusyChange, installJob, profileJob, oneAtATime } from './busy'

const server = { id: 'a', serverInstallPath: 'C:\\PZ\\server' }
const other = { id: 'b', serverInstallPath: 'C:\\PZ\\server\\' }
const elsewhere = { id: 'c', serverInstallPath: 'D:\\Other' }

function gate() {
  let open!: () => void
  const wait = new Promise<void>(r => { open = r })
  return { open, wait }
}

describe('what a start has to wait for', () => {
  it('a game update blocks every server on that install, nothing else', async () => {
    const g = gate()
    const job = whileBusy({ installDir: 'c:\\pz\\SERVER' }, 'game-update', 'Updating...', () => g.wait)
    expect(startBlocker(server)).toBe("The game server is updating. Start it again when that's done.")
    expect(startBlocker(other)).toMatch(/updating/)
    expect(startBlocker(elsewhere)).toBeNull()
    g.open()
    await job
    expect(startBlocker(server)).toBeNull()
  })

  it("a rollback blocks only that server, and says so first", async () => {
    const g = gate()
    const u = gate()
    const rb = whileBusy({ profileId: 'a' }, 'rollback', 'Getting started...', async () => {
      // switching the game version inside it
      await whileBusy({ installDir: server.serverInstallPath }, 'game-update', 'Switching...', () => u.wait)
      await g.wait
      return { success: true }
    })
    await Promise.resolve()
    expect(startBlocker(server)).toBe("This server's world is being rolled back. Start it again when that's done.")
    expect(startBlocker(other)).toMatch(/updating/)
    u.open()
    await new Promise(r => setTimeout(r, 0))
    expect(startBlocker(other)).toBeNull()
    expect(startBlocker(server)).toMatch(/rolled back/)
    g.open()
    await rb
    expect(startBlocker(server)).toBeNull()
  })

  it('goes away when the job fails too', async () => {
    await expect(whileBusy({ profileId: 'a' }, 'wipe', 'Wiping...', async () => { throw new Error('in use') })).rejects.toThrow('in use')
    expect(profileJob('a')).toBeUndefined()
  })
})

describe('telling the window', () => {
  it('reports progress, and keeps a result until it has been shown', async () => {
    const seen: string[] = []
    onBusyChange(jobs => seen.push(jobs.map(j => `${j.kind}:${j.progress}${j.done ? ':done' : ''}`).join(',')))
    try {
      const r = await whileBusy({ profileId: 'x' }, 'rollback', 'Getting started...', async (progress) => {
        progress('Putting the world back...')
        return { success: true, message: 'ok' }
      }, { keepResult: true })
      expect(r).toEqual({ success: true, message: 'ok' })
      expect(seen).toEqual(['rollback:Getting started...', 'rollback:Putting the world back...', 'rollback:Putting the world back...:done'])
      const done = busyJobs().find(j => j.profileId === 'x')!
      expect(done.result).toEqual({ success: true, message: 'ok' })
      // a finished one doesn't block anything
      expect(startBlocker({ id: 'x', serverInstallPath: 'E:\\x' })).toBeNull()
      dismissJob(done.id)
      expect(busyJobs().find(j => j.profileId === 'x')).toBeUndefined()
    } finally {
      onBusyChange(null)
    }
  })

  it('finds the newest job on an install', async () => {
    const g = gate()
    const job = whileBusy({ installDir: 'F:\\srv' }, 'game-update', 'one', () => g.wait)
    expect(installJob('f:\\SRV')?.progress).toBe('one')
    g.open()
    await job
    expect(installJob('F:\\srv')).toBeUndefined()
  })
})

describe('one thing at a time on a server', () => {
  it('runs jobs for one server in order, even after one fails', async () => {
    const order: string[] = []
    const a = oneAtATime('q', async () => { await new Promise(r => setTimeout(r, 20)); order.push('backup') })
    const b = oneAtATime('q', async () => { order.push('restore'); throw new Error('no') })
    const c = oneAtATime('q', async () => { order.push('start') })
    await Promise.allSettled([a, b, c])
    expect(order).toEqual(['backup', 'restore', 'start'])
  })
})
