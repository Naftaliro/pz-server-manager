import { describe, it, expect } from 'vitest'
import { scanServerLog, baselineSignatures, signature, attribute, startPassed, UNATTRIBUTED, type LogMod } from './serverLogCheck'

// lines as 42.22.2 prints them (from real test starts)
const STARTED = 'LOG  : Network      f:0 st:9,496,369> *** SERVER STARTED ****'
const ANIMSETS = [
  'ERROR: General      f:0 st:4,800,256> AdvancedAnimator$1.visitFileFailed> Exception thrown',
  '\tjava.nio.file.NoSuchFileException: C:\\PZServer\\steamapps\\workshop\\content\\108600\\2256623447\\mods\\Firearms\\common\\media\\AnimSets at WindowsException.translateToIOException(null:-1).',
  '\t\tjava.base/sun.nio.fs.WindowsException.translateToIOException(Unknown Source)',
]
const THEY_KNEW = [
  '\tLua((MOD:They Knew [B42])).TheyKnew_BodyLocations.lua(TheyKnew_BodyLocations.lua:3)',
  'ERROR: General      f:0 st:6,740,322> Lua((MOD:They Knew [B42])).TheyKnew_BodyLocations.lua> Exception thrown',
  '\tjava.lang.RuntimeException: expected argument of type ItemBodyLocation, got String at MethodArguments.assertValid(MethodArguments.java:128).',
  '\tStack trace:',
]
const COMMON_SENSE_FATAL = [
  'ERROR: General      f:0 st:6,743,647> ScriptManager.PostWorldDictionaryInit> Exception thrown',
  '\tjava.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol] at InputScript.OnPostWorldDictionaryInit(InputScript.java:967).',
  'ERROR: General      f:0 st:6,743,700> GameServer.main> Exception thrown',
  '\tzombie.world.WorldDictionaryException: World loading could not proceed, there are script load errors. (WorldDictionary.java:181)',
  'LOG  : General      f:0 st:6,743,710> Server Terminated.',
]
const VANILLA_ERRORS = [
  'ERROR: Sound        f:0 st:9,430,001 at BrokenFences.addBrokenTiles         > Missing ThumpSound for breakable object fencing_01_65',
  'ERROR: WorldGen     f:0 st:9,430,100> IsoPropertyType.lookupOrDefaultStr> Exception thrown',
  '\tzombie.core.properties.IsoPropertyType$IsoPropertyTypeNotFoundException: Property Name not found: WindowShape at IsoPropertyType.lookup(IsoPropertyType.java:277).',
]

const MODS: LogMod[] = [
  { label: 'Firearms', workshopId: '2256623447', ids: ['firearmmod'], folders: ['Firearms'] },
  { label: 'They Knew [B42]', workshopId: '3387110070', ids: ['TheyKnew'], names: ['They Knew [B42]'] },
  { label: "'87 Ford B700/F700 Trucks", workshopId: '3110911330', ids: ['87fordB700'] },
  { label: 'RV Interior - GMC fix', folders: ['RVInteriorGMCVans'], ids: ['RVInteriorGMCVans'] },
]

describe('signature', () => {
  it('drops the frame and time counters so two runs compare equal', () => {
    expect(signature('ERROR: Sound        f:0 st:9,430,001 at X > y  ')).toBe(signature('ERROR: Sound        f:12 st:1,000,000,001 at X > y'))
  })
})

describe('scanServerLog', () => {
  it('a clean start is a pass, the AnimSets folder noise every modded server prints is not an error', () => {
    const r = scanServerLog([...ANIMSETS, STARTED], { mods: MODS })
    expect(r.started).toBe(true)
    expect(r.fatal).toBeNull()
    expect(r.groups).toEqual([])
    expect(r.noise).toBe(1)
    expect(startPassed(r)).toBe(true)
  })

  it('a Lua error is put under the mod the game names, and fails the check', () => {
    const r = scanServerLog([...THEY_KNEW, STARTED], { mods: MODS })
    expect(r.started).toBe(true)
    expect(r.exceptions).toBe(1)
    expect(r.groups[0].mod).toBe('They Knew [B42]')
    expect(r.groups[0].errors[0].text).toContain('expected argument of type ItemBodyLocation')
    expect(startPassed(r)).toBe(false)
  })

  it('a broken script that stops the world loading is a failed start', () => {
    const r = scanServerLog(COMMON_SENSE_FATAL, { mods: MODS })
    expect(r.started).toBe(false)
    expect(r.fatal).toMatch(/WorldDictionaryException|Exception thrown|Server Terminated/)
    expect(startPassed(r)).toBe(false)
  })

  it('"SERVER STARTED" after a fatal line still counts as failed', () => {
    const r = scanServerLog([...COMMON_SENSE_FATAL, STARTED], { mods: MODS })
    expect(r.started).toBe(false)
  })

  it('errors the server prints without any mods are left out (including the WindowShape exception)', () => {
    const baseline = baselineSignatures(VANILLA_ERRORS)
    const later = VANILLA_ERRORS.map(l => l.replace(/st:[\d,]+/, 'st:1,234'))
    const r = scanServerLog([...later, STARTED], { mods: MODS, baseline })
    expect(r.groups).toEqual([])
    expect(r.exceptions).toBe(0)
    expect(r.baseline).toBe(2)
    expect(startPassed(r)).toBe(true)
  })

  it('without the vanilla run the same lines would count', () => {
    const r = scanServerLog([...VANILLA_ERRORS, STARTED], { mods: MODS })
    expect(r.exceptions).toBe(1)
  })

  it('a vehicle template error that names no mod is reported but does not fail the check', () => {
    const r = scanServerLog(['LOG  : General      f:0 st:4,793,939> ERROR: template "B700SideStorage" not found B', STARTED], { mods: MODS })
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].mod).toBe(UNATTRIBUTED)
    expect(startPassed(r)).toBe(true)
  })

  it('counts the same error line once with a count', () => {
    const line = 'ERROR: General      f:0 st:1> Something odd in C:\\x\\steamapps\\workshop\\content\\108600\\2256623447\\mods\\Firearms\\42.16\\media\\scripts\\a.txt'
    const r = scanServerLog([line, line.replace('st:1', 'st:2'), STARTED], { mods: MODS })
    expect(r.groups[0]).toMatchObject({ mod: 'Firearms', errors: [{ count: 2 }] })
  })
})

describe('attribute', () => {
  it('by Workshop folder, by local mod folder and by a script file the verifier knows', () => {
    expect(attribute('...\\108600\\2256623447\\mods\\Firearms\\x', { mods: MODS })).toBe('Firearms')
    expect(attribute('C:\\PZTest\\cache\\mods\\RVInteriorGMCVans\\42\\media\\lua\\x.lua', { mods: MODS })).toBe('RV Interior - GMC fix')
    expect(attribute("unknown script object \"/\" in 'media/scripts/papa_chad_itens.txt'", {
      mods: MODS, ownerOfFile: rel => (rel === 'media/scripts/papa_chad_itens.txt' ? 'Military Tool Kit' : undefined),
    })).toBe('Military Tool Kit')
    expect(attribute('ERROR: something with no clue', { mods: MODS })).toBe(UNATTRIBUTED)
  })

  it('a mod the game names that is not in the list keeps its own name', () => {
    expect(attribute('Lua((MOD:Common Sense)).BB_CS_RecipeCode.lua> Exception thrown', { mods: MODS })).toBe('Common Sense')
  })
})
