interface ElectronAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  shell: {
    openExternal: (url: string) => void
    openPath: (path: string) => Promise<string>
  }
  system: {
    info: () => Promise<{ totalMemMb: number; platform: string }>
  }
  settings: {
    get: () => Promise<import('../store/useAppStore').AppSettings>
    set: (patch: Partial<import('../store/useAppStore').AppSettings>) => Promise<import('../store/useAppStore').AppSettings>
  }
  dialog: {
    openFolder: () => Promise<string | null>
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
    saveFile: (options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
  }
  fs: {
    readFile: (filePath: string) => Promise<{ success: boolean; content?: string; message?: string }>
    writeFile: (filePath: string, content: string) => Promise<{ success: boolean; message?: string }>
    findServerBat: (dir: string) => Promise<{ success: boolean; path?: string; message?: string }>
  }
  updater: {
    check: () => Promise<{
      success: boolean
      available: boolean
      currentVersion: string
      latestVersion?: string
      releaseNotes?: string
      releaseUrl?: string
      downloadUrl?: string
      assetName?: string
      assetSize?: number
      publishedAt?: string
      message?: string
    }>
    install: (downloadUrl: string, assetName: string) => Promise<{ success: boolean; message?: string }>
    openReleasePage: (url: string) => Promise<{ success: boolean }>
    getVersion: () => Promise<{ version: string }>
    onProgress: (callback: (data: { stage: string; pct: number }) => void) => () => void
  }
  steamcmd: {
    download: (targetDir: string) => Promise<{ success: boolean; path?: string; message: string }>
    installServer: (
      steamcmdPath: string,
      installDir: string,
      onProgress: (line: string) => void,
      buildVersion?: 'b41' | 'b42'
    ) => Promise<{ success: boolean; message: string }>
    updateServer: (
      steamcmdPath: string,
      installDir: string,
      onProgress: (line: string) => void,
      buildVersion?: 'b41' | 'b42'
    ) => Promise<{ success: boolean; message: string }>
    checkInstalled: (installDir: string) => Promise<boolean>
    downloadMods: (workshopIds: string[], onEvent: (e: ModDownloadEvent) => void) => Promise<{
      success: boolean
      done: string[]
      failed: string[]
      message?: string
    }>
  }
  server: {
    start: (profileId: string) => Promise<{ success: boolean; message: string }>
    stop: (profileId: string) => Promise<{ success: boolean; message: string }>
    restart: (profileId: string) => Promise<{ success: boolean; message: string }>
    getStatus: (profileId: string) => Promise<string>
    getAllStatuses: () => Promise<Record<string, string>>
    sendCommand: (profileId: string, command: string) => Promise<{ success: boolean; output?: string; message?: string }>
    getPlayers: (profileId: string) => Promise<string[]>
    preflight: (profileId: string) => Promise<PreflightIssue[]>
    networkInfo: () => Promise<{ publicIp: string | null; lanIps: string[] }>
    onPlayers: (callback: (profileId: string, players: string[]) => void) => () => void
    onProblem: (callback: (profileId: string, problem: ServerProblem) => void) => () => void
    onConsoleOutput: (profileId: string, callback: (line: string) => void) => () => void
    onStatusChange: (callback: (profileId: string, status: string) => void) => () => void
  }
  profiles: {
    list: () => Promise<import('../store/useAppStore').ServerProfile[]>
    get: (id: string) => Promise<import('../store/useAppStore').ServerProfile | null>
    save: (profile: unknown) => Promise<import('../store/useAppStore').ServerProfile>
    delete: (id: string) => Promise<{ success: boolean }>
    duplicate: (id: string) => Promise<import('../store/useAppStore').ServerProfile | null>
  }
  config: {
    readIni: (serverName: string, dataPath: string) => Promise<{ success: boolean; settings?: Record<string, unknown>; exists?: boolean; message?: string }>
    writeIni: (serverName: string, dataPath: string, settings: unknown) => Promise<{ success: boolean; message?: string }>
    readSandbox: (serverName: string, dataPath: string) => Promise<{ success: boolean; settings?: Record<string, unknown>; exists?: boolean; message?: string }>
    writeSandbox: (serverName: string, dataPath: string, settings: unknown) => Promise<{ success: boolean; message?: string }>
  }
  mods: {
    getDetails: (workshopIds: string[]) => Promise<{
      success: boolean
      mods: WorkshopMod[]
      message?: string
    }>
    getCollection: (workshopId: string) => Promise<{
      success: boolean
      isCollection: boolean
      mods: WorkshopMod[]
      message?: string
    }>
    scanInstalled: (serverInstallPath: string, workshopIds: string[]) => Promise<{
      success: boolean
      found: Record<string, ModInfo[]>
      message?: string
    }>
  }
  world: {
    wipe: (serverName: string, dataPath: string) => Promise<{ success: boolean; message: string }>
    getSize: (serverName: string, dataPath: string) => Promise<{
      success: boolean
      exists?: boolean
      sizeBytes?: number
      sizeMb?: number
      path?: string
      message?: string
    }>
  }
}

interface ModDownloadEvent {
  workshopId: string
  state: 'queued' | 'downloading' | 'done' | 'failed'
  bytes?: number
  message?: string
}

interface ModInfo {
  id: string
  name: string
  requires: string[]
  maps: string[]
}

interface PreflightIssue {
  level: 'error' | 'warning'
  message: string
  fix?: 'install-server' | 'download-mods' | 'open-mods' | 'open-settings'
}

interface ServerProblem {
  hint: string
  line: string
  at: number
}

interface WorkshopMod {
  workshopId: string
  name: string
  description: string
  thumbnailUrl: string
  subscriptions: number
  tags: string[]
  timeUpdated: number
  fileSize: number
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
  type WorkshopModDetails = WorkshopMod
  type ModFileInfo = ModInfo
  type ModDownloadProgress = ModDownloadEvent
  type ServerPreflightIssue = PreflightIssue
  type ServerProblemReport = ServerProblem
}

export {}
