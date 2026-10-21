import { create } from 'zustand'

export interface ModFileEntry {
  id: string
  name: string
  requires: string[]
  maps: string[]
}

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
  // address the user pasted in, used if we can't read it from playit
  playitAddress?: string
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastStarted?: string
}

export interface AppSettings {
  setupComplete: boolean
  steamcmdDir: string
  serverInstallPath: string
  buildVersion: BuildVersion
  advancedMode: boolean
  steamManaged: boolean
  playitEnabled: boolean
}

// 'starting' = loading world/mods, 'running' = players can join
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping'

export type View = 'setup' | 'home' | 'create' | 'server' | 'editor' | 'sandbox' | 'raweditor' | 'appsettings'
export type ServerTab = 'overview' | 'mods' | 'settings' | 'console'

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

  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  loadingMessage: string
  setLoadingMessage: (msg: string) => void
}

export const useAppStore = create<AppState>((set) => ({
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
  appendConsoleLog: (profileId, line) => set((state) => {
    const existing = state.consoleLogs[profileId] || []
    const newLogs = [...existing, line]
    const trimmed = newLogs.length > 3000 ? newLogs.slice(-3000) : newLogs
    return { consoleLogs: { ...state.consoleLogs, [profileId]: trimmed } }
  }),
  clearConsoleLogs: (profileId) => set((state) => ({
    consoleLogs: { ...state.consoleLogs, [profileId]: [] }
  })),

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

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  loadingMessage: '',
  setLoadingMessage: (msg) => set({ loadingMessage: msg }),
}))
