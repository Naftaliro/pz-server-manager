import { describe, it, expect } from 'vitest'
import { madeForOlderBuild, planImport, parseRequiredItems, importSummary } from './collectionImport'
import { resolvePack, parseWorkshopIds } from './modCore'

const item = (workshopId: string, tags: string[] = ['Build 42']) => ({ workshopId, name: `Mod ${workshopId}`, tags, fileSize: 1000 })

describe('madeForOlderBuild', () => {
  it('only B41 (or older) tags and no B42 tag', () => {
    expect(madeForOlderBuild(['Build 41', 'QOL'], 'b42')).toBe(true)
    expect(madeForOlderBuild(['Build 40', 'Build 41'], 'b42')).toBe(true)
    expect(madeForOlderBuild(['Build 41', 'Build 42'], 'b42')).toBe(false)
    // no build tag says nothing, lots of B42 mods have none
    expect(madeForOlderBuild(['QOL'], 'b42')).toBe(false)
    expect(madeForOlderBuild([], 'b42')).toBe(false)
    // on a B41 server a B41 mod is what you want
    expect(madeForOlderBuild(['Build 41'], 'b41')).toBe(false)
  })
})

describe('planImport', () => {
  const details = [item('1001'), item('1002', ['Build 41']), item('1003'), item('1004'), item('1005', ['Build 41']), item('1006')]

  it('adds the new ones, leaves out B41-only, knows the required ones and the ones already there', () => {
    const plan = planImport({
      packIds: ['1001', '1002', '1003', '1004', '9999', '1006'],
      details,
      listIds: ['1003'],
      addedDeps: { 1006: ['1004'] },
      build: 'b42',
    })
    expect(plan.add.map(d => d.workshopId)).toEqual(['1001', '1004', '1006'])
    expect(plan.olderBuild.map(d => d.workshopId)).toEqual(['1002'])
    expect(plan.requiredAdded).toEqual(['1006'])
    expect(plan.already).toEqual(['1003'])
    expect(plan.unknown).toEqual(['9999'])
  })

  it('a requirement only a left-out mod needs is left out too', () => {
    const plan = planImport({ packIds: ['1002', '1006'], details, listIds: [], addedDeps: { 1006: ['1002'] }, build: 'b42' })
    expect(plan.add).toEqual([])
    expect(plan.olderBuild.map(d => d.workshopId)).toEqual(['1002'])
  })

  it('a B41-tagged mod that something kept requires is still added (a library tagged long ago)', () => {
    const plan = planImport({ packIds: ['1001', '1005'], details, listIds: [], addedDeps: { 1005: ['1001'] }, build: 'b42' })
    expect(plan.add.map(d => d.workshopId)).toEqual(['1001', '1005'])
  })

  it('"add them anyway" keeps the B41 ones', () => {
    const plan = planImport({ packIds: ['1001', '1002'], details, listIds: [], addedDeps: {}, build: 'b42', includeOlder: true })
    expect(plan.add.map(d => d.workshopId)).toEqual(['1001', '1002'])
    expect(plan.olderBuild).toEqual([])
  })

  it('never takes something that isn\'t a Workshop id, even if Steam\'s answer had it', () => {
    const plan = planImport({
      packIds: ['1001', '../../evil', '1001; quit'],
      details: [item('1001'), { workshopId: '../../evil', name: 'x' }],
      listIds: [], addedDeps: {}, build: 'b42',
    })
    expect(plan.add.map(d => d.workshopId)).toEqual(['1001'])
    expect(plan.unknown).toEqual([])
  })

  it('works with what resolvePack gives back (collection, nested collection, missing requirement)', async () => {
    const pack = await resolvePack(parseWorkshopIds('https://steamcommunity.com/sharedfiles/filedetails/?id=50000000'), {
      collectionChildren: async id => ({ 50000000: ['1001', '50000001'], 50000001: ['1002', '1004'] } as Record<string, string[]>)[id] || null,
      requiredItems: async ids => Object.fromEntries(ids.map(id => [id, id === '1004' ? ['1006'] : []])),
    })
    expect(pack.mods).toEqual(['1001', '1002', '1004', '1006'])
    const plan = planImport({ packIds: pack.mods, details, listIds: [], addedDeps: pack.addedDeps, build: 'b42' })
    expect(plan.add.map(d => d.workshopId)).toEqual(['1001', '1004', '1006'])
    expect(plan.requiredAdded).toEqual(['1006'])
    expect(plan.olderBuild.map(d => d.workshopId)).toEqual(['1002'])
  })
})

describe('parseRequiredItems', () => {
  const page = (box: string) => `<html><div class="workshopItemTitle">Swap It</div>${box}<!-- created by --><div class="panel"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=777">other</a></div></html>`
  it('reads the Required items box, nothing past it', () => {
    const html = page(`<div class="requiredItemsContainer" id="RequiredItems">
      <a href="https://steamcommunity.com/workshop/filedetails/?id=2896041179" target="_blank"><div class="requiredItem">errorMagnifier</div></a>
      <a href="https://steamcommunity.com/workshop/filedetails/?id=3077900375" target="_blank"><div class="requiredItem">Mod Update and Alert System</div></a>
    </div></div>`)
    expect(parseRequiredItems(html)).toEqual(['2896041179', '3077900375'])
  })
  it('no box = needs nothing; not an item page = could not tell', () => {
    expect(parseRequiredItems(page(''))).toEqual([])
    expect(parseRequiredItems('<html>There was a problem accessing the item.</html>')).toBeNull()
  })
})

describe('importSummary', () => {
  it('says it the way the brief does', () => {
    expect(importSummary({ added: 38, sorted: true, moved: 5, olderSkipped: 2, requiredAdded: 3, wrongBuild: 0, needChoice: 0, failed: 0 }))
      .toBe('Added 38 mods, sorted the load order, skipped 2 made for Build 41 and added 3 required mods.')
  })
  it('one mod, nothing else to say', () => {
    expect(importSummary({ added: 1, sorted: false, moved: 0, olderSkipped: 0, requiredAdded: 0, wrongBuild: 0, needChoice: 0, failed: 0 })).toBe('Added 1 mod.')
  })
  it('mentions what still needs a look', () => {
    const s = importSummary({ added: 4, sorted: true, moved: 0, olderSkipped: 0, requiredAdded: 1, wrongBuild: 1, needChoice: 2, failed: 1 })
    expect(s).toBe("Added 4 mods, checked the load order and added 1 required mod. 1 mod didn't download, retry it on the Mods tab. 1 mod only has files for another game version. 2 downloads have several mods inside, pick which to turn on.")
  })
})
