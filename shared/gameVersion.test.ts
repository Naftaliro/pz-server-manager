import { describe, it, expect } from 'vitest'
import {
  parseVdf, parseBranches, branchFor, branchArgs, buildOfBranch, branchLabel, versionOf, worldVersionOf,
  versionFromLog, worldVersionFromMapT, serverVersionState, isBranchName, steamSwitchSteps, openBranches,
  parseAppManifest, playerVersionCheck,
} from './gameVersion'

// trimmed from a real `+app_info_print 380870` on 2026-11-10, SteamCMD's chatter included
const APP_INFO = `Redirecting stderr to 'C:\\steamcmd\\logs\\stderr.txt'
Loading Steam API...OK
Connecting anonymously to Steam Public...OK
AppID : 380870, change number : 34001234/0, last change : Mon Nov  9 2026
"380870"
{
	"common" { "name" "Project Zomboid Dedicated Server" "type" "Tool" }
	"depots"
	{
		"1004" { "config" { "oslist" "windows" } "manifests" { "public" { "gid" "1" "size" "67863136" "download" "24251776" } } "depotfromapp" "1007" }
		"380871"
		{
			"manifests"
			{
				"public" { "gid" "1755746619808321605" "size" "6849662987" "download" "1888501536" }
				"42.21" { "gid" "5337933334995336130" "size" "6873739602" "download" "1889184016" }
				"legacy41" { "gid" "969953672967332490" "size" "5063752681" "download" "715454384" }
			}
		}
		"380873" { "config" { "oslist" "linux" } "manifests" { "public" { "gid" "2" "size" "1" "download" "58205008" } } }
		"380874" { "config" { "oslist" "windows" } "manifests" { "public" { "gid" "3" "size" "1" "download" "55662416" } "42.21" { "gid" "4" "size" "1" "download" "56153136" } } }
		"branches"
		{
			"public" { "buildid" "26486687" "timeupdated" "1794233007" }
			"pre-release" { "buildid" "26486687" "description" "Pre-release testing" "timeupdated" "1793976064" }
			"42.21" { "buildid" "25485538" "description" "temporary fall-back" "timeupdated" "1790597203" }
			"42.19" { "buildid" "24929695" "description" "Build 42.19.2" "timeupdated" "1787742952" }
			"legacy41" { "buildid" "24928750" "description" "Build 41.78.21" "timeupdated" "1787742984" }
			"secret" { "buildid" "99" "pwdrequired" "1" }
			"bad name; +quit" { "buildid" "1" }
		}
		"privatebranches" "1"
	}
}
Unloading Steam API...OK`

describe('app_info_print', () => {
  it('reads nested blocks and escaped quotes', () => {
    expect(parseVdf('"a" { "b" "c \\"d\\"" "e" { "f" "1" } } "g" "2"')).toEqual({ a: { b: 'c "d"', e: { f: '1' } }, g: '2' })
  })

  it('lists every branch with its build, description and Windows download size', () => {
    const branches = parseBranches(APP_INFO, '380870')
    expect(branches.map(b => b.name)).toEqual(['public', 'pre-release', '42.21', '42.19', 'legacy41', 'secret'])
    expect(branches.find(b => b.name === '42.21')).toEqual({
      name: '42.21', buildId: '25485538', description: 'temporary fall-back', timeUpdated: 1790597203, pwdRequired: undefined,
      downloadBytes: 1889184016 + 56153136,
    })
    // linux depot and the borrowed redistributable don't count
    expect(branches.find(b => b.name === 'public')?.downloadBytes).toBe(1888501536 + 55662416)
    expect(openBranches(branches).map(b => b.name)).not.toContain('secret')
  })

  it('gives nothing for output without the app in it', () => {
    expect(parseBranches('Connecting anonymously to Steam Public...FAILED', '380870')).toEqual([])
  })
})

describe('which branch an update uses', () => {
  it('keeps the install on its own branch, a fall-back included', () => {
    expect(branchFor({ installed: '42.21', build: 'b42' })).toBe('42.21')
    expect(branchFor({ installed: 'legacy41', build: 'b41' })).toBe('legacy41')
    expect(branchFor({ installed: 'public' })).toBe('public')
  })

  it('switches when the user picked another branch for this install', () => {
    // F-04: Build 41 install, user went back to Build 42
    expect(branchFor({ chosen: 'public', installed: 'legacy41' })).toBe('public')
    expect(branchFor({ chosen: '42.21', installed: 'public' })).toBe('42.21')
  })

  it('falls back to the build default for a new install', () => {
    expect(branchFor({ build: 'b41' })).toBe('legacy41')
    expect(branchFor({ build: 'b42' })).toBe('public')
    expect(branchFor({ installed: '', chosen: 'bad name' })).toBe('public')
  })

  it('always passes -beta, public too', () => {
    expect(branchArgs('public')).toEqual(['-beta', 'public'])
    expect(branchArgs('42.21')).toEqual(['-beta', '42.21'])
    expect(() => branchArgs('x +quit')).toThrow()
    expect(isBranchName('-beta')).toBe(false)
  })

  it('knows which build a branch is', () => {
    expect(buildOfBranch('legacy41')).toBe('b41')
    expect(buildOfBranch('41.78')).toBe('b41')
    expect(buildOfBranch('42.21')).toBe('b42')
    expect(buildOfBranch('public')).toBe('b42')
  })
})

describe('version names', () => {
  const branches = parseBranches(APP_INFO, '380870')

  it('labels branches in plain words', () => {
    expect(branchLabel('42.21', 'temporary fall-back')).toBe('42.21 fall-back')
    expect(branchLabel('public')).toBe('Latest')
    expect(branchLabel('legacy41', 'Build 41.78.21')).toBe('Build 41')
    expect(branchLabel('42.19', 'Build 42.19.2')).toBe('42.19')
  })

  it('finds the game version of a build from what is known, learned or in the branch list', () => {
    expect(versionOf('25485538')).toBe('42.21.0')
    expect(versionOf('111', { learned: { 111: { version: '42.23.0' } } })).toBe('42.23.0')
    expect(versionOf('24929695', { branches })).toBe('42.19.2')
    expect(versionOf('5', { branches: [{ name: '42.30', buildId: '5' }] })).toBe('42.30')
    expect(versionOf('6', { branches })).toBeUndefined()
    expect(worldVersionOf('26486687')).toBe(251)
    expect(worldVersionOf('7', { 7: { worldVersion: 260 } })).toBe(260)
  })

  it('reads the version from the server log', () => {
    expect(versionFromLog('LOG  : General      f:0 st:8,465,740> version=42.21.0 4a0e9546ec demo=false')).toBe('42.21.0')
    expect(versionFromLog('LOG  : General      f:0 st:8,705,181> version=42.22.2 3d39148846 integrity=pending demo=false')).toBe('42.22.2')
    expect(versionFromLog('nothing here')).toBeUndefined()
  })

  it('reads the world version out of map_t.bin', () => {
    expect(worldVersionFromMapT(Uint8Array.from([0x47, 0x4d, 0x54, 0x4d, 0, 0, 0, 0xf9, 0x3f]))).toBe(249)
    expect(worldVersionFromMapT(Uint8Array.from([0x47, 0x4d, 0x54, 0x4d, 0, 0, 0, 0xfb]))).toBe(251)
    expect(worldVersionFromMapT(Uint8Array.from([1, 2, 3, 4, 0, 0, 0, 1]))).toBeUndefined()
    expect(worldVersionFromMapT(new Uint8Array(3))).toBeUndefined()
  })

  it('says what players do in Steam', () => {
    expect(steamSwitchSteps('42.21')).toBe('In Steam: right-click Project Zomboid → Properties → Game Versions & Betas → pick 42.21.')
    expect(steamSwitchSteps('public')).toMatch(/"None"/)
  })
})

describe("the player's game", () => {
  const acf = (mounted: string | null, user: string | null) => `"AppState"
{
	"appid"		"108600"
	"buildid"		"26486631"
	${user === null ? '' : `"UserConfig"\n\t{\n\t\t"language"\t\t"english"\n\t\t"BetaKey"\t\t"${user}"\n\t}`}
	${mounted === null ? '' : `"MountedConfig"\n\t{\n\t\t"language"\t\t"english"\n\t\t"BetaKey"\t\t"${mounted}"\n\t}`}
}`

  it('reads the build and branch from appmanifest_108600.acf', () => {
    expect(parseAppManifest(acf('42.21', '42.21'))).toEqual({ buildId: '26486631', branch: '42.21', pendingBranch: undefined })
    // the normal version has no BetaKey, or an empty one
    expect(parseAppManifest(acf(null, null))).toEqual({ buildId: '26486631', branch: 'public', pendingBranch: undefined })
    expect(parseAppManifest(acf('', ''))).toMatchObject({ branch: 'public' })
  })

  it('notices a branch picked in Steam that is still downloading', () => {
    expect(parseAppManifest(acf('', '42.21'))).toMatchObject({ branch: 'public', pendingBranch: '42.21' })
  })

  it('tells the player exactly what to pick, never that the app does it', () => {
    expect(playerVersionCheck({ branch: '42.21' }, { branch: 'public' })).toEqual({
      kind: 'switch', branch: '42.21', steps: 'In Steam: right-click Project Zomboid → Properties → Game Versions & Betas → pick 42.21.',
    })
    expect(playerVersionCheck({ branch: 'public' }, { branch: '42.21' })).toMatchObject({ kind: 'switch', branch: 'public' })
    expect(playerVersionCheck({ branch: '42.21' }, { branch: '42.21' })).toEqual({ kind: 'ok' })
    expect(playerVersionCheck({ branch: '42.21' }, { branch: 'public', pendingBranch: '42.21' })).toEqual({ kind: 'downloading', branch: '42.21' })
    // switched away and Steam hasn't caught up
    expect(playerVersionCheck({ branch: '42.21' }, { branch: '42.21', pendingBranch: 'public' })).toMatchObject({ kind: 'switch' })
    expect(playerVersionCheck(undefined, { branch: 'public' })).toEqual({ kind: 'unknown' })
    expect(playerVersionCheck({ branch: 'public' }, null)).toEqual({ kind: 'unknown' })
  })
})

describe('is the server behind', () => {
  const branches = parseBranches(APP_INFO, '380870')

  it('a 42.21 install is up to date on its branch but behind public (F-05)', () => {
    const s = serverVersionState({ buildId: '25485538', branch: '42.21' }, branches)
    expect(s.updateAvailable).toBe(false)
    expect(s.behindPublic).toBe(true)
    expect(s.branchMissing).toBe(false)
  })

  it('an old public install has an update', () => {
    const s = serverVersionState({ buildId: '25485538', branch: 'public' }, branches)
    expect(s).toMatchObject({ updateAvailable: true, latest: '26486687', behindPublic: false })
  })

  it('Build 41 on legacy41 is not behind', () => {
    expect(serverVersionState({ buildId: '24928750', branch: 'legacy41' }, branches).behindPublic).toBe(false)
  })

  it('notices a branch Steam took away', () => {
    const s = serverVersionState({ buildId: '1', branch: '42.13' }, branches)
    expect(s.branchMissing).toBe(true)
    expect(s.updateAvailable).toBe(false)
    // offline: nothing is claimed
    expect(serverVersionState({ buildId: '1', branch: '42.13' }, null)).toMatchObject({ branchMissing: false, updateAvailable: false, behindPublic: false })
  })
})
