import { describe, it, expect } from 'vitest'
import { buildWorkshopTxt, readWorkshopId } from './workshopItem'

describe('buildWorkshopTxt', () => {
  it('writes the uploader format with credits and unlisted visibility', () => {
    const txt = buildWorkshopTxt({
      title: "RV Interior - '83 GMC Vans",
      description: 'Adds the vans to the RV interior.',
      needs: [{ name: '[B42]Project RV Interior', workshopId: '3543229299' }, { name: 'someLib' }],
    })
    const lines = txt.split('\r\n')
    expect(lines[0]).toBe('version=1')
    expect(lines[1]).toBe("title=RV Interior - '83 GMC Vans")
    expect(lines).toContain('description=Adds the vans to the RV interior.')
    expect(lines).toContain('description=[url=https://steamcommunity.com/sharedfiles/filedetails/?id=3543229299][B42]Project RV Interior[/url]')
    expect(lines).toContain('description=someLib')
    expect(lines).toContain('visibility=unlisted')
    expect(lines.filter(l => !l.startsWith('description=') && l).every(l => /^(version|title|tags|visibility)=/.test(l))).toBe(true)
  })

  it('keeps the title on one line', () => {
    expect(buildWorkshopTxt({ title: 'a\nb', description: '', needs: [] })).toContain('title=a b')
  })
})

describe('readWorkshopId', () => {
  it('finds the id the game writes after uploading', () => {
    expect(readWorkshopId('version=1\r\nid=3612345678\r\ntitle=x')).toBe('3612345678')
    expect(readWorkshopId('version=1\ntitle=x')).toBeNull()
  })
})

describe('cantUploadReason', () => {
  it('blocks ids that belong to another Workshop item', async () => {
    const { cantUploadReason } = await import('./workshopItem')
    expect(cantUploadReason('2256623447/firearmmod')).toMatch(/belongs to Workshop item 2256623447/)
    expect(cantUploadReason('RVInteriorGMCVans')).toBeNull()
    expect(cantUploadReason('83gmcGseriesVans')).toBeNull()
  })
})

// security review F5: a pack (or a saved list) can carry any picture link
describe('steamImageUrl', () => {
  it("keeps Steam's own preview pictures", async () => {
    const { steamImageUrl } = await import('./workshopItem')
    for (const ok of [
      'https://images.steamusercontent.com/ugc/2028347262925951258/E78A7D0A8AB796D811889B83C293480ED75BF18E/',
      'https://steamuserimages-a.akamaihd.net/ugc/1/ABC/?imw=200',
    ]) expect(steamImageUrl(ok)).toBe(ok)
  })

  it('drops anything else', async () => {
    const { steamImageUrl } = await import('./workshopItem')
    for (const bad of [
      'https://attacker.example/beacon.png?victim=1', 'http://images.steamusercontent.com/ugc/1/', 'https://images.steamusercontent.com.attacker.example/x',
      'https://user@images.steamusercontent.com/x', 'https://images.steamusercontent.com:8443/x', 'file:///C:/Windows/win.ini', 'javascript:alert(1)',
      '//attacker.example/x', '', 42, undefined,
    ]) expect(steamImageUrl(bad)).toBeUndefined()
  })

  it("the page's Content-Security-Policy lets the same hosts through (vite.config.mts)", async () => {
    const { STEAM_IMAGE_HOSTS } = await import('./workshopItem')
    const { readFileSync } = await import('fs')
    const config = readFileSync(new URL('../vite.config.mts', import.meta.url), 'utf-8')
    const list = config.match(/const STEAM_IMAGE_HOSTS = \[([^\]]*)\]/)?.[1]
    expect(list && JSON.parse(`[${list.replace(/'/g, '"')}]`)).toEqual(STEAM_IMAGE_HOSTS)
  })
})
