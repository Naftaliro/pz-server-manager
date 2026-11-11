import { describe, it, expect } from 'vitest'
import { freeGamePort, freeRconPort, copyName } from './ports'

describe('freeGamePort', () => {
  it('steps past ports other servers use, the +1 port too', () => {
    expect(freeGamePort([])).toBe(16261)
    expect(freeGamePort([{ port: 16261, udpPort: 16262 }])).toBe(16263)
    expect(freeGamePort([{ port: 16261, udpPort: 16262 }, { port: 16263, udpPort: 16264 }])).toBe(16265)
    // someone moved a server to 16264: 16263 would clash on its +1
    expect(freeGamePort([{ port: 16261, udpPort: 16262 }, { port: 16264, udpPort: 16265 }])).toBe(16267)
  })
})

describe('freeRconPort', () => {
  it('picks the first RCON port nobody has', () => {
    expect(freeRconPort([{ port: 1, iniSettings: { RCONPort: 27015 } }, { port: 2, iniSettings: { RCONPort: 27016 } }])).toBe(27017)
    // no RCONPort set = the game's 27015
    expect(freeRconPort([{ port: 1, iniSettings: {} }])).toBe(27016)
  })
})

describe('copyName', () => {
  it('numbers copies so no two have the same name', () => {
    expect(copyName('Dup Base', ['Dup Base'])).toBe('Dup Base (Copy)')
    expect(copyName('Dup Base', ['Dup Base', 'Dup Base (Copy)'])).toBe('Dup Base (Copy 2)')
    expect(copyName('Dup Base (Copy)', ['Dup Base', 'Dup Base (Copy)', 'dup base (copy 2)'])).toBe('Dup Base (Copy 3)')
  })
})
