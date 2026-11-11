import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { allowedFile, allowedFolder, localPath, isInside, isServerName } from './allowedPaths'

// security review F8: what a script that got into the app's window could ask the file handlers for
describe.runIf(process.platform === 'win32')('allowed files and folders', () => {
  let base: string, zomboid: string, server: string, outside: string
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'pzm-paths-'))
    zomboid = join(base, 'Zomboid')
    server = join(zomboid, 'Server')
    outside = join(base, 'elsewhere')
    for (const d of [server, join(zomboid, 'mods', 'Fix', 'media', 'lua'), outside]) mkdirSync(d, { recursive: true })
    writeFileSync(join(server, 'Main.ini'), 'PVP=true')
    writeFileSync(join(outside, 'secret.ini'), 'x')
    writeFileSync(join(outside, 'tool.exe'), 'MZ')
    // a junction inside the Server folder that leads out of it (no admin needed for these)
    symlinkSync(outside, join(server, 'link'), 'junction')
  })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  const roots = () => [server]
  const none = new Set<string>()

  it("reads and writes the servers' config files, new ones too", () => {
    expect(allowedFile(join(server, 'Main.ini'), roots(), none)).toBe(join(server, 'Main.ini'))
    expect(allowedFile(join(server, 'Main_SandboxVars.lua'), roots(), none)).toBe(join(server, 'Main_SandboxVars.lua'))
    expect(allowedFile(join(server, 'MAIN.INI'), roots().map(r => r.toUpperCase()), none)).not.toBeNull()
  })

  it('turns away everything else', () => {
    for (const bad of [
      join(server, '..', 'mods', 'Fix', 'media', 'lua', 'evil.lua'),   // .. out of the Server folder
      join(server, 'link', 'secret.ini'),                              // junction out of it
      join(outside, 'secret.ini'),
      join(server, 'run.bat'), join(server, 'x.exe'), join(server, 'Main.ini.exe'),
      `${join(server, 'Main.ini')}:hidden.ini`,                         // alternate data stream
      '\\\\attacker.example\\share\\Server\\x.ini', '\\\\?\\C:\\Windows\\win.ini', 'Server\\Main.ini',
      'C:\\Windows\\win.ini', '%WINDIR%\\win.ini', '', 42, null,
    ]) expect(allowedFile(bad, roots(), none), String(bad)).toBeNull()
  })

  it('a file the user picked in a dialog is fine wherever it is', () => {
    const picked = new Set([join(outside, 'secret.ini').toLowerCase(), join(outside, 'tool.exe').toLowerCase()])
    expect(allowedFile(join(outside, 'secret.ini'), roots(), picked)).toBe(join(outside, 'secret.ini'))
    expect(allowedFile(join(outside, 'other.ini'), roots(), picked)).toBeNull()
  })

  it('only opens folders, never files or programs, and only the app\'s own', () => {
    expect(allowedFolder(zomboid, [zomboid])).toBe(zomboid)
    expect(allowedFolder(join(zomboid, 'mods'), [zomboid])).toBe(join(zomboid, 'mods'))
    expect(allowedFolder('%TEMP%', [zomboid])).toBeNull()
    expect(allowedFolder(join(server, 'Main.ini'), [zomboid])).toBeNull()
    expect(allowedFolder(join(outside, 'tool.exe'), [base])).toBeNull()
    expect(allowedFolder(join(server, 'link'), [zomboid])).toBeNull()
    expect(allowedFolder(join(zomboid, '..', 'elsewhere'), [zomboid])).toBeNull()
    expect(allowedFolder('\\\\attacker.example\\share', [zomboid])).toBeNull()
  })
})

describe('path helpers', () => {
  it('expands %VARS% and refuses what is not a plain local path', () => {
    expect(localPath('%USERPROFILE%\\Zomboid', { USERPROFILE: 'C:\\Users\\Me' })).toBe('C:\\Users\\Me\\Zomboid')
    expect(localPath('%NOPE%\\x', {})).toBeNull()
    expect(localPath('C:/Users/Me/../Me/Zomboid/')).toBe('C:\\Users\\Me\\Zomboid')
  })

  it('inside means inside, not a folder with a longer name', () => {
    expect(isInside('C:\\Zomboid\\Server\\a.ini', 'C:\\Zomboid')).toBe(true)
    expect(isInside('C:\\Zomboid', 'C:\\Zomboid\\')).toBe(true)
    expect(isInside('C:\\Zomboid2\\a.ini', 'C:\\Zomboid')).toBe(false)
  })

  it('server names are folder-safe', () => {
    expect(isServerName('Friday_Night-2')).toBe(true)
    for (const bad of ['..', '..\\..\\Windows', 'a b', '', 'a/b', 5]) expect(isServerName(bad)).toBe(false)
  })
})
