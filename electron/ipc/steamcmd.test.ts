import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { getPath: () => tmpdir(), isPackaged: false } }))

const { installArgs, workshopDownloadArgs, downloadMods, installFailureMessage, worthRetrying } = await import('./steamcmd')

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
