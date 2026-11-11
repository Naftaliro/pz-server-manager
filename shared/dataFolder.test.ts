import { describe, it, expect } from 'vitest'
import { ownDataFolder, expandDataPath, sameFolder, sharingWith, serverFiles } from './dataFolder'

const env = { USERPROFILE: 'C:\\Users\\Me' }

describe('ownDataFolder', () => {
  it('puts each server in Zomboid\\Knox servers under its fixed name', () => {
    expect(ownDataFolder('Friday_Night')).toBe('%USERPROFILE%\\Zomboid\\Knox servers\\Friday_Night')
    expect(expandDataPath(ownDataFolder('Friday_Night'), env)).toBe('C:\\Users\\Me\\Zomboid\\Knox servers\\Friday_Night')
  })
})

describe('expandDataPath', () => {
  it('uses the shared Zomboid folder when none is set', () => {
    expect(expandDataPath(undefined, env)).toBe('C:\\Users\\Me\\Zomboid')
    expect(expandDataPath('  ', env)).toBe('C:\\Users\\Me\\Zomboid')
  })
  it('drops a trailing backslash', () => {
    expect(expandDataPath('D:\\PZData\\', env)).toBe('D:\\PZData')
  })
})

describe('sharingWith', () => {
  const profiles = [
    { id: 'a', name: 'Old one', worldSavePath: '' },
    { id: 'b', name: 'Old two', worldSavePath: '%USERPROFILE%\\Zomboid\\' },
    { id: 'c', name: 'New', worldSavePath: ownDataFolder('New') },
    { id: 'd', name: 'Typed by hand', worldSavePath: 'c:\\users\\me\\zomboid' },
  ]
  it('finds every other server on the same folder, however it was written', () => {
    expect(sharingWith(profiles[0], profiles, env).map(p => p.id)).toEqual(['b', 'd'])
  })
  it('a server with its own folder shares with nobody', () => {
    expect(sharingWith(profiles[2], profiles, env)).toEqual([])
  })
  it('compares folders without case or trailing slashes', () => {
    expect(sameFolder('C:\\Users\\Me\\Zomboid\\server-console.txt', 'c:/users/me/zomboid/server-console.txt')).toBe(true)
  })
})

describe('serverFiles', () => {
  it("copies only that server's files, not a copy's that starts with the same name", () => {
    const files = serverFiles('Base')
    expect(files).toContain('Server\\Base.ini')
    expect(files).toContain('Server\\Base_SandboxVars.lua')
    expect(files).toContain('Saves\\Multiplayer\\Base')
    expect(files).toContain('db\\Base.db')
    expect(files.some(f => f.includes('Base_copy'))).toBe(false)
  })
})
