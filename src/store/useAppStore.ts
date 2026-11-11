import { create } from 'zustand'

import type { ModInfo, ModSnapshot } from '../../shared/modCore'

export type ModFileEntry = ModInfo

export interface ModEntry {
  workshopId: string
  // enabled mod ids, ;-separated (one workshop item can hold several mods)
  modId: string
  name: string
  description?: string
  thumbnailUrl?: string
  fileSize?: number
  // what the downloaded files actually contain (from mod.info)
  infos?: ModFileEntry[]
  requires?: string[]
  maps?: string[]
}

export type BuildVersion = 'b41' | 'b42'
export type LaunchMode = 'managed' | 'passthrough'

export interface ServerProfile {
  id: string
  name: string
  serverName?: string
  description: string
  buildVersion: BuildVersion
  serverInstallPath: string
  worldSavePath?: string
  port: number
  udpPort: number
  memory: number
  adminPassword: string
  serverPassword: string
  maxPlayers: number
  mods: ModEntry[]
  launchMode: LaunchMode
  autoRestart?: boolean
  restartOnModUpdate?: boolean
  backupsEnabled?: boolean
  backupsToKeep?: number
  // restart once a day at this hour (0-23), off when unset
  dailyRestartHour?: number | null
  // Discord channel webhook for server updates
  discordWebhook?: string
  discordPlayerEvents?: boolean
  // address the user pasted in, used if we can't read it from playit
  playitAddress?: string
  // start this server when the app opens (with "Start with Windows" it comes up after a reboot)
  startWithApp?: boolean
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
  sandboxSettingsVersion?: number
  createdAt: string
  updatedAt: string
  lastStarted?: string
  lastStartedMods?: ModSnapshot
  mapOrder?: string[]
}

export interface AppSettings {
  setupComplete: boolean
  steamcmdDir: string
  serverInstallPath: string
  buildVersion: BuildVersion
  advancedMode: boolean
  steamManaged: boolean
  playitEnabled: boolean
  steamApiKey?: string
  gameDir?: string
  clientDataDir?: string
  role?: 'host' | 'player'
  modBackups?: boolean
  modBackupDir?: string
  // the Overview shows dots instead of the public IP (streams, screenshots)
  hidePublicIp?: boolean
}

// 'starting' = loading world/mods, 'running' = players can join
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping'

export type View = 'setup' | 'home' | 'create' | 'server' | 'editor' | 'sandbox' | 'raweditor' | 'appsettings' | 'play'
export type ServerTab = 'overview' | 'mods' | 'settings' | 'console'

// where you are in the app, for back/forward (mouse side buttons, alt+left/right)
export interface NavLocation {
  view: View
  profileId: string | null
  tab: ServerTab
}
// a page with unsaved changes can hold up back/forward. It gets a function that carries on
// with the move, to call if the user says leaving is fine
export type NavGuard = (proceed: () => void) => void

export interface ModDownloadState {
  state: 'queued' | 'downloading' | 'done' | 'failed'
  bytes?: number
  message?: string
}

interface AppState {
  settings: AppSettings | null
  setSettings: (settings: AppSettings) => void

  profiles: ServerProfile[]
  setProfiles: (profiles: ServerProfile[]) => void
  updateProfile: (profile: ServerProfile) => void
  removeProfile: (id: string) => void

  serverStatuses: Record<string, ServerStatus>
  setServerStatus: (profileId: string, status: ServerStatus) => void

  players: Record<string, string[]>
  setPlayers: (profileId: string, players: string[]) => void

  modUpdates: Record<string, string[]>
  setModUpdates: (profileId: string, names: string[]) => void

  problems: Record<string, ServerProblemReport[]>
  addProblem: (profileId: string, problem: ServerProblemReport) => void
  clearProblems: (profileId: string) => void

  consoleLogs: Record<string, string[]>
  appendConsoleLog: (profileId: string, line: string) => void
  clearConsoleLogs: (profileId: string) => void

  modDownloads: Record<string, ModDownloadState>
  setModDownload: (workshopId: string, state: ModDownloadState) => void

  activeProfileId: string | null
  setActiveProfileId: (id: string | null) => void
  activeView: View
  setActiveView: (view: View) => void
  serverTab: ServerTab
  setServerTab: (tab: ServerTab) => void
  // open a server on a given tab in one go
  openServer: (id: string, tab?: ServerTab) => void

  navBack: NavLocation[]
  navForward: NavLocation[]
  goBack: () => void
  goForward: () => void
  // forget the history, e.g. once the app has picked its first page
  resetNav: () => void
  navGuard: NavGuard | null
  setNavGuard: (guard: NavGuard | null) => void

  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  loadingMessage: string
  setLoadingMessage: (msg: string) => void
}

// console lines waiting for the next batched update (see appendConsoleLog)
let pendingLogs: Record<string, string[]> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null

const NAV_LIMIT = 50
// these pages need a server that still exists
const NEEDS_PROFILE: View[] = ['server', 'editor', 'sandbox', 'raweditor']

export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  // the tab only matters on the server page
  return a.view === b.view && a.profileId === b.profileId && (a.view !== 'server' || a.tab === b.tab)
}

// a place back/forward can still take you: not the setup screen, not a deleted server
export function canVisit(loc: NavLocation, profileIds: string[]): boolean {
  if (loc.view === 'setup') return false
  return !NEEDS_PROFILE.includes(loc.view) || (!!loc.profileId && profileIds.includes(loc.profileId))
}

// step through the history in one direction, skipping places that are gone.
// from = the stack being walked, to = the other one
export function stepNav(from: NavLocation[], to: NavLocation[], here: NavLocation, profileIds: string[]) {
  const rest = [...from]
  while (rest.length) {
    const next = rest.pop()!
    if (canVisit(next, profileIds) && !sameLocation(next, here)) {
      return { next, from: rest, to: [...to, here].slice(-NAV_LIMIT) }
    }
  }
  return null
}

const locationOf = (s: Pick<AppState, 'activeView' | 'activeProfileId' | 'serverTab'>): NavLocation =>
  ({ view: s.activeView, profileId: s.activeProfileId, tab: s.serverTab })

// set while back/forward moves us, so that move isn't recorded as a new place
let travelling = false

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  setSettings: (settings) => set({ settings }),

  profiles: [],
  setProfiles: (profiles) => set({ profiles }),
  updateProfile: (profile) => set((state) => ({
    profiles: state.profiles.map(p => p.id === profile.id ? profile : p)
  })),
  removeProfile: (id) => set((state) => ({
    profiles: state.profiles.filter(p => p.id !== id)
  })),

  serverStatuses: {},
  setServerStatus: (profileId, status) => set((state) => ({
    serverStatuses: { ...state.serverStatuses, [profileId]: status }
  })),

  players: {},
  setPlayers: (profileId, players) => set((state) => ({
    players: { ...state.players, [profileId]: players }
  })),

  modUpdates: {},
  setModUpdates: (profileId, names) => set((state) => ({
    modUpdates: { ...state.modUpdates, [profileId]: names }
  })),

  problems: {},
  addProblem: (profileId, problem) => set((state) => {
    const existing = state.problems[profileId] || []
    // same hint twice in a row is just noise
    if (existing.some(p => p.hint === problem.hint)) return {}
    return { problems: { ...state.problems, [profileId]: [...existing, problem].slice(-5) } }
  }),
  clearProblems: (profileId) => set((state) => ({
    problems: { ...state.problems, [profileId]: [] }
  })),

  consoleLogs: {},
  // a starting server prints thousands of lines in a few seconds; adding them one at a
  // time redrew the whole console for each line and froze the window, so lines are
  // collected and added a few times a second
  appendConsoleLog: (profileId, line) => {
    ;(pendingLogs[profileId] ||= []).push(line)
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      const batch = pendingLogs
      pendingLogs = {}
      set((state) => {
        const consoleLogs = { ...state.consoleLogs }
        for (const [id, lines] of Object.entries(batch)) {
          const all = [...(consoleLogs[id] || []), ...lines]
          consoleLogs[id] = all.length > 3000 ? all.slice(-3000) : all
        }
        return { consoleLogs }
      })
    }, 200)
  },
  clearConsoleLogs: (profileId) => {
    delete pendingLogs[profileId]
    set((state) => ({ consoleLogs: { ...state.consoleLogs, [profileId]: [] } }))
  },

  modDownloads: {},
  setModDownload: (workshopId, st) => set((state) => ({
    modDownloads: { ...state.modDownloads, [workshopId]: st }
  })),

  activeProfileId: null,
  setActiveProfileId: (id) => set({ activeProfileId: id }),
  activeView: 'home',
  setActiveView: (view) => set({ activeView: view }),
  serverTab: 'overview',
  setServerTab: (tab) => set({ serverTab: tab }),
  openServer: (id, tab = 'overview') => set({ activeProfileId: id, activeView: 'server', serverTab: tab }),

  navBack: [],
  navForward: [],
  goBack: () => travel('back'),
  goForward: () => travel('forward'),
  resetNav: () => set({ navBack: [], navForward: [] }),
  navGuard: null,
  setNavGuard: (guard) => set({ navGuard: guard }),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  loadingMessage: '',
  setLoadingMessage: (msg) => set({ loadingMessage: msg }),
}))

function travel(dir: 'back' | 'forward') {
  const go = () => {
    const s = useAppStore.getState()
    // nowhere to go while setup is still running or something is loading
    if (s.activeView === 'setup' || s.isLoading) return
    const ids = s.profiles.map(p => p.id)
    const step = dir === 'back'
      ? stepNav(s.navBack, s.navForward, locationOf(s), ids)
      : stepNav(s.navForward, s.navBack, locationOf(s), ids)
    if (!step) return
    travelling = true
    useAppStore.setState({
      activeView: step.next.view,
      activeProfileId: step.next.profileId,
      serverTab: step.next.tab,
      navGuard: null,
      ...(dir === 'back' ? { navBack: step.from, navForward: step.to } : { navForward: step.from, navBack: step.to }),
    })
    travelling = false
  }
  const guard = useAppStore.getState().navGuard
  if (guard) guard(go)
  else go()
}

// Record every move. Pages often change the view and the server in two separate calls
// (setActiveProfileId then setActiveView), so the moves made in one go are saved as one step
let before: NavLocation | null = null
useAppStore.subscribe((state, prev) => {
  if (travelling) return
  const now = locationOf(state)
  const was = locationOf(prev)
  if (sameLocation(now, was)) return
  if (before) return
  before = was
  queueMicrotask(() => {
    const from = before!
    before = null
    const s = useAppStore.getState()
    if (sameLocation(locationOf(s), from) || from.view === 'setup') return
    useAppStore.setState({ navBack: [...s.navBack, from].slice(-NAV_LIMIT), navForward: [] })
  })
})
