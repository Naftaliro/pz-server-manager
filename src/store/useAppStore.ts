import { create } from 'zustand'

export interface ModEntry {
  workshopId: string
  modId: string
  name: string
  description?: string
  thumbnailUrl?: string
}

export type BuildVersion = 'b41' | 'b42'
export type LaunchMode = 'managed' | 'passthrough'

export interface ServerProfile {
  id: string
  name: string
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
  iniSettings: Record<string, unknown>
  sandboxSettings: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastStarted?: string
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping'

interface AppState {
  // Profiles
  profiles: ServerProfile[]
  setProfiles: (profiles: ServerProfile[]) => void
  updateProfile: (profile: ServerProfile) => void
  removeProfile: (id: string) => void

  // Server statuses
  serverStatuses: Record<string, ServerStatus>
  setServerStatus: (profileId: string, status: ServerStatus) => void

  // Console logs
  consoleLogs: Record<string, string[]>
  appendConsoleLog: (profileId: string, line: string) => void
  clearConsoleLogs: (profileId: string) => void

  // UI state
  activeProfileId: string | null
  setActiveProfileId: (id: string | null) => void
  activeView: 'dashboard' | 'editor' | 'sandbox' | 'mods' | 'console' | 'install' | 'raweditor'
  setActiveView: (view: AppState['activeView']) => void
  editorTab: 'basic' | 'server' | 'sandbox' | 'mods'
  setEditorTab: (tab: AppState['editorTab']) => void

  // Loading states
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  loadingMessage: string
  setLoadingMessage: (msg: string) => void
}

export const useAppStore = create<AppState>((set) => ({
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

  consoleLogs: {},
  appendConsoleLog: (profileId, line) => set((state) => {
    const existing = state.consoleLogs[profileId] || []
    const newLogs = [...existing, line]
    const trimmed = newLogs.length > 2000 ? newLogs.slice(-2000) : newLogs
    return { consoleLogs: { ...state.consoleLogs, [profileId]: trimmed } }
  }),
  clearConsoleLogs: (profileId) => set((state) => ({
    consoleLogs: { ...state.consoleLogs, [profileId]: [] }
  })),

  activeProfileId: null,
  setActiveProfileId: (id) => set({ activeProfileId: id }),
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view }),
  editorTab: 'basic',
  setEditorTab: (tab) => set({ editorTab: tab }),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  loadingMessage: '',
  setLoadingMessage: (msg) => set({ loadingMessage: msg }),
}))
