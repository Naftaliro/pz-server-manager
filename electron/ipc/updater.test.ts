import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { getPath: () => tmpdir(), isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, shell: {} }))
// Electron's unpatched fs, only there inside Electron
vi.mock('original-fs', async () => ({ default: await import('fs') }))

const { unpackAndCheckUpdate } = await import('./updater')

const zipOf = (dir: string, zip: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${dir.replace(/'/g, "''")}\\*' -DestinationPath '${zip.replace(/'/g, "''")}'`])

// security review F6: the portable zip used to go in after a look at its first two bytes
describe.runIf(process.platform === 'win32')('portable updates on Windows', () => {
  const exe = 'PZ Server Manager.exe'
  const make = (fill: (pkg: string) => void) => {
    const base = mkdtempSync(join(tmpdir(), "pzm upd it's-"))
    const pkg = join(base, 'pkg')
    mkdirSync(join(pkg, 'resources'), { recursive: true })
    writeFileSync(join(pkg, 'resources', 'app.asar'), 'new')
    fill(pkg)
    zipOf(pkg, join(base, 'update.zip'))
    return { zip: join(base, 'update.zip'), extractDir: join(base, 'extracted') }
  }

  it("won't take an unsigned exe", async () => {
    const u = make(pkg => writeFileSync(join(pkg, exe), readFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')).subarray(0, 4096)))
    expect(await unpackAndCheckUpdate(u.zip, u.extractDir, exe)).toEqual({ error: expect.stringMatching(/isn't signed by Mitchell Berg/) })
  }, 120000)

  it("won't take an exe someone else signed", async () => {
    // node.exe: validly signed, by the OpenJS Foundation
    const u = make(pkg => copyFileSync(process.execPath, join(pkg, exe)))
    expect(await unpackAndCheckUpdate(u.zip, u.extractDir, exe)).toEqual({ error: expect.stringMatching(/isn't signed by Mitchell Berg/) })
  }, 120000)

  it("won't take a zip without the app's exe", async () => {
    const u = make(pkg => writeFileSync(join(pkg, 'other.exe'), 'x'))
    expect(await unpackAndCheckUpdate(u.zip, u.extractDir, exe)).toEqual({ error: expect.stringMatching(/doesn't have PZ Server Manager.exe/) })
  }, 120000)

  it("won't take something that isn't a zip", async () => {
    const base = mkdtempSync(join(tmpdir(), 'pzm-upd-'))
    writeFileSync(join(base, 'update.zip'), 'PK but not really')
    expect(await unpackAndCheckUpdate(join(base, 'update.zip'), join(base, 'x'), exe)).toEqual({ error: expect.stringMatching(/Couldn't unpack/) })
  }, 120000)
})
