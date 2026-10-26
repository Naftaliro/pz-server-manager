import { describe, it, expect } from 'vitest'
import {
  parseModInfo, formatModIds, orderModIds, sortModList, isListSorted, buildMapLine, orderedModMaps,
  wrongBuildMods, diffSnapshot, parseWorkshopIds, resolvePack, comparePack,
  type ModLike, type ModInfo,
} from './modCore'

const info = (id: string, extra: Partial<ModInfo> = {}): ModInfo => ({ id, name: id, requires: [], maps: [], ...extra })
const mod = (workshopId: string, infos: ModInfo[], enabled = infos.map(i => i.id)): ModLike => ({
  workshopId, modId: enabled.join(';'), name: `item ${workshopId}`, infos,
})

describe('parseModInfo', () => {
  it('reads B42 keys and strips backslashes', () => {
    const p = parseModInfo([
      'name=Cool Mod', 'id=\\CoolMod', 'require=\\ModA,\\ModB', 'loadModAfter=\\Base1',
      'loadModBefore=Late', 'incompatible=\\Rival', 'description=whatever',
    ].join('\n'))
    expect(p).toEqual({
      id: 'CoolMod', name: 'Cool Mod', requires: ['ModA', 'ModB'], loadAfter: ['Base1'], loadBefore: ['Late'], incompatible: ['Rival'],
    })
  })

  it('handles CRLF, spaces and ; separators', () => {
    const p = parseModInfo('id = X \r\nrequire = A; B ,C\r\n')
    expect(p.id).toBe('X')
    expect(p.requires).toEqual(['A', 'B', 'C'])
    expect(p.loadAfter).toEqual([])
  })
})

describe('formatModIds', () => {
  it('adds backslashes for B42 only', () => {
    expect(formatModIds(['A;\\B', 'C'], 'b42')).toBe('\\A;\\B;\\C')
    expect(formatModIds(['\\A', 'B'], 'b41')).toBe('A;B')
  })
})

describe('orderModIds', () => {
  it('keeps user order when there are no rules', () => {
    const mods = [mod('1', [info('C')]), mod('2', [info('A')]), mod('3', [info('B')])]
    expect(orderModIds(mods).order).toEqual(['C', 'A', 'B'])
  })

  it('moves requirements up and keeps the rest in place', () => {
    const mods = [mod('1', [info('X')]), mod('2', [info('Big', { requires: ['Lib'] })]), mod('3', [info('Y')]), mod('4', [info('Lib')])]
    expect(orderModIds(mods).order).toEqual(['X', 'Lib', 'Big', 'Y'])
  })

  it('follows loadModAfter and loadModBefore', () => {
    const mods = [
      mod('1', [info('Patch', { loadAfter: ['Base'] })]),
      mod('2', [info('Base')]),
      mod('3', [info('Early')]),
      mod('4', [info('Tweak', { loadBefore: ['Early'] })]),
    ]
    const { order } = orderModIds(mods)
    expect(order.indexOf('Base')).toBeLessThan(order.indexOf('Patch'))
    expect(order.indexOf('Tweak')).toBeLessThan(order.indexOf('Early'))
  })

  it('ignores rules about mods that are not in the list', () => {
    const mods = [mod('1', [info('A', { requires: ['Gone'], loadAfter: ['AlsoGone'] })])]
    expect(orderModIds(mods)).toEqual({ order: ['A'], problems: [] })
  })

  it('reports loops instead of hanging', () => {
    const mods = [mod('1', [info('A', { requires: ['B'] })]), mod('2', [info('B', { requires: ['A'] })]), mod('3', [info('C')])]
    const { order, problems } = orderModIds(mods)
    expect(order.sort()).toEqual(['A', 'B', 'C'])
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('cycle')
    expect((problems[0] as { ids: string[] }).ids.sort()).toEqual(['A', 'B'])
  })

  it('reports incompatible pairs once', () => {
    const mods = [mod('1', [info('A', { incompatible: ['B'] })]), mod('2', [info('B', { incompatible: ['A'] })])]
    expect(orderModIds(mods).problems).toEqual([{ kind: 'incompatible', a: 'A', b: 'B' }])
  })

  it('only uses enabled ids from multi-mod items', () => {
    const mods = [mod('1', [info('Main'), info('Extra', { requires: ['Lib'] })], ['Main']), mod('2', [info('Lib')])]
    expect(orderModIds(mods).order).toEqual(['Main', 'Lib'])
  })

  it('falls back to the item-level requires on old profiles', () => {
    const old: ModLike = { workshopId: '1', modId: 'A', name: 'a', requires: ['B'] }
    expect(orderModIds([old, { workshopId: '2', modId: 'B', name: 'b' }]).order).toEqual(['B', 'A'])
  })
})

describe('sortModList', () => {
  it('moves whole items and says why', () => {
    const mods = [mod('1', [info('Guns', { requires: ['Lib'] })]), mod('2', [info('Lib')])]
    const { sorted, moves } = sortModList(mods)
    expect(sorted.map(m => m.workshopId)).toEqual(['2', '1'])
    expect(moves).toEqual([{ name: 'item 1', because: 'Guns requires Lib' }])
    expect(isListSorted(mods)).toBe(false)
    expect(isListSorted(sorted)).toBe(true)
  })

  it('leaves a good list alone', () => {
    const mods = [mod('2', [info('Lib')]), mod('1', [info('Guns', { requires: ['Lib'] })]), mod('3', [info('Z')])]
    expect(sortModList(mods)).toEqual({ sorted: mods, moves: [] })
  })

  it('ignores rules inside the same item', () => {
    const mods = [mod('1', [info('A', { requires: ['B'] }), info('B')])]
    expect(isListSorted(mods)).toBe(true)
  })
})

describe('maps', () => {
  const mods: ModLike[] = [
    { workshopId: '1', modId: 'A', name: 'a', maps: ['Raven Creek'] },
    { workshopId: '2', modId: 'B', name: 'b', maps: ['Bedford Falls', 'Raven Creek'] },
  ]
  it('puts mod maps before vanilla, no duplicates', () => {
    expect(buildMapLine(mods, 'Muldraugh, KY')).toBe('Raven Creek;Bedford Falls;Muldraugh, KY')
    expect(buildMapLine([], undefined)).toBe('Muldraugh, KY')
  })
  it('uses the saved map order and drops maps that are gone', () => {
    expect(orderedModMaps(mods, ['Bedford Falls', 'Old Map'])).toEqual(['Bedford Falls', 'Raven Creek'])
  })
})

describe('wrongBuildMods', () => {
  it('flags enabled mods without files for the build', () => {
    const mods = [mod('1', [info('Old', { builds: ['b41'] })]), mod('2', [info('New', { builds: ['b41', 'b42'] })]), mod('3', [info('Unknown')])]
    expect(wrongBuildMods(mods, 'b42')).toEqual([{ name: 'item 1', id: 'Old', builds: ['b41'] }])
  })
})

describe('diffSnapshot', () => {
  it('finds adds, removes and reorders', () => {
    const prev = { workshopItems: ['1', '2'], mods: ['A', 'B', 'C'] }
    expect(diffSnapshot(prev, prev)).toBeNull()
    expect(diffSnapshot(undefined, prev)).toBeNull()
    expect(diffSnapshot(prev, { workshopItems: ['1', '2'], mods: ['B', 'A', 'D'] }))
      .toEqual({ added: ['D'], removed: ['C'], reordered: true })
  })
})

describe('parseWorkshopIds', () => {
  it('takes links, ids and ini lines', () => {
    expect(parseWorkshopIds('https://steamcommunity.com/sharedfiles/filedetails/?id=2392709985\n2200148440')).toEqual(['2392709985', '2200148440'])
    expect(parseWorkshopIds('WorkshopItems=111;222\nMods=\\A')).toEqual(['111', '222'])
  })
})

describe('resolvePack', () => {
  const collections: Record<string, string[]> = { C1: ['m1', 'C2', 'm2'], C2: ['m3', 'C1'] }
  const required: Record<string, string[]> = { m1: ['dep1'], m3: ['m1', 'dep2'], dep2: ['dep3'] }
  const f = {
    collectionChildren: async (id: string) => collections[id] || null,
    requiredItems: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, required[id] || []])),
  }

  it('expands nested collections without looping and adds dependencies', async () => {
    const r = await resolvePack(['C1'], f)
    expect(r.collections).toEqual(['C1', 'C2'])
    expect(r.mods).toEqual(['m1', 'm3', 'm2', 'dep1', 'dep2', 'dep3'])
    expect(r.addedDeps).toEqual({ dep1: ['m1'], dep2: ['m3'], dep3: ['dep2'] })
    expect(r.unchecked).toEqual([])
  })

  it('lists mods it could not check', async () => {
    const r = await resolvePack(['C1'], { ...f, requiredItems: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, id === 'm2' ? null : required[id] || []])) })
    expect(r.unchecked).toEqual(['m2'])
    expect(r.mods).toContain('dep3')
  })

  it('can skip dependencies', async () => {
    expect((await resolvePack(['C1'], f, { deps: false })).mods).toEqual(['m1', 'm3', 'm2'])
  })
})

describe('comparePack', () => {
  it('splits missing and extra', () => {
    expect(comparePack(['1', '2', '3'], ['2', '3', '4'])).toEqual({ missing: ['4'], extra: ['1'], matching: ['2', '3'] })
  })
})
