import { describe, it, expect } from 'vitest'
import { isSafeRelPath, isSafeFolderName, validatePack, modFingerprint, checkPack, launchUrl, PACK_FORMAT, type ServerPack } from './serverPack'

const sha = (c: string) => c.repeat(64)
const pack = (over: Partial<ServerPack> = {}): ServerPack => ({
  format: PACK_FORMAT, version: 1, createdAt: '2026-10-25T00:00:00Z',
  server: { name: 'VAN', address: '1.2.3.4', port: 16261, build: 'b42' },
  workshopItems: [{ workshopId: '111', name: 'Guns' }, { workshopId: '222', name: 'Cars' }],
  mods: ['Guns', 'Cars', 'Fix'], maps: [],
  localMods: [{ id: 'Fix', name: 'The fix', folder: 'FixMod', files: [
    { path: '42/mod.info', sha256: sha('a'), data: 'aWQ9Rml4' },
    { path: 'common/media/lua/shared/fix.lua', sha256: sha('b'), data: '' },
  ] }],
  ...over,
})

describe('isSafeRelPath', () => {
  it('allows normal mod paths', () => {
    expect(isSafeRelPath('42/mod.info')).toBe(true)
    expect(isSafeRelPath('common\\media\\lua\\client\\a b.lua')).toBe(true)
  })
  it('blocks anything that could escape the mod folder', () => {
    for (const bad of ['../evil.lua', '42/../../x', '/abs', '\\abs', 'C:/Windows/x', 'C:x', 'a//b', 'a/./b', 'con:x', 'a/b.', '', 'x\0y', 'NUL', 'media/com1.lua', 'aux.txt']) {
      expect(isSafeRelPath(bad), bad).toBe(false)
    }
  })
  it('folder names are one segment', () => {
    expect(isSafeFolderName('FirearmsShim')).toBe(true)
    expect(isSafeFolderName('a/b')).toBe(false)
    expect(isSafeFolderName('..')).toBe(false)
  })
})

describe('validatePack', () => {
  it('accepts a good pack', () => expect(validatePack(pack())).toEqual([]))
  it('rejects things that are not packs', () => {
    expect(validatePack(null)).toHaveLength(1)
    expect(validatePack({ format: 'something' })).toHaveLength(1)
  })
  it('rejects unsafe files and folders', () => {
    const p = pack()
    p.localMods[0].files[0].path = '../../../Windows/evil.bat'
    expect(validatePack(p)[0]).toMatch(/isn't allowed/)
    expect(validatePack(pack({ localMods: [{ id: 'x', name: 'x', folder: '..', files: [] }] }))[0]).toMatch(/isn't valid/)
  })
  it('rejects server details that could add launch options', () => {
    const base = pack().server
    expect(validatePack(pack({ server: { ...base, address: '1.2.3.4 +exec evil' } }))[0]).toMatch(/address/)
    expect(validatePack(pack({ server: { ...base, address: 'hoc-gz.tun.ply.gg' } }))).toEqual([])
    expect(validatePack(pack({ server: { ...base, port: 70000 } }))[0]).toMatch(/port/)
    expect(validatePack(pack({ server: { ...base, password: 'pw -debug' } }))[0]).toMatch(/password/)
    expect(validatePack(pack({ server: { ...base, password: 'Abc123!' } }))).toEqual([])
  })
  it('rejects packs from a newer app', () => {
    expect(validatePack(pack({ version: 99 }))[0]).toMatch(/newer version/)
  })
  it('rejects bad workshop ids and duplicate folders', () => {
    expect(validatePack(pack({ workshopItems: [{ workshopId: 'abc', name: 'x' }] }))).toHaveLength(1)
    const p = pack()
    p.localMods.push({ ...p.localMods[0] , folder: 'fixmod' })
    expect(validatePack(p)[0]).toMatch(/twice/)
  })
})

describe('modFingerprint', () => {
  it('ignores file order, slash style and case of paths', () => {
    expect(modFingerprint([{ path: 'A/b.lua', sha256: '1' }, { path: 'c', sha256: '2' }]))
      .toBe(modFingerprint([{ path: 'c', sha256: '2' }, { path: 'a\\B.lua', sha256: '1' }]))
  })
  it('changes when a file changes', () => {
    expect(modFingerprint([{ path: 'a', sha256: '1' }])).not.toBe(modFingerprint([{ path: 'a', sha256: '2' }]))
  })
})

describe('checkPack', () => {
  const p = pack()
  const fp = modFingerprint(p.localMods[0].files)
  it('is ready when the fix mods match', () => {
    const c = checkPack(p, { gameFound: true, workshopDownloaded: ['111'], localMods: { fixmod: fp } })
    expect(c.ready).toBe(true)
    expect(c.localMods[0].status).toBe('ok')
    // the game downloads workshop items itself, so these don't block
    expect(c.toDownload).toEqual([{ workshopId: '222', name: 'Cars' }])
  })
  it('spots missing and outdated fix mods', () => {
    expect(checkPack(p, { gameFound: true, workshopDownloaded: [], localMods: {} }).localMods[0].status).toBe('missing')
    const c = checkPack(p, { gameFound: true, workshopDownloaded: [], localMods: { fixmod: 'old' } })
    expect(c.localMods[0].status).toBe('different')
    expect(c.ready).toBe(false)
  })
  it('is not ready without the game', () => {
    expect(checkPack(p, { gameFound: false, workshopDownloaded: [], localMods: { fixmod: fp } }).ready).toBe(false)
  })
})

describe('launchUrl', () => {
  it('just starts the game without an address', () => expect(launchUrl()).toBe('steam://run/108600'))
  it('joins the server with Steam launch options', () => {
    expect(launchUrl({ address: '1.2.3.4', port: 16261 })).toBe('steam://run/108600//%2Bconnect%201.2.3.4%3A16261/')
    expect(decodeURIComponent(launchUrl({ address: 'x.y', port: 1, password: 'pw' }))).toBe('steam://run/108600//+connect x.y:1 +password pw/')
  })
})

describe('accounts', () => {
  it('accepts normal usernames and refuses ones that break save names', async () => {
    const { accountProblem } = await import('./serverPack')
    expect(accountProblem({ username: 'Mitchell_7', password: 'abcd' })).toBeNull()
    expect(accountProblem({ username: 'a', password: 'abcd' })).toMatch(/between/)
    expect(accountProblem({ username: 'bad/name', password: 'abcd' })).toMatch(/letters/)
    expect(accountProblem({ username: 'okname', password: '12' })).toMatch(/password/)
  })
  it('suggests readable passwords', async () => {
    const { suggestPassword } = await import('./serverPack')
    const p = suggestPassword()
    expect(p).toHaveLength(10)
    expect(p).not.toMatch(/[0O1lI]/)
    expect(suggestPassword()).not.toBe(p)
  })
})

describe('parseJoinAddress', () => {
  it('keeps a playit port and falls back to the server port', async () => {
    const { parseJoinAddress } = await import('./serverPack')
    expect(parseJoinAddress('hoc-gz.tun.ply.gg:41371', 16261)).toEqual({ address: 'hoc-gz.tun.ply.gg', port: 41371 })
    expect(parseJoinAddress(' 73.9.243.225 ', 16261)).toEqual({ address: '73.9.243.225', port: 16261 })
    expect(parseJoinAddress('', 16261)).toEqual({ port: 16261 })
    expect(parseJoinAddress('1.2.3.4 +exec', 16261).error).toMatch(/doesn't look like/)
    expect(parseJoinAddress('x.y:99999', 16261).error).toMatch(/valid port/)
  })
})

describe('hosting from a pack', () => {
  const host = {
    mods: [{ workshopId: '111', modId: 'Guns', name: 'Guns' }, { workshopId: '', modId: 'Fix', name: 'The fix' }],
    maxPlayers: 8, memory: 8192,
    ini: { PVP: false, PauseEmpty: true },
    sandbox: { Zombies: 2, ZombieLore: { Speed: 1 }, SomeMod: { Option: true } },
  }

  it('strips private ini settings', async () => {
    const { publicIni } = await import('./serverPack')
    expect(publicIni({ PVP: true, Password: 'x', RCONPassword: 'y', DiscordToken: 'z', DefaultPort: 16261, Mods: '\A', PublicName: 'VAN', Nested: {} }))
      .toEqual({ PVP: true })
  })

  it('needs the host part only when hosting', () => {
    expect(validatePack(pack())).toEqual([])
    expect(validatePack(pack(), true)[0]).toMatch(/only has what players need/)
    expect(validatePack(pack({ host }), true)).toEqual([])
  })

  it("a broken host part doesn't stop players", () => {
    const bad = pack({ host: { ...host, ini: { PVP: { nested: true } } } as never })
    expect(validatePack(bad)).toEqual([])
    expect(validatePack(bad, true).join(' ')).toMatch(/server settings/)
  })

  it('every fix mod the host list uses has to be in the pack', () => {
    const missing = pack({ host: { ...host, mods: [...host.mods, { workshopId: '', modId: 'Other', name: 'Other fix' }] } })
    expect(validatePack(missing, true).join(' ')).toMatch(/missing the fix mod "Other fix"/)
  })
})

// security review F2/F3: the "host a copy" pack from the review's proof of concept
describe('settings from a pack someone else made', () => {
  const LUA_KEY = 'Pwned = (function() print("KNOX_POC: attacker Lua ran inside SandboxVars.lua") return 1 end)(),\n    Dummy'
  const INI_KEY = 'ServerWelcomeMessage2\r\nWorkshopItems=999999999;2392709985\r\nMods=\\HiddenMod;\\SomeMod\r\nPassword'
  const evil = {
    mods: [{ workshopId: '2392709985', modId: 'SomeMod', name: 'Some Mod' }],
    maxPlayers: 8,
    ini: { PVP: false, [INI_KEY]: '', Welcome: 'hi\r\nPassword=', Fine: 'one line' },
    sandbox: { ZombieLore: { Speed: 2, 'Bad Key': 1 }, [LUA_KEY]: 1, Zombies: 3 },
  }

  it('the pack still opens (nothing to stop players or the import)', () => {
    expect(validatePack(pack({ host: evil }), true)).toEqual([])
  })

  it('leaves out names that are not plain words and .ini values with line breaks, and says which', async () => {
    const { cleanHostSettings } = await import('./serverPack')
    const r = cleanHostSettings(evil)
    expect(r.ini).toEqual({ PVP: false, Fine: 'one line' })
    expect(r.sandbox).toEqual({ ZombieLore: { Speed: 2 }, Zombies: 3 })
    expect(r.dropped).toHaveLength(4)
    expect(r.dropped.join('|')).toContain('ZombieLore.Bad Key')
    // shown on one line
    expect(r.dropped.some(d => /[\r\n]/.test(d))).toBe(false)
  })

  it('__proto__ and friends never become settings', async () => {
    const { cleanHostSettings } = await import('./serverPack')
    const r = cleanHostSettings({ ini: JSON.parse('{"__proto__":"x","constructor":"y","A":1}'), sandbox: JSON.parse('{"__proto__":{"evil":1},"Normal":2}') })
    expect(r.ini).toEqual({ A: 1 })
    expect(r.sandbox).toEqual({ Normal: 2 })
    expect(Object.getPrototypeOf(r.sandbox)).toBe(Object.prototype)
  })

  it('workshop ids in a pack are plain numbers', () => {
    expect(validatePack(pack({ workshopItems: [{ workshopId: '1 & calc', name: 'x' }] }))).toContain('The pack has a bad Workshop item in it.')
    expect(validatePack(pack({ workshopItems: [{ workshopId: 111 as never, name: 'x' }] }))).toContain('The pack has a bad Workshop item in it.')
    const badHost = { ...evil, mods: [{ workshopId: '0;1 & calc.exe', modId: 'X', name: 'X' }] }
    expect(validatePack(pack({ host: badHost }), true).join(' ')).toMatch(/mod list for hosting/)
  })
})

// security review F4: the pack maker shouldn't know or pick the copy's secrets
describe('private settings in a pack', () => {
  it('never come along when hosting a copy', async () => {
    const { cleanHostSettings, PRIVATE_INI_KEYS } = await import('./serverPack')
    const ini = Object.fromEntries([...PRIVATE_INI_KEYS].map(k => [k, 'from-the-pack']))
    const r = cleanHostSettings({ ini: { ...ini, RCONPassword: 'attacker-knows-this', PVP: true }, sandbox: {} })
    expect(r.ini).toEqual({ PVP: true })
    // left out quietly: packs this app makes never have them
    expect(r.dropped).toEqual([])
  })
})
