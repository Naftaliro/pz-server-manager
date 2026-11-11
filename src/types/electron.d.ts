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
    // no argument: read the current setting
    startWithWindows: (on?: boolean) => Promise<boolean>
    // why this copy can't start with Windows (it's running from a temp folder), null when it can
    startupProblem: () => Promise<string | null>
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
    // branch: switch the install to this Steam branch. Left out, an update keeps the install's own branch
    installServer: (
      steamcmdPath: string,
      installDir: string,
      onProgress: (line: string) => void,
      buildVersion?: 'b41' | 'b42',
      branch?: string
    ) => Promise<{ success: boolean; message: string; branch?: string }>
    updateServer: (
      steamcmdPath: string,
      installDir: string,
      onProgress: (line: string) => void,
      buildVersion?: 'b41' | 'b42',
      branch?: string
    ) => Promise<{ success: boolean; message: string; branch?: string }>
    checkInstalled: (installDir: string) => Promise<boolean>
    checkUpdate: (installDir: string) => Promise<ServerUpdateState>
    branches: (force?: boolean) => Promise<{ success: boolean; message?: string; branches?: Array<SteamBranchInfo> }>
    chooseBranch: (installDir: string, branch: string) => Promise<{ success: boolean; message?: string }>
    findSteamInstall: () => Promise<string | null>
    downloadMods: (workshopIds: string[], onEvent: (e: ModDownloadEvent) => void, installDir?: string) => Promise<{
      success: boolean
      done: string[]
      failed: string[]
      message?: string
    }>
  }
  server: {
    // needsConfirm: the backup before a game version change failed, withoutBackup starts anyway
    start: (profileId: string, opts?: { withoutBackup?: boolean }) => Promise<{ success: boolean; message: string; needsConfirm?: 'no-backup' }>
    stop: (profileId: string) => Promise<{ success: boolean; message: string }>
    restart: (profileId: string) => Promise<{ success: boolean; message: string }>
    getStatus: (profileId: string) => Promise<string>
    getAllStatuses: () => Promise<Record<string, string>>
    sendCommand: (profileId: string, command: string) => Promise<{ success: boolean; output?: string; message?: string }>
    getPlayers: (profileId: string) => Promise<string[]>
    preflight: (profileId: string) => Promise<PreflightIssue[]>
    playerAction: (profileId: string, action: 'kick' | 'ban' | 'unban' | 'admin' | 'unadmin', name: string) => Promise<{ success: boolean; message?: string }>
    knownPlayers: (profileId: string) => Promise<{ success: boolean; message?: string; players?: Array<{ username: string; lastSeen?: string; role?: string; banned: boolean; banReason?: string }> }>
    restartWithWarning: (profileId: string, minutes: number) => Promise<{ success: boolean; message?: string }>
    listBackups: (profileId: string) => Promise<BackupInfo[]>
    backupNow: (profileId: string) => Promise<{ success: boolean; message: string; noWorld?: boolean }>
    restoreBackup: (profileId: string, name: string) => Promise<{ success: boolean; message: string }>
    openBackups: (profileId: string) => Promise<string>
    // where the server keeps its world, settings, players and log, and who else uses that folder
    dataFolder: (profileId: string) => Promise<{ path: string; exists: boolean; shared: boolean; sharedWith: string[] } | null>
    // copy its files into a folder of its own, check them, then switch to it
    useOwnDataFolder: (profileId: string) => Promise<{ success: boolean; message: string; worldSavePath?: string }>
    onModUpdates: (callback: (profileId: string, names: string[]) => void) => () => void
    networkInfo: () => Promise<{ publicIp: string | null; lanIps: string[] }>
    onPlayers: (callback: (profileId: string, players: string[]) => void) => () => void
    onProblem: (callback: (profileId: string, problem: ServerProblem) => void) => () => void
    onConsoleOutput: (profileId: string, callback: (line: string) => void) => () => void
    onStatusChange: (callback: (profileId: string, status: string) => void) => () => void
  }
  backups: {
    summary: (profileId: string) => Promise<{
      success: boolean; message?: string; count?: number; usageBytes?: number
      current?: GameNow
      lastRollback?: { at: string; backupId: string; beforeId?: string; branchBefore?: string; branchAfter?: string }
    }>
    check: (profileId: string, id: string) => Promise<{
      success: boolean; message?: string
      compat?: import('../../shared/backups').CompatResult
      current?: GameNow
      legacy?: boolean
      backup?: BackupInfo
      running?: boolean
      players?: number
      // newerWorld: its world won't load on the game version this switches to
      sharedWith?: Array<{ name: string; running: boolean; newerWorld?: boolean }>
    }>
    rollback: (profileId: string, id: string, opts: RollbackOpts) => Promise<RollbackOutcome>
    undoRollback: (profileId: string, opts?: { stopFirst?: boolean; warnMinutes?: number }) => Promise<RollbackOutcome>
    delete: (profileId: string, id: string) => Promise<{ success: boolean; message?: string }>
    updateGame: (installDir: string, opts?: { branch?: string; warnMinutes?: number }) => Promise<{ success: boolean; message: string; branch?: string }>
    onChanged: (callback: (profileId: string) => void) => () => void
    onProgress: (callback: (profileId: string, text: string) => void) => () => void
    onUpdateProgress: (callback: (installDir: string, text: string) => void) => () => void
  }
  // game updates, rollbacks, wipes and folder moves going on right now (and why each server can't start)
  busy: {
    list: () => Promise<BusyState>
    // the window has shown a finished job's result
    dismiss: (id: number) => Promise<void>
    onChanged: (callback: (state: BusyState) => void) => () => void
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
    // the server install's Steam build id (null when it isn't installed there)
    serverBuild: (installDir: string) => Promise<{ success: boolean; buildId: string | null; branch?: string; message?: string }>
  }
  workshop: {
    prepare: (profileId: string, modId: string) => Promise<{ success: boolean; message?: string; itemDir?: string; folder?: string; title?: string; workshopId?: string | null }>
    status: (profileId: string, modId: string) => Promise<{ success: boolean; message?: string; prepared?: boolean; workshopId?: string | null; itemDir?: string }>
    useWorkshopCopy: (profileId: string, modId: string, workshopId: string) => Promise<{ success: boolean; message?: string; visibleToSteamApi?: boolean }>
    openFolder: (dir: string) => Promise<{ success: boolean; message?: string }>
  }
  modBackups: {
    status: (withSize?: boolean) => Promise<{
      success: boolean; message?: string; enabled?: boolean; dir?: string; sizeBytes?: number
      // workshop id -> newest saved copy
      items?: Record<string, { name?: string; savedAt: string; versions: number }>
    }>
    configure: (patch: { enabled?: boolean; dir?: string }) => Promise<{ success: boolean; message?: string }>
    backupNow: (items: Array<{ workshopId: string; name?: string; installDir?: string }>) => Promise<{ success: boolean; message?: string; saved?: number; same?: number; missing?: number }>
    use: (workshopId: string, worldSavePath?: string) => Promise<{
      success: boolean; message?: string; folders?: string[]; infos?: import('../../shared/modCore').ModInfo[]; savedAt?: string
    }>
  }
  client: {
    state: () => Promise<{ success: boolean; message?: string; gameFound?: boolean; gameDir?: string; dataDir?: string; workshopDownloaded?: string[] }>
    searchDrives: () => Promise<{ success: boolean; message?: string; found?: string[] }>
    useGameDir: (dir: string) => Promise<{ success: boolean; message?: string; gameDir?: string }>
    // game: the player's installed build and Steam branch, null if it couldn't be read
    listServers: () => Promise<{ success: boolean; message?: string; gameDir?: string; servers?: PlayServerInfo[]; game?: import('../../shared/gameVersion').ClientGame | null }>
    openPack: () => Promise<{ success: boolean; message?: string; cancelled?: boolean; saved?: { id: string } }>
    removeServer: (id: string) => Promise<{ success: boolean; message?: string }>
    setAccount: (id: string, account: { username: string; password: string }) => Promise<{ success: boolean; message?: string }>
    installFixes: (id: string) => Promise<{ success: boolean; message?: string; installed?: string[]; backedUp?: string[] }>
    launch: (id?: string, join?: boolean) => Promise<{ success: boolean; message?: string }>
    exportPack: (profileId: string, opts: { address?: string; includePassword?: boolean; includeSettings?: boolean }) => Promise<{
      success: boolean; message?: string; cancelled?: boolean; path?: string; fixMods?: number; workshopItems?: number
    }>
    // the pack's fix mod files stay in the main process, only their names come back
    openPackForHost: () => Promise<{ success: boolean; message?: string; cancelled?: boolean; path?: string; pack?: import('../../shared/serverPack').ServerPack; droppedSettings?: string[] }>
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

// one world backup, as the list shows it
interface BackupInfo {
  name: string
  sizeMb: number
  createdAt: string
  reason: import('../../shared/backups').BackupReason
  legacy: boolean
  game: { buildId?: string; branch?: string; version?: string; worldVersion?: number; label?: string }
  modCount: number
  configFiles: number
  savedFirst?: boolean
  unsettledFiles?: number
}

// the game server a server runs on right now
interface GameNow {
  buildId: string | null
  branch: string
  version?: string
  label: string
  worldVersion?: number
}

interface RollbackOpts {
  switchBranch?: string | null
  restoreMods?: boolean
  restoreSettings?: boolean
  force?: boolean
  stopFirst?: boolean
  warnMinutes?: number
}

interface RollbackOutcome {
  success: boolean
  message: string
  beforeId?: string
  gameChanged?: { branch: string; label: string; version?: string }
  playerSteps?: string
  modsRestored?: boolean
  settingsRestored?: boolean
}

// something changing a game server install or a server's world right now (electron/ipc/busy.ts)
interface BusyJobInfo {
  id: number
  kind: 'game-update' | 'rollback' | 'wipe' | 'data-folder'
  profileId?: string
  installDir?: string
  progress: string
  startedAt: number
  // finished, with its result still to show
  done?: boolean
  result?: unknown
}

interface BusyState {
  jobs: BusyJobInfo[]
  // servers that can't start right now, and why
  blocked: Record<string, string>
}

interface SteamBranchInfo {
  name: string
  buildId: string
  description?: string
  timeUpdated?: number
  pwdRequired?: boolean
  downloadBytes?: number
  // "42.21 fall-back", "Latest"
  label: string
  version?: string
}

// how a server install compares with what Steam has (steamcmd.ts checkServerUpdate)
interface ServerUpdateState {
  checked: boolean
  updateAvailable: boolean
  installed: string | null
  latest: string | null
  steamManaged: boolean
  branch: string
  branchLabel: string
  chosenBranch?: string
  branchMissing: boolean
  behindPublic: boolean
  publicBuild: string | null
  installedVersion?: string
  latestVersion?: string
  publicVersion?: string
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
  // what the button next to it opens
  fix?: 'open-mods' | 'open-console'
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
  type ServerUpdateInfo = ServerUpdateState
  type WorldBackup = BackupInfo
  type GameVersionNow = GameNow
  type RollbackOptions = RollbackOpts
  type RollbackResult = RollbackOutcome
  type BusyJob = BusyJobInfo
  type BusyNow = BusyState
  type SteamBranchOption = SteamBranchInfo
  type ServerPreflightIssue = PreflightIssue
  type ServerProblemReport = ServerProblem
  type PlayitState = PlayitStateInfo
  type UpnpReport = UpnpReportInfo
}

export {}
