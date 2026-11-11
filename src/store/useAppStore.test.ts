import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore, stepNav, canVisit } from './useAppStore'
import type { ServerProfile, NavLocation } from './useAppStore'

const tick = () => new Promise<void>(r => queueMicrotask(r))
const profile = (id: string) => ({ id, name: id }) as ServerProfile
const at = (view: NavLocation['view'], profileId: string | null = null, tab: NavLocation['tab'] = 'overview'): NavLocation =>
  ({ view, profileId, tab })
const here = () => {
  const s = useAppStore.getState()
  return { view: s.activeView, profileId: s.activeProfileId, tab: s.serverTab }
}

beforeEach(async () => {
  useAppStore.setState({
    activeView: 'home', activeProfileId: null, serverTab: 'overview',
    profiles: [profile('a'), profile('b')], isLoading: false, navGuard: null,
  })
  await tick()
  useAppStore.getState().resetNav()
})

describe('back/forward history', () => {
  it('records where you were and goes back and forward', async () => {
    const s = useAppStore.getState()
    s.setActiveView('appsettings')
    await tick()
    s.openServer('a', 'mods')
    await tick()
    expect(useAppStore.getState().navBack).toEqual([at('home'), at('appsettings')])

    s.goBack()
    expect(here()).toEqual(at('appsettings'))
    s.goBack()
    expect(here()).toEqual(at('home'))
    s.goBack() // nothing left, stays put
    expect(here()).toEqual(at('home'))

    s.goForward()
    s.goForward()
    expect(here()).toEqual(at('server', 'a', 'mods'))
    await tick()
    // travelling isn't recorded as new moves
    expect(useAppStore.getState().navBack).toEqual([at('home'), at('appsettings')])
    expect(useAppStore.getState().navForward).toEqual([])
  })

  it('saves two calls made together as one step', async () => {
    const s = useAppStore.getState()
    s.setActiveProfileId('a')
    s.setActiveView('editor')
    await tick()
    expect(useAppStore.getState().navBack).toEqual([at('home')])
  })

  it('going somewhere new drops the forward history', async () => {
    const s = useAppStore.getState()
    s.setActiveView('appsettings')
    await tick()
    s.goBack()
    expect(useAppStore.getState().navForward).toHaveLength(1)
    s.setActiveView('play')
    await tick()
    expect(useAppStore.getState().navForward).toEqual([])
  })

  it('skips servers that were deleted and never goes back to setup', async () => {
    useAppStore.setState({ activeView: 'setup' })
    await tick()
    useAppStore.getState().resetNav()
    const s = useAppStore.getState()
    s.setActiveView('home')
    await tick()
    expect(useAppStore.getState().navBack).toEqual([]) // setup isn't kept
    s.openServer('b')
    await tick()
    s.setActiveView('appsettings')
    await tick()
    useAppStore.setState({ profiles: [profile('a')] }) // b deleted
    s.goBack()
    expect(here()).toEqual(at('home'))
  })

  it("does nothing on the setup screen or while something's loading", async () => {
    const s = useAppStore.getState()
    s.setActiveView('appsettings')
    await tick()
    useAppStore.setState({ isLoading: true })
    s.goBack()
    expect(here()).toEqual(at('appsettings'))
  })

  it('a page with unsaved changes holds up the move until told to carry on', async () => {
    const s = useAppStore.getState()
    s.setActiveView('appsettings')
    await tick()
    let proceed: (() => void) | null = null
    const guard = vi.fn((go: () => void) => { proceed = go })
    s.setNavGuard(guard)
    s.goBack()
    expect(guard).toHaveBeenCalledOnce()
    expect(here()).toEqual(at('appsettings'))
    proceed!()
    expect(here()).toEqual(at('home'))
    expect(useAppStore.getState().navGuard).toBeNull()
  })

  it('keeps at most 50 steps', async () => {
    const s = useAppStore.getState()
    for (let i = 0; i < 60; i++) {
      s.setActiveView(i % 2 ? 'home' : 'appsettings')
      await tick()
    }
    expect(useAppStore.getState().navBack).toHaveLength(50)
  })
})

describe('stepNav / canVisit', () => {
  it('only lets you visit server pages for servers that exist', () => {
    expect(canVisit(at('server', 'a'), ['a'])).toBe(true)
    expect(canVisit(at('editor', 'x'), ['a'])).toBe(false)
    expect(canVisit(at('home'), [])).toBe(true)
    expect(canVisit(at('setup'), [])).toBe(false)
  })

  it('skips entries that are the same as where you are', () => {
    const step = stepNav([at('home'), at('appsettings')], [], at('appsettings'), [])
    expect(step?.next).toEqual(at('home'))
    expect(step?.to).toEqual([at('appsettings')])
  })
})
