import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const userData = mkdtempSync(join(tmpdir(), 'pzm-profiles-'))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) },
  app: { getPath: () => userData },
}))

const { setupProfileHandlers } = await import('./profileManager')
beforeAll(() => setupProfileHandlers())
afterAll(() => rmSync(userData, { recursive: true, force: true }))

const save = (profile: unknown) => handlers.get('profiles:save')!({}, profile) as Promise<Record<string, any>>

describe('a new server makes its own secrets', () => {
  // security review F4: settings copied from someone else's server pack
  it("ignores an RCON password, admin password or Discord token it was handed", async () => {
    const p = await save({
      id: '', name: 'Cozy Friends Server', mods: [], port: 16261,
      iniSettings: { PVP: false, RCONPassword: 'attacker-knows-this', AdminPassword: 'x', DiscordToken: 'tok', WebhookAddress: 'https://x', ResetID: 1, RCONPort: 27016 },
    })
    expect(p.iniSettings.RCONPassword).toMatch(/^[a-f0-9]{24}$/)
    expect(p.iniSettings.AdminPassword).toBeUndefined()
    expect(p.iniSettings.DiscordToken).toBeUndefined()
    expect(p.iniSettings.WebhookAddress).toBeUndefined()
    expect(p.iniSettings.ResetID).not.toBe(1)
    // the rest is kept
    expect(p.iniSettings.PVP).toBe(false)
    expect(p.iniSettings.RCONPort).toBe(27016)
  })

  it('keeps the RCON password of a server that already exists', async () => {
    const p = await save({ id: '', name: 'Mine', mods: [], port: 16263, iniSettings: {} })
    const again = await save({ ...p, iniSettings: { ...p.iniSettings, PVP: true } })
    expect(again.iniSettings.RCONPassword).toBe(p.iniSettings.RCONPassword)
  })

  it('drops mods with a workshop id that is not one (security review F1)', async () => {
    const p = await save({ id: '', name: 'Ids', port: 16265, iniSettings: {}, mods: [
      { workshopId: '2392709985', modId: 'A', name: 'A' },
      { workshopId: '1 & calc.exe', modId: 'B', name: 'B' },
      { workshopId: '', modId: 'Fix', name: 'Fix' },
    ] })
    expect(p.mods.map((m: { modId: string }) => m.modId)).toEqual(['A', 'Fix'])
  })
})
