interface ElectronAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  shell: {
    openExternal: (url: string) => void
  }
  dialog: {
    openFolder: () => Promise<string | null>
  }
  steamcmd: {
    download: (targetDir: string) => Promise<{ success: boolean; path?: string; message: string }>
    installServer: (
      steamcmdPath: string,
      installDir: string,
      onProgress: (line: string) => void
    ) => Promise<{ success: boolean; message: string }>
    updateServer: (
      steamcmdPath: string,
      installDir: string,
      onProgress: (line: string) => void
    ) => Promise<{ success: boolean; message: string }>
    checkInstalled: (installDir: string) => Promise<boolean>
  }
  server: {
    start: (profileId: string) => Promise<{ success: boolean; message: string }>
    stop: (profileId: string) => Promise<{ success: boolean; message: string }>
    restart: (profileId: string) => Promise<{ success: boolean; message: string }>
    getStatus: (profileId: string) => Promise<string>
    getAllStatuses: () => Promise<Record<string, string>>
    sendCommand: (profileId: string, command: string) => Promise<{ success: boolean }>
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
    search: (query: string, page: number) => Promise<{
      success: boolean
      mods: WorkshopMod[]
      total: number
      message?: string
    }>
    getDetails: (workshopIds: string[]) => Promise<{
      success: boolean
      mods: WorkshopMod[]
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

interface WorkshopMod {
  workshopId: string
  modId: string
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
}

export {}
