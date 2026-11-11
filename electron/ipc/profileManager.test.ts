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

describe('a new server gets its own data folder', () => {
  it('in Zomboid\\Knox servers, unless one was picked', async () => {
    const p = await save({ id: '', name: 'Folder Test', mods: [], port: 16271, iniSettings: {} })
    expect(p.worldSavePath).toBe('%USERPROFILE%\\Zomboid\\Knox servers\\Folder_Test')
    const picked = await save({ id: '', name: 'Picked', mods: [], port: 16273, worldSavePath: 'D:\\PZData', iniSettings: {} })
    expect(picked.worldSavePath).toBe('D:\\PZData')
  })

  it('an older server without one keeps the shared folder', async () => {
    const p = await save({ id: '', name: 'Old', mods: [], port: 16275, iniSettings: {} })
    const again = await save({ ...p, worldSavePath: '' })
    expect(again.worldSavePath).toBe('')
  })
})

describe('Make a copy', () => {
  const duplicate = (id: string) => handlers.get('profiles:duplicate')!({}, id) as Promise<Record<string, any>>

  it('twice gives two servers with their own ports, RCON port, name and folder', async () => {
    const base = await save({ id: '', name: 'Dup Base', mods: [], port: 26261, udpPort: 26262, iniSettings: { RCONPort: 37015 } })
    const a = await duplicate(base.id)
    const b = await duplicate(base.id)
    const all = (await handlers.get('profiles:list')!({})) as Array<Record<string, any>>
    expect([a.name, b.name]).toEqual(['Dup Base (Copy)', 'Dup Base (Copy 2)'])
    const ports = all.flatMap(p => [p.port, p.udpPort ?? p.port + 1])
    expect(new Set(ports).size).toBe(ports.length)
    // (the servers made by the tests above all have the default 27015)
    const rcon = [base, a, b].map(p => Number(p.iniSettings.RCONPort))
    expect(new Set(rcon).size).toBe(3)
    expect(rcon).not.toContain(27015)
    expect(a.iniSettings.DefaultPort).toBe(a.port)
    expect(a.serverName).not.toBe(b.serverName)
    expect(a.worldSavePath).not.toBe(b.worldSavePath)
    expect(a.iniSettings.RCONPassword).not.toBe(base.iniSettings.RCONPassword)
  })
})
