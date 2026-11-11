import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { getPath: () => tmpdir(), isPackaged: false } }))

const { installArgs, workshopDownloadArgs, downloadMods } = await import('./steamcmd')

// what a pasted WorkshopItems= line from someone else's .ini could carry (security review F1)
const INJECTED = ['0', '1 & calc.exe', '2392709985" & whoami > %TEMP%\\x.txt & "', '3|powershell -c evil', '4\r\n+quit']

describe('SteamCMD command line', () => {
  it('puts every +command and its arguments in their own item, path with spaces as one', () => {
    expect(installArgs('C:\\Program Files (x86)\\PZ Server', 'b42')).toEqual([
      '+force_install_dir', 'C:\\Program Files (x86)\\PZ Server',
      '+login', 'anonymous',
      '+app_update', '380870', 'validate',
      '+quit',
    ])
    expect(installArgs('C:\\PZServer', 'b41')).toEqual([
      '+force_install_dir', 'C:\\PZServer', '+login', 'anonymous', '+app_update', '380870', '-beta', 'legacy41', 'validate', '+quit',
    ])
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
