import { describe, it, expect } from 'vitest'
import { parseSandbox, mergeSandbox, serializeSandbox, parseIni, mergeIni, isGameWritten, getPath, setPath, deleteToPath, deepMerge, humanize } from './gameConfig'

// trimmed copy of what B42 writes
const GAME_FILE = `SandboxVars = {
    VERSION = 6,
    -- Changing this also sets the "Population Multiplier" in Advanced Zombie Options. Default = Normal
    -- 1 = Insane
    -- 2 = Very High
    -- 4 = Normal
    Zombies = 4,
    -- Any food that can rot or spoil. Min: 0.00 Max: 4.00 Default: 0.80
    FoodLootNew = 0.8,
    -- <BHC> [!] It is recommended that you DO NOT change this. [!] <RGB:1,1,1>   Can be used to adjust rolls. Min: 0.10 Max: 100.00 Default: 1.00
    RollsMultiplier = 1.0,
    -- If fires spread when started.
    FireSpread = true,
    LootItemRemovalList = "",
    ZombieLore = {
        -- How fast zombies move. Default = Random
        -- 1 = Sprinters
        -- 4 = Random
        Speed = 4,
        Strength = 2,
    },
    MultiplierConfig = {
        -- Rate at which Strength skill levels up. Min: 0.00 Max: 1000.00 Default: 1.00
        Strength = 1.0,
    },
    SomeMod = {
        -- Min: 0.00 Max: 10.00 Default: 1.00
        LootRare = 1.0,
    },
}
`

describe('parseSandbox', () => {
  const { values, defs } = parseSandbox(GAME_FILE)
  const def = (p: string) => defs.find(d => d.path.join('.') === p)!

  it('reads values into sections', () => {
    expect(values.Zombies).toBe(4)
    expect(getPath(values, ['ZombieLore', 'Speed'])).toBe(4)
    expect(getPath(values, ['MultiplierConfig', 'Strength'])).toBe(1)
    expect(getPath(values, ['SomeMod', 'LootRare'])).toBe(1)
    expect(values.LootItemRemovalList).toBe('')
  })

  it('reads the game comments', () => {
    expect(def('Zombies')).toMatchObject({ type: 'number', default: 4, options: [{ value: 1, label: 'Insane' }, { value: 2, label: 'Very High' }, { value: 4, label: 'Normal' }] })
    expect(def('Zombies').description).toBe('Changing this also sets the "Population Multiplier" in Advanced Zombie Options.')
    expect(def('FoodLootNew')).toMatchObject({ min: 0, max: 4, default: 0.8, decimal: true, description: 'Any food that can rot or spoil.' })
    expect(def('RollsMultiplier').description).toBe('[!] It is recommended that you DO NOT change this. [!] Can be used to adjust rolls.')
    expect(def('FireSpread')).toMatchObject({ type: 'bool', description: 'If fires spread when started.' })
    expect(def('ZombieLore.Speed')).toMatchObject({ default: 4, description: 'How fast zombies move.' })
    expect(def('ZombieLore.Strength').description).toBeUndefined()
    expect(def('SomeMod.LootRare')).toMatchObject({ min: 0, max: 10, default: 1 })
  })

  it('reads the game preset files', () => {
    const { values } = parseSandbox('return {\n    Version = 6,\n    Zombies = 1,\n    ZombieLore = {\n        Speed = 1,\n    },\n}\n')
    expect(values).toEqual({ Version: 6, Zombies: 1, ZombieLore: { Speed: 1 } })
  })

  it('ignores comments after a value', () => {
    expect(parseSandbox('SandboxVars = {\n    Zombies = 3, -- busy\n}\n').values.Zombies).toBe(3)
  })
})

describe('mergeSandbox', () => {
  it('only changes the lines asked for, in the right section', () => {
    const out = mergeSandbox(GAME_FILE, { Zombies: 2, MultiplierConfig: { Strength: 3 } }, false)
    const { values } = parseSandbox(out)
    expect(values.Zombies).toBe(2)
    expect(getPath(values, ['MultiplierConfig', 'Strength'])).toBe(3)
    expect(getPath(values, ['ZombieLore', 'Strength'])).toBe(2)
    expect(getPath(values, ['SomeMod', 'LootRare'])).toBe(1)
    // comments kept, line count unchanged
    expect(out.split('\n').length).toBe(GAME_FILE.split('\n').length)
    expect(out).toContain('-- Any food that can rot or spoil.')
  })

  it('keeps the decimal point where the game uses one', () => {
    expect(mergeSandbox(GAME_FILE, { FoodLootNew: 2 }, false)).toContain('    FoodLootNew = 2.0,')
  })

  it("doesn't add settings a game-written file doesn't have", () => {
    const out = mergeSandbox(GAME_FILE, { FoodLoot: 4, ZombieConfig: { Speed: 1 }, ZombieLore: { Toughness: 1 } }, false)
    expect(out).toBe(GAME_FILE)
  })

  it('adds missing settings and sections to our own files', () => {
    const own = serializeSandbox({ Zombies: 4, ZombieLore: { Speed: 2 } })
    const out = mergeSandbox(own, { DayLength: 3, ZombieLore: { Strength: 1 }, MultiplierConfig: { Global: 2 } })
    expect(parseSandbox(out).values).toEqual({ Zombies: 4, DayLength: 3, ZombieLore: { Speed: 2, Strength: 1 }, MultiplierConfig: { Global: 2 } })
  })

  it('writes a new file when there is none', () => {
    const out = mergeSandbox('', { Zombies: 4, LootItemRemovalList: 'a"b', ZombieLore: { Speed: 2 } })
    expect(parseSandbox(out).values).toEqual({ Zombies: 4, LootItemRemovalList: 'a"b', ZombieLore: { Speed: 2 } })
  })

  it('never writes the file version', () => {
    expect(mergeSandbox(GAME_FILE, { VERSION: 4, Version: 6 }, true)).toBe(GAME_FILE)
    expect(serializeSandbox({ VERSION: 4, Zombies: 1 })).not.toContain('VERSION')
  })

  it('tells game files from ours', () => {
    expect(isGameWritten(GAME_FILE)).toBe(true)
    expect(isGameWritten(serializeSandbox({ Zombies: 4 }))).toBe(false)
  })
})

describe('ini', () => {
  const INI = '# Players can hurt and kill other players\nPVP=true\n\n# Game time stops when there are no players online\nPauseEmpty=true\nMap=Muldraugh, KY\nMaxPlayers=32\n'

  it('reads values and descriptions', () => {
    const { values, defs } = parseIni(INI)
    expect(values).toEqual({ PVP: true, PauseEmpty: true, Map: 'Muldraugh, KY', MaxPlayers: 32 })
    expect(defs[0]).toMatchObject({ path: ['PVP'], type: 'bool', description: 'Players can hurt and kill other players' })
    expect(defs[2].description).toBeUndefined()
  })

  it('changes lines in place and adds new ones', () => {
    const out = mergeIni(INI, { PVP: false, Mods: '\\A;\\B' })
    expect(out).toContain('# Players can hurt and kill other players\nPVP=false\n')
    expect(out.endsWith('MaxPlayers=32\n\nMods=\\A;\\B\n')).toBe(true)
  })
})

describe('tree helpers', () => {
  it('set, delete and merge by path', () => {
    let t = setPath({}, ['ZombieLore', 'Speed'], 1)
    t = setPath(t, ['Zombies'], 2)
    expect(t).toEqual({ ZombieLore: { Speed: 1 }, Zombies: 2 })
    expect(deleteToPath(t, ['ZombieLore', 'Speed'])).toEqual({ Zombies: 2 })
    expect(deepMerge({ A: { x: 1, y: 2 } }, { A: { y: 3 } })).toEqual({ A: { x: 1, y: 3 } })
  })

  it('makes readable names', () => {
    expect(humanize('ZombiesCountBeforeDelete')).toBe('Zombies count before delete')
    expect(humanize('PVPMeleeDamageModifier')).toBe('PVP melee damage modifier')
    expect(humanize('server_browser_announced_ip')).toBe('Server browser announced ip')
  })
})

describe('old profile cleanup', () => {
  it('drops values still at the old filled-in default, keeps real choices', async () => {
    const { dropOldSandboxDefaults } = await import('./profileMigrations')
    expect(dropOldSandboxDefaults({
      VERSION: 4, Zombies: 2, ChanceHasGas: 4, FoodLootNew: 2,
      ZombieConfig: { RespawnHours: 72, PopulationMultiplier: 2 },
      ZombieLore: { Speed: 1 },
      SomeMod: { Option: true },
    })).toEqual({ Zombies: 2, FoodLootNew: 2, ZombieConfig: { PopulationMultiplier: 2 }, ZombieLore: { Speed: 1 }, SomeMod: { Option: true } })
  })
})
