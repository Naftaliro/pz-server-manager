import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanWorkshopItem } from './modManager'

// the scanner doesn't touch electron, the module just imports it
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { getPath: () => tmpdir() } }))

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pzm-scan-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// write <item>/mods/<mod>/<sub>/mod.info (sub '' = the mod folder itself)
function info(mod: string, sub: string, text: string) {
  const d = join(dir, 'mods', mod, sub)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'mod.info'), text)
}
const folder = (...parts: string[]) => mkdirSync(join(dir, 'mods', ...parts), { recursive: true })

describe('scanWorkshopItem', () => {
  it('reads a B41 mod at the top of the mod folder', () => {
    info('Old', '', 'id=OldMod\nname=Old one\nrequire=Lib')
    expect(scanWorkshopItem(dir)).toEqual([
      { id: 'OldMod', name: 'Old one', requires: ['Lib'], maps: [], loadAfter: [], loadBefore: [], incompatible: [], builds: ['b41'] },
    ])
  })

  it('reads a B42 mod from its 42 folder', () => {
    info('New', '42', 'id=NewMod\nloadModAfter=\\Base')
    folder('New', 'common')
    const [m] = scanWorkshopItem(dir)
    expect(m.id).toBe('NewMod')
    expect(m.loadAfter).toEqual(['Base'])
    expect(m.builds).toEqual(['b42'])
  })

  it('counts mod.info in common plus media-only 42.x folders as B42', () => {
    info('Lib', 'common', 'id=tsarslib')
    folder('Lib', '42.13', 'media')
    expect(scanWorkshopItem(dir)[0].builds).toEqual(['b42'])
  })

  it('counts a mod with only common/mod.info as B42', () => {
    info('Brief', 'common', 'id=SurvivorBriefing')
    expect(scanWorkshopItem(dir)[0].builds).toEqual(['b42'])
  })

  it('prefers the 42 folder over common and the B41 copy', () => {
    info('Both', '', 'id=Both\nrequire=OldLib')
    info('Both', 'common', 'id=Both\nrequire=CommonLib')
    info('Both', '42', 'id=Both\nrequire=NewLib')
    const [m] = scanWorkshopItem(dir)
    expect(m.requires).toEqual(['NewLib'])
    expect(m.builds).toEqual(['b41', 'b42'])
  })

  it('uses the newest version folder when ids differ between them (Firearms does this)', () => {
    info('Firearms', '', 'id=firearmmod')
    info('Firearms', '42.9', 'id=2256623447/firearmmod')
    info('Firearms', '42.10', 'id=firearmmod\nrequire=New')
    info('Firearms', '42.13', 'id=2256623447/firearmmod')
    info('Firearms', '42.16', 'id=firearmmod\nrequire=Newest')
    const [m] = scanWorkshopItem(dir)
    expect(m.id).toBe('firearmmod')
    expect(m.requires).toEqual(['Newest'])
  })

  it('finds maps in any of the folders', () => {
    info('Map', '42', 'id=MapMod')
    folder('Map', 'common', 'media', 'maps', 'Raven Creek')
    expect(scanWorkshopItem(dir)[0].maps).toEqual(['Raven Creek'])
  })

  it('handles several mods in one item and skips folders without an id', () => {
    info('A', '42', 'id=A')
    info('B', '42', 'id=B')
    info('Broken', '42', 'name=no id here')
    expect(scanWorkshopItem(dir).map(m => m.id).sort()).toEqual(['A', 'B'])
  })
})
