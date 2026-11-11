import { describe, it, expect } from 'vitest'
import { StartWatch, quotedScriptLine, startFailureHint, requiredModHint, isProgressLine } from './serverLog'

// trimmed from a real 42.22.2 start with Common Sense (2875848298) in the list
const COMMON_SENSE = `LOG  : Mod          f:0 st:6,729,837> loading BB_CommonSense
WARN : Mod          f:0 st:6,729,734 at ZomboidFileSystem.loadModAndRequired> required mod "gnomeBars" not found
ERROR: General      f:0 st:6,739,008> AdvancedAnimator$1.visitFileFailed> Exception thrown
	java.nio.file.NoSuchFileException: C:\\PZServer\\steamapps\\workshop\\content\\108600\\2875848298\\mods\\CommonSense\\common\\media\\AnimSets at WindowsException.translateToIOException(null:-1).
	Stack trace:
		sun.nio.fs.WindowsException.translateToIOException(null:-1)
ERROR: General      f:0 st:6,740,450 at KahluaThread.flushErrorMessage      > expected argument of type ItemBodyLocation, got String
ERROR: General      f:0 st:6,740,451> Lua((MOD:They Knew [B42])).TheyKnew_BodyLocations.lua> Exception thrown
	java.lang.RuntimeException: expected argument of type ItemBodyLocation, got String at MethodArguments.assertValid(MethodArguments.java:128).
	Stack trace:
		Lua((MOD:They Knew [B42])).TheyKnew_BodyLocations.lua(TheyKnew_BodyLocations.lua:3)
LOG  : General      f:0 st:6,743,545> Loading WorldDictionary:C:\\Users\\root\\Zomboid\\Saves\\Multiplayer\\QA_ModsB_42_22\\WorldDictionary.bin
ERROR: General      f:0 st:6,743,647> ScriptManager.PostWorldDictionaryInit> Exception thrown
	java.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol] at InputScript.OnPostWorldDictionaryInit(InputScript.java:967).
	Stack trace:
		zombie.scripting.entity.components.crafting.InputScript.OnPostWorldDictionaryInit(InputScript.java:967)
		zombie.network.GameServer.main(GameServer.java:829)
LOG  : General      f:0 st:6,743,648> WorldDictionary.init() end
LOG  : General      f:0 st:6,745,852> MetaTracker.load() end
ERROR: General      f:0 st:6,745,854> GameServer.main> Exception thrown
	zombie.world.WorldDictionaryException: World loading could not proceed, there are script load errors. (Actual error may be printed earlier in log) at IsoWorld.init(IsoWorld.java:2819). Message: Exception Thrown
	Stack trace:
		zombie.iso.IsoWorld.init(IsoWorld.java:2819)
		zombie.network.GameServer.main(GameServer.java:829)
LOG  : General      f:0 st:6,745,854> Server Terminated.`.split('\n')

const run = (lines: string[]) => {
  const w = new StartWatch()
  const hits = lines.map(l => w.feed(l)).filter(Boolean)
  return { w, hits }
}

describe('StartWatch', () => {
  it('finds the script error behind "World loading could not proceed", once', () => {
    const { hits } = run(COMMON_SENSE)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.cause?.text).toBe('java.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol]')
    expect(hits[0]!.cause?.from).toBe('ScriptManager.PostWorldDictionaryInit')
    expect(hits[0]!.fatalLine).toMatch(/^zombie\.world\.WorldDictionaryException: World loading could not proceed/)
  })

  it('knows as soon as GameServer.main throws, before "Server Terminated."', () => {
    const at = COMMON_SENSE.findIndex(l => l.includes('WorldDictionaryException'))
    const { hits } = run(COMMON_SENSE.slice(0, at + 1))
    expect(hits).toHaveLength(1)
  })

  it('ignores the harmless "Exception thrown" lines a big mod list is full of', () => {
    const at = COMMON_SENSE.findIndex(l => l.includes('Loading WorldDictionary'))
    expect(run(COMMON_SENSE.slice(0, at + 1)).hits).toHaveLength(0)
  })

  it('reads the mod name from (MOD:...) in a Lua error', () => {
    const lua = COMMON_SENSE.slice(6, 11)
    const w = new StartWatch()
    lua.forEach(l => w.feed(l))
    const r = w.feed('LOG  : General      f:0 st:1> Server Terminated.')
    expect(r?.cause?.mod).toBe('They Knew [B42]')
    expect(r?.cause?.text).toBe('java.lang.RuntimeException: expected argument of type ItemBodyLocation, got String')
  })

  it('treats "Server Terminated." on its own as a failed start', () => {
    const { hits } = run(['LOG  : General      f:0 st:1> loading world', 'LOG  : General      f:0 st:2> Server Terminated.'])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.cause).toBeNull()
    expect(hits[0]!.fatalLine).toBe('LOG  : General      f:0 st:2> Server Terminated.')
  })

  it('uses the error GameServer.main threw when it is the real cause', () => {
    const { hits } = run([
      'ERROR: General      f:0 st:1> GameServer.main> Exception thrown',
      '\tjava.net.BindException: Address already in use: bind at Net.bind0(null:-1).',
    ])
    expect(hits[0]!.cause?.text).toBe('java.net.BindException: Address already in use: bind')
  })

  it("doesn't fire for a server that starts", () => {
    expect(run(['LOG  : General      f:0 st:1> *** SERVER STARTED ****']).hits).toHaveLength(0)
  })
})

describe('quotedScriptLine', () => {
  it('pulls out the script line the game quotes', () => {
    expect(quotedScriptLine('java.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol]')).toBe('fluid 0.1 [Alcohol]')
    expect(quotedScriptLine('java.lang.Exception: something else')).toBeNull()
  })
})

describe('startFailureHint', () => {
  it('names the mod and says what to do', () => {
    expect(startFailureHint({ text: 'java.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol]', from: 'ScriptManager' }, 'Common Sense'))
      .toBe('The mod Common Sense stopped the world loading: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol]. Open the Mods tab and switch that mod off, then start the server again.')
  })

  it('still explains it without a mod', () => {
    expect(startFailureHint(null)).toMatch(/^The server stopped while loading the world\. This is usually a mod/)
  })
})

describe('requiredModHint', () => {
  const line = 'WARN : Mod          f:0 st:6,729,734 at ZomboidFileSystem.loadModAndRequired> required mod "gnomeBars" not found'
  it("doesn't say a mod is missing from the list when it's in it (wrong build)", () => {
    expect(requiredModHint(line, ['gnomeBars', 'OpenAndEat'])).toMatch(/even though it's in your list/)
  })
  it("says so when it really isn't in the list", () => {
    expect(requiredModHint(line, ['Other'])).toBe('A mod needs "gnomeBars", which isn\'t in your list. Add it on the Mods tab.')
  })
  it('ignores other lines', () => {
    expect(requiredModHint('LOG  : Mod f:0> loading gnomeBars', [])).toBeNull()
  })
})

describe('isProgressLine', () => {
  it('only plain LOG lines', () => {
    expect(isProgressLine('LOG  : General      f:0 st:6,745,852> MetaTracker.load() end')).toBe(true)
    expect(isProgressLine('WARN : General      f:0> Sprite duplicate texture')).toBe(false)
    expect(isProgressLine('\tat foo')).toBe(false)
  })
})
