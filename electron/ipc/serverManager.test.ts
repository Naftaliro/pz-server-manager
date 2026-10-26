import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { getPath: () => tmpdir(), isPackaged: false } }))

const { dailyRestartDue, iniSettingsFor } = await import('./serverManager')

describe('iniSettingsFor', () => {
  const profile = {
    name: 'Test', buildVersion: 'b42', port: 16261, udpPort: 16262, maxPlayers: 8, serverPassword: 'pw',
    iniSettings: { PVP: false, Map: 'Muldraugh, KY', Mods: 'stale' },
    mapOrder: ['Bedford Falls'],
    mods: [
      { workshopId: '111', modId: 'Guns', name: 'Guns', infos: [{ id: 'Guns', name: 'Guns', requires: ['Lib'], maps: [] }] },
      { workshopId: '222', modId: 'RavenMap', name: 'Raven', maps: ['Raven Creek'] },
      { workshopId: '', modId: 'LocalFix', name: 'Local fix' },
      { workshopId: '333', modId: 'Lib;Bedford', name: 'Lib + map', maps: ['Bedford Falls'] },
    ],
  } as unknown as Parameters<typeof iniSettingsFor>[0]

  it('writes mods in load-rule order with B42 backslashes, skipping local mods in WorkshopItems', () => {
    const s = iniSettingsFor(profile)
    // only Lib has to move up for Guns, its sibling Bedford keeps its place
    expect(s.Mods).toBe('\\Lib;\\Guns;\\RavenMap;\\LocalFix;\\Bedford')
    expect(s.WorkshopItems).toBe('111;222;333')
  })

  it('puts mod maps first in the saved map order, vanilla last', () => {
    expect(iniSettingsFor(profile).Map).toBe('Bedford Falls;Raven Creek;Muldraugh, KY')
  })

  it('keeps other saved settings and overrides the profile-owned ones', () => {
    const s = iniSettingsFor(profile)
    expect(s.PVP).toBe(false)
    expect(s.DefaultPort).toBe(16261)
    expect(s.Password).toBe('pw')
  })
})

const at = (h: number, m: number, day = 10) => new Date(2026, 9, day, h, m)

describe('dailyRestartDue', () => {
  it('starts warning 5 minutes before the hour', () => {
    expect(dailyRestartDue(4, at(3, 54))).toBeNull()
    expect(dailyRestartDue(4, at(3, 55))).toBe(at(4, 0).toDateString())
    expect(dailyRestartDue(4, at(3, 57))).toBe(at(4, 0).toDateString())
  })

  it('gives up if the tick was more than a few minutes late', () => {
    expect(dailyRestartDue(4, at(3, 59))).toBeNull()
    expect(dailyRestartDue(4, at(4, 30))).toBeNull()
  })

  it('only fires once per day', () => {
    const key = dailyRestartDue(4, at(3, 55))!
    expect(dailyRestartDue(4, at(3, 56), key)).toBeNull()
    expect(dailyRestartDue(4, at(3, 55, 11), key)).toBe(at(4, 0, 11).toDateString())
  })

  it('puts the 23:55 warning for a midnight restart on the next day', () => {
    expect(dailyRestartDue(0, at(23, 55))).toBe(at(0, 0, 11).toDateString())
  })
})
