import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { getPath: () => tmpdir(), isPackaged: false } }))

const { installArgs, workshopDownloadArgs, downloadMods, installFailureMessage, worthRetrying, runServerInstall, onBeforeServerUpdate } = await import('./steamcmd')
const { installJob } = await import('./busy')

// A stand-in steamcmd.exe: a copy of node.exe that runs fake-steamcmd.js first (NODE_OPTIONS).
// Each run takes the next step of the plan: the exit code, and the build and branch it leaves
// in the install's appmanifest (none = it didn't touch the install)
type Step = { code: number; build?: string; branch?: string; say?: string }
const FAKE = `
const fs = require('fs'), path = require('path')
if (process.argv.includes('+app_info_print')) {
  // what Steam has for each branch: FAKE_STEAM_BRANCHES = {"public":"300"}
  const b = JSON.parse(process.env.FAKE_STEAM_BRANCHES || '{}')
  console.log('"380870"\\n{\\n\\t"depots"\\n\\t{\\n\\t\\t"branches"\\n\\t\\t{\\n' + Object.entries(b).map(([n, id]) => '\\t\\t\\t"' + n + '"\\n\\t\\t\\t{\\n\\t\\t\\t\\t"buildid"\\t\\t"' + id + '"\\n\\t\\t\\t}\\n').join('') + '\\t\\t}\\n\\t}\\n}')
  process.exit(0)
}
const plan = JSON.parse(fs.readFileSync(process.env.FAKE_STEAM_PLAN, 'utf-8'))
const runs = path.join(path.dirname(process.env.FAKE_STEAM_PLAN), 'runs.txt')
const n = fs.existsSync(runs) ? fs.readFileSync(runs, 'utf-8').split('\\n').filter(Boolean).length : 0
fs.appendFileSync(runs, process.argv.slice(1).join(' ') + '\\n')
const step = plan[Math.min(n, plan.length - 1)]
// node takes the first argument for its script and makes it a full path
const dir = process.argv[process.argv.findIndex(a => a.endsWith('+force_install_dir')) + 1]
if (step.build) {
  fs.mkdirSync(path.join(dir, 'steamapps'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'StartServer64.bat'), 'rem')
  fs.writeFileSync(path.join(dir, 'steamapps', 'appmanifest_380870.acf'), '"AppState"\\n{\\n\\t"buildid"\\t\\t"' + step.build + '"\\n' + (step.branch && step.branch !== 'public' ? '\\t"UserConfig"\\n\\t{\\n\\t\\t"BetaKey"\\t\\t"' + step.branch + '"\\n\\t}\\n' : '') + '}\\n')
}
if (step.say) console.log(step.say)
process.exit(step.code)
`
let fakeDir = ''
async function fakeSteam(plan: Step[], installed?: { build: string; branch?: string }) {
  const { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, existsSync } = await import('fs')
  const { join } = await import('path')
  if (!fakeDir || !existsSync(join(fakeDir, 'steamcmd.exe'))) {
    fakeDir = mkdtempSync(join(tmpdir(), 'pzm-fakesteam-'))
    copyFileSync(process.execPath, join(fakeDir, 'steamcmd.exe'))
    writeFileSync(join(fakeDir, 'fake-steamcmd.js'), FAKE)
  }
  const work = mkdtempSync(join(tmpdir(), 'pzm-fakerun-'))
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan))
  const installDir = join(work, 'server')
  if (installed) {
    mkdirSync(join(installDir, 'steamapps'), { recursive: true })
    writeFileSync(join(installDir, 'StartServer64.bat'), 'rem')
    writeFileSync(join(installDir, 'steamapps', 'appmanifest_380870.acf'), `"AppState"\n{\n\t"buildid"\t\t"${installed.build}"\n${installed.branch && installed.branch !== 'public' ? `\t"UserConfig"\n\t{\n\t\t"BetaKey"\t\t"${installed.branch}"\n\t}\n` : ''}}\n`)
  }
  process.env.FAKE_STEAM_PLAN = join(work, 'plan.json')
  process.env.NODE_OPTIONS = `--require ${join(fakeDir, 'fake-steamcmd.js')}`
  const { readFileSync } = await import('fs')
  const runs = () => { try { return readFileSync(join(work, 'runs.txt'), 'utf-8').split('\n').filter(Boolean).length } catch { return 0 } }
  return { exe: join(fakeDir, 'steamcmd.exe'), installDir, runs }
}

describe.runIf(process.platform === 'win32')('updating a server install', () => {
  const restoreEnv = { ...process.env }
  const done = () => { process.env.NODE_OPTIONS = restoreEnv.NODE_OPTIONS || ''; if (!restoreEnv.NODE_OPTIONS) delete process.env.NODE_OPTIONS }

  it("checks again that nothing runs on it once it's SteamCMD's turn, and stops if something does", async () => {
    const f = await fakeSteam([{ code: 0, build: '200' }], { build: '100' })
    const order: string[] = []
    let running = false
    onBeforeServerUpdate({
      prepare: async (dir) => { order.push('prepare'); expect(installJob(dir)).toBeTruthy(); return ['a'] },
      check: async (_dir, backedUp) => {
        order.push(`check:${backedUp.join(',')}`)
        if (running) throw new Error('Stop "Friday" first, the game server can\'t update while it runs.')
      },
    })
    try {
      // something got going on it while the update waited
      running = true
      const lines: string[] = []
      const r = await runServerInstall(f.exe, f.installDir, l => lines.push(l), true)
      expect(r).toEqual({ success: false, message: 'Stop "Friday" first, the game server can\'t update while it runs.' })
      expect(order).toEqual(['prepare', 'check:a'])
      expect(f.runs()).toBe(0)
      expect(installJob(f.installDir)).toBeUndefined()

      // two in a row: the second one checks when its turn comes, after the first is done
      running = false
      order.length = 0
      const g = await fakeSteam([{ code: 0, build: '200' }], { build: '100' })
      const one = runServerInstall(g.exe, g.installDir, l => { if (/Starting server update/.test(l)) order.push('run') }, true)
      const two = runServerInstall(g.exe, g.installDir, l => { if (/Starting server update/.test(l)) order.push('run') }, true)
      await Promise.all([one, two])
      expect(order).toEqual(['prepare', 'prepare', 'check:a', 'run', 'check:a', 'run'])
      expect(g.runs()).toBe(2)
    } finally {
      onBeforeServerUpdate({ prepare: async () => [], check: async () => undefined })
      done()
    }
  }, 60000)

  describe('only says it worked when it did', () => {
    const update = async (plan: Step[], installed: { build: string; branch?: string }, steam: Record<string, string>, branch?: string) => {
      const f = await fakeSteam(plan, installed)
      process.env.FAKE_STEAM_BRANCHES = JSON.stringify(steam)
      try {
        return { ...(await runServerInstall(f.exe, f.installDir, () => undefined, true, 'b42', branch)), runs: f.runs() }
      } finally {
        done()
      }
    }

    it('runs SteamCMD again after it updated itself, also on an install that is there', async () => {
      const r = await update([{ code: 7 }, { code: 0, build: '300' }], { build: '200' }, { public: '300' })
      expect(r).toMatchObject({ success: true, runs: 2 })
    }, 60000)

    it("isn't fooled by SteamCMD updating itself twice and leaving the old build", async () => {
      const r = await update([{ code: 7 }, { code: 7 }], { build: '200' }, { public: '300' })
      expect(r.success).toBe(false)
      expect(r.message).toMatch(/^Steam didn't update the server\b.*Try again/)
      expect(r.runs).toBe(2)
    }, 60000)

    it('is fine when there was nothing to update', async () => {
      expect(await update([{ code: 0 }], { build: '300' }, { public: '300' })).toMatchObject({ success: true, runs: 1 })
    }, 60000)

    it("says plainly when Steam didn't switch the version", async () => {
      const r = await update([{ code: 0, build: '200' }], { build: '200' }, { public: '200', '42.21': '100' }, '42.21')
      expect(r.success).toBe(false)
      expect(r.message).toBe("Steam didn't switch the server to 42.21. Try again, or check that the 42.21 version is still offered in Steam.")
      const ok = await update([{ code: 0, build: '100', branch: '42.21' }], { build: '200' }, { public: '200', '42.21': '100' }, '42.21')
      expect(ok).toMatchObject({ success: true, branch: '42.21' })
    }, 60000)
  })
})

describe('installFailureMessage', () => {
  it("doesn't blame the internet for SteamCMD restarting after its own update", () => {
    const m = installFailureMessage(7, ['[----] Update complete, launching...'], 'C:\\PZServer')
    expect(m).toMatch(/updating itself/)
    expect(m).not.toMatch(/internet/)
  })
  it('names a folder it may not write to', () => {
    expect(installFailureMessage(8, ["ERROR! Failed to install app '380870' (Disk write failure)"], 'C:\\Program Files\\PZ')).toMatch(/wouldn't let SteamCMD write to C:\\Program Files\\PZ/)
  })
  it('says when it really is the connection', () => {
    expect(installFailureMessage(5, ['Connecting anonymously to Steam Public...FAILED (No Connection)'], 'C:\\PZServer')).toMatch(/internet connection/)
  })
  it('runs SteamCMD again after a self-update or a cold app info cache, not after a real error', () => {
    expect(worthRetrying(7, [])).toBe(true)
    expect(worthRetrying(8, ["ERROR! Failed to install app '380870' (Missing configuration)"])).toBe(true)
    expect(worthRetrying(8, ["ERROR! Failed to install app '380870' (Disk write failure)"])).toBe(false)
    expect(worthRetrying(0, [])).toBe(false)
  })
  it('passes on any other reason SteamCMD gives', () => {
    expect(installFailureMessage(8, ["ERROR! Failed to install app '380870' (Missing configuration)"], 'C:\\PZServer')).toMatch(/Missing configuration/)
  })
})

// what a pasted WorkshopItems= line from someone else's .ini could carry (security review F1)
const INJECTED = ['0', '1 & calc.exe', '2392709985" & whoami > %TEMP%\\x.txt & "', '3|powershell -c evil', '4\r\n+quit']

describe('SteamCMD command line', () => {
  it('puts every +command and its arguments in their own item, path with spaces as one', () => {
    expect(installArgs('C:\\Program Files (x86)\\PZ Server', 'public')).toEqual([
      '+force_install_dir', 'C:\\Program Files (x86)\\PZ Server',
      '+login', 'anonymous',
      '+app_update', '380870', '-beta', 'public', 'validate',
      '+quit',
    ])
    expect(installArgs('C:\\PZServer', 'legacy41')).toEqual([
      '+force_install_dir', 'C:\\PZServer', '+login', 'anonymous', '+app_update', '380870', '-beta', 'legacy41', 'validate', '+quit',
    ])
    expect(installArgs('C:\\PZServer', '42.21')).toContain('42.21')
  })

  // F-04: SteamCMD keeps the last branch when -beta is left out, so public has to be said out loud
  it('always names the branch, public included', () => {
    expect(installArgs('C:\\PZServer')).toEqual(expect.arrayContaining(['-beta', 'public']))
    expect(() => installArgs('C:\\PZServer', 'x +quit')).toThrow()
    expect(() => installArgs('C:\\PZServer', '-beta')).toThrow()
  })

  it('downloads each workshop item with its own +workshop_download_item', () => {
    expect(workshopDownloadArgs('D:\\Servers\\PZ & Friends', ['2392709985', '2200148440'])).toEqual([
      '+force_install_dir', 'D:\\Servers\\PZ & Friends',
      '+login', 'anonymous',
      '+workshop_download_item', '108600', '2392709985',
      '+workshop_download_item', '108600', '2200148440',
      '+quit',
    ])
  })

  it('refuses anything that is not a workshop id', () => {
    for (const bad of INJECTED.slice(1)) expect(() => workshopDownloadArgs('C:\\PZServer', ['2392709985', bad])).toThrow(/isn't a Workshop item id/)
    expect(() => workshopDownloadArgs('C:\\PZServer', [123 as unknown as string])).toThrow()
    expect(() => workshopDownloadArgs('C:\\PZServer', ['1'.repeat(21)])).toThrow()
  })

  it('refuses install folders that are not a plain full path', () => {
    for (const dir of ['PZServer', 'C:\\PZ" +login evil', 'C:\\PZ +quit', 'C:\\PZ\r\nx', '']) {
      expect(() => installArgs(dir)).toThrow(/isn't a folder/)
    }
  })

  it('turns bad ids away before SteamCMD is even looked for', async () => {
    const events: Array<{ workshopId: string; state: string }> = []
    const r = await downloadMods(INJECTED.slice(1), e => events.push(e))
    expect(r.success).toBe(false)
    expect(r.done).toEqual([])
    expect(r.failed).toEqual(INJECTED.slice(1))
    expect(events.every(e => e.state === 'failed')).toBe(true)
  })
})
