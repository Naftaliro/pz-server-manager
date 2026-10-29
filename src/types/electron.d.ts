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
  playit: {
    state: () => Promise<PlayitStateInfo>
    install: () => Promise<{ success: boolean; openedDownloadPage?: boolean; message?: string }>
    setup: () => Promise<{ success: boolean; message?: string }>
    start: () => Promise<{ success: boolean }>
    openDashboard: () => Promise<{ success: boolean }>
  }
  network: {
    checkUpnp: (port: number, publicIp: string | null) => Promise<UpnpReportInfo>
    // exists = every server's game ports are allowed (same as upToDate)
    firewallStatus: () => Promise<{ exists: boolean; upToDate: boolean; oldRule: boolean; anyRule: boolean; ports: number[]; unknown: boolean }>
    addFirewallRule: (serverInstallPath: string) => Promise<{ success: boolean; message?: string }>
    removeFirewallRule: () => Promise<{ success: boolean; message?: string }>
  }
  system: {
    info: () => Promise<{ totalMemMb: number; platform: string }>
  }
  discord: {
    test: (url: string, serverName: string) => Promise<{ success: boolean; message?: string }>
  }
  diagnostics: {
    copy: () => Promise<string>
    reportError: (where: string, message: string) => void
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
    checkUpdate: (installDir: string) => Promise<{ checked: boolean; updateAvailable: boolean; installed: string | null; latest: string | null; steamManaged: boolean }>
    findSteamInstall: () => Promise<string | null>
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
    playerAction: (profileId: string, action: 'kick' | 'ban' | 'admin' | 'unadmin', name: string) => Promise<{ success: boolean; message?: string }>
    restartWithWarning: (profileId: string, minutes: number) => Promise<{ success: boolean; message?: string }>
    listBackups: (profileId: string) => Promise<Array<{ name: string; sizeMb: number }>>
    backupNow: (profileId: string) => Promise<{ success: boolean; message: string }>
    restoreBackup: (profileId: string, name: string) => Promise<{ success: boolean; message: string }>
    openBackups: (profileId: string) => Promise<string>
    onModUpdates: (callback: (profileId: string, names: string[]) => void) => () => void
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
    // the game's own files as text (the editors parse them with shared/gameConfig)
    sources: (profileId: string) => Promise<{
      success: boolean
      message?: string
      sandbox?: string
      ini?: string
      sandboxTemplate?: string
      iniTemplate?: string
      sandboxFromGame?: boolean
      // preset name -> file text, from the server install
      presets?: Record<string, string>
    }>
    presets: (installPath?: string) => Promise<Record<string, string>>
    writeIni: (serverName: string, dataPath: string, settings: unknown) => Promise<{ success: boolean; message?: string }>
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
    // collection / mod links -> every mod to download, nested collections + required items included
    resolvePack: (ids: string[], withDeps?: boolean) => Promise<{
      success: boolean
      mods: string[]
      addedDeps: Record<string, string[]>
      collections: string[]
      unchecked: string[]
      // false when there was no Steam API key to ask with
      depsChecked: boolean
      details: WorkshopMod[]
      message?: string
    }>
    scanInstalled: (serverInstallPath: string, workshopIds: string[]) => Promise<{
      success: boolean
      found: Record<string, ModInfo[]>
      message?: string
    }>
    // copy fix mods that ship with the app into <Zomboid>\mods
    installLocal: (modIds: string[], worldSavePath?: string) => Promise<{
      success: boolean
      installed: string[]
      missing: string[]
      message?: string
    }>
  }
  workshop: {
    prepare: (profileId: string, modId: string) => Promise<{ success: boolean; message?: string; itemDir?: string; folder?: string; title?: string; workshopId?: string | null }>
    status: (profileId: string, modId: string) => Promise<{ success: boolean; message?: string; prepared?: boolean; workshopId?: string | null; itemDir?: string }>
    useWorkshopCopy: (profileId: string, modId: string, workshopId: string) => Promise<{ success: boolean; message?: string; visibleToSteamApi?: boolean }>
    openFolder: (dir: string) => Promise<{ success: boolean; message?: string }>
  }
  client: {
    state: () => Promise<{ success: boolean; message?: string; gameFound?: boolean; gameDir?: string; dataDir?: string; workshopDownloaded?: string[] }>
    searchDrives: () => Promise<{ success: boolean; message?: string; found?: string[] }>
    useGameDir: (dir: string) => Promise<{ success: boolean; message?: string; gameDir?: string }>
    listServers: () => Promise<{ success: boolean; message?: string; gameDir?: string; servers?: PlayServerInfo[] }>
    openPack: () => Promise<{ success: boolean; message?: string; cancelled?: boolean; saved?: { id: string } }>
    removeServer: (id: string) => Promise<{ success: boolean; message?: string }>
    setAccount: (id: string, account: { username: string; password: string }) => Promise<{ success: boolean; message?: string }>
    installFixes: (id: string) => Promise<{ success: boolean; message?: string; installed?: string[]; backedUp?: string[] }>
    launch: (id?: string, join?: boolean) => Promise<{ success: boolean; message?: string }>
    exportPack: (profileId: string, opts: { address?: string; includePassword?: boolean; includeSettings?: boolean }) => Promise<{
      success: boolean; message?: string; cancelled?: boolean; path?: string; fixMods?: number; workshopItems?: number
    }>
    // the pack's fix mod files stay in the main process, only their names come back
    openPackForHost: () => Promise<{ success: boolean; message?: string; cancelled?: boolean; path?: string; pack?: import('../../shared/serverPack').ServerPack }>
    installPackFixes: (path: string, worldSavePath?: string) => Promise<{ success: boolean; message?: string; installed?: string[]; backedUp?: string[] }>
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

type ModInfo = import('../../shared/modCore').ModInfo

// a host's server pack the player opened, plus how their PC compares to it
interface PlayServerInfo {
  id: string
  addedAt: string
  pack: import('../../shared/serverPack').ServerPack
  check: import('../../shared/serverPack').PackCheck
  account?: { username: string; password: string }
}

interface PreflightIssue {
  level: 'error' | 'warning'
  message: string
  fix?: 'install-server' | 'download-mods' | 'open-mods' | 'open-settings' | 'update-server' | 'firewall'
}

interface PlayitStateInfo {
  installed: boolean
  exePath: string | null
  running: boolean
  phase: 'not_installed' | 'not_running' | 'needs_setup' | 'starting' | 'running' | 'error' | 'unknown'
  tunnels: Array<{ address: string; destination: string; disabled: boolean; disabledReason?: string }>
  notices: string[]
  error?: string
}

interface UpnpReportInfo {
  routerFound: boolean
  routerExternalIp: string | null
  cgnat: boolean
  portOpen: boolean | null
  summary: string
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
  type PlayServer = PlayServerInfo
  type ModFileInfo = ModInfo
  type ModDownloadProgress = ModDownloadEvent
  type ServerPreflightIssue = PreflightIssue
  type ServerProblemReport = ServerProblem
  type PlayitState = PlayitStateInfo
  type UpnpReport = UpnpReportInfo
}

export {}
